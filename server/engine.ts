// The verification engine. Pure functions: no I/O, no clock, no network, no model calls.
// Inputs are timestamped claims, observations and run records; outputs are findings with the
// evidence, the rule that fired and the limits. The same inputs always give the same output.
import { createHash } from 'node:crypto';
import { fmtDay, fmtTime, sameLocalDay } from '../shared/time.ts';
import type { Claim, DaySummary, EvidenceItem, Finding, Obs, RunRec, Series, Verdict } from './model.ts';
import type { DeviceSpec } from './devices.ts';

// ---------- small helpers ----------
export const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const madScaled = (a: number[]) => { const m = median(a); return 1.4826 * median(a.map(x => Math.abs(x - m))); };
const hid = (...p: string[]) => 'f_' + createHash('sha1').update(p.join('|')).digest('hex').slice(0, 10);
const t = (iso: string) => fmtTime(new Date(iso));
const r1 = (n: number) => (Math.round(n * 10) / 10).toString();
export function ago(now: Date, iso: string) {
  const m = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (m < 2) return 'just now'; if (m < 90) return `${m} min ago`; const h = Math.round(m / 60); if (h < 36) return `${h} h ago`; return `${Math.round(h / 24)} days ago`;
}
const LABEL: Record<Verdict, string> = { WORKED: 'Worked', PROBLEM_FOUND: 'Problem found', NOT_VERIFIED: 'Not verified' };

