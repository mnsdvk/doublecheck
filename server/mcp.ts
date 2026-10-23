// Protocol adapter: MCP over Streamable HTTP (spec 2025-11-25), hand-written because the
// official SDK is not installable in the build workspace. Everything product-specific lives in
// tools.ts; this file is the single swap point if the official SDK is used instead.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export const LATEST = '2025-11-25';
export const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26'];

export interface JsonSchema { type?: string; properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]; items?: JsonSchema; description?: string; additionalProperties?: boolean; title?: string }

export interface ElicitResult { action: 'accept' | 'decline' | 'cancel' | 'unsupported' | 'timeout'; content?: Record<string, unknown> }
export interface ToolContext { elicit(message: string, schema: JsonSchema): Promise<ElicitResult>; canElicit: boolean }
export interface ToolResult { content: { type: 'text'; text: string }[]; structuredContent?: unknown; isError?: boolean; _meta?: unknown }
export interface ToolDef {
  name: string; title: string; description: string; inputSchema: JsonSchema;
  annotations?: Record<string, unknown>;
  handler(args: any, ctx: ToolContext): Promise<ToolResult>;
}

export interface McpOptions { serverName: string; version: string; tools: ToolDef[]; elicitTimeoutMs?: number; elicitDefault?: boolean }

type Json = any;
const rpcError = (id: Json, code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
const rpcResult = (id: Json, result: unknown) => ({ jsonrpc: '2.0', id, result });

// Small JSON-Schema subset validator (type, required, enum, properties, items, additionalProperties).
export function validate(schema: JsonSchema, value: any, path = 'arguments'): string | null {
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}`;
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${path} must be an object`;
      for (const r of schema.required ?? []) if (value[r] === undefined || value[r] === null || value[r] === '') return `${path}.${r} is required`;
      for (const [k, v] of Object.entries(value)) {
        const s = schema.properties?.[k];
        if (!s) { if (schema.additionalProperties === false) return `${path}.${k} is not a known field`; continue; }
        const e = validate(s, v, `${path}.${k}`); if (e) return e;
      }
      return null;
    }
    case 'string': return typeof value === 'string' ? null : `${path} must be a string`;
    case 'number': case 'integer': return typeof value === 'number' ? null : `${path} must be a number`;
    case 'boolean': return typeof value === 'boolean' ? null : `${path} must be a boolean`;
    case 'array': {
      if (!Array.isArray(value)) return `${path} must be an array`;
      if (schema.items) for (let i = 0; i < value.length; i++) { const e = validate(schema.items, value[i], `${path}[${i}]`); if (e) return e; }
      return null;
    }
    default: return null;
  }
}

export function createMcpHandler(opts: McpOptions) {
  const sessions = new Map<string, { elicitation: boolean }>();
  const pending = new Map<string, (r: Json) => void>();
  let elicitCounter = 0;

  async function readBody(req: IncomingMessage): Promise<string> {
    return await new Promise((resolve, reject) => {
      let b = ''; req.on('data', c => { b += c; if (b.length > 1_000_000) reject(new Error('too large')); }); req.on('end', () => resolve(b)); req.on('error', reject);
    });
  }
  const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body));
  };

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return; }
    let msg: Json;
    try { msg = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, rpcError(null, -32700, 'Parse error')); }
    if (Array.isArray(msg) || typeof msg !== 'object' || msg === null || msg.jsonrpc !== '2.0') return sendJson(res, 400, rpcError(null, -32600, 'Invalid Request'));

    // A client reply to a server request (elicitation) has an id and a result/error but no method.
    if (msg.method === undefined && msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const fn = pending.get(String(msg.id));
      if (fn) { pending.delete(String(msg.id)); fn(msg); }
      res.writeHead(202); res.end(); return;
    }
    if (typeof msg.method !== 'string') return sendJson(res, 400, rpcError(msg.id, -32600, 'Invalid Request'));
    if (msg.id === undefined) { res.writeHead(202); res.end(); return; } // notification

    const sid = String(req.headers['mcp-session-id'] ?? '');
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        const version = SUPPORTED.includes(asked) ? asked : LATEST;
        const id = randomUUID();
        sessions.set(id, { elicitation: !!msg.params?.capabilities?.elicitation });
        return sendJson(res, 200, rpcResult(msg.id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: opts.serverName, version: opts.version },
          instructions: 'Doublecheck checks whether what a device or agent reported actually happened, using independent evidence. It answers Worked, Problem found or Not verified, shows its evidence, never states a cause it cannot show, and never claims safety.',
        }), { 'Mcp-Session-Id': id });
      }
      case 'ping': return sendJson(res, 200, rpcResult(msg.id, {}));
      case 'tools/list':
        return sendJson(res, 200, rpcResult(msg.id, { tools: opts.tools.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) })) }));
      case 'tools/call': {
        const tool = opts.tools.find(t => t.name === msg.params?.name);
        if (!tool) return sendJson(res, 200, rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`));
        const args = msg.params?.arguments ?? {};
        const bad = validate(tool.inputSchema, args);
        if (bad) return sendJson(res, 200, rpcError(msg.id, -32602, `Invalid params: ${bad}`));

        const canElicit = sessions.get(sid)?.elicitation ?? (sid ? false : (opts.elicitDefault ?? true));
        let streaming = false;
        const write = (m: unknown) => res.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`);
        const ctx: ToolContext = {
          canElicit,
          async elicit(message, schema) {
            if (!canElicit) return { action: 'unsupported' };
            if (!streaming) { streaming = true; res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); }
            const eid = `elicit-${++elicitCounter}`;
            write({ jsonrpc: '2.0', id: eid, method: 'elicitation/create', params: { mode: 'form', message, requestedSchema: schema } });
            return await new Promise<ElicitResult>(resolve => {
              const timer = setTimeout(() => { pending.delete(eid); resolve({ action: 'timeout' }); }, opts.elicitTimeoutMs ?? 120_000);
              pending.set(eid, (r: Json) => { clearTimeout(timer); resolve(r.error ? { action: 'cancel' } : { action: r.result?.action ?? 'cancel', content: r.result?.content }); });
            });
          },
        };
        let out: Json;
        try { out = rpcResult(msg.id, await tool.handler(args, ctx)); }
        catch (e: any) { out = rpcResult(msg.id, { content: [{ type: 'text', text: `Nothing was recorded. ${e?.message ?? 'Tool failed.'}` }], isError: true }); }
        if (streaming) { write(out); res.end(); } else sendJson(res, 200, out);
        return;
      }
      default: return sendJson(res, 200, rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
    }
  };
}
