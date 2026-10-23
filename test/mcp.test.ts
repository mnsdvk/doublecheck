import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/index.ts';
import { fixedClock } from '../server/clock.ts';
import { seedDemo } from '../server/seed.ts';
import { rpc, init, sse } from './helpers.ts';

const NOW = '2026-10-22T16:30:00Z';
async function setup(opts: { seed?: boolean; caps?: object } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'doublecheck-mcp-')); const clock = fixedClock(NOW);
  const app = createApp({ dataFile: join(dir, 'events.jsonl'), clock, elicitTimeoutMs: 800, staticDir: dir });
  if (opts.seed) seedDemo(app.store);
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/mcp`;
  const { sid, body } = await init(url, opts.caps ?? { elicitation: { form: {} } }); let id = 10;
  async function call(name: string, args: object = {}, answer?: Record<string, unknown> | 'decline' | 'silence') {
    const res = await rpc(url, { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, { 'Mcp-Session-Id': sid });
    const asked: string[] = [];
    if (!(res.headers.get('content-type') ?? '').includes('event-stream')) { const j = await res.json(); const r = j.result ?? { isError: true, rpcError: j.error }; r.asked = asked; return r; }
    for await (const m of sse(res)) {
      if (m.method === 'elicitation/create') {
        asked.push(m.params.message); if (answer === 'silence') continue;
        await rpc(url, { jsonrpc: '2.0', id: m.id, result: answer === 'decline' || !answer ? { action: 'decline' } : { action: 'accept', content: answer } }, { 'Mcp-Session-Id': sid });
      } else if (m.id === id) { m.result.asked = asked; return m.result; }
    }
  }
  const t = (offsetS: number) => new Date(Date.parse(NOW) - 3600000 + offsetS * 1000).toISOString();
  return { app, url, sid, body, call, t, close: () => new Promise<void>(r => { app.server.close(() => r()); app.server.closeAllConnections(); }) };
}

test('initialize negotiates the protocol and lists the tools with honest descriptions', async () => {
  const s = await setup();
  assert.equal(s.body.result.protocolVersion, '2025-11-25'); assert.equal(s.body.result.serverInfo.name, 'doublecheck');
  const r = await (await rpc(s.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'Mcp-Session-Id': s.sid })).json();
  const names = r.result.tools.map((x: any) => x.name).sort();
  assert.deepEqual(names, ['apply_fix', 'get_evidence', 'get_history', 'list_devices', 'night_check', 'record_observation', 'record_run', 'report_claim', 'review_run', 'review_trend', 'verify_outcome']);
  assert.ok(r.result.tools.every((x: any) => x.description.length > 40 && x.inputSchema.type === 'object'));
  await s.close();
});

test('valve story over MCP: claim, independent readings, then the contradiction with evidence', async () => {
  const s = await setup();
  const c = await s.call('report_claim', { device_id: 'valve_main', command: 'close', state: 'closed', reported_by: 'Alexa+ routine', at: s.t(0) });
  assert.equal(c.structuredContent.recorded, true);
  const early = await s.call('verify_outcome', { device_id: 'valve_main' }); // clock is long past, but no readings yet
  assert.equal(early.structuredContent.finding.verdict, 'NOT_VERIFIED');
  for (const [off, v] of [[120, 6.2], [160, 6.0]] as const) await s.call('record_observation', { device_id: 'valve_main', source: 'flow_meter', metric: 'flow_lpm', value: v, independent: true, at: s.t(off) });
  const late = await s.call('verify_outcome', { device_id: 'valve_main' });
  const f = late.structuredContent.finding; assert.equal(f.verdict, 'PROBLEM_FOUND'); assert.equal(f.suggested_fix.id, 'resend_close'); assert.equal(f.synthetic, true);
  const ev = await s.call('get_evidence', { finding_id: f.id }); assert.equal(ev.structuredContent.finding.id, f.id);
  const h = await s.call('get_history', { device_id: 'valve_main' }); assert.ok(h.structuredContent.history.length >= 2);
  await s.close();
});

test('apply_fix: approval is asked with the exact action; only an explicit yes acts; the result still needs a recheck', async () => {
  const s = await setup();
  const ok = await s.call('apply_fix', { device_id: 'valve_main', fix_id: 'resend_close' }, { approve: true });
  assert.equal(ok.asked.length, 1); assert.match(ok.asked[0], /Send the close command again/); assert.match(ok.asked[0], /simulated/i);
  assert.equal(ok.structuredContent.applied, true); assert.equal(ok.structuredContent.simulated, true); assert.match(ok.content[0].text, /not yet a result/);
  const after = await s.call('verify_outcome', { device_id: 'valve_main' }); assert.equal(after.structuredContent.finding.verdict, 'NOT_VERIFIED'); // a fix is an action; only readings make it Worked
  const n = s.app.store.size;
  for (const answer of ['decline', { approve: false }, 'silence'] as const) {
    const r = await s.call('apply_fix', { device_id: 'valve_main', fix_id: 'resend_close' }, answer); assert.equal(r.structuredContent.applied, false);
  }
  assert.equal(s.app.store.claims('valve_main').length, 1, 'declined, refused and unanswered fixes add no new claim'); assert.ok(s.app.store.size > n); // the refusals themselves are logged
  await s.close();
});

test('apply_fix on a host that cannot ask does nothing', async () => {
  const s = await setup({ caps: {} });
  const r = await s.call('apply_fix', { device_id: 'valve_main', fix_id: 'resend_close' });
  assert.equal(r.structuredContent.applied, false); assert.match(r.content[0].text, /cannot ask for approval/); assert.equal(s.app.store.claims('valve_main').length, 0);
  await s.close();
});

test('night check over seeded history keeps current, run, trend and unverified apart', async () => {
  const s = await setup({ seed: true });
  const r = await s.call('night_check'); const n = r.structuredContent.night;
  assert.equal(n.current.length, 0, 'nothing historical is presented as current');
  assert.deepEqual(n.run.map((f: any) => f.device_id), ['cleaner_floor']); assert.deepEqual(n.trend.map((f: any) => f.device_id), ['geyser_bath']);
  assert.deepEqual(n.not_verified.map((f: any) => f.device_id), ['lock_front']); assert.deepEqual(n.worked.map((f: any) => f.device_id).sort(), ['ac_bedroom', 'lights_living']);
  assert.match(r.structuredContent.spoken, /Over recent weeks, not tonight/); assert.equal(r.structuredContent.checked, 5);
  await s.close();
});

test('bad input is refused with nothing recorded', async () => {
  const s = await setup(); const before = s.app.store.size;
  const missing = await s.call('verify_outcome', {}); assert.equal(missing.isError, true); assert.equal(missing.rpcError.code, -32602);
  const unknown = await s.call('verify_outcome', { device_id: 'toaster' }); assert.equal(unknown.isError, true); assert.match(unknown.content[0].text, /Unknown device/);
  const nan = await s.call('record_observation', { device_id: 'valve_main', source: 'x', metric: 'flow_lpm', value: null as any, independent: true }); assert.equal(nan.isError, true);
  const badTime = await s.call('report_claim', { device_id: 'valve_main', command: 'close', state: 'closed', at: 'yesterday-ish' }); assert.equal(badTime.isError, true); assert.match(badTime.content[0].text, /^Nothing was recorded/);
  const noClaim = await s.call('verify_outcome', { device_id: 'valve_main' }); assert.equal(noClaim.isError, true);
  const badRun = await s.call('record_run', { device_id: 'valve_main', started_at: NOW, duration_min: 5 }); assert.equal(badRun.isError, true);
  assert.equal(s.app.store.size, before);
  await s.close();
});

test('a second problem on the same device is remembered across sessions', async () => {
  const s = await setup();
  const mk = async (off: number) => { const c = await s.call('report_claim', { device_id: 'valve_main', command: 'close', state: 'closed', at: s.t(off) }); for (const k of [120, 160]) await s.call('record_observation', { device_id: 'valve_main', source: 'flow_meter', metric: 'flow_lpm', value: 6, independent: true, at: s.t(off + k) }); return c.structuredContent.claim.id; };
  const id1 = await mk(0); const f1 = (await s.call('verify_outcome', { device_id: 'valve_main', claim_id: id1 })).structuredContent.finding;
  assert.equal(f1.verdict, 'PROBLEM_FOUND'); assert.doesNotMatch(f1.explanation.join(' '), /not the first time/);
  const id2 = await mk(600); const f2 = (await s.call('verify_outcome', { device_id: 'valve_main', claim_id: id2 })).structuredContent.finding;
  assert.match(f2.explanation.join(' '), /not the first time: 1 earlier problem was found/);
  await s.close();
});

test('every stored record is marked synthetic, and records are only ever appended', async () => {
  const s = await setup({ seed: true }); await s.call('night_check');
  const all = s.app.store as any; const events = (all.events as any[]);
  assert.ok(events.every(e => e.kind === 'verification' || e.kind === 'fix' || e.synthetic === true));
  assert.deepEqual(events.map(e => e.seq), events.map((_, i) => i + 1));
  const f = events.filter(e => e.kind === 'verification').every(e => e.finding.synthetic === true); assert.ok(f);
  await s.close();
});