// ---------- 1. Contradiction: a device's claim against independent evidence ----------
export function verifyOutcome(dev: DeviceSpec, claim: Claim, allObs: Obs[], now: Date, priorProblems = 0): Finding {
  const spec = dev.outcome!;
  const base = { device_id: dev.id, device_name: dev.name, as_of: now.toISOString(), synthetic: claim.synthetic };
  const claimEv: EvidenceItem = { role: 'claim', label: `${dev.name} reported "${claim.state}"`, at: claim.at, source: claim.reported_by, independent: false, value: claim.state, synthetic: claim.synthetic };
  const mk = (verdict: Verdict, check: Finding['check'], headline: string, explanation: string[], limitations: string[], evidence: EvidenceItem[], extra: Partial<Finding> = {}): Finding => ({
    ...base, id: hid(dev.id, check, claim.id, verdict), check, scope: 'current', verdict, label: LABEL[verdict], headline, explanation, limitations, evidence: [claimEv, ...evidence], fresh: true, ...extra });

  const sinceClaim = allObs.filter(o => o.device_id === dev.id && o.metric === spec.metric && Date.parse(o.at) >= Date.parse(claim.at) - 1000);
  const indep = sinceClaim.filter(o => o.independent);
  const everIndependent = allObs.some(o => o.device_id === dev.id && o.metric === spec.metric && o.independent);
  const series = (obs: Obs[]): Series => ({ kind: 'line', unit: spec.unit, threshold: spec.threshold, points: obs.map(o => ({ t: o.at, v: o.value, flag: !(spec.test === 'lt' ? o.value < spec.threshold : o.value > spec.threshold) })) });

  if (!everIndependent) {
    return mk('NOT_VERIFIED', 'no_independent_evidence',
      `${dev.name} says ${spec.claim_text}. Nothing independent can confirm it.`,
      [`At ${t(claim.at)} the ${dev.name.toLowerCase()} reported "${claim.state}".`, `No ${spec.noun} sensor separate from the device has ever reported for it, so its own report is the only evidence.`, 'This is not a failure. It means the claim has not been checked.'],
      ['Without a second source, a wrong report and a right one look the same.'], [], { scope: 'earlier', suggested_fix: undefined, short: `${spec.claim_text}, but nothing independent can confirm it` });
  }
  const settleAt = Date.parse(claim.at) + spec.settle_s * 1000;
  if (now.getTime() < settleAt) {
    return mk('NOT_VERIFIED', 'contradiction', `${dev.name} says ${spec.claim_text}. Too early to check.`,
      [`The check waits ${spec.settle_s} seconds after a report so that normal movement and draining are not mistaken for a fault.`, `Ask again after ${t(new Date(settleAt).toISOString())}.`], ['Nothing has been measured yet.'], [], { short: 'too early to check' });
  }
  const post = indep.filter(o => Date.parse(o.at) >= settleAt && Date.parse(o.at) <= now.getTime()).sort((a, b) => a.at.localeCompare(b.at));
  const pass = (v: number) => (spec.test === 'lt' ? v < spec.threshold : v > spec.threshold);
  const bySource = new Map<string, Obs[]>(); for (const o of post) { const l = bySource.get(o.source) ?? []; l.push(o); bySource.set(o.source, l); }
  type St = 'pass' | 'fail' | 'mixed' | 'few';
  const status = new Map<string, St>();
  for (const [src, l] of bySource) {
    if (l.length < spec.min_samples) { status.set(src, 'few'); continue; }
    const last = l.slice(-spec.min_samples).map(o => pass(o.value));
    status.set(src, last.every(Boolean) ? 'pass' : last.every(x => !x) ? 'fail' : 'mixed');
  }
  const usable = [...status.values()].filter(s => s !== 'few');
  const used = post.filter(o => status.get(o.source) !== 'few');
  const shown = (used.length ? used : post).slice(-4);
  const obsEv = (list: Obs[]): EvidenceItem[] => list.map(o => ({ role: 'observation' as const, label: `${o.source.replace(/_/g, ' ')} read ${r1(o.value)} ${spec.unit}`.trim(), at: o.at, value: `${r1(o.value)} ${spec.unit}`.trim(), source: o.source, independent: true, synthetic: o.synthetic }));
  const lastAt = (used.at(-1) ?? post.at(-1))?.at;
  const fresh = lastAt ? now.getTime() - Date.parse(lastAt) <= spec.max_age_s * 1000 : false;
  const staleNote = lastAt && !fresh ? `The last reading was at ${t(lastAt)} (${ago(now, lastAt)}). There is no newer one, so I cannot say what is happening now.` : '';
  const ser = series(sinceClaim.sort((a, b) => a.at.localeCompare(b.at)));
  const scope = fresh ? 'current' as const : 'earlier' as const;

  if (!post.length || usable.length === 0) {
    return mk('NOT_VERIFIED', 'contradiction', `${dev.name} says ${spec.claim_text}. No usable reading since.`,
      [`At ${t(claim.at)} the ${dev.name.toLowerCase()} reported "${claim.state}".`, post.length ? `Only ${post.length} reading${post.length === 1 ? '' : 's'} arrived after the ${spec.settle_s}-second settling period; ${spec.min_samples} are needed.` : `No independent ${spec.noun} reading arrived after the ${spec.settle_s}-second settling period.`],
      ['A sensor that has gone quiet and a sensor reading zero look different here, and only the second counts as evidence.'], obsEv(shown), { scope: 'earlier', series: ser, short: `no usable ${spec.noun} reading since the report` });
  }
  if (usable.length < spec.min_sources) {
    return mk('NOT_VERIFIED', 'contradiction', `${dev.name} says ${spec.claim_text}. Only one source has reported.`,
      [`This check needs ${spec.min_sources} independent sources to agree. ${usable.length} reported.`], ['Agreement between two sources is stricter than one reading.'], obsEv(shown), { scope, series: ser, short: 'only one source has reported' });
  }
  if (usable.every(s => s === 'pass')) {
    const v = used.at(-1)!;
    return mk('WORKED', 'contradiction', `${dev.name} says ${spec.claim_text}, and the ${spec.noun} sensor agrees.`,
      [`At ${t(claim.at)} the ${dev.name.toLowerCase()} reported "${claim.state}".`, `After the ${spec.settle_s}-second settling period, ${r1(v.value)} ${spec.unit} was measured at ${t(v.at)}. ${spec.claim_text[0].toUpperCase() + spec.claim_text.slice(1)} should read ${spec.expect_text}.`, ...(staleNote ? [staleNote] : [])],
      ['This checks the measured outcome only. It is not a safety guarantee.'], obsEv(shown), { scope, fresh, series: ser, short: `${spec.claim_text}, confirmed by the ${spec.noun} sensor`, facts: { claim: spec.claim_text, noun: spec.noun, last: r1(v.value), unit: spec.unit } });
  }
  if (usable.every(s => s === 'fail')) {
    const v = used.at(-1)!;
    const repeatLine = priorProblems >= 1 ? [`This is not the first time: ${priorProblems} earlier problem${priorProblems === 1 ? ' was' : 's were'} found for this device in the last 30 days.`] : [];
    return mk('PROBLEM_FOUND', 'contradiction', `${dev.name} reports ${spec.claim_text}, but ${spec.noun} is still ${r1(v.value)} ${spec.unit}.`,
      [`At ${t(claim.at)} the ${dev.name.toLowerCase()} reported "${claim.state}".`, `After the ${spec.settle_s}-second settling period, ${r1(v.value)} ${spec.unit} was measured at ${t(v.at)}, and the readings before it agree. ${spec.claim_text[0].toUpperCase() + spec.claim_text.slice(1)} should read ${spec.expect_text}.`, 'The report and the measurement disagree. This does not show which one is wrong.', ...(staleNote ? [staleNote] : []), ...repeatLine],
      ['The cause is not established.', 'Draining, trapped air or a second source of flow can also produce a reading.'], obsEv(shown), { scope, fresh, series: ser, suggested_fix: dev.fixes?.[0] ? { id: dev.fixes[0].id, title: dev.fixes[0].title, description: dev.fixes[0].description } : undefined, short: `says ${spec.claim_text}, but ${spec.noun} is still ${r1(v.value)} ${spec.unit}`, facts: { claim: spec.claim_text, noun: spec.noun, last: r1(v.value), unit: spec.unit } });
  }
  return mk('NOT_VERIFIED', 'contradiction', `${dev.name} says ${spec.claim_text}. The readings do not agree.`,
    [usable.includes('mixed') ? 'The most recent readings are on both sides of the limit.' : 'Independent sources give different answers.', 'I will not call it either way until the readings settle or another source confirms.'],
    ['Disagreeing sources are a reason to look, not evidence of either result.'], obsEv(shown), { scope, fresh, series: ser, short: 'the readings do not agree' });
}

