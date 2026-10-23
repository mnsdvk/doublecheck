// The Doublecheck ring: open = unfinished, closed = done. One component for voice state, loops and the logo.
export type RingState = 'idle' | 'listening' | 'processing' | 'asking' | 'done' | 'open';
export function Ring({ state, size = 64, tone = 'forest' }: { state: RingState; size?: number; tone?: 'forest' | 'amber' | 'ink' }) {
  const r = 20, c = 2 * Math.PI * r;
  return (
    <svg className={`ring ring-${state} tone-${tone}`} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={`Voice state: ${state}`}>
      <circle className="ring-track" cx="24" cy="24" r={r} fill="none" />
      <circle className="ring-arc" cx="24" cy="24" r={r} fill="none" strokeLinecap="round" strokeDasharray={`${c}`} />
    </svg>
  );
}
