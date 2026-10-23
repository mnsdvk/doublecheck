// Three small, hand-drawn SVG charts. Each is built for one kind of evidence; none is decorative.
import { fmtDate, fmtMonth, fmtTime, fromLocal, localParts } from '../../shared/time.ts';
import type { Series } from '../../server/model.ts';

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const lin = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
const nice = (max: number, parts = 4) => { const raw = max / parts; const pow = 10 ** Math.floor(Math.log10(raw || 1)); const f = raw / pow; const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow; return { step, top: Math.ceil(max / step) * step }; };

export function FlowChart(p: { series: Series; claimAt: number; settleAt: number; claimLabel: string; markers?: { t: number; label: string }[]; to: number }) {
  const W = 690, H = 200, L = 52, R = 18, T = 34, B = 30; const pts = p.series.points.map(q => ({ t: Date.parse(q.t), v: q.v, bad: !!q.flag }));
  const t0 = p.claimAt - 15000, t1 = Math.max(p.to, ...pts.map(q => q.t)) + 20000; const thr = p.series.threshold ?? 0;
  const ymaxRaw = Math.max(...pts.map(q => q.v), thr * 3, 1); const { step, top } = nice(ymaxRaw * 1.12, 3);
  const x = lin(t0, t1, L, W - R), y = lin(0, top, H - B, T);
  const span = t1 - t0; const tickStep = span > 8 * 60000 ? 120000 : span > 3.5 * 60000 ? 60000 : 30000; const ticks: number[] = []; for (let t = Math.ceil(t0 / tickStep) * tickStep; t <= t1; t += tickStep) ticks.push(t);
  const yt: number[] = []; for (let v = 0; v <= top + 1e-9; v += step) yt.push(v);
  const label = `Independent flow readings after the report. ${pts.map(q => `${fmtTime(new Date(q.t))}: ${q.v} ${p.series.unit}`).join('; ')}. Closed should read below ${thr} ${p.series.unit}.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      {yt.map(v => <g key={v}><line className="gridline" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text className="ax" x={L - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      <text className="ax" x={L - 8} y={T - 14} textAnchor="end">{p.series.unit}</text>
      {ticks.map(t => <text key={t} className="ax" x={x(t)} y={H - 8} textAnchor="middle">{fmtTime(new Date(t))}</text>)}
      <rect className="settle" x={x(p.claimAt)} y={T} width={Math.max(0, x(p.settleAt) - x(p.claimAt))} height={H - B - T} />
      <text className="settle-label" x={x(p.claimAt) + 6} y={T + 14}>settling</text>
      <line className="mk" x1={x(p.claimAt)} x2={x(p.claimAt)} y1={T - 8} y2={H - B} /><text className="mk-label" x={x(p.claimAt) + 6} y={T - 12}>{p.claimLabel}</text>
      {(p.markers ?? []).map(m => <g key={m.t}><line className="mk" strokeDasharray="4 4" x1={x(m.t)} x2={x(m.t)} y1={T - 8} y2={H - B} /><text className="mk-label" x={x(m.t) + 6} y={T - 12}>{m.label}</text></g>)}
      <line className="thr" x1={L} x2={W - R} y1={y(thr)} y2={y(thr)} /><text className="thr-label" x={W - R} y={y(thr) - 7} textAnchor="end">closed should read below {thr} {p.series.unit}</text>
      <polyline className="line" points={pts.map(q => `${x(q.t)},${y(q.v)}`).join(' ')} />
      {pts.map((q, i) => <circle key={i} r={q.t < p.settleAt ? 4 : 6.5} cx={x(q.t)} cy={y(q.v)} className={q.t < p.settleAt ? 'dot-mute' : q.bad ? 'dot-bad' : 'dot-ok'}><title>{fmtTime(new Date(q.t))}: {q.v} {p.series.unit}</title></circle>)}
    </svg>
  );
}

export function TrendChart({ series }: { series: Series }) {
  const W = 800, H = 330, L = 50, R = 22, T = 26, B = 40; const post = series.points.map(q => ({ t: Date.parse(q.t), v: q.v, e: q.r ?? q.v, bad: !!q.flag })); const base = (series.base ?? []).map(q => ({ t: Date.parse(q.t), v: q.v }));
  const t0 = Math.min(...base.map(q => q.t), ...post.map(q => q.t)), t1 = Math.max(...post.map(q => q.t)) + 3 * 86400000; const rel = series.baseline?.band ?? 0.18;
  const { step, top } = nice(Math.max(...post.map(q => Math.max(q.v, q.e * (1 + rel))), ...base.map(q => q.v)) * 1.08, 4);
  const x = lin(t0, t1, L, W - R), y = lin(0, top, H - B, T);
  const months: number[] = []; { const p0 = localParts(new Date(t0)); let yr = p0.y, mo = p0.mo + 1; for (;;) { if (mo > 12) { mo = 1; yr++; } const t = fromLocal(yr, mo, 1, 0).getTime(); if (t > t1) break; months.push(t); mo++; } }
  const yt: number[] = []; for (let v = 0; v <= top + 1e-9; v += step) yt.push(v);
  const last = post.slice(-14); const bx = last.length ? x(last[0].t) - 4 : W - R; const baseEnd = series.baseline ? Date.parse(series.baseline.to) : t0;
  const bandPath = post.length ? `M${post.map(q => `${x(q.t)},${y(q.e * (1 + rel))}`).join(' L')} L${[...post].reverse().map(q => `${x(q.t)},${y(q.e * (1 - rel))}`).join(' L')} Z` : '';
  const baseMed = base.length ? med(base.map(q => q.v)) : 0; const nowMed = last.length ? med(last.map(q => q.v)) : 0; const expMed = last.length ? med(last.map(q => q.e)) : 0;
  const label = `Heating-draw time per cycle over ${Math.round((t1 - t0) / 86400000)} days. Baseline period about ${baseMed.toFixed(1)} minutes. The last ${last.length} comparable cycles took a median of ${nowMed.toFixed(1)} minutes where about ${expMed.toFixed(1)} would be expected.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      {yt.map(v => <g key={v}><line className="gridline" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text className="ax" x={L - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      <text className="ax" x={L - 8} y={T - 10} textAnchor="end">min</text>
      {months.map(t => <text key={t} className="ax" x={x(t)} y={H - 14} textAnchor="middle">{fmtMonth(new Date(t + 86400000))}</text>)}
      {series.baseline && <><rect className="settle" x={x(t0)} y={T} width={Math.max(0, x(baseEnd) - x(t0))} height={H - B - T} /><text className="settle-label" x={x(t0) + 6} y={T + 14}>baseline period (first 45 days)</text></>}
      {last.length > 0 && <><rect x={bx} y={T} width={W - R - bx} height={H - B - T} fill="rgba(165, 42, 31, .07)" /><text className="settle-label" x={W - R - 6} y={T + 14} textAnchor="end" style={{ fill: 'var(--alert)' }}>last {last.length} comparable cycles</text></>}
      <path d={bandPath} className="band" />
      <polyline className="line" strokeDasharray="5 4" style={{ stroke: 'var(--forest)' }} points={post.map(q => `${x(q.t)},${y(q.e)}`).join(' ')} />
      {base.map((q, i) => <circle key={'b' + i} r={3} cx={x(q.t)} cy={y(q.v)} className="dot-mute" />)}
      {post.map((q, i) => <circle key={i} r={q.bad ? 4 : 3} cx={x(q.t)} cy={y(q.v)} className={q.bad ? 'dot-bad' : 'dot-mute'}><title>{fmtDate(new Date(q.t))}: {q.v} min (expected about {q.e})</title></circle>)}
      {base.length > 0 && <text className="band-label" x={x(t0) + 6} y={y(baseMed) - 12}>about {baseMed.toFixed(0)} min</text>}
      {last.length > 0 && <text className="mk-label" x={W - R - 6} y={Math.max(T + 34, y(nowMed) - 14)} textAnchor="end" style={{ fill: 'var(--alert)', fontSize: 15 }}>about {nowMed.toFixed(0)} min now</text>}
    </svg>
  );
}

export function PauseChart({ series }: { series: Series }) {
  const W = 800, H = 330, L = 50, R = 20; const pts = series.points.map(q => ({ t: Date.parse(q.t), pauses: q.v, dur: q.r ?? 0, bad: !!q.flag }));
  const prior = pts.slice(0, -1); const usual = prior.length ? med(prior.map(q => q.dur)) : 0; const maxP = Math.max(5, ...pts.map(q => q.pauses)); const topP = maxP + 1; const maxD = Math.max(...pts.map(q => q.dur), usual * 1.3, 1);
  const n = pts.length; const slot = (W - L - R) / n; const bw = Math.min(40, slot * 0.6); const cx = (i: number) => L + slot * (i + 0.5);
  const y1 = lin(0, topP, 150, 30), y2 = lin(0, Math.ceil(maxD / 10) * 10, 296, 196);
  const label = `Pauses per run and run time over the last ${n} runs. The latest run had ${pts[n - 1]?.pauses} pauses and took ${pts[n - 1]?.dur} minutes; the usual run takes about ${usual.toFixed(1)} minutes.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <text className="ax ax-strong" x={L} y={16}>Pauses in each run</text>
      {[0, Math.ceil(topP / 2), topP].map(v => <g key={v}><line className="gridline" x1={L} x2={W - R} y1={y1(v)} y2={y1(v)} /><text className="ax" x={L - 8} y={y1(v) + 4} textAnchor="end">{v}</text></g>)}
      {pts.map((q, i) => <g key={i}>
        <rect x={cx(i) - bw / 2} y={y1(q.pauses)} width={bw} height={Math.max(2, 150 - y1(q.pauses))} rx={4} fill={q.bad ? 'var(--alert)' : 'var(--ink-3)'} opacity={q.bad ? 1 : 0.5}><title>{fmtDate(new Date(q.t))}: {q.pauses} pauses, {q.dur} min</title></rect>
        <text className="ax ax-strong" x={cx(i)} y={y1(q.pauses) - 6} textAnchor="middle" style={q.bad ? { fill: 'var(--alert)', fontSize: 16 } : undefined}>{q.pauses}</text>
        <text className="ax" x={cx(i)} y={H - 8} textAnchor="middle">{fmtDate(new Date(q.t)).replace(' Oct', '')}</text></g>)}
      <text className="ax ax-strong" x={L} y={186}>Run time (min)</text>
      <rect className="band" x={L} y={y2(usual * 1.1)} width={W - L - R} height={Math.max(2, y2(usual * 0.9) - y2(usual * 1.1))} /><text className="band-label" x={L + 4} y={y2(usual * 1.1) - 6} textAnchor="start">usual {usual.toFixed(0)} min</text>
      <polyline className="line" points={pts.map((q, i) => `${cx(i)},${y2(q.dur)}`).join(' ')} />
      {pts.map((q, i) => <g key={i}><circle r={q.bad ? 6 : 4} cx={cx(i)} cy={y2(q.dur)} className={q.bad ? 'dot-bad' : 'dot-mute'} />{(q.bad || i === n - 1) && <text className="ax ax-strong" x={cx(i)} y={y2(q.dur) - 12} textAnchor="middle" style={q.bad ? { fill: 'var(--alert)', fontSize: 15 } : undefined}>{q.dur.toFixed(0)} min</text>}</g>)}
    </svg>
  );
}
