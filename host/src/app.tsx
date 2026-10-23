import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LuMessageSquareText, LuPanelBottomOpen, LuSend, LuChevronRight, LuCopy, LuCheck, LuRotateCcw } from 'react-icons/lu';
import { McpClient, type ElicitParams, type WireEntry } from './mcp-client.ts';
import { route, EXAMPLES } from './router.ts';
import { Mark, Home, Heard, SaidDone, Contradiction, TrendView, RunView, NightView, EvidenceDrawer, ApproveSheet } from './views.tsx';
import { fmtDay, fmtTime, fmtDate } from '../../shared/time.ts';
import type { Finding } from '../../server/model.ts';

const client = new McpClient('/mcp');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Night = { current: Finding[]; earlier: Finding[]; run: Finding[]; trend: Finding[]; not_verified: Finding[]; worked: Finding[] };
type Valve = { step: 'said' | 'checking' | 'result' | 'rechecking' | 'fixed'; claimIso: string; before?: Finding; finding?: Finding; fixAt?: number; line: string };
type Scene =
  | { kind: 'home' } | { kind: 'heard'; text: string; state: 'listening' | 'processing' }
  | { kind: 'valve'; v: Valve } | { kind: 'trend'; f: Finding } | { kind: 'run'; f: Finding } | { kind: 'night'; spoken: string; night: Night; back?: Scene } | { kind: 'other'; f: Finding }
  | { kind: 'error'; message: string };