// ---------- 2. Gradual change: comparable cycles against the appliance's own baseline ----------
export interface Point { t: number; v: number; x?: number; tg?: number; n: number }
export interface TrendCfg { baseDays: number; minSpanDays: number; settingTol: number; minBase: number; minPoints: number; recentK: number; quorum: number; relFloor: number; eachFloor: number; sigmaMult: number; staleDays: number; maxMissing: number; band: number; minNeighbours: number }
export const TREND: TrendCfg = { baseDays: 45, minSpanDays: 60, settingTol: 1.5, minBase: 15, minPoints: 40, recentK: 14, quorum: 10, relFloor: 0.2, eachFloor: 0.15, sigmaMult: 4, staleDays: 21, maxMissing: 0.3, band: 8, minNeighbours: 5 };

export interface TrendResult {
  status: 'consistent' | 'drift' | 'insufficient' | 'stale' | 'cannot_separate' | 'not_comparable';
  reason: string; sigma?: number; medianRatio?: number; countOver?: number; recentN?: number; tau?: number;
  expectedMed?: number; actualMed?: number; baseMed?: number; baseUntil?: number; recentFrom?: number;
  adjusted: { t: number; v: number; raw: number; expected: number; ratio: number }[]; baselinePts?: { t: number; v: number }[];
}
export function analyzeTrend(points: Point[], nowMs: number, cfg: TrendCfg = TREND): TrendResult {
  const empty = (status: TrendResult['status'], reason: string): TrendResult => ({ status, reason, adjusted: [] });
  const pts = [...points].sort((a, b) => a.t - b.t);
  if (pts.length < cfg.minPoints) return empty('insufficient', `Only ${pts.length} cycles are recorded; at least ${cfg.minPoints} are needed to know what is normal for this appliance.`);
  const dT = (p: Point) => (p.x !== undefined && p.tg !== undefined ? p.tg - p.x : NaN);
  const usable = pts.filter(p => dT(p) >= 5);
  if ((pts.length - usable.length) / pts.length > cfg.maxMissing) return empty('cannot_separate', 'Starting or target temperatures are missing for many cycles, so a longer heating time cannot be separated from colder incoming water.');
  // Only cycles at the current target temperature are comparable: after a setting change, a new baseline has to build up.
  const cur = usable.length ? usable[usable.length - 1].tg! : NaN;
  const valid = usable.filter(p => Math.abs(p.tg! - cur) <= cfg.settingTol);
  if (valid.length < cfg.minPoints) return empty('insufficient', valid.length < usable.length ? `The target temperature was changed. Only ${valid.length} cycles are at the current setting; at least ${cfg.minPoints} are needed to define normal for it.` : `Only ${valid.length} cycles have usable temperatures; at least ${cfg.minPoints} are needed to know what is normal for this appliance.`);
  if ((valid[valid.length - 1].t - valid[0].t) / 86400000 < cfg.minSpanDays) return empty('insufficient', `Normal is defined from at least ${cfg.minSpanDays} days of history; this appliance has less at its current setting.`);
  if (nowMs - valid[valid.length - 1].t > cfg.staleDays * 86400000) return empty('stale', `The most recent cycle is more than ${cfg.staleDays} days old.`);
  const base = valid.filter(p => p.t - valid[0].t <= cfg.baseDays * 86400000);
  if (base.length < cfg.minBase) return empty('insufficient', `Only ${base.length} cycles fall in the first ${cfg.baseDays} days, which is too few to define normal.`);
  const rest = valid.slice(base.length);
  const expected = (p: Point, pool: Point[], skip?: Point) => {
    const near = pool.filter(b => b !== skip && Math.abs(dT(b) - dT(p)) <= cfg.band);
    if (near.length < cfg.minNeighbours) return NaN;
    return median(near.map(b => b.v * (dT(p) / dT(b)))); // heating time scales with the temperature rise inside a narrow window
  };
  const baseRatios = base.map(p => { const e = expected(p, base, p); return Number.isNaN(e) ? NaN : p.v / e; }).filter(x => !Number.isNaN(x));
  const sigma = Math.max(0.04, baseRatios.length >= 8 ? madScaled(baseRatios) : 0.06);
  const adj = rest.map(p => { const e = expected(p, base); return { p, e, ratio: Number.isNaN(e) ? NaN : p.v / e }; });
  const comparable = adj.filter(a => !Number.isNaN(a.ratio));
  const refLevel = median(base.map(b => b.v));
  const adjusted = comparable.map(a => ({ t: a.p.t, v: a.ratio * refLevel, raw: a.p.v, expected: a.e, ratio: a.ratio }));
  const baselinePts = base.map(p => ({ t: p.t, v: p.v }));
  const last30 = adj.slice(-30); const comp30 = last30.filter(a => !Number.isNaN(a.ratio)).length;
  if (comparable.length < cfg.recentK || comp30 < cfg.quorum) return { status: 'not_comparable', reason: 'Recent cycles start from temperatures too different from the baseline period to compare fairly.', sigma, adjusted, baselinePts, baseMed: refLevel, baseUntil: base[base.length - 1].t };
  const recent = comparable.slice(-cfg.recentK);
  const medRatio = median(recent.map(a => a.ratio));
  const thrMed = 1 + Math.max(cfg.relFloor, cfg.sigmaMult * sigma); const thrEach = 1 + Math.max(cfg.eachFloor, 3 * sigma);
  const over = recent.filter(a => a.ratio >= thrEach).length;
  // Kendall tau of ratio against time over the comparable post-baseline cycles: rising or just shifted?
  const rs = comparable.slice(-120).map(a => a.ratio); let con = 0, dis = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { if (rs[j] > rs[i]) con++; else if (rs[j] < rs[i]) dis++; }
  const tau = con + dis ? (con - dis) / (con + dis) : 0;
  const res: TrendResult = { status: medRatio >= thrMed && over >= cfg.quorum ? 'drift' : 'consistent', reason: '', sigma, medianRatio: medRatio, countOver: over, recentN: recent.length, tau,
    expectedMed: median(recent.map(a => a.e)), actualMed: median(recent.map(a => a.p.v)), baseMed: refLevel, baseUntil: base[base.length - 1].t, recentFrom: recent[0].p.t, adjusted, baselinePts };
  return res;
}

