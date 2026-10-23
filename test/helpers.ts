import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/index.ts';
import { fixedClock } from '../server/clock.ts';

export async function boot(elicitTimeoutMs = 3000) {
  const dir = mkdtempSync(join(tmpdir(), 'doublecheck-'));
  const clock = fixedClock('2026-10-22T16:30:00Z'); // 22:00 India
  const app = createApp({ dataFile: join(dir, 'events.jsonl'), clock, elicitTimeoutMs, staticDir: dir });
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/mcp`;
  return { ...app, url, close: () => new Promise<void>(r => { app.server.close(() => r()); app.server.closeAllConnections(); }) };
}

export async function rpc(url: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
  return r;
}

export async function init(url: string, caps: object = { elicitation: { form: {} } }) {
  const r = await rpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: caps, clientInfo: { name: 'test', version: '0' } } });
  const sid = r.headers.get('mcp-session-id') ?? '';
  const body = await r.json();
  await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'Mcp-Session-Id': sid });
  return { sid, body };
}

// Read an SSE response, yielding parsed JSON messages as they arrive.
export async function* sse(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) return;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (data) yield JSON.parse(data);
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}