export function App() {
  const [scene, setScene] = useState<Scene>({ kind: 'home' });
  const [report, setReport] = useState<Night | null>(null);
  const [daysAgo, setDaysAgo] = useState(0); const [note, setNote] = useState<{ title: string; text: string; action?: { label: string; utterance: string } } | null>(null);
  const [seen, setSeen] = useState<Record<string, Finding>>({});
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date()); const [dev, setDev] = useState(false);
  const [connected, setConnected] = useState<'connecting' | 'ok' | 'down'>('connecting');
  const [inspect, setInspect] = useState(false); const [evidence, setEvidence] = useState<Finding | null>(null);
  const [ask, setAsk] = useState<{ params: ElicitParams; resolve: (r: { action: 'accept' | 'decline'; content?: Record<string, unknown> }) => void } | null>(null);
  const entries = useSyncEntries(); const stageRef = useRef<HTMLDivElement>(null); const [scale, setScale] = useState(1);
  const sceneRef = useRef<Scene>(scene); sceneRef.current = scene;

  useEffect(() => { client.connect().then(() => setConnected('ok')).catch(() => setConnected('down')); refreshNow(); }, []);
  useLayoutEffect(() => { const el = stageRef.current; if (!el) return; const fit = () => setScale(Math.min(1, el.clientWidth / 1280)); fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect(); }, []);
  async function refreshNow() { try { const j = await (await fetch('/api/now')).json(); setNow(new Date(j.now)); setDev(!!j.dev); return { now: new Date(j.now) as Date, dev: !!j.dev }; } catch { return { now: new Date(), dev: false }; } }
  async function setClock(ms: number) { await fetch('/api/dev/clock', { method: 'POST', body: JSON.stringify({ now: new Date(ms).toISOString() }) }); await refreshNow(); }
  async function resetDemo() { if (busy) return; await fetch('/api/dev/reset', { method: 'POST' }); await refreshNow(); setScene({ kind: 'home' }); setEvidence(null); setSeen({}); setReport(null); setDaysAgo(0); setNote(null); await loadReport(0); }
  const no = async () => ({ action: 'decline' as const });
  async function tool(name: string, args: object, elicit: Parameters<McpClient['callTool']>[2] = no) {
    const out = await client.callTool(name, args, elicit); if (out.error) throw new Error(out.error.message);
    if (out.result?.isError) throw new Error(out.result.content?.[0]?.text ?? 'The tool refused.'); return out.result;
  }

  async function say(utterance: string) {
    const u = utterance.trim(); if (!u || busy) return; setBusy(true); setEvidence(null);
    try {
      setScene({ kind: 'heard', text: '', state: 'listening' });
      const step = Math.max(8, Math.min(28, 800 / u.length)); for (let i = 1; i <= u.length; i++) { setScene({ kind: 'heard', text: u.slice(0, i), state: 'listening' }); await sleep(step); }
      const intent = route(u);
      if (intent === 'unknown') { setScene({ kind: 'error', message: 'I can check the main water valve, the geyser, the floor cleaner, or everything at once. Try one of those.' }); return; }
      if (connected !== 'ok') { setScene({ kind: 'error', message: 'Doublecheck is not connected. Nothing was checked.' }); return; }
      setScene({ kind: 'heard', text: u, state: 'processing' });
      if (intent === 'valve') return await playValve();
      if (intent === 'trend') { const r = await tool('review_trend', { device_id: 'geyser_bath' }); return setScene({ kind: 'trend', f: r.structuredContent.finding }); }
      if (intent === 'run') { const r = await tool('review_run', { device_id: 'cleaner_floor' }); return setScene({ kind: 'run', f: r.structuredContent.finding }); }
      const r = await tool('night_check', {}); setScene({ kind: 'night', spoken: r.structuredContent.spoken, night: r.structuredContent.night });
    } catch (e: any) { setScene({ kind: 'error', message: `I couldn't finish that check. Nothing was changed. (${e.message})` }); }
    finally { setBusy(false); }
  }

  // The simulated devices. Each reading below is posted to the real MCP server exactly as a real sensor adapter would post it.
  async function playValve() {
    const info = await refreshNow(); if (!info.dev) throw new Error('The scenes need the demo clock. Start the server with npm run dev.');
    const t0 = info.now.getTime(); const iso = (s: number) => new Date(t0 + s * 1000).toISOString();
    // Everything is recorded up front, so leaving the screen mid-story can never leave a half-recorded event behind.
    await tool('report_claim', { device_id: 'valve_main', command: 'close', state: 'closed', reported_by: 'Alexa+ routine', at: iso(0) });
    for (const [s, flow] of [[20, 6.4], [55, 6.3], [110, 6.2], [150, 6.0], [190, 6.1]] as const) await tool('record_observation', { device_id: 'valve_main', source: 'flow_meter', metric: 'flow_lpm', value: flow, independent: true, at: iso(s) });
    await setClock(t0 + 200_000);
    const v0: Valve = { step: 'said', claimIso: iso(0), line: 'Done. The main water valve is closed.' }; setScene({ kind: 'valve', v: v0 }); await sleep(2200);
    setScene({ kind: 'valve', v: { ...v0, step: 'checking' } }); await sleep(1100);
    const r = await tool('verify_outcome', { device_id: 'valve_main' }); setScene({ kind: 'valve', v: { ...v0, step: 'result', finding: r.structuredContent.finding } });
  }
  async function fixValve() {
    const cur = sceneRef.current; if (cur.kind !== 'valve' || !cur.v.finding || busy) return; const v = cur.v; setBusy(true);
    try {
      const r = await tool('apply_fix', { device_id: 'valve_main', fix_id: 'resend_close' }, params => new Promise(resolve => setAsk({ params, resolve: a => { setAsk(null); resolve(a); } })));
      if (!r.structuredContent.applied) { return; }
      const t1 = (await refreshNow()).now.getTime(); const iso = (s: number) => new Date(t1 + s * 1000).toISOString();
      setScene({ kind: 'valve', v: { ...v, step: 'rechecking', before: v.finding, fixAt: t1 } });
      for (const [s, flow] of [[30, 2.4], [70, 0.4], [100, 0.03], [130, 0.02], [160, 0.02]] as const) await tool('record_observation', { device_id: 'valve_main', source: 'flow_meter', metric: 'flow_lpm', value: flow, independent: true, at: iso(s) });
      await setClock(t1 + 170_000); await sleep(1200);
      const a = await tool('verify_outcome', { device_id: 'valve_main' }); setScene({ kind: 'valve', v: { ...v, step: 'fixed', before: v.finding, finding: a.structuredContent.finding, fixAt: t1 } });
    } catch (e: any) { setScene({ kind: 'error', message: `The fix did not finish. ${e.message}` }); }
    finally { setBusy(false); }
  }
  function openFinding(f: Finding) { setScene(s => ({ kind: f.scope === 'trend' ? 'trend' : f.scope === 'run' ? 'run' : 'other', f, back: s } as any)); }

  useEffect(() => {
    const sc: any = scene; const fs: Finding[] = [];
    if (sc.kind === 'valve' && sc.v?.finding) fs.push(sc.v.finding);
    if ((sc.kind === 'trend' || sc.kind === 'run') && sc.f) fs.push(sc.f);
    if (sc.kind === 'night' && sc.night) for (const k of ['current', 'earlier', 'run', 'trend', 'not_verified', 'worked']) fs.push(...(sc.night[k] ?? []));
    if (fs.length) setSeen(p => ({ ...p, ...Object.fromEntries(fs.map(f => [f.device_id, f])) }));
  }, [scene]);
  async function loadReport(d = daysAgo) { try { const r = await tool('night_check', d ? { days_ago: d } : {}); setReport(r.structuredContent.night); } catch { setReport({ current: [], earlier: [], run: [], trend: [], not_verified: [], worked: [] }); } }
  function pickDay(d: number) { setDaysAgo(d); setReport(null); }
  useEffect(() => { if (scene.kind === 'home' && connected === 'ok') loadReport(daysAgo); }, [scene.kind, connected, daysAgo]);
  useEffect(() => { if (!report || daysAgo) return; const fs: Finding[] = []; for (const k of ['current', 'earlier', 'run', 'trend', 'not_verified', 'worked'] as const) fs.push(...report[k]); setSeen(p => ({ ...p, ...Object.fromEntries(fs.map(f => [f.device_id, f])) })); }, [report, daysAgo]);
  function openAny(f: Finding) {
    if (f.scope === 'trend') return setScene({ kind: 'trend', f });
    if (f.scope === 'run') return setScene({ kind: 'run', f });
    if (f.device_id === 'valve_main' && f.verdict === 'PROBLEM_FOUND') { const c = f.evidence.find(e => e.role === 'claim'); return setScene({ kind: 'valve', v: { step: 'result', claimIso: c?.at ?? f.as_of, line: '', finding: f } }); }
    setEvidence(f);
  }
  const scn = scene;
  return (
    <div className={`page ${inspect ? 'insp-open' : ''}`}>
      <div className="simbar" role="note"><strong>Alexa said done.</strong><span>Did it work?</span></div>
      <div className="stage" ref={stageRef}>
        <div className="device-wrap" style={{ height: 800 * scale, width: 1280 * scale }}>
          <div className="device" style={{ transform: `scale(${scale})` }}>
            <div className="screen">
              <header className="dev-head">
                <button className="brand brand-btn" onClick={() => !busy && setScene({ kind: 'home' })} aria-label="Doublecheck home"><Mark /><span className="wordmark">Doublecheck</span></button>
              </header>
              {scn.kind === 'home' && <Home onSay={say} busy={busy} seen={seen} report={report} now={now} onOpen={openAny} daysAgo={daysAgo} onDays={pickDay} onNote={setNote} />}
              {scn.kind === 'heard' && <Heard text={scn.text} state={scn.state} />}
              {scn.kind === 'valve' && (scn.v.step === 'said' || scn.v.step === 'checking') && <SaidDone line={scn.v.line} sub={`Alexa+ routine · reported by the valve at ${fmtTime(new Date(scn.v.claimIso))}`} checking={scn.v.step === 'checking'} caption={scn.v.step === 'checking' ? '3 minutes pass (simulated clock)' : undefined} />}
              {scn.kind === 'valve' && (scn.v.step === 'result' || scn.v.step === 'rechecking' || scn.v.step === 'fixed') && scn.v.finding && (
                <Contradiction f={scn.v.step === 'rechecking' ? scn.v.before! : scn.v.finding} before={scn.v.step === 'fixed' ? scn.v.before : undefined} waiting={scn.v.step === 'rechecking'} fixBusy={busy}
                  onFix={scn.v.step === 'result' ? fixValve : undefined} onEvidence={() => setEvidence(scn.v.finding!)} markers={scn.v.fixAt ? [{ t: scn.v.fixAt, label: 'Close sent again' }] : undefined} />)}
              {scn.kind === 'trend' && <TrendView f={scn.f} onEvidence={() => setEvidence(scn.f)} />}
              {scn.kind === 'run' && <RunView f={scn.f} onEvidence={() => setEvidence(scn.f)} />}
              {scn.kind === 'night' && <NightView spoken={scn.spoken} night={scn.night} onOpen={f => (f.scope === 'trend' || f.scope === 'run') ? setScene(f.scope === 'trend' ? { kind: 'trend', f } : { kind: 'run', f }) : setEvidence(f)} />}
              {scn.kind === 'other' && <div className="view"><div className="vhead"><div><p className="eyebrow">Doublecheck</p><h1>{scn.f.headline}</h1></div></div></div>}
              {scn.kind === 'error' && <main className="view error-view"><h1>I can’t do that one.</h1><p>{scn.message}</p><button className="btn" onClick={() => setScene({ kind: 'home' })}>Back</button></main>}
              {(evidence || ask) && <div className="scrim" onClick={() => !ask && setEvidence(null)} />}
              {note && <><div className="scrim" onClick={() => setNote(null)} /><div className="sheet" role="dialog" aria-modal="true" aria-labelledby="nt-t"><h2 id="nt-t">{note.title}</h2><p className="ask-text">{note.text}</p><div className="btns">{note.action && <button className="btn primary" onClick={() => { const u = note.action!.utterance; setNote(null); say(u); }}>{note.action.label}</button>}<button className="btn ghost" onClick={() => setNote(null)}>Close</button></div></div></>}
              {evidence && <EvidenceDrawer f={evidence} onClose={() => setEvidence(null)} />}
              {ask && <ApproveSheet message={ask.params.message} onAnswer={yes => ask.resolve(yes ? { action: 'accept', content: { approve: true } } : { action: 'decline' })} />}
            </div>
          </div>
        </div>
      </div>

      <section className="console" aria-label="Simulator console">
        <p className="who-label" hidden={scn.kind === 'home'}>You are the person at home, speaking to Alexa+. Ask below, or play a simulated event:</p>
        <form className="say" hidden={scn.kind === 'home'} onSubmit={e => { e.preventDefault(); const t = text; setText(''); say(t); }}>
          <label htmlFor={scn.kind === 'home' ? 'utt-console' : 'utt'} className="sr">What you say to Alexa+</label>
          <input id={scn.kind === 'home' ? 'utt-console' : 'utt'} value={text} onChange={e => setText(e.target.value)} placeholder="Type what you say to Alexa+…" autoComplete="off" />
          <button type="submit" className="primary" disabled={!text.trim() || busy}><LuSend aria-hidden /> Say it</button>
        </form>
        <div className="tools-row">
          <div className="examples"><span>Simulator</span><button className="link" disabled={busy} onClick={() => say(EXAMPLES[0].text)}>Play event: leak alert, Alexa closes the valve</button></div>
          <div className="toggles">
            {dev && <button className="toggle iconbtn" aria-label="Reset the simulation" title="Reset the simulation" onClick={resetDemo} disabled={busy}><LuRotateCcw aria-hidden /></button>}
            <button className={`toggle ${inspect ? 'on' : ''}`} aria-pressed={inspect} onClick={() => setInspect(v => !v)}><LuPanelBottomOpen aria-hidden /> Inspector <em>{entries.length}</em></button>
          </div>
        </div>
        <p className="conn" data-state={connected}>{connected === 'ok' ? `Connected to the Doublecheck MCP server (session ${client.sid.slice(0, 8)}…)` : connected === 'connecting' ? 'Connecting to the Doublecheck MCP server…' : 'Cannot reach the Doublecheck MCP server'}</p>
      </section>
      {inspect && <Inspector entries={entries} onClose={() => setInspect(false)} />}
    </div>
  );
}