export function pointsFromRuns(runs: RunRec[], summaries: DaySummary[], now: Date, keepDays = 30): Point[] {
  const cutoff = now.getTime() - keepDays * 86400000;
  const raw = runs.filter(r => r.status === 'completed' && Date.parse(r.started_at) >= cutoff).map(r => ({ t: Date.parse(r.started_at), v: r.duration_min, x: r.start_temp_c, tg: r.target_c, n: 1 }));
  const old = summaries.filter(s => Date.parse(s.date) < cutoff).map(s => ({ t: Date.parse(s.date), v: s.median_duration_min, x: s.median_start_temp_c, tg: s.median_target_c, n: s.n }));
  return [...old, ...raw];
}
// Compact old raw runs into one summary per local day. Old days that were abnormal keep their raw runs elsewhere (see Store.keepRaw).
export function compactRuns(runs: RunRec[], now: Date, keepDays = 30): { summaries: DaySummary[]; keep: RunRec[] } {
  const cutoff = now.getTime() - keepDays * 86400000; const days = new Map<string, RunRec[]>(); const keep: RunRec[] = [];
  for (const r of runs) { if (Date.parse(r.started_at) >= cutoff) { keep.push(r); continue; } const k = r.started_at.slice(0, 10); (days.get(k) ?? days.set(k, []).get(k)!).push(r); }
  const summaries: DaySummary[] = [...days.entries()].sort().map(([date, l]) => {
    const d = l.filter(r => r.status === 'completed').map(r => r.duration_min); const xs = l.map(r => r.start_temp_c).filter((x): x is number => x !== undefined); const tg = l.map(r => r.target_c).filter((x): x is number => x !== undefined);
    return { date: date + 'T00:00:00.000Z', device_id: l[0].device_id, n: l.length, median_duration_min: median(d), min_duration_min: Math.min(...d), max_duration_min: Math.max(...d), median_start_temp_c: xs.length ? median(xs) : undefined, median_target_c: tg.length ? median(tg) : undefined, synthetic: l.every(r => r.synthetic) };
  }).filter(s => !Number.isNaN(s.median_duration_min));
  return { summaries, keep };
}

