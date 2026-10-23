import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyOutcome, analyzeTrend, pointsFromRuns, compactRuns, reviewRun, trendFinding, nightCheck } from '../server/engine.ts';
import { deviceById } from '../server/devices.ts';
import { geyserRuns, cleanerRuns } from '../server/sim.ts';
import type { Claim, Obs } from '../server/model.ts';

const valve = deviceById('valve_main')!; const lock = deviceById('lock_front')!; const geyser = deviceById('geyser_bath')!; const cleaner = deviceById('cleaner_floor')!;
const T0 = Date.parse('2026-10-22T12:00:00Z'); const iso = (ms: number) => new Date(ms).toISOString();
const claim: Claim = { id: 'c1', device_id: 'valve_main', command: 'close', state: 'closed', at: iso(T0), reported_by: 'valve', synthetic: true };
let n = 0;
const ob = (offsetS: number, v: number, source = 'flow_meter', device = 'valve_main', metric = 'flow_lpm', independent = true): Obs => ({ id: 'o' + ++n, device_id: device, source, independent, metric, value: v, at: iso(T0 + offsetS * 1000), synthetic: true });
const at = (offsetS: number) => new Date(T0 + offsetS * 1000);

test('valve: closed report while measured flow continues is a PROBLEM, with no cause claimed', () => {
  const f = verifyOutcome(valve, claim, [ob(120, 6.2), ob(160, 6.0), ob(200, 6.3)], at(230));
  assert.equal(f.verdict, 'PROBLEM_FOUND'); assert.equal(f.scope, 'current'); assert.ok(f.fresh);
  const text = [f.headline, ...f.explanation, ...f.limitations].join(' ');
  assert.match(text, /does not show which one is wrong/); assert.match(text, /cause is not established/);
  assert.doesNotMatch(text, /faulty|broken|defective/i);
  assert.equal(f.suggested_fix?.id, 'resend_close');
  assert.ok(f.evidence.some(e => e.role === 'claim') && f.evidence.some(e => e.role === 'observation' && e.independent));
});
test('valve: confirmed closed after the settling period is WORKED', () => {
  const f = verifyOutcome(valve, claim, [ob(20, 5.0), ob(55, 2.0), ob(120, 0.04), ob(160, 0.02)], at(200));
  assert.equal(f.verdict, 'WORKED');
});
test('valve: draining before the settling period is not held against the valve', () => {
  const f = verifyOutcome(valve, claim, [ob(10, 7), ob(40, 3), ob(100, 0), ob(140, 0)], at(180));
  assert.equal(f.verdict, 'WORKED');
});
test('valve: too early is NOT_VERIFIED, not a guess', () => {
  assert.equal(verifyOutcome(valve, claim, [ob(30, 5)], at(60)).verdict, 'NOT_VERIFIED');
});
test('valve: one reading is not enough', () => {
  assert.equal(verifyOutcome(valve, claim, [ob(120, 0.01)], at(150)).verdict, 'NOT_VERIFIED');
});
test('valve: a silent sensor is NOT_VERIFIED, never WORKED', () => {
  assert.equal(verifyOutcome(valve, claim, [ob(5, 4, 'flow_meter')], at(400)).verdict, 'NOT_VERIFIED');
});
test('valve: readings that do not agree are NOT_VERIFIED', () => {
  const f = verifyOutcome(valve, claim, [ob(120, 6), ob(160, 0.0), ob(200, 6)], at(230));
  assert.equal(f.verdict, 'NOT_VERIFIED');
});
test('valve: two sensors disagreeing is NOT_VERIFIED, not either answer', () => {
  const f = verifyOutcome(valve, claim, [ob(120, 6, 'flow_meter'), ob(160, 6, 'flow_meter'), ob(120, 0, 'clamp'), ob(160, 0, 'clamp')], at(200));
  assert.equal(f.verdict, 'NOT_VERIFIED'); assert.match(f.headline, /do not agree/);
});
test('valve: device-reported (non-independent) readings never count as evidence', () => {
  const f = verifyOutcome(valve, claim, [ob(120, 0, 'valve_self', 'valve_main', 'flow_lpm', false), ob(160, 0, 'valve_self', 'valve_main', 'flow_lpm', false)], at(200));
  assert.notEqual(f.verdict, 'WORKED');
});
test('a success with no independent confirmation stays NOT_VERIFIED (front door lock)', () => {
  const f = verifyOutcome(lock, { ...claim, id: 'l1', device_id: 'lock_front', state: 'locked', command: 'lock' }, [], at(300));
  assert.equal(f.verdict, 'NOT_VERIFIED'); assert.equal(f.check, 'no_independent_evidence'); assert.match(f.explanation.join(' '), /not a failure/i);
});
test('a stale problem is described as earlier, never as happening now', () => {
  const f = verifyOutcome(valve, claim, [ob(120, 6), ob(160, 6.1)], new Date(T0 + 6 * 3600000));
  assert.equal(f.verdict, 'PROBLEM_FOUND'); assert.equal(f.scope, 'earlier'); assert.equal(f.fresh, false);
  assert.match(f.explanation.join(' '), /cannot say what is happening now/);
});
test('engine is deterministic: identical input, identical output', () => {
  const o = [ob(120, 6.2), ob(160, 6.0)];
  assert.deepEqual(verifyOutcome(valve, claim, o, at(230)), verifyOutcome(valve, claim, o, at(230)));
});
test('verifyOutcome: priorProblems=0 or omitted adds no repeat sentence', () => {
  const obs = [ob(120, 6.2), ob(160, 6.0), ob(200, 6.3)];
  const f0 = verifyOutcome(valve, claim, obs, at(230), 0);
  const fOmit = verifyOutcome(valve, claim, obs, at(230));
  assert.equal(f0.verdict, 'PROBLEM_FOUND');
  assert.doesNotMatch(f0.explanation.join(' '), /not the first time/);
  assert.doesNotMatch(fOmit.explanation.join(' '), /not the first time/);
});
test('verifyOutcome: priorProblems>=1 appends the count to PROBLEM_FOUND explanation', () => {
  const obs = [ob(120, 6.2), ob(160, 6.0), ob(200, 6.3)];
  const f1 = verifyOutcome(valve, claim, obs, at(230), 1);
  const f2 = verifyOutcome(valve, claim, obs, at(230), 2);
  assert.equal(f1.verdict, 'PROBLEM_FOUND');
  assert.match(f1.explanation.join(' '), /not the first time: 1 earlier problem was found/);
  assert.match(f2.explanation.join(' '), /not the first time: 2 earlier problems were found/);
  // Must not appear on non-PROBLEM_FOUND verdicts
  const worked = verifyOutcome(valve, claim, [ob(20, 5.0), ob(55, 2.0), ob(120, 0.04), ob(160, 0.02)], at(200), 3);
  assert.equal(worked.verdict, 'WORKED');
  assert.doesNotMatch(worked.explanation.join(' '), /not the first time/);
});

