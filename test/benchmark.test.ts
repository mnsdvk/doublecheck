import test from 'node:test';
import assert from 'node:assert/strict';
import { valveBenchmark, trendBenchmark, cleanerBenchmark } from '../server/bench.ts';

// These assertions describe the generated scenario sets in server/bench.ts. They are claims about
// those sets, not about real homes, and the README says so.
test('valve contradictions: zero false reassurance over the main set; the one sensor-blind class is reported, not hidden', () => {
  const one = valveBenchmark(200, 1, 5);
  assert.equal(one.main.falseReassurance, 0, 'no broken valve is ever called Worked when sensors report or are silent');
  assert.ok(one.byClass.stuck_open.problem === one.byClass.stuck_open.n && one.byClass.partial_leak.problem === one.byClass.partial_leak.n);
  assert.ok(one.byClass.dead_sensor.worked === 0 && one.byClass.one_reading.worked === 0 && one.byClass.late_only.worked === 0);
  assert.ok(one.main.falseAlarm < 0.02, `false alarms ${one.main.falseAlarm}`);
  assert.ok(one.withStuckZero.falseReassurance > 0, 'a single sensor stuck at zero cannot be caught: documented limit');
  assert.equal(one.byClass.stuck_zero_sensor.worked, one.byClass.stuck_zero_sensor.n);
  assert.ok(one.all.every(s => s.verdict !== 'WORKED' || s.usedReadings >= 2), 'Worked always rests on at least two independent readings');
  const two = valveBenchmark(200, 2, 5);
  assert.equal(two.withStuckZero.falseReassurance, 0, 'with two independent sources the stuck sensor is caught as a disagreement');
  assert.equal(two.byClass.stuck_zero_sensor.notVerified, two.byClass.stuck_zero_sensor.n);
});
test('gradual change: finds the decline early, no false alarms on season, setpoint or noise, never says fine when it cannot tell', () => {
  const b = trendBenchmark(24, 3);
  assert.ok(b.detectionRate >= 0.95, `detection ${b.detectionRate}`);
  assert.equal(b.falseAlarmScenarioRate, 0); assert.equal(b.falseAlarmCheckRate, 0);
  assert.equal(b.falseReassurance, 0, 'no declining appliance is ever left as Worked in this set');
  for (const k of ['stable', 'strong_seasonal', 'setpoint_change']) assert.equal(b.byClass[k].problem, 0, k);
  assert.equal(b.byClass.missing_temps_decline.notVerified, b.byClass.missing_temps_decline.n); assert.equal(b.byClass.short_history.notVerified, b.byClass.short_history.n);
  assert.ok(b.medianLeadDays !== null && b.medianLeadDays > 14, `lead ${b.medianLeadDays}`); assert.ok(b.compactionAgreement >= 0.98, `compaction ${b.compactionAgreement}`);
});
test('execution anomalies: finds unusual finished runs, leaves normal variation alone, abstains on new devices', () => {
  const c = cleanerBenchmark(150, 4);
  assert.ok(c.detection >= 0.98 && c.falseAlarm <= 0.01 && c.falseReassurance <= 0.02 && c.newDeviceNotVerified === 1, JSON.stringify({ ...c, all: undefined }));
});
test('the benchmark is repeatable: same seed, same numbers', () => {
  const a = valveBenchmark(40, 1, 9), b = valveBenchmark(40, 1, 9);
  assert.deepEqual({ ...a, all: undefined }, { ...b, all: undefined });
});