export function trendFinding(dev: DeviceSpec, points: Point[], now: Date, synthetic = true): Finding {
  const a = analyzeTrend(points, now.getTime());
  const base = { device_id: dev.id, device_name: dev.name, check: 'gradual_change' as const, scope: 'trend' as const, as_of: now.toISOString(), synthetic };
  const lastT = points.length ? new Date(Math.max(...points.map(p => p.t))).toISOString() : now.toISOString();
  const rel = Math.max(0.15, 3 * (a.sigma ?? 0.06));
  const series: Series | undefined = a.adjusted.length ? { kind: 'line', unit: 'min',
    points: a.adjusted.map(p => ({ t: new Date(p.t).toISOString(), v: Math.round(p.raw * 10) / 10, r: Math.round(p.expected * 10) / 10, flag: p.ratio >= 1 + rel })),
    base: a.baselinePts?.map(p => ({ t: new Date(p.t).toISOString(), v: Math.round(p.v * 10) / 10 })),
    baseline: a.baseMed !== undefined && a.baseUntil !== undefined ? { from: new Date(points.map(p => p.t).sort((x, y) => x - y)[0]).toISOString(), to: new Date(a.baseUntil).toISOString(), level: a.baseMed, band: rel } : undefined } : undefined;
  const common = { fresh: true, series };
  const limits = ['Heating-draw time comes from the smart-plug power reading. It is not a measurement of water temperature.', 'Only starting and target temperature are accounted for. Usage, tank size and settings are not.', 'The cause is not established.'];
  const rng = (ms: number) => `${fmtDay(new Date(ms))} ${new Date(ms).toISOString().slice(0, 10)}`;
  if (a.status === 'drift') {
    return { ...base, ...common, id: hid(dev.id, 'trend', 'drift', String(Math.max(...points.map(p => p.t)))), verdict: 'PROBLEM_FOUND', label: 'Unusual change',
      headline: `${dev.name} now takes about ${r1(a.actualMed!)} min to heat; comparable cycles used to take about ${r1(a.expectedMed!)} min.`,
      explanation: [`Each cycle is compared only with earlier cycles that started from a similar temperature, so colder winter water is not mistaken for a fault.`, `${a.countOver} of the last ${a.recentN} comparable cycles were well above that baseline, and the median is ${r1(a.medianRatio!)}× normal.`, a.tau! >= 0.4 ? 'The change has been rising across cycles, not a single jump.' : 'The change looks more like a shift than a steady rise.', 'Every cycle still ended normally. Nothing was reported as failing.'],
      limitations: limits, evidence: trendEvidence(a, points, true), suggested_fix: undefined, short: `takes about ${r1(a.medianRatio!)} times as long to heat as it used to`, facts: { actual: r1(a.actualMed!), expected: r1(a.expectedMed!), ratio: r1(a.medianRatio!), over: a.countOver!, of: a.recentN!, tau: Math.round(a.tau! * 100) / 100 } };
  }
  if (a.status === 'consistent') {
    return { ...base, ...common, id: hid(dev.id, 'trend', 'ok', String(Math.max(...points.map(p => p.t)))), verdict: 'WORKED', label: 'Worked',
      headline: `${dev.name} heats as it normally does.`, explanation: [`Comparable cycles are within the normal range: median ${r1(a.medianRatio!)}× the baseline.`], limitations: limits, evidence: trendEvidence(a, points, false), short: 'no sustained change in heating time' };
  }
  return { ...base, ...common, id: hid(dev.id, 'trend', a.status, lastT), verdict: 'NOT_VERIFIED', label: 'Not verified', headline: `${dev.name}: not enough to judge its heating trend.`, explanation: [a.reason], limitations: ['A trend can only be judged against the appliance’s own history.'], evidence: [], scope: 'trend', short: 'not enough history to judge its heating trend' };
}
function trendEvidence(a: TrendResult, points: Point[], drift: boolean): EvidenceItem[] {
  const first = points.slice().sort((x, y) => x.t - y.t)[0];
  const out: EvidenceItem[] = [{ role: 'baseline', label: `Baseline: typical heating-draw time about ${r1(a.baseMed!)} min`, value: `${r1(a.baseMed!)} min`, at: new Date(first.t).toISOString(), source: 'smart-plug power reading', independent: true, synthetic: true }];
  if (a.actualMed !== undefined) out.push({ role: 'recent', label: `Last ${a.recentN} comparable cycles: median ${r1(a.actualMed)} min (baseline for the same temperature rise: ${r1(a.expectedMed!)} min)`, value: `${r1(a.actualMed)} min`, at: a.recentFrom ? new Date(a.recentFrom).toISOString() : undefined, source: 'smart-plug power reading', independent: true, synthetic: true });
  if (drift) out.push({ role: 'note', label: `${a.countOver} of ${a.recentN} recent cycles at least ${r1(1 + Math.max(0.15, 3 * a.sigma!))}× baseline`, synthetic: true });
  return out;
}

