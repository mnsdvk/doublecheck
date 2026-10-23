// Demo data. Every record is synthetic and marked so. The demo moment is Thu 22 Oct 2026, 10:00 pm IST.
import type { Store } from './store.ts';
import { cleanerRuns, geyserRuns } from './sim.ts';

export const DEMO_NOW = '2026-10-22T16:30:00.000Z';
export function seedDemo(store: Store, endIso = DEMO_NOW) {
  const g = geyserRuns({ seed: 2026, endIso, days: 183, perDay: 1, inletMean: 26, inletAmp: 3, degrade: { kind: 'gradual', startFrac: 0.86, finalFactor: 2.4 } });
  for (const r of g.runs) store.append({ kind: 'run', ...r });
  const c = cleanerRuns({ seed: 7, endIso: new Date(Date.parse(endIso) - 8 * 3600000).toISOString(), runs: 40, odd: [{ index: 38, pauses: 3, duration: 55.5 }, { index: 39, pauses: 5, duration: 63.8 }] });
  for (const r of c) store.append({ kind: 'run', ...r });
  const at = (m: number) => new Date(Date.parse(endIso) - m * 60000).toISOString();
  // Tonight's routine, as the devices reported it, with independent readings where a sensor exists.
  store.append({ kind: 'claim', id: 'cl_lights', device_id: 'lights_living', command: 'off', state: 'off', at: at(30), reported_by: 'Alexa+ routine', synthetic: true });
  store.append({ kind: 'obs', id: 'ob_l1', device_id: 'lights_living', source: 'room_light_sensor', independent: true, metric: 'lux', value: 1.4, at: at(28), synthetic: true });
  store.append({ kind: 'obs', id: 'ob_l2', device_id: 'lights_living', source: 'room_light_sensor', independent: true, metric: 'lux', value: 1.1, at: at(20), synthetic: true });
  store.append({ kind: 'claim', id: 'cl_ac', device_id: 'ac_bedroom', command: 'off', state: 'off', at: at(20), reported_by: 'Alexa+ routine', synthetic: true });
  store.append({ kind: 'obs', id: 'ob_a1', device_id: 'ac_bedroom', source: 'smart_plug', independent: true, metric: 'power_w', value: 3.1, at: at(17), synthetic: true });
  store.append({ kind: 'obs', id: 'ob_a2', device_id: 'ac_bedroom', source: 'smart_plug', independent: true, metric: 'power_w', value: 2.8, at: at(10), synthetic: true });
  // The kitchen leak alert earlier tonight: Alexa+ closed the main valve, but the independent flow meter still reads water moving.
  store.append({ kind: 'claim', id: 'cl_valve', device_id: 'valve_main', command: 'close', state: 'closed', at: at(9), reported_by: 'Alexa+ routine', synthetic: true });
  for (const [m, flow] of [[8.6, 6.4], [8, 6.3], [7, 6.2], [6.2, 6.0], [5.6, 6.1]] as const) store.append({ kind: 'obs', id: `ob_v${m}`, device_id: 'valve_main', source: 'flow_meter', independent: true, metric: 'flow_lpm', value: flow, at: at(m), synthetic: true });
  store.append({ kind: 'claim', id: 'cl_lock', device_id: 'lock_front', command: 'lock', state: 'locked', at: at(15), reported_by: 'Front door lock', synthetic: true });
  // Earlier days. Most were quiet, but no two look alike: routines ran on some days and not others, and the readings differ a little each day.
  // Three days had a real problem: the AC kept drawing power (27 days ago), the living-room lights stayed bright (18), the valve kept leaking (12).
  let seedN = 90210; const rnd = () => { seedN = (seedN * 1664525 + 1013904223) % 4294967296; return seedN / 4294967296; };
  for (let d = 1; d <= 30; d++) {
    const b = d * 1440; const j = (x: number, w: number) => Math.round((x + (rnd() - 0.5) * w) * 100) / 100;
    if (d === 12 || rnd() < 0.6) {
      const leak = d === 12; const t = 150 + Math.round(rnd() * 90);
      store.append({ kind: 'claim', id: `cl_valve_d${d}`, device_id: 'valve_main', command: 'close', state: 'closed', at: at(b + t), reported_by: 'Alexa+ routine', synthetic: true });
      [3, 4, 5].forEach((dm, i) => store.append({ kind: 'obs', id: `ob_vd${d}_${i}`, device_id: 'valve_main', source: 'flow_meter', independent: true, metric: 'flow_lpm', value: leak ? j(4.3, 0.4) : Math.max(0, j(0.05, 0.1)), at: at(b + t - dm), synthetic: true }));
    }
    if (d === 27 || rnd() < 0.75) {
      const bad = d === 27; const t = 120 + Math.round(rnd() * 200); store.append({ kind: 'claim', id: `cl_ac_d${d}`, device_id: 'ac_bedroom', command: 'off', state: 'off', at: at(b + t), reported_by: 'Alexa+ routine', synthetic: true });
      [[t - 3, bad ? 142 : 3], [t - 10, bad ? 151 : 2.8]].forEach(([m, v], i) => store.append({ kind: 'obs', id: `ob_ad${d}_${i}`, device_id: 'ac_bedroom', source: 'smart_plug', independent: true, metric: 'power_w', value: Math.max(0, j(v, bad ? 12 : 1.2)), at: at(b + m), synthetic: true }));
    }
    if (d === 18 || rnd() < 0.8) {
      const bad = d === 18; const t = 330 + Math.round(rnd() * 90); store.append({ kind: 'claim', id: `cl_lights_d${d}`, device_id: 'lights_living', command: 'off', state: 'off', at: at(b + t), reported_by: 'Alexa+ routine', synthetic: true });
      [[t - 2, bad ? 220 : 1.2], [t - 10, bad ? 214 : 1.0]].forEach(([m, v], i) => store.append({ kind: 'obs', id: `ob_ld${d}_${i}`, device_id: 'lights_living', source: 'room_light_sensor', independent: true, metric: 'lux', value: Math.max(0, j(v, bad ? 10 : 0.6)), at: at(b + m), synthetic: true }));
    }
    if (rnd() < 0.5) store.append({ kind: 'claim', id: `cl_lock_d${d}`, device_id: 'lock_front', command: 'lock', state: 'locked', at: at(b + 45 + Math.round(rnd() * 200)), reported_by: 'Front door lock', synthetic: true });
  }
}