function useSyncEntries() { const [, force] = useState(0); useEffect(() => client.subscribe(() => force(n => n + 1)), []); return client.entries; }

function Inspector({ entries, onClose }: { entries: WireEntry[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null); const [copied, setCopied] = useState(false);
  const list = [...entries].reverse(); const t0 = entries[0]?.at ?? 0; const sel = entries.find(e => e.id === (open ?? list[0]?.id));
  const rid = (sel?.body as any)?.id; const mate = sel && rid !== undefined ? entries.find(e => e !== sel && (e.body as any)?.id === rid && e.dir !== sel.dir) : undefined;
  const req = sel?.dir === 'out' ? sel : mate; const res = sel?.dir === 'in' ? sel : mate;
  const copy = (e?: WireEntry) => { if (!e) return; try { navigator.clipboard.writeText(JSON.stringify(e.body, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard may be blocked */ } };
  const Pane = ({ e, tag }: { e?: WireEntry; tag: 'Request' | 'Response' }) => (
    <div className={`pane pane-${tag.toLowerCase()}`}>
      <div className="pane-head"><span className="pane-tag">{tag}</span><span className="pane-label">{e?.label}</span>{e?.ms !== undefined && <span className="mono pane-ms">{e.ms} ms</span>}{e && <button className="copy" onClick={() => copy(e)} aria-label={`Copy ${tag} JSON`}>{copied ? <LuCheck aria-hidden /> : <LuCopy aria-hidden />}</button>}</div>
      <pre tabIndex={0}>{e ? colorJson(JSON.stringify(e.body, null, 2)) : 'No matching message (a notification, or it has not arrived yet).'}</pre>
    </div>);
  return (
    <aside className="inspector" aria-label="MCP traffic inspector">
      <header><h2><LuMessageSquareText aria-hidden /> MCP traffic <small>captured by this host’s MCP client, as sent and received</small></h2><button className="link" onClick={onClose}>Close</button></header>
      <div className="insp-body">
        <ol className="insp-list">{list.map(e => (
          <li key={e.id}><button className={`insp-row ${sel?.id === e.id ? 'on' : ''}`} onClick={() => setOpen(e.id)}>
            <span className={`dir dir-${e.dir}`}>{e.dir === 'out' ? '→' : '←'}</span><span className="mono time">+{((e.at - t0) / 1000).toFixed(2)}s</span><span className="label">{e.label}</span>
            <span className={`kind kind-${e.kind}`}>{e.kind.replace('-', ' ')}</span><LuChevronRight aria-hidden /></button></li>))}</ol>
        <div className="insp-panes"><Pane e={req} tag="Request" /><Pane e={res} tag="Response" /></div>
      </div>
    </aside>
  );
}
function colorJson(src: string) {
  const out: React.ReactNode[] = []; const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g; let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(src))) { if (m.index > last) out.push(src.slice(last, m.index)); if (m[1]) out.push(m[2] ? <span key={k++} className="j-key">{m[1]}<span className="j-p">{m[2]}</span></span> : <span key={k++} className="j-str">{m[1]}</span>); else if (m[3]) out.push(<span key={k++} className="j-lit">{m[3]}</span>); else out.push(<span key={k++} className="j-num">{m[4]}</span>); last = re.lastIndex; }
  out.push(src.slice(last)); return out;
}