// ---------- 3. Execution anomaly: a job that finished, but not the way it normally does ----------
export function reviewRun(dev: DeviceSpec, runs: RunRec[], runId: string | undefined, now: Date): Finding {
  const done = runs.filter(r => r.device_id === dev.id).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const run = runId ? done.find(r => r.id === runId) : done.at(-1);
  const base = { device_id: dev.id, device_name: dev.name, check: 'execution_anomaly' as const, scope: 'run' as const, as_of: now.toISOString(), fresh: true };
  if (!run) return { ...base, id: hid(dev.id, 'run', 'none'), verdict: 'NOT_VERIFIED', label: 'Not verified', headline: `${dev.name}: no run to review.`, explanation: ['No run record has been received.'], limitations: [], evidence: [], synthetic: true, short: 'no run to review' };
  const prior = done.filter(r => r.started_at < run.started_at && r.status === 'completed' && (r.mode ?? '') === (run.mode ?? '')).slice(-20);
  const synthetic = run.synthetic;
  const evRun: EvidenceItem = { role: 'run', label: `${run.status === 'completed' ? 'Finished' : 'Stopped'}: ${r1(run.duration_min)} min, ${run.pauses ?? 0} pause${(run.pauses ?? 0) === 1 ? '' : 's'}`, at: run.started_at, source: 'device run log', independent: false, synthetic };
  if (run.status !== 'completed') return { ...base, id: hid(dev.id, 'run', run.id, 'abort'), verdict: 'PROBLEM_FOUND', label: 'Problem found', headline: `${dev.name} did not finish its run.`, explanation: [`The run that started at ${t(run.started_at)} ended without completing.`], limitations: ['The device’s log gives no cause, so none is stated.'], evidence: [evRun], synthetic, short: 'did not finish its last run' };
  if (prior.length < 6) return { ...base, id: hid(dev.id, 'run', run.id, 'nb'), verdict: 'NOT_VERIFIED', label: 'Not verified', headline: `${dev.name} finished, but I have too few earlier runs to compare.`, explanation: [`${prior.length} comparable earlier runs are recorded; 6 are needed.`], limitations: ['A pause count means little without what is normal for this device.'], evidence: [evRun], synthetic, short: 'finished, but too few earlier runs to compare' };
  const pm = median(prior.map(r => r.pauses ?? 0)); const dm = median(prior.map(r => r.duration_min)); const ds = Math.max(1.5, madScaled(prior.map(r => r.duration_min)));
  const maxPrior = Math.max(...prior.map(r => r.pauses ?? 0)); const pauseHi = (run.pauses ?? 0) > maxPrior && (run.pauses ?? 0) >= pm + 3; const durHi = run.duration_min >= dm * 1.3 && run.duration_min >= dm + 3 * ds;
  const lastTwo = done.filter(r => r.started_at < run.started_at).slice(-2);
  const wasOdd = (r: RunRec) => {
    if (r.status !== 'completed') return false;
    const pr = done.filter(x => x.started_at < r.started_at && x.status === 'completed' && (x.mode ?? '') === (r.mode ?? '')).slice(-20);
    if (pr.length < 6) return false;
    const m = median(pr.map(x => x.pauses ?? 0)), d = median(pr.map(x => x.duration_min)), sd = Math.max(1.5, madScaled(pr.map(x => x.duration_min)));
    const mx = Math.max(...pr.map(x => x.pauses ?? 0));
    return ((r.pauses ?? 0) > mx && (r.pauses ?? 0) >= m + 3) || (r.duration_min >= d * 1.3 && r.duration_min >= d + 3 * sd);
  };
  const repeated = lastTwo.filter(wasOdd).length;
  const evidence: EvidenceItem[] = [evRun, { role: 'baseline', label: `Usual for ${run.mode ?? 'this mode'}: ${r1(pm)} pauses, ${r1(dm)} min (last ${prior.length} runs)`, source: 'device run log', independent: false, synthetic },
    ...(run.pause_events ?? []).slice(0, 6).map(e => ({ role: 'observation' as const, label: `Paused ${e.seconds} s${e.code ? `, device code ${e.code}` : ''}`, at: e.at, source: 'device run log', independent: false, synthetic }))];
  const series: Series = { kind: 'bars', unit: 'pauses', points: [...prior.slice(-12), run].map(r => ({ t: r.started_at, v: r.pauses ?? 0, r: r.duration_min, flag: r === run && (pauseHi || durHi) })) };
  if (pauseHi || durHi) {
    const bits = [pauseHi ? `${run.pauses} pauses (usual ${r1(pm)})` : '', durHi ? `${r1(run.duration_min)} min (usual ${r1(dm)})` : ''].filter(Boolean).join(' and ');
    return { ...base, id: hid(dev.id, 'run', run.id, 'anom'), verdict: 'PROBLEM_FOUND', label: 'Completed with an anomaly', series,
      headline: `${dev.name} finished its run, but with ${bits}.`,
      explanation: [`The run that started at ${t(run.started_at)} ended normally, so a plain "done" report would call it a success.`, `Compared with its last ${prior.length} ${run.mode ?? ''} runs, this one is outside the normal range.`, repeated ? `${repeated} of the ${lastTwo.length} runs before it were also outside the range.` : 'The runs before it were within the normal range.', 'The device’s own log is the only source here.'],
      short: 'finished its run as it normally does', limitations: ['Only what the device logged is used. No sound is heard and no cause is inferred.', 'A one-off pause can have an ordinary reason, such as an obstacle.'], evidence, synthetic, short: `finished, but with ${bits}`, facts: { pauses: run.pauses ?? 0, usual_pauses: r1(pm), minutes: r1(run.duration_min), usual_minutes: r1(dm) } };
  }
  return { ...base, id: hid(dev.id, 'run', run.id, 'ok'), verdict: 'WORKED', label: 'Worked', series, headline: `${dev.name} finished its run as it normally does.`, explanation: [`${run.pauses ?? 0} pauses and ${r1(run.duration_min)} min are within the range of its last ${prior.length} runs.`], limitations: ['Only what the device logged is used.'], evidence, synthetic };
}

