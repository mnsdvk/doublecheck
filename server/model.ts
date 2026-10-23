// Shared types. Every record carries `synthetic`: in this prototype all data is simulated, and the
// flag travels with the data so the interface and the tests can never mistake it for live readings.
export type Verdict = 'WORKED' | 'PROBLEM_FOUND' | 'NOT_VERIFIED';
export type Scope = 'current' | 'earlier' | 'run' | 'trend';
export type CheckKind = 'contradiction' | 'gradual_change' | 'execution_anomaly' | 'no_independent_evidence';

export interface Claim { id: string; device_id: string; command: string; state: string; at: string; reported_by: string; synthetic: boolean }
export interface Obs { id: string; device_id: string; source: string; independent: boolean; metric: string; value: number; at: string; synthetic: boolean }
export interface RunRec {
  id: string; device_id: string; started_at: string; duration_min: number; status: 'completed' | 'aborted'; synthetic: boolean;
  start_temp_c?: number; target_c?: number;            // heaters: temperature rise is what heating time depends on
  mode?: string; pauses?: number; pause_events?: { at: string; seconds: number; code?: string }[]; // robots
}
export interface DaySummary { date: string; device_id: string; n: number; median_duration_min: number; min_duration_min: number; max_duration_min: number; median_start_temp_c?: number; median_target_c?: number; synthetic: boolean }

export interface EvidenceItem { label: string; at?: string; value?: string; source?: string; independent?: boolean; role: 'claim' | 'observation' | 'baseline' | 'recent' | 'run' | 'note'; synthetic: boolean }
// v is what was measured. r is a second number per point: for a trend, the expected value for that cycle's temperature rise; for a run, its duration in minutes.
export interface Series { unit: string; points: { t: string; v: number; r?: number; flag?: boolean }[]; baseline?: { from: string; to: string; level: number; band: number }; base?: { t: string; v: number }[]; threshold?: number; kind: 'line' | 'bars' }
export interface Finding {
  id: string; device_id: string; device_name: string; check: CheckKind; scope: Scope; verdict: Verdict;
  label: string;                 // the words shown: Worked / Problem found / Not verified / Unusual change / Completed with an anomaly
  headline: string; short: string; facts?: Record<string, string | number>; explanation: string[]; limitations: string[]; evidence: EvidenceItem[];
  as_of: string; fresh: boolean; series?: Series; suggested_fix?: { id: string; title: string; description: string };
  synthetic: boolean;
}
