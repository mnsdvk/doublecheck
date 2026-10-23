import { useEffect, useRef, useState } from 'react';
import { LuCheck, LuCheckCheck, LuTriangleAlert, LuCircleHelp, LuX, LuChevronLeft, LuCalendarDays, LuChevronRight, LuClock3, LuArrowRight, LuDroplets, LuMic, LuFlame, LuBot, LuLock, LuSnowflake, LuLightbulb, LuWrench, LuFileSearch, LuInfo } from 'react-icons/lu';
import { Ring } from './ring.tsx';
import { FlowChart, PauseChart, TrendChart } from './charts.tsx';
import { fmtDate, fmtDay, fmtTime } from '../../shared/time.ts';
import type { EvidenceItem, Finding, Verdict } from '../../server/model.ts';
import { EXAMPLES } from './router.ts';

const tm = (iso: string) => fmtTime(new Date(iso));
export const VERDICT_ICON: Record<Verdict, any> = { WORKED: LuCheck, PROBLEM_FOUND: LuTriangleAlert, NOT_VERIFIED: LuCircleHelp };

export function Badge({ f, small }: { f: Pick<Finding, 'verdict' | 'label'>; small?: boolean }) {
  const I = VERDICT_ICON[f.verdict];
  return <span className={`badge-v v-${f.verdict} ${small ? 'sm' : ''} ${f.verdict === 'PROBLEM_FOUND' && f.label !== 'Problem found' ? 'unusual' : ''}`}><I aria-hidden />{f.label}</span>;
}
export function Mark() { return <span className="mark" aria-hidden><LuCheckCheck /></span>; }

