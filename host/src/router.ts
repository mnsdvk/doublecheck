// A rule-based stand-in for Alexa+'s language understanding. The real Alexa+ host does this with a model;
// here a few patterns map typed requests to the scenes, and anything else gets an honest "not sure".
export type Intent = 'valve' | 'trend' | 'run' | 'night' | 'unknown';
export function route(u: string): Intent {
  const s = u.toLowerCase();
  if (/everything|actually done|anything (go|went) wrong|all done|done tonight|night check|double ?check (the )?(home|house)/.test(s)) return 'night';
  if (/geyser|water heater|heater|heating|slower|slow to heat/.test(s)) return 'trend';
  if (/clean|mop|vacuum|robot/.test(s)) return 'run';
  if (/valve|leak|shut ?off|close.*water|water.*close/.test(s)) return 'valve';
  if (/unusual|anything (odd|strange|wrong|off)|what happened|today|report|summary|how.*(home|house)/.test(s)) return 'night';
  return 'unknown';
}
export const EXAMPLES: { text: string; kind: string; sub: string }[] = [
  { text: 'The kitchen leak sensor is wet. Close the main water valve.', kind: 'Contradiction', sub: 'Alexa+ says done. Does the meter agree?' },
  { text: 'Is the bathroom geyser getting slower?', kind: 'Gradual change', sub: 'Every cycle ends fine. Is the pattern drifting?' },
  { text: 'How did the floor cleaner do today?', kind: 'Hidden problem', sub: 'It finished. Did it finish normally?' },
  { text: 'Was everything actually done tonight?', kind: 'Whole home', sub: 'What worked, what did not, what I could not confirm' },
];