// ---------- gradual change ----------
const END = '2026-10-22T16:30:00Z'; const NOW = new Date(END);
const trend = (opts: Parameters<typeof geyserRuns>[0]) => { const { runs } = geyserRuns(opts); const { summaries, keep } = compactRuns(runs, NOW); return analyzeTrend(pointsFromRuns(keep, summaries, NOW), NOW.getTime()); };
test('geyser: a stable appliance is not flagged', () => assert.equal(trend({ seed: 11, endIso: END, days: 200 }).status, 'consistent'));
test('geyser: a sustained rise in heating time is flagged', () => assert.equal(trend({ seed: 12, endIso: END, days: 200, degrade: { kind: 'gradual', startFrac: 0.3, finalFactor: 2.3 } }).status, 'drift'));
test('geyser: colder incoming water in winter is not a fault', () => assert.equal(trend({ seed: 13, endIso: END, days: 300, inletMean: 20, inletAmp: 9 }).status, 'consistent'));
test('geyser: a new target temperature needs its own baseline', () => {
  const a = trend({ seed: 14, endIso: END, days: 100, targetC: 50, targetChange: { atFrac: 0.9, to: 60 } });
  assert.equal(a.status, 'insufficient'); assert.match(a.reason, /target temperature was changed/);
  assert.equal(trend({ seed: 15, endIso: END, days: 220, targetC: 50, targetChange: { atFrac: 0.4, to: 60 } }).status, 'consistent');
});
test('geyser: missing temperatures cannot be separated from the season', () => assert.equal(trend({ seed: 16, endIso: END, days: 200, missingStartTemp: 0.7, degrade: { kind: 'gradual', startFrac: 0.3, finalFactor: 2.3 } }).status, 'cannot_separate'));
test('geyser: too little history is NOT_VERIFIED, not "fine"', () => {
  const f = (() => { const { runs } = geyserRuns({ seed: 17, endIso: END, days: 30 }); return trendFinding(geyser, pointsFromRuns(runs, [], NOW), NOW); })();
  assert.equal(f.verdict, 'NOT_VERIFIED');
});
test('geyser: an old appliance with no recent cycles is stale, not fine', () => {
  const { runs } = geyserRuns({ seed: 18, endIso: '2026-08-01T00:00:00Z', days: 150 }); const { summaries, keep } = compactRuns(runs, NOW);
  assert.equal(analyzeTrend(pointsFromRuns(keep, summaries, NOW), NOW.getTime()).status, 'stale');
});
test('geyser: the finding keeps cause unstated and labels the signal honestly', () => {
  const { runs } = geyserRuns({ seed: 12, endIso: END, days: 200, degrade: { kind: 'gradual', startFrac: 0.3, finalFactor: 2.3 } }); const { summaries, keep } = compactRuns(runs, NOW);
  const f = trendFinding(geyser, pointsFromRuns(keep, summaries, NOW), NOW);
  assert.equal(f.verdict, 'PROBLEM_FOUND'); assert.equal(f.label, 'Unusual change'); assert.equal(f.scope, 'trend');
  const text = [...f.explanation, ...f.limitations].join(' ');
  assert.match(text, /cause is not established/); assert.match(text, /not a measurement of water temperature/); assert.match(text, /Every cycle still ended normally/);
  assert.ok(f.series && f.series.points.length > 20);
});
test('compaction keeps the verdict: daily summaries plus recent raw runs agree with all raw runs', () => {
  const { runs } = geyserRuns({ seed: 21, endIso: END, days: 220, degrade: { kind: 'gradual', startFrac: 0.3, finalFactor: 2.3 } });
  const raw = analyzeTrend(pointsFromRuns(runs, [], NOW, 100000), NOW.getTime()); const { summaries, keep } = compactRuns(runs, NOW);
  assert.equal(analyzeTrend(pointsFromRuns(keep, summaries, NOW), NOW.getTime()).status, raw.status);
  assert.ok(summaries.length > 100 && keep.length <= 31);
});

