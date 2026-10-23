// Injectable clock. All times are stored as UTC ISO strings.
// DOUBLECHECK_NOW (ISO) starts the clock at a scripted moment and lets it advance in real time,
// so demo recordings and tests are reproducible.
export interface Clock { now(): Date; }

export function systemClock(): Clock {
  const start = process.env.DOUBLECHECK_NOW ? Date.parse(process.env.DOUBLECHECK_NOW) : NaN;
  if (Number.isNaN(start)) return { now: () => new Date() };
  const offset = start - Date.now();
  return { now: () => new Date(Date.now() + offset) };
}

export function fixedClock(iso: string): Clock & { set(iso: string): void } {
  let t = Date.parse(iso);
  return { now: () => new Date(t), set: (v: string) => { t = Date.parse(v); } };
}

export { CIRCLE_TZ_OFFSET_MIN, localParts, fromLocal } from '../shared/time.ts';
