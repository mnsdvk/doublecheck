import type { CheckKind } from './model.ts';

export interface OutcomeSpec {
  command: string; state: string;            // what the device says it did
  metric: string; test: 'lt' | 'gt'; threshold: number; unit: string; // what independent evidence should show
  noun: string; claim_text: string; expect_text: string;              // wording only
  settle_s: number; min_samples: number; max_age_s: number; min_sources: number;
}
export interface FixSpec { id: string; title: string; description: string; needs_approval: true }
export interface DeviceSpec {
  id: string; name: string; kind: 'valve' | 'lock' | 'ac' | 'light' | 'geyser' | 'cleaner';
  checks: CheckKind[]; outcome?: OutcomeSpec; fixes?: FixSpec[];
  evidence_note: string;                     // what evidence this device can offer, shown in list_devices
  trend_metric?: string;
}

export const DEVICES: DeviceSpec[] = [
  { id: 'valve_main', name: 'Main water valve', kind: 'valve', checks: ['contradiction'],
    outcome: { command: 'close', state: 'closed', metric: 'flow_lpm', test: 'lt', threshold: 0.3, unit: 'L/min', noun: 'water flow', claim_text: 'closed', expect_text: 'below 0.3 L/min', settle_s: 90, min_samples: 2, max_age_s: 900, min_sources: 1 },
    fixes: [{ id: 'resend_close', title: 'Send the close command again', description: 'Sends one more close command to the valve. It does not change any setting.', needs_approval: true }],
    evidence_note: 'Independent: pipe flow meter (readings in litres per minute).' },
  { id: 'lock_front', name: 'Front door lock', kind: 'lock', checks: ['contradiction'],
    outcome: { command: 'lock', state: 'locked', metric: 'door_contact', test: 'lt', threshold: 0.5, unit: '', noun: 'door position', claim_text: 'locked', expect_text: 'a second sensor confirming it', settle_s: 20, min_samples: 1, max_age_s: 900, min_sources: 1 },
    evidence_note: 'No independent sensor. Only the lock’s own report is available.' },
  { id: 'ac_bedroom', name: 'Bedroom AC', kind: 'ac', checks: ['contradiction'],
    outcome: { command: 'off', state: 'off', metric: 'power_w', test: 'lt', threshold: 15, unit: 'W', noun: 'power draw', claim_text: 'off', expect_text: 'below 15 W', settle_s: 60, min_samples: 2, max_age_s: 1800, min_sources: 1 },
    evidence_note: 'Independent: smart-plug energy reading (watts).' },
  { id: 'lights_living', name: 'Living-room lights', kind: 'light', checks: ['contradiction'],
    outcome: { command: 'off', state: 'off', metric: 'lux', test: 'lt', threshold: 5, unit: 'lux', noun: 'room brightness', claim_text: 'off', expect_text: 'below 5 lux', settle_s: 15, min_samples: 2, max_age_s: 1800, min_sources: 1 },
    evidence_note: 'Independent: room light sensor (lux).' },
  { id: 'geyser_bath', name: 'Bathroom geyser', kind: 'geyser', checks: ['gradual_change'], trend_metric: 'heating_draw_min',
    evidence_note: 'Independent: smart-plug power reading gives heating-draw time; tank probe gives starting temperature.' },
  { id: 'cleaner_floor', name: 'Floor cleaner', kind: 'cleaner', checks: ['execution_anomaly'],
    evidence_note: 'Device run log: duration, pauses, reported codes. No sound or cause is inferred.' },
];
export const deviceById = (id: string) => DEVICES.find(d => d.id === id);