// ---------- execution anomaly ----------
test('cleaner: a normal run is WORKED', () => {
  const runs = cleanerRuns({ seed: 3, endIso: END, runs: 30 }); assert.equal(reviewRun(cleaner, runs, undefined, NOW).verdict, 'WORKED');
});
test('cleaner: it finished, but with repeated pauses and a long runtime, so Completed with an anomaly', () => {
  const runs = cleanerRuns({ seed: 3, endIso: END, runs: 30, odd: [{ index: 29, pauses: 5, duration: 64 }] });
  const f = reviewRun(cleaner, runs, undefined, NOW);
  assert.equal(f.verdict, 'PROBLEM_FOUND'); assert.equal(f.label, 'Completed with an anomaly'); assert.equal(f.scope, 'run');
  assert.match(f.explanation.join(' '), /ended normally/); assert.match(f.limitations.join(' '), /No sound is heard and no cause is inferred/);
});
test('cleaner: too few earlier runs is NOT_VERIFIED', () => {
  const runs = cleanerRuns({ seed: 3, endIso: END, runs: 4, odd: [{ index: 3, pauses: 6, duration: 70 }] }); assert.equal(reviewRun(cleaner, runs, undefined, NOW).verdict, 'NOT_VERIFIED');
});
test('cleaner: an aborted run is reported as not finished', () => {
  const runs = cleanerRuns({ seed: 3, endIso: END, runs: 12 }); runs[runs.length - 1] = { ...runs[runs.length - 1], status: 'aborted' };
  assert.equal(reviewRun(cleaner, runs, undefined, NOW).headline, 'Floor cleaner did not finish its run.');
});

// ---------- the night check keeps time straight ----------
test('night check: gradual and run findings are never described as happening now', () => {
  const runs = cleanerRuns({ seed: 3, endIso: END, runs: 30, odd: [{ index: 29, pauses: 5, duration: 64 }] });
  const g = geyserRuns({ seed: 12, endIso: END, days: 200, degrade: { kind: 'gradual', startFrac: 0.3, finalFactor: 2.3 } }).runs; const { summaries, keep } = compactRuns(g, NOW);
  const fs = [reviewRun(cleaner, runs, undefined, NOW), trendFinding(geyser, pointsFromRuns(keep, summaries, NOW), NOW)];
  const nc = nightCheck(fs, NOW);
  assert.equal(nc.current.length, 0); assert.equal(nc.run.length, 1); assert.equal(nc.trend.length, 1);
  assert.match(nc.spoken, /From its last run:/); assert.match(nc.spoken, /Over recent weeks, not tonight:/); assert.doesNotMatch(nc.spoken, /Right now:/);
});
test('night check: a fresh contradiction is current; an old one is earlier; an unverifiable lock is listed', () => {
  const live = verifyOutcome(valve, claim, [ob(120, 6), ob(160, 6)], at(200));
  const old = verifyOutcome(valve, claim, [ob(120, 6), ob(160, 6)], new Date(T0 + 5 * 3600000));
  const lk = verifyOutcome(lock, { ...claim, id: 'l1', device_id: 'lock_front', state: 'locked' }, [], at(300));
  const a = nightCheck([live, lk], at(200)); assert.equal(a.current.length, 1); assert.equal(a.not_verified.length, 1); assert.match(a.spoken, /Right now:/); assert.match(a.spoken, /could not confirm front door lock/);
  const b = nightCheck([old], new Date(T0 + 5 * 3600000)); assert.equal(b.current.length, 0); assert.equal(b.earlier.length, 1); assert.match(b.spoken, /Earlier,/);
});