// What each simulated device says about itself on the demo home. These are reports, not verified results.
const TILES: { id: string; name: string; state: string; on: boolean; Icon: any; hue: string; ask: number }[] = [
  { id: 'valve_main', name: 'Main water valve', state: 'Closed', on: true, Icon: LuDroplets, hue: 'blue', ask: 0 },
  { id: 'geyser_bath', name: 'Bathroom geyser', state: 'Off', on: false, Icon: LuFlame, hue: 'orange', ask: 1 },
  { id: 'cleaner_floor', name: 'Floor cleaner', state: 'Done · docked', on: true, Icon: LuBot, hue: 'teal', ask: 2 },
  { id: 'lock_front', name: 'Front door lock', state: 'Locked', on: true, Icon: LuLock, hue: 'violet', ask: 3 },
  { id: 'ac_bedroom', name: 'Bedroom AC', state: 'Off', on: false, Icon: LuSnowflake, hue: 'sky', ask: 3 },
  { id: 'lights_living', name: 'Living lights', state: 'Off', on: false, Icon: LuLightbulb, hue: 'amber', ask: 3 },
];
const TAG = (f: Finding) => f.verdict === 'NOT_VERIFIED' ? 'Not verified' : f.scope === 'trend' ? 'Trend' : f.scope === 'run' ? 'Anomaly' : f.scope === 'earlier' ? 'Earlier conflict' : 'Conflict';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayLabel = (n: number, d: Date) => n === 0 ? 'Today' : n === 1 ? 'Yesterday' : `${fmtDay(d)} ${fmtDate(d)}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayDiff = (now: Date, s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null; const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), b = Date.UTC(+m[1], +m[2] - 1, +m[3]); return Math.round((a - b) / 86400000); };
export function Home({ onSay, busy, seen, report, now, onOpen, daysAgo, onDays, onNote }: { onSay: (u: string) => void; busy: boolean; seen: Record<string, Finding>; report: Night | null; now: Date; onOpen: (f: Finding) => void; daysAgo: number; onDays: (d: number) => void; onNote: (n: { title: string; text: string; action?: { label: string; utterance: string } }) => void }) {
  const [q, setQ] = useState('');
  const past = daysAgo > 0;
  const day = new Date(now.getTime() - daysAgo * 86400000);
  const issues = report ? [...report.current, ...report.earlier, ...report.run, ...report.trend] : [];
  const nv = report?.not_verified ?? [];
  const total = report ? report.worked.length + issues.length + nv.length : 0;
  const fromReport: Record<string, Finding> = {}; if (report) for (const f of [...issues, ...nv, ...report.worked]) fromReport[f.device_id] = f;
  const tileF = (id: string) => past ? fromReport[id] : seen[id];
  const Row = ({ f }: { f: Finding }) => (
    <button className={`rep rep-${f.verdict === 'NOT_VERIFIED' ? 'nv' : f.scope === 'current' || f.scope === 'earlier' ? 'bad' : 'warn'}`} onClick={() => onOpen(f)}>
      <span className="rep-ic">{(() => { const T = TILES.find(t => t.id === f.device_id); return T ? <T.Icon aria-hidden /> : null; })()}</span>
      <span className="rep-main"><b>{f.device_name}</b><small>{cap(f.short)}</small></span><span className="rep-tag">{TAG(f)}</span><i className="rep-dot" aria-hidden /><LuChevronRight aria-hidden />
    </button>);
  return (
    <main className="view home">
      <section className="home-left">
        <div className="home-top">
          <p className="tagline">Was everything actually done?</p>
          <div className="daypick" role="group" aria-label="Choose a day, up to 30 days back">
            <button type="button" className="daynav" aria-label="Previous day" disabled={busy || daysAgo >= 30} onClick={() => onDays(daysAgo + 1)}><LuChevronLeft aria-hidden /></button>
            <label className="datefield"><span className="datelabel">{dayLabel(daysAgo, day)}<LuCalendarDays aria-hidden /></span>
              <input type="date" aria-label="Choose a day" value={ymd(day)} min={ymd(new Date(now.getTime() - 30 * 86400000))} max={ymd(now)} disabled={busy}
                onClick={e => { try { e.currentTarget.showPicker?.(); } catch { /* the native control still opens */ } }}
                onChange={e => { const d = dayDiff(now, e.target.value); if (d !== null) onDays(Math.min(30, Math.max(0, d))); }} />
            </label>
            <button type="button" className="daynav" aria-label="Next day" disabled={busy || daysAgo <= 0} onClick={() => onDays(daysAgo - 1)}><LuChevronRight aria-hidden /></button>
          </div>
        </div>
        <h1>{!report ? 'Checking your home…' : issues.length ? `${issues.length} thing${issues.length === 1 ? '' : 's'} ${past ? 'needed' : 'need'} a look` : total ? (past ? 'Nothing needed a look' : 'Everything checked out') : 'Nothing was recorded'}</h1>
        <p className="home-sub">{!report ? 'Comparing what each device reported with independent evidence.' : past ? `This is how it looked on that day, using only what had been recorded by then.${total ? '' : ' No device action or run was recorded.'}` : `Alexa and your devices reported all of this as done. Doublecheck compared ${total} reports with independent evidence.`}</p>
        <div className="reps">{issues.map(f => <Row key={f.id} f={f} />)}{nv.map(f => <Row key={f.id} f={f} />)}
          {report && !issues.length && !nv.length && <p className="none">{total ? 'Nothing to flag.' : 'Nothing to show for this day.'}</p>}</div>
        {report && report.worked.length > 0 && <p className="home-ok"><LuCheck aria-hidden /> {report.worked.length} confirmed by independent evidence</p>}
        <form className="askbar" onSubmit={e => { e.preventDefault(); const s = q; setQ(''); onSay(s); }}>
          <label htmlFor="utt" className="sr">What you say to Alexa+</label>
          <span className="askmark" aria-hidden><LuMic /></span>
          <input id="utt" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask Alexa about your home…" autoComplete="off" />
          <button type="submit" className="askgo" disabled={!q.trim() || busy} aria-label="Send"><LuArrowRight aria-hidden /></button>
        </form>
      </section>
      <section className="home-panel" aria-label="Devices and what they report">
        <header><h2>Your devices</h2><span className="synth">Simulated</span></header>
        <p className="panel-sub">What each device reports. Tap one to open its report.</p>
        <div className="tiles">
          {TILES.map(d => { const f = tileF(d.id); const flag = f && f.verdict !== 'WORKED' ? (f.verdict === 'NOT_VERIFIED' ? 'nv' : f.scope === 'current' || f.scope === 'earlier' ? 'bad' : 'warn') : ''; return (
            <button key={d.id} className={`tile hue-${d.hue} ${d.on ? 'on' : 'off'}`} disabled={busy}
              onClick={() => f ? onOpen(f) : onNote(d.id === 'valve_main' && !past ? { title: 'Main water valve reports closed', text: 'Nothing has asked this valve to close yet, so there is nothing to check. Play the leak alert to see Alexa close it and Doublecheck check the flow meter.', action: { label: 'Play the leak alert', utterance: EXAMPLES[0].text } } : { title: `${d.name} reports ${d.state.toLowerCase()}`, text: past ? 'No action on this device was recorded for that day, so there is nothing to check.' : 'Nothing has asked this device to do anything since it last reported, so there is nothing to verify yet. When Alexa+ or a routine acts on it, Doublecheck checks the result.' })}
              aria-label={`${d.name}, ${d.state}${f ? `, ${f.label}` : ''}. Open report.`}>
              <span className="tile-ic"><d.Icon aria-hidden /></span>
              <b>{d.name}</b><small>{d.state}</small>
              {flag && <i className={`tile-dot dot-${flag}`} aria-hidden />}
            </button>); })}
        </div>
      </section>
    </main>
  );
}

export function Heard({ text, state }: { text: string; state: 'listening' | 'processing' }) {
  return (
    <main className="view heard">
      <div><p className="eyebrow">You said</p><blockquote>{text}{state === 'listening' && <span className="caret" aria-hidden />}</blockquote></div>
      <div className="state-line"><Ring state={state} size={56} /><div><b>{state === 'listening' ? 'Listening' : 'Working on it'}</b></div></div>
    </main>
  );
}

export function SaidDone({ line, sub, checking, caption }: { line: string; sub: string; checking: boolean; caption?: string }) {
  return (
    <main className="view">
      <div className="vhead"><div><p className="eyebrow">Alexa+ reports</p><h1>That is what the device told Alexa+.</h1></div></div>
      <div className="said-done">
        <section className="alexa" aria-label="What Alexa+ said"><p className="plabel" style={{ margin: 0, fontSize: 14, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>Alexa+ says</p><p className="say-line">{line}</p><p className="sub">{sub}</p></section>
        <section className="dc-wait" aria-live="polite">
          <Ring state={checking ? 'processing' : 'idle'} size={64} />
          <p>{checking ? 'Doublecheck is reading the independent flow meter.' : 'Doublecheck is waiting for the settling period to pass.'}</p>
          {caption && <span className="timecap"><LuClock3 aria-hidden />{caption}</span>}
          <small>Nothing the valve says about itself counts as evidence.</small>
        </section>
      </div>
    </main>
  );
}

function lastObs(f: Finding) { return [...f.evidence].reverse().find(e => e.role === 'observation'); }
export function Contradiction(p: { f: Finding; before?: Finding; fixBusy?: boolean; waiting?: boolean; onFix?: () => void; onEvidence: () => void; markers?: { t: number; label: string }[]; extraPoints?: Finding['series'] }) {
  const f = p.f; const claim = f.evidence.find(e => e.role === 'claim'); const obs = lastObs(f);
  const claimMs = Date.parse((p.before ?? f).evidence.find(e => e.role === 'claim')!.at!);
  const series = f.series!; const merged = p.before?.series ? { ...series, points: [...p.before.series.points, ...series.points.filter(q => !p.before!.series!.points.some(r => r.t === q.t))].sort((a, b) => a.t.localeCompare(b.t)) } : series;
  const lim = f.limitations[0]; const sym = f.verdict === 'WORKED' ? '=' : f.verdict === 'PROBLEM_FOUND' ? '≠' : '?';
  const symLabel = f.verdict === 'WORKED' ? 'agree' : f.verdict === 'PROBLEM_FOUND' ? 'disagree' : 'unclear';
  const noun = obs?.source?.replace(/_/g, ' ') ?? 'sensor';
  return (
    <main className="view">
      <div className="vhead"><div><p className="eyebrow">Doublecheck · {f.device_name}{p.before ? ' · after the approved fix' : ''}</p><h1>{f.headline}</h1></div><Badge f={f} /></div>
      {p.before && (
        <div className="ba" aria-label="Before and after">
          <div><b>Before · {tm(p.before.as_of)}</b><Badge f={p.before} small /></div><LuArrowRight aria-hidden />
          <div className="act"><b>Action · you approved</b>Close command sent again (simulated device)</div><LuArrowRight aria-hidden />
          <div><b>After · {tm(f.as_of)}</b><Badge f={f} small /></div>
        </div>)}
      <div className="contra">
        <section className="panel claim" aria-label="What the device said">
          <div><p className="plabel">The device said</p><p className="big">{claim?.value ?? ''}</p><p className="who">{claim?.source}</p><p className="when tnum">{claim?.at && tm(claim.at)}</p></div>
          <p className="self">Its own report. A report is a claim, not evidence.</p>
        </section>
        <div className={`neq ${f.verdict === 'WORKED' ? 'ok' : f.verdict === 'NOT_VERIFIED' ? 'nv' : ''}`} aria-label={symLabel}><span aria-hidden>{sym}</span><small>{symLabel}</small></div>
        <section className="panel meas" aria-label="Independent measurement">
          <p className="plabel"><span>Independent · {noun}</span><span className="tnum">{obs?.at && `latest ${tm(obs.at)}`}</span></p>
          <div className="reading"><b className="tnum">{obs?.value?.split(' ')[0] ?? 'no reading'}</b><span>{obs?.value?.split(' ').slice(1).join(' ')}</span></div>
          <div className="chartbox"><FlowChart series={merged} claimAt={claimMs} settleAt={claimMs + 90000} claimLabel={`Reported ${tm(new Date(claimMs).toISOString())}`} markers={p.markers} to={Date.parse(f.as_of)} /></div>
        </section>
      </div>
      <div className="conclude">
        <ul className="why">{f.explanation.slice(1).map((l, i) => <li key={i}>{l}</li>)}{lim && <li className="lim">{lim}</li>}</ul>
        <div className="acts">
          <button className="btn ghost" onClick={p.onEvidence}><LuFileSearch aria-hidden />Evidence</button>
          {f.suggested_fix && p.onFix && <button className="btn" disabled={p.fixBusy} onClick={p.onFix}><LuWrench aria-hidden />{f.suggested_fix.title}…</button>}
        </div>
      </div>
      {p.waiting && <p className="note-line"><LuClock3 aria-hidden />Waiting out the settling period, then checking the meter again.</p>}
    </main>
  );
}

export function TrendView({ f, onEvidence }: { f: Finding; onEvidence: () => void }) {
  const ev = (r: string) => f.evidence.find(e => e.role === r); const recent = ev('recent'); const base = ev('baseline'); const note = ev('note');
  const med = f.explanation.find(l => /median is/.test(l)); const over = f.explanation.find(l => /comparable cycles were well above/.test(l));
  return (
    <main className="view unusual">
      <div className="vhead"><div><p className="eyebrow">Doublecheck · {f.device_name} · gradual change</p><h1>{f.headline}</h1></div><Badge f={f} /></div>
      <div className="split">
        <div className="sidecol">
          <div className="stat"><p className="plabel">Observed · recent cycles</p><p className="num tnum">{f.facts?.actual ?? '—'} <small>min median</small></p><p>Normal for the same temperature rise: {f.facts?.expected} min</p></div>
          <div className="stat"><p className="plabel">Observed · how consistent</p><p className="num tnum">{f.facts?.over} of {f.facts?.of}</p><p>recent cycles well above normal. Every cycle still ended normally.</p></div>
          <div className="stat interp"><p className="plabel">Interpretation</p><p className="num">Unusual change. Cause not established.</p></div>
        </div>
        <section className="bigchart" aria-label="Heating time over months">
          <p className="plabel"><span>Heating-draw time per cycle</span><span className="synth">Synthetic 6-month history</span></p>
          <div className="chartbox"><TrendChart series={f.series!} /></div>
          <div className="legend"><span><i style={{ background: 'var(--ink-3)', opacity: .6 }} />each cycle</span><span><i style={{ background: 'var(--alert)' }} />well above normal</span><span><i className="sw-band" />normal for that cycle’s temperature rise</span></div>
        </section>
      </div>
      <div className="conclude"><ul className="why"><li>{f.explanation[0]}</li><li className="lim">{f.limitations[1]}</li></ul><div className="acts"><button className="btn ghost" onClick={onEvidence}><LuFileSearch aria-hidden />Evidence</button></div></div>
      <span hidden>{base?.label}</span>
    </main>
  );
}

function RunTimeline({ start, minutes, pauses }: { start?: string; minutes?: number; pauses: EvidenceItem[] }) {
  if (!start || !minutes) return null;
  const t0 = new Date(start).getTime(), total = minutes * 60000;
  const ev = pauses.map(e => { const m = e.label.match(/Paused (\d+) s/); return { at: new Date(e.at!).getTime(), s: Number(m?.[1] ?? 0), iso: e.at! }; }).filter(e => e.at >= t0 && e.at <= t0 + total);
  return (
    <div className="rtl" role="img" aria-label={`Run timeline: started ${tm(start)}, ${minutes} minutes, ${ev.length} pauses`}>
      <div className="rtl-bar">{ev.map((e, i) => <i key={i} style={{ left: `${((e.at - t0) / total) * 100}%`, width: `max(8px, ${(e.s * 1000 / total) * 100}%)` }} title={`Paused ${e.s} s at ${tm(e.iso)}`} />)}</div>
      <div className="rtl-axis"><span>{tm(start)} start</span><span>{ev.length} pause{ev.length === 1 ? '' : 's'} (amber)</span><span>{tm(new Date(t0 + total).toISOString())} end</span></div>
    </div>);
}
export function RunView({ f, onEvidence }: { f: Finding; onEvidence: () => void }) {
  const run = f.evidence.find(e => e.role === 'run'); const usual = f.evidence.find(e => e.role === 'baseline'); const pauses = f.evidence.filter(e => e.role === 'observation');
  const last = f.series!.points[f.series!.points.length - 1];
  return (
    <main className="view unusual">
      <div className="vhead"><div><p className="eyebrow">Doublecheck · {f.device_name} · what happened inside the run</p><h1>{f.headline}</h1></div><Badge f={f} /></div>
      <div className="split">
        <div className="sidecol">
          <div className="stat"><p className="plabel">Observed · this run</p><p className="num tnum">{last.v} <small>pauses</small></p><p>Run time {f.facts?.minutes} min, usual {f.facts?.usual_minutes}.</p></div>
          <div className="stat"><p className="plabel">Reported by the device</p><ul className="runs-list">{pauses.slice(0, 2).map((e, i) => { const m = e.label.match(/Paused (\d+) s(?:, device code (\w+))?/); return <li key={i}><span className="tnum">{tm(e.at!)}</span><span>{m?.[1]} s {m?.[2] && <code>{m[2]}</code>}</span></li>; })}</ul></div>
          <div className="stat interp"><p className="plabel">Interpretation</p><p className="num">Out of its normal range. Cause not established.</p></div>
        </div>
        <section className="bigchart" aria-label="Pauses and run time">
          <p className="plabel"><span>The last {f.series!.points.length} runs</span><span className="synth">Synthetic run log</span></p>
          <RunTimeline start={run?.at} minutes={last.r} pauses={pauses} />
          <div className="chartbox"><PauseChart series={f.series!} /></div>
          <div className="legend"><span><i style={{ background: 'var(--alert)' }} />this run</span><span><i style={{ background: 'var(--ink-3)', opacity: .6 }} />earlier runs</span><span><i className="sw-band" />usual run time</span></div>
        </section>
      </div>
      <div className="conclude"><ul className="why"><li>{f.explanation[0]}</li><li>{f.explanation[2]}</li></ul><div className="acts"><button className="btn ghost" onClick={onEvidence}><LuFileSearch aria-hidden />Evidence</button></div></div>
    </main>
  );
}

type Night = { current: Finding[]; earlier: Finding[]; run: Finding[]; trend: Finding[]; not_verified: Finding[]; worked: Finding[] };
function Item({ f, onOpen }: { f: Finding; onOpen: (f: Finding) => void }) {
  return <button className={`item ${f.verdict === 'WORKED' ? 'compact' : ''}`} onClick={() => onOpen(f)}><Badge f={f} small /><span><b>{f.device_name}</b><small>{f.headline}</small></span><LuChevronRight aria-hidden /></button>;
}
export function NightView({ spoken, night, onOpen }: { spoken: string; night: Night; onOpen: (f: Finding) => void }) {
  const G = ({ title, hint, list, empty }: { title: string; hint: string; list: Finding[]; empty?: string }) => (list.length || empty) ? (
    <section className="group"><h2>{title} <em>{hint}</em></h2>{list.length ? list.map(f => <Item key={f.id} f={f} onOpen={onOpen} />) : <p className="none">{empty}</p>}</section>) : null;
  return (
    <main className="view">
      <div className="vhead"><div><p className="eyebrow">Doublecheck · Was everything actually done?</p></div></div>
      <div className="tally" aria-label="Summary of results"><span className="t-ok"><LuCheck aria-hidden /><b>{night.worked.length}</b> confirmed</span><span className="t-un"><LuTriangleAlert aria-hidden /><b>{night.current.length + night.earlier.length + night.run.length + night.trend.length}</b> need a look</span><span className="t-nv"><LuCircleHelp aria-hidden /><b>{night.not_verified.length}</b> not verified</span></div>
      <div className="night">
        <p className="spoken" aria-live="polite">{spoken}</p>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <G title="Right now" hint="live readings" list={night.current} empty="Nothing is going wrong right now." />
          <G title="Earlier today" hint="no newer reading" list={night.earlier} />
          <G title="From the last run" hint="a finished job" list={night.run} />
          <G title="Over recent weeks" hint="a trend, not tonight" list={night.trend} />
        </div>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <G title="Could not confirm" hint="not the same as a failure" list={night.not_verified} />
          <G title="Confirmed" hint="independent evidence agrees" list={night.worked} />
        </div>
      </div>
    </main>
  );
}

const ROLE: Record<EvidenceItem['role'], string> = { claim: 'Device report', observation: 'Reading', baseline: 'Baseline', recent: 'Recent', run: 'Run log', note: 'Note' };
export function EvidenceDrawer({ f, onClose }: { f: Finding; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <aside className="drawer" role="dialog" aria-modal="true" aria-label="Evidence behind this result">
      <header><p className="eyebrow">The evidence behind this</p><button ref={ref} className="x" onClick={onClose} aria-label="Close"><LuX aria-hidden /></button></header>
      <h2>{f.headline}</h2><Badge f={f} small />
      <h3>What was found</h3><ul>{f.explanation.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <h3>Evidence used</h3>
      <ol className="ev">{f.evidence.map((e, i) => (
        <li key={i} className={`role-${e.role}`}>
          <p className="evh"><span>{ROLE[e.role]}</span>{e.independent === true && <span className="pill ind">independent</span>}{e.independent === false && <span className="pill dev">from the device itself</span>}{e.synthetic && <span className="pill">synthetic</span>}</p>
          <p className="evb">{e.label}</p>{(e.at || e.source) && <p className="evm tnum">{e.at && `${fmtDate(new Date(e.at))}, ${tm(e.at)}`}{e.at && e.source && ' · '}{e.source}</p>}
        </li>))}</ol>
      <h3>What this cannot tell you</h3><ul>{f.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <p className="engine">engine verdict {f.verdict}<br />check {f.check} · scope {f.scope}<br />as of {f.as_of}<br />finding {f.id}</p>
    </aside>
  );
}

export function ApproveSheet({ message, onAnswer }: { message: string; onAnswer: (yes: boolean) => void }) {
  const first = useRef<HTMLButtonElement>(null); useEffect(() => { first.current?.focus(); }, []);
  const [title, ...rest] = message.split('\n\n');
  return (
    <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="ap-t">
      <h2 id="ap-t">{title}</h2><p className="ask-text">{rest.join('\n\n')}</p>
      <div className="btns"><button ref={first} className="btn" onClick={() => onAnswer(true)}><LuCheck aria-hidden />Yes, do it</button><button className="btn ghost" onClick={() => onAnswer(false)}>Not now</button></div>
      <p className="note-line" style={{ marginTop: 16 }}><LuInfo aria-hidden />Nothing happens unless you choose Yes. Saying nothing also does nothing.</p>
    </div>
  );
}
