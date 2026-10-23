// Fault-injection benchmark. Everything is synthetic and seeded; results describe how the rules
// behave on THESE generated scenarios, not on real homes. The scenario classes are defined here
// so that any number quoted from this file can be traced to the set that produced it.
import { rng, geyserRuns, cleanerRuns } from './sim.ts';
import { analyzeTrend, pointsFromRuns, compactRuns, reviewRun, verifyOutcome, median } from './engine.ts';
import { deviceById } from './devices.ts';
import type { Claim, Obs, Verdict } from './model.ts';

const valve = deviceById('valve_main')!; const geyser = deviceById('geyser_bath')!; const cleaner = deviceById('cleaner_floor')!;
const T0 = Date.parse('2026-10-22T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

// ---------- Contradiction: valve reports closed, flow meter(s) say what they say ----------
export type ValveClass = 'closed_clean' | 'closed_noisy' | 'stuck_open' | 'partial_leak' | 'dead_sensor' | 'one_reading' | 'late_only' | 'stale_open' | 'stuck_zero_sensor' | 'sensors_disagree';
export const VALVE_CLASSES: ValveClass[] = ['closed_clean', 'closed_noisy', 'stuck_open', 'partial_leak', 'dead_sensor', 'one_reading', 'late_only', 'stale_open', 'stuck_zero_sensor', 'sensors_disagree'];
// Which classes the main claim is made over. `stuck_zero_sensor` is the case a single sensor cannot reveal.
export interface ValveScenario { cls: ValveClass; broken: boolean; verdict: Verdict; fresh: boolean; scope: string; usedReadings: number; sources: number }
export function runValve(cls: ValveClass, seed: number, sources: 1 | 2): ValveScenario {
  const r = rng(seed); const claim: Claim = { id: 'c', device_id: 'valve_main', command: 'close', state: 'closed', at: iso(T0), reported_by: 'valve', synthetic: true };
  const obs: Obs[] = []; let n = 0;
  const add = (src: string, at: number, v: number) => obs.push({ id: 'o' + ++n, device_id: 'valve_main', source: src, independent: true, metric: 'flow_lpm', value: Math.max(0, v), at: iso(at), synthetic: true });
  const srcs = sources === 2 ? ['flow_meter', 'clamp_sensor'] : ['flow_meter'];
  const settle = valve.outcome!.settle_s * 1000; const k = r.int(3, 6);
  let broken = false; let truthFlow = 0; let lastAt = T0 + settle + 5 * 60000;
  const series = (flowFor: (src: string, i: number) => number, from = T0 + settle + 10000, count = k, step = 40000) => { for (let i = 0; i < count; i++) for (const s of srcs) add(s, from + i * step + r.int(0, 3000), flowFor(s, i)); lastAt = from + (count - 1) * step; };
  const transient = () => { for (const s of srcs) { add(s, T0 + 15000, 5 + r.gauss()); add(s, T0 + 50000, 2 + r.gauss() * 0.5); } }; // water still draining before the settling period ends
  switch (cls) {
    case 'closed_clean': transient(); series(() => Math.abs(r.gauss()) * 0.06); break;
    case 'closed_noisy': transient(); series(() => 0.12 + Math.abs(r.gauss()) * 0.12); break;
    case 'stuck_open': broken = true; truthFlow = 6; series(() => 6 + r.gauss() * 1.5); break;
    case 'partial_leak': broken = true; truthFlow = 0.8; series(() => 0.8 + r.gauss() * 0.15); break;
    case 'dead_sensor': broken = r.next() < 0.5; break;                                   // nothing reports; the world can be either
    case 'one_reading': broken = r.next() < 0.5; series(() => (broken ? 5 : 0.03), T0 + settle + 20000, 1); break;
    case 'late_only': broken = r.next() < 0.5; transient(); lastAt = T0 + 50000; break;   // only pre-settle readings
    case 'stale_open': broken = true; series(() => 6 + r.gauss(), T0 + settle + 10000, 3); lastAt = T0 + settle + 90000; break;
    case 'stuck_zero_sensor': broken = true; transient(); series((s, i) => (s === 'flow_meter' ? 0 : 5.5 + r.gauss()), T0 + settle + 10000, k); break; // meter stuck at 0 while water flows
    case 'sensors_disagree': broken = sources === 1 ? true : r.next() < 0.5; transient(); series((s) => (s === 'flow_meter' ? 6 : 0.02), T0 + settle + 10000, k); break;
  }
  void truthFlow;
  const lag = cls === 'stale_open' ? 6 * 3600000 : r.int(0, 8) * 60000;
  const f = verifyOutcome(valve, claim, obs, new Date(Math.max(lastAt, T0 + settle + 1000) + lag));
  return { cls, broken, verdict: f.verdict, fresh: f.fresh, scope: f.scope, usedReadings: f.evidence.filter(e => e.role === 'observation').length, sources };
}
export interface ValveReport { n: number; byClass: Record<string, { n: number; broken: number; worked: number; problem: number; notVerified: number }>; main: Rates; withStuckZero: Rates }
export interface Rates { falseReassurance: number; falseAlarm: number; detection: number; abstainWhenBroken: number; abstainWhenFine: number; brokenN: number; fineN: number }
function rates(list: ValveScenario[]): Rates {
  const b = list.filter(x => x.broken); const g = list.filter(x => !x.broken); const f = (l: ValveScenario[], v: Verdict) => l.length ? l.filter(x => x.verdict === v).length / l.length : 0;
  return { falseReassurance: f(b, 'WORKED'), detection: f(b, 'PROBLEM_FOUND'), abstainWhenBroken: f(b, 'NOT_VERIFIED'), falseAlarm: f(g, 'PROBLEM_FOUND'), abstainWhenFine: f(g, 'NOT_VERIFIED'), brokenN: b.length, fineN: g.length };
}
export function valveBenchmark(perClass: number, sources: 1 | 2, seed = 1): ValveReport & { all: ValveScenario[] } {
  const all: ValveScenario[] = []; const byClass: ValveReport['byClass'] = {};
  VALVE_CLASSES.forEach((cls, ci) => { for (let i = 0; i < perClass; i++) all.push(runValve(cls, seed * 100003 + ci * 7919 + i, sources)); });
  for (const s of all) { const c = (byClass[s.cls] ??= { n: 0, broken: 0, worked: 0, problem: 0, notVerified: 0 }); c.n++; if (s.broken) c.broken++; if (s.verdict === 'WORKED') c.worked++; else if (s.verdict === 'PROBLEM_FOUND') c.problem++; else c.notVerified++; }
  const noStuck = all.filter(s => s.cls !== 'stuck_zero_sensor');
  return { n: all.length, byClass, main: rates(noStuck), withStuckZero: rates(all), all };
}

// ---------- Gradual change: monitored daily-ish over the whole history ----------
export type TrendClass = 'stable' | 'strong_seasonal' | 'setpoint_change' | 'gradual_decline' | 'step_change' | 'sparse_decline' | 'missing_temps_decline' | 'short_history';
export const TREND_CLASSES: TrendClass[] = ['stable', 'strong_seasonal', 'setpoint_change', 'gradual_decline', 'step_change', 'sparse_decline', 'missing_temps_decline', 'short_history'];
export interface TrendScenario { cls: TrendClass; truthDeclining: boolean; everAlerted: boolean; finalVerdict: Verdict; finalStatus: string; leadDays: number | null; factorAtAlert: number | null; compactedSame: boolean; falseAlarmChecks: number; checks: number }
export function runTrend(cls: TrendClass, seed: number): TrendScenario {
  const r = rng(seed); const end = Date.parse('2026-10-22T16:30:00Z');
  const days = cls === 'short_history' ? 25 : cls === 'strong_seasonal' ? 300 : r.int(180, 270);
  const fixedLoss = r.next() * 4; const noise = 0.04 + r.next() * 0.08; const perDay = r.next() < 0.3 ? 2 : 1;
  const base = { seed, endIso: new Date(end).toISOString(), days, perDay, fixedLoss, usageNoise: noise, inletMean: 24 + r.next() * 4, inletAmp: 2 + r.next() * 2 };
  const startFrac = 0.25 + r.next() * 0.25; const finalFactor = 1.8 + r.next() * 1.4;
  const opts = cls === 'strong_seasonal' ? { ...base, inletMean: 20, inletAmp: 8 + r.next() * 2 }
    : cls === 'setpoint_change' ? { ...base, targetC: 50, targetChange: { atFrac: 0.45 + r.next() * 0.2, to: 60 } }
    : cls === 'gradual_decline' ? { ...base, degrade: { kind: 'gradual' as const, startFrac, finalFactor } }
    : cls === 'step_change' ? { ...base, degrade: { kind: 'step' as const, startFrac, finalFactor: 1.7 + r.next() * 0.6 } }
    : cls === 'sparse_decline' ? { ...base, sparse: 0.75, degrade: { kind: 'gradual' as const, startFrac, finalFactor } }
    : cls === 'missing_temps_decline' ? { ...base, missingStartTemp: 0.65, degrade: { kind: 'gradual' as const, startFrac, finalFactor } }
    : base;
  const { runs, factorAt } = geyserRuns(opts);
  const truthDeclining = ['gradual_decline', 'step_change', 'sparse_decline', 'missing_temps_decline'].includes(cls);
  const verdictAt = (nowMs: number, keepDays = 30) => {
    const now = new Date(nowMs); const upto = runs.filter(x => Date.parse(x.started_at) <= nowMs);
    const { summaries, keep } = compactRuns(upto, now, keepDays);
    return analyzeTrend(pointsFromRuns(keep, summaries, now, keepDays), nowMs);
  };
  // Monitor every 3 days once there is something to judge; count any alert at any check.
  let everAlerted = false, firstAlertDay: number | null = null, falseAlarmChecks = 0, checks = 0;
  for (let d = Math.min(40, days - 1); d < days; d += 3) {
    const nowMs = end - (days - 1 - d) * 86400000 + 3600000; const a = verdictAt(nowMs); checks++;
    if (a.status === 'drift') { everAlerted = true; if (firstAlertDay === null) firstAlertDay = d; if (!truthDeclining) falseAlarmChecks++; }
  }
  const final = verdictAt(end); const rawFinal = verdictAt(end, 100000);
  const frac = (d: number) => d / Math.max(1, days - 1);
  // Reference severity: heating time has doubled (2x its true baseline). Lead = days between the first alert and that point.
  let sevDay: number | null = null; for (let d = 0; d < days; d++) if (factorAt(frac(d)) >= 2) { sevDay = d; break; }
  const leadDays = cls === 'gradual_decline' && firstAlertDay !== null && sevDay !== null ? sevDay - firstAlertDay : null;
  const factorAtAlert = cls === 'gradual_decline' && firstAlertDay !== null ? factorAt(frac(firstAlertDay)) : null;
  const verdict: Verdict = final.status === 'drift' ? 'PROBLEM_FOUND' : final.status === 'consistent' ? 'WORKED' : 'NOT_VERIFIED';
  return { cls, truthDeclining, everAlerted, finalVerdict: verdict, finalStatus: final.status, leadDays, factorAtAlert, compactedSame: final.status === rawFinal.status, falseAlarmChecks, checks };
}
export interface TrendReport { byClass: Record<string, { n: number; alerted: number; worked: number; problem: number; notVerified: number }>; detectionRate: number; falseAlarmScenarioRate: number; falseAlarmCheckRate: number; medianLeadDays: number | null; leadSamples: number; medianFactorAtAlert: number | null; compactionAgreement: number; falseReassurance: number; all: TrendScenario[] }
export function trendBenchmark(perClass: number, seed = 1): TrendReport {
  const all: TrendScenario[] = []; TREND_CLASSES.forEach((cls, ci) => { for (let i = 0; i < perClass; i++) all.push(runTrend(cls, seed * 91 + ci * 10007 + i)); });
  const byClass: TrendReport['byClass'] = {}; for (const s of all) { const c = (byClass[s.cls] ??= { n: 0, alerted: 0, worked: 0, problem: 0, notVerified: 0 }); c.n++; if (s.everAlerted) c.alerted++; if (s.finalVerdict === 'WORKED') c.worked++; else if (s.finalVerdict === 'PROBLEM_FOUND') c.problem++; else c.notVerified++; }
  const dec = all.filter(s => s.truthDeclining && s.cls !== 'missing_temps_decline' && s.cls !== 'sparse_decline'); const fine = all.filter(s => !s.truthDeclining && s.cls !== 'short_history');
  const leads = dec.map(s => s.leadDays).filter((x): x is number => x !== null); const facs = dec.map(s => s.factorAtAlert).filter((x): x is number => x !== null);
  const everDecl = all.filter(s => s.truthDeclining);
  return { byClass, detectionRate: dec.filter(s => s.everAlerted).length / Math.max(1, dec.length), falseAlarmScenarioRate: fine.filter(s => s.everAlerted).length / Math.max(1, fine.length),
    falseAlarmCheckRate: fine.reduce((a, s) => a + s.falseAlarmChecks, 0) / Math.max(1, fine.reduce((a, s) => a + s.checks, 0)),
    medianLeadDays: leads.length ? median(leads) : null, leadSamples: leads.length, medianFactorAtAlert: facs.length ? median(facs) : null, compactionAgreement: all.filter(s => s.compactedSame).length / all.length,
    falseReassurance: everDecl.filter(s => s.finalVerdict === 'WORKED').length / Math.max(1, everDecl.length), all };
}

// ---------- Execution anomaly: runs that finish ----------
export type RunClass = 'normal' | 'mild_variation' | 'many_pauses' | 'long_run' | 'pauses_and_long' | 'new_device';
export const RUN_CLASSES: RunClass[] = ['normal', 'mild_variation', 'many_pauses', 'long_run', 'pauses_and_long', 'new_device'];
export function runCleaner(cls: RunClass, seed: number): { cls: RunClass; anomalous: boolean; verdict: Verdict } {
  const r = rng(seed); const baseDur = 35 + r.next() * 40; const n = cls === 'new_device' ? r.int(1, 5) : 25;
  const idx = n - 1; const odd = cls === 'many_pauses' ? [{ index: idx, pauses: r.int(4, 8), duration: baseDur + r.gauss() * 2 }] : cls === 'long_run' ? [{ index: idx, pauses: 0, duration: baseDur * (1.45 + r.next() * 0.4) }]
    : cls === 'pauses_and_long' ? [{ index: idx, pauses: r.int(4, 8), duration: baseDur * 1.5 }] : cls === 'mild_variation' ? [{ index: idx, pauses: r.int(0, 2), duration: baseDur * (0.9 + r.next() * 0.2) }] : undefined;
  const runs = cleanerRuns({ seed, endIso: '2026-10-22T10:00:00Z', runs: n, baseDuration: baseDur, odd });
  const f = reviewRun(cleaner, runs, undefined, new Date('2026-10-22T16:30:00Z'));
  return { cls, anomalous: ['many_pauses', 'long_run', 'pauses_and_long'].includes(cls), verdict: f.verdict };
}
export function cleanerBenchmark(perClass: number, seed = 1) {
  const all = RUN_CLASSES.flatMap((cls, ci) => Array.from({ length: perClass }, (_, i) => runCleaner(cls, seed * 77 + ci * 4001 + i)));
  const an = all.filter(x => x.anomalous), ok = all.filter(x => !x.anomalous && x.cls !== 'new_device'), nd = all.filter(x => x.cls === 'new_device');
  return { n: all.length, detection: an.filter(x => x.verdict === 'PROBLEM_FOUND').length / an.length, falseAlarm: ok.filter(x => x.verdict === 'PROBLEM_FOUND').length / ok.length, newDeviceNotVerified: nd.filter(x => x.verdict === 'NOT_VERIFIED').length / nd.length, falseReassurance: an.filter(x => x.verdict === 'WORKED').length / an.length, all };
}
void geyser;
