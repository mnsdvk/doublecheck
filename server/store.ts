import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Claim, Finding, Obs, RunRec } from './model.ts';

export type Ev =
  | ({ kind: 'claim' } & Claim) | ({ kind: 'obs' } & Obs) | ({ kind: 'run' } & RunRec)
  | { kind: 'verification'; id: string; at: string; device_id: string; finding: Finding }
  | { kind: 'fix'; id: string; at: string; device_id: string; fix_id: string; approved: boolean; simulated: true; note: string };
export type Stored = Ev & { seq: number };

// Append-only: records are never edited or deleted by the product. (`reset` exists only for the
// demo server's --dev mode, so a recording can be repeated from a clean start.)
export class Store {
  private events: Stored[] = [];
  private path: string | null;
  constructor(path: string | null) {
    this.path = path;
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      if (existsSync(path)) for (const line of readFileSync(path, 'utf8').split('\n')) if (line.trim()) this.events.push(JSON.parse(line));
    }
  }
  newId(p: string) { return `${p}_${randomUUID().slice(0, 8)}`; }
  append(e: Ev): Stored { const s = { ...e, seq: this.events.length + 1 } as Stored; this.events.push(s); if (this.path) appendFileSync(this.path, JSON.stringify(s) + '\n'); return s; }
  get size() { return this.events.length; }
  reset() { this.events = []; if (this.path) writeFileSync(this.path, ''); }
  claims(device?: string): Claim[] { return this.events.filter((e): e is Stored & { kind: 'claim' } => e.kind === 'claim' && (!device || e.device_id === device)); }
  obs(device?: string): Obs[] { return this.events.filter((e): e is Stored & { kind: 'obs' } => e.kind === 'obs' && (!device || e.device_id === device)); }
  runs(device?: string): RunRec[] { return this.events.filter((e): e is Stored & { kind: 'run' } => e.kind === 'run' && (!device || e.device_id === device)); }
  verifications(device?: string) { return this.events.filter((e): e is Stored & { kind: 'verification' } => e.kind === 'verification' && (!device || e.device_id === device)); }
  fixes(device?: string) { return this.events.filter((e): e is Stored & { kind: 'fix' } => e.kind === 'fix' && (!device || e.device_id === device)); }
  finding(id: string): Finding | undefined { return [...this.verifications()].reverse().find(v => v.finding.id === id)?.finding; }
}