// ---------- 4. The night check: group findings by when they apply ----------
export interface Night { current: Finding[]; earlier: Finding[]; run: Finding[]; trend: Finding[]; not_verified: Finding[]; worked: Finding[]; spoken: string }
export function nightCheck(findings: Finding[], now: Date): Night {
  const n: Night = { current: [], earlier: [], run: [], trend: [], not_verified: [], worked: [], spoken: '' };
  for (const f of findings) {
    if (f.verdict === 'NOT_VERIFIED') n.not_verified.push(f);
    else if (f.verdict === 'WORKED') n.worked.push(f);
    else if (f.scope === 'trend') n.trend.push(f); else if (f.scope === 'run') n.run.push(f); else if (f.scope === 'current') n.current.push(f); else n.earlier.push(f);
  }
  const parts: string[] = [];
  const total = findings.length;
  parts.push(`I checked ${total} thing${total === 1 ? '' : 's'}. ${n.worked.length} ${n.worked.length === 1 ? 'was' : 'were'} confirmed.`);
  for (const f of n.current) parts.push(`Right now: ${f.device_name} ${f.short}.`);
  for (const f of n.earlier) parts.push(`Earlier, ${t(f.evidence.at(-1)?.at ?? f.as_of)}: ${f.device_name} ${f.short}. I have no newer reading.`);
  for (const f of n.run) parts.push(`From its last run: ${f.device_name} ${f.short}.`);
  for (const f of n.trend) parts.push(`Over recent weeks, not tonight: ${f.device_name} ${f.short}.`);
  if (n.not_verified.length) parts.push(`I could not confirm ${n.not_verified.map(f => f.device_name.toLowerCase()).join(', ')}.`);
  n.spoken = parts.join(' ');
  void sameLocalDay; void now;
  return n;
}
