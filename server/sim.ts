// Synthetic data generators. Everything here is simulated and labelled `synthetic: true`.
// Seeded, so the demo and the benchmark are exactly repeatable.
import type { RunRec } from './model.ts';

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { let u = 0, v = 0; while (u === 0) u = next(); while (v === 0) v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return { next, gauss, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T,>(l: T[]) => l[Math.floor(next() * l.length)] };
}

export interface GeyserOpts {
  seed: number; endIso: string; days: number; perDay?: number;
  inletMean?: number; inletAmp?: number; inletNoise?: number;
  coefficient?: number; fixedLoss?: number; usageNoise?: number;       // minutes per degree, standing loss, multiplicative noise
  degrade?: { kind: 'none' | 'gradual' | 'step'; startFrac: number; finalFactor: number };
  targetC?: number; targetChange?: { atFrac: number; to: number };
  missingStartTemp?: number; sparse?: number;                          // fraction of start temperatures missing / of runs skipped
  deviceId?: string;
}
export function geyserRuns(o: GeyserOpts): { runs: RunRec[]; factorAt: (frac: number) => number; failureDay: (factor: number) => number | null } {
  const r = rng(o.seed); const end = Date.parse(o.endIso); const dayMs = 86400000; const per = o.perDay ?? 1;
  const c = o.coefficient ?? 0.33, f = o.fixedLoss ?? 1.5, un = o.usageNoise ?? 0.06;
  const deg = o.degrade ?? { kind: 'none', startFrac: 0.2, finalFactor: 1 };
  const factorAt = (frac: number) => {
    if (deg.kind === 'none' || frac < deg.startFrac) return 1; const p = (frac - deg.startFrac) / (1 - deg.startFrac);
    return deg.kind === 'step' ? deg.finalFactor : 1 + (deg.finalFactor - 1) * p * p;
  };
  const runs: RunRec[] = []; let n = 0;
  for (let d = o.days - 1; d >= 0; d--) {
    const dayStart = end - d * dayMs; const frac = (o.days - 1 - d) / Math.max(1, o.days - 1);
    const doy = Math.floor((dayStart / dayMs) % 365.25) % 365;
    const season = (o.inletMean ?? 26) + (o.inletAmp ?? 3) * Math.cos(2 * Math.PI * ((new Date(dayStart).getUTCMonth() * 30.4 + new Date(dayStart).getUTCDate()) - 140) / 365);
    void doy;
    for (let k = 0; k < per; k++) {
      if (o.sparse && r.next() < o.sparse) continue;
      const inlet = season + r.gauss() * (o.inletNoise ?? 1.2);
      const warm = r.next() < 0.25 ? r.next() * 8 + 2 : 0;                  // tank not fully cold from an earlier use
      const start = inlet + warm; const target = o.targetChange && frac >= o.targetChange.atFrac ? o.targetChange.to : (o.targetC ?? 55);
      const dT = Math.max(6, target - start);
      const dur = Math.max(1, (c * dT + f) * factorAt(frac) * (1 + r.gauss() * un));
      const t = dayStart - (k ? 12 * 3600000 : 0) - 14 * 3600000 + 0; // ~ early morning IST-ish
      n++;
      runs.push({ id: `g${o.seed}_${n}`, device_id: o.deviceId ?? 'geyser_bath', started_at: new Date(t).toISOString(), duration_min: Math.round(dur * 10) / 10, status: 'completed',
        start_temp_c: o.missingStartTemp && r.next() < o.missingStartTemp ? undefined : Math.round(start * 10) / 10, target_c: target, synthetic: true });
    }
  }
  runs.sort((a, b) => a.started_at.localeCompare(b.started_at));
  // day on which the true degradation factor first reaches `factor` (null if never)
  const failureDay = (factor: number) => { for (let i = 0; i < o.days; i++) if (factorAt(i / Math.max(1, o.days - 1)) >= factor) return i; return null; };
  return { runs, factorAt, failureDay };
}

export interface CleanerOpts { seed: number; endIso: string; runs: number; deviceId?: string; mode?: string; odd?: { index: number; pauses: number; duration: number }[]; baseDuration?: number; pauseMean?: number }
export function cleanerRuns(o: CleanerOpts): RunRec[] {
  const r = rng(o.seed); const end = Date.parse(o.endIso); const out: RunRec[] = [];
  for (let i = 0; i < o.runs; i++) {
    const idx = o.runs - 1 - i; const started = end - idx * 86400000;
    const odd = o.odd?.find(x => x.index === i);
    const pauses = odd ? odd.pauses : (r.next() < (o.pauseMean ?? 0.35) ? 1 : 0) + (r.next() < 0.08 ? 1 : 0);
    const dur = odd ? odd.duration : Math.max(10, (o.baseDuration ?? 48) + r.gauss() * 2.5);
    const events = Array.from({ length: pauses }, (_, k) => ({ at: new Date(started + (8 + k * 9) * 60000).toISOString(), seconds: odd ? r.int(40, 110) : r.int(8, 25), code: odd ? (k % 2 ? 'E12' : 'E07') : undefined }));
    out.push({ id: `c${o.seed}_${i + 1}`, device_id: o.deviceId ?? 'cleaner_floor', started_at: new Date(started).toISOString(), duration_min: Math.round(dur * 10) / 10, status: 'completed', mode: o.mode ?? 'floor', pauses, pause_events: events, synthetic: true });
  }
  return out;
}
