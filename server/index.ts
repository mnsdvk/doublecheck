import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpHandler } from './mcp.ts';
import { Store } from './store.ts';
import { seedDemo, DEMO_NOW } from './seed.ts';
import { buildTools } from './tools.ts';
import { systemClock, fixedClock, type Clock } from './clock.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function createApp(opts: { dataFile: string | null; clock?: Clock & { set?(iso: string): void }; dev?: boolean; elicitTimeoutMs?: number; staticDir?: string }) {
  const store = new Store(opts.dataFile);
  const dev = opts.dev ?? process.env.DOUBLECHECK_DEV === '1';
  // Dev mode uses a settable demo clock (Thu 22 Oct 2026, 10:00 pm India time) and seeds labelled synthetic history if the data file is empty.
  const clock: Clock & { set?(iso: string): void } = opts.clock ?? (dev ? fixedClock(process.env.DOUBLECHECK_NOW ?? DEMO_NOW) : systemClock());
  if (dev && store.size === 0) seedDemo(store);
  const mcp = createMcpHandler({ serverName: 'doublecheck', version: '0.1.0', tools: buildTools(store, clock), elicitTimeoutMs: opts.elicitTimeoutMs });
  const staticDir = opts.staticDir ?? join(root, 'host', 'dist');
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/mcp') return void mcp(req, res);
    if (url.pathname === '/api/now') { res.writeHead(200, { 'Content-Type': 'application/json' }); return void res.end(JSON.stringify({ now: clock.now().toISOString(), dev })); }
    if (url.pathname === '/api/dev/clock' && dev && req.method === 'POST') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => { try { const t = JSON.parse(b).now; if (Number.isNaN(Date.parse(t)) || !clock.set) throw new Error('bad time'); clock.set(t); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ now: clock.now().toISOString() })); } catch { res.writeHead(400); res.end(); } });
      return;
    }
    if (url.pathname === '/api/dev/reset' && dev && req.method === 'POST') { store.reset(); seedDemo(store); clock.set?.(DEMO_NOW); res.writeHead(200, { 'Content-Type': 'application/json' }); return void res.end(JSON.stringify({ ok: true, now: clock.now().toISOString() })); }
    if (req.method !== 'GET') { res.writeHead(405); return void res.end(); }
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''); if (p === '/' || p === '\\') p = '/index.html';
    const file = join(staticDir, p);
    if (!file.startsWith(staticDir) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return void res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }); res.end(readFileSync(file));
  });
  return { server, store, clock };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  // Flags instead of environment variables so the same commands work in PowerShell, cmd and bash.
  const arg = (name: string) => { const hit = process.argv.find(a => a.startsWith(`--${name}=`)); return hit?.slice(name.length + 3); };
  const dev = process.argv.includes('--dev') || process.env.DOUBLECHECK_DEV === '1';
  const port = Number(arg('port') ?? process.env.PORT ?? 8787);
  const { server } = createApp({ dataFile: arg('data') ?? process.env.DOUBLECHECK_DATA ?? join(root, 'data', 'events.jsonl'), dev });
  server.listen(port, '127.0.0.1', () => console.log(`Doublecheck: http://127.0.0.1:${port}  (MCP endpoint: POST /mcp)${dev ? '  [demo clock on]' : ''}`));
}
