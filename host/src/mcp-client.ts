// A minimal MCP client (Streamable HTTP). Every request and response that crosses the wire is
// recorded in `entries`, which is what the inspector shows. Nothing is simulated here.
export interface WireEntry {
  id: number; at: number; dir: 'out' | 'in'; kind: 'request' | 'response' | 'notification' | 'server-request' | 'client-response';
  method?: string; label: string; body: unknown; status?: number; ms?: number;
}
type Json = any;
export interface ElicitParams { message: string; requestedSchema: { properties: Record<string, any>; required?: string[] } }
export type ElicitHandler = (p: ElicitParams) => Promise<{ action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }>;

export class McpClient {
  entries: WireEntry[] = [];
  tools: any[] = [];
  sid = '';
  private rid = 0; private eid = 0;
  private subs = new Set<() => void>();
  constructor(private url = '/mcp') {}
  subscribe(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private log(e: Omit<WireEntry, 'id' | 'at'>) { this.entries = [...this.entries, { id: ++this.eid, at: Date.now(), ...e }]; this.subs.forEach(f => f()); }

  private async post(body: Json, kind: WireEntry['kind'], label: string) {
    const t0 = performance.now();
    this.log({ dir: 'out', kind, method: body.method, label, body });
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.sid) headers['Mcp-Session-Id'] = this.sid;
    const res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body) });
    return { res, t0 };
  }

  async connect() {
    const init = { jsonrpc: '2.0', id: ++this.rid, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: { form: {} } }, clientInfo: { name: 'doublecheck-simulated-host', version: '0.1.0' } } };
    const { res, t0 } = await this.post(init, 'request', 'initialize');
    this.sid = res.headers.get('mcp-session-id') ?? '';
    const out = await res.json();
    this.log({ dir: 'in', kind: 'response', label: 'initialize', body: out, status: res.status, ms: Math.round(performance.now() - t0) });
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'notification', 'notifications/initialized');
    const { res: r2, t0: t2 } = await this.post({ jsonrpc: '2.0', id: ++this.rid, method: 'tools/list' }, 'request', 'tools/list');
    const list = await r2.json();
    this.log({ dir: 'in', kind: 'response', label: 'tools/list', body: list, status: r2.status, ms: Math.round(performance.now() - t2) });
    this.tools = list.result?.tools ?? [];
  }

  async callTool(name: string, args: Json, onElicit: ElicitHandler): Promise<Json> {
    const id = ++this.rid;
    const { res, t0 } = await this.post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, 'request', `tools/call ${name}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/event-stream')) {
      const out = await res.json();
      this.log({ dir: 'in', kind: 'response', label: `tools/call ${name}`, body: out, status: res.status, ms: Math.round(performance.now() - t0) });
      return out;
    }
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Stream ended before the tool finished');
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (!data) continue;
        const msg = JSON.parse(data);
        if (msg.method === 'elicitation/create') {
          this.log({ dir: 'in', kind: 'server-request', method: msg.method, label: 'elicitation/create', body: msg, ms: Math.round(performance.now() - t0) });
          const answer = await onElicit(msg.params);
          const reply = { jsonrpc: '2.0', id: msg.id, result: answer };
          const { res: ack } = await this.post(reply, 'client-response', `elicitation reply (${answer.action})`);
          if (ack.status !== 202) throw new Error('Server did not accept the answer');
        } else if (msg.id === id) {
          this.log({ dir: 'in', kind: 'response', label: `tools/call ${name}`, body: msg, status: 200, ms: Math.round(performance.now() - t0) });
          return msg;
        }
      }
    }
  }
}
