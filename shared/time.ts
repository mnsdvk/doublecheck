// Shared by server and host. The demo household is in India (UTC+05:30); storage is always UTC.
export const CIRCLE_TZ_OFFSET_MIN = 330;
export function localParts(d: Date, offsetMin = CIRCLE_TZ_OFFSET_MIN) {
  const l = new Date(d.getTime() + offsetMin * 60000);
  return { y: l.getUTCFullYear(), mo: l.getUTCMonth() + 1, d: l.getUTCDate(), h: l.getUTCHours(), mi: l.getUTCMinutes(), dow: l.getUTCDay() };
}
export function fromLocal(y: number, mo: number, d: number, h: number, mi = 0, offsetMin = CIRCLE_TZ_OFFSET_MIN): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - offsetMin * 60000);
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function fmtTime(d: Date) { const p = localParts(d); const h12 = p.h % 12 === 0 ? 12 : p.h % 12; return `${h12}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'am' : 'pm'}`; }
export function fmtDay(d: Date) { return DAYS[localParts(d).dow]; }
export function sameLocalDay(a: Date, b: Date) { const x = localParts(a), y = localParts(b); return x.y === y.y && x.mo === y.mo && x.d === y.d; }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d: Date) { const p = localParts(d); return `${p.d} ${MONTHS[p.mo - 1]}`; }
export function fmtMonth(d: Date) { return MONTHS[localParts(d).mo - 1]; }
