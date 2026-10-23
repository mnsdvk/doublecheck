import type { ToolContext, ToolDef, ToolResult } from './mcp.ts';
import type { Store } from './store.ts';
import type { Clock } from './clock.ts';
import { DEVICES, deviceById } from './devices.ts';
import { nightCheck, pointsFromRuns, compactRuns, reviewRun, trendFinding, verifyOutcome } from './engine.ts';
import type { Finding } from './model.ts';

const ok = (text: string, structured: unknown): ToolResult => ({ content: [{ type: 'text', text }], structuredContent: structured });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text: `Nothing was recorded. ${text}` }], isError: true });
const isIso = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const str = { type: 'string' } as const;

export function buildTools(store: Store, clock: Clock): ToolDef[] {
  const nowIso = () => clock.now().toISOString();
  const deviceArg = (id: string) => deviceById(id);

  function evaluate(deviceId: string, opts: { claimId?: string; runId?: string } = {}): Finding | { error: string } {
    const dev = deviceArg(deviceId); if (!dev) return { error: `Unknown device "${deviceId}". Use list_devices.` };
    const now = clock.now();
    let f: Finding;
    if (dev.checks.includes('gradual_change')) {
      const runs = store.runs(dev.id); const { summaries, keep } = compactRuns(runs, now);
      f = trendFinding(dev, pointsFromRuns(keep, summaries, now), now, runs.every(r => r.synthetic));
    } else if (dev.checks.includes('execution_anomaly')) {
      f = reviewRun(dev, store.runs(dev.id), opts.runId, now);
    } else {
      const claims = store.claims(dev.id).sort((a, b) => a.at.localeCompare(b.at));
      const claim = opts.claimId ? claims.find(c => c.id === opts.claimId) : claims.at(-1);
      if (!claim) return { error: `No report from ${dev.name} has been recorded yet.` };
      // Count earlier PROBLEM_FOUND findings for this device in the last 30 days (excluding the current one).
      // The engine stays pure: we query the store here and pass the count in.
      const prior = store.verifications(dev.id).filter(v => v.finding.verdict === 'PROBLEM_FOUND' && Date.parse(v.at) > now.getTime() - 30 * 86400000);
      const distinct = new Set(prior.map(v => v.finding.id)).size;
      f = verifyOutcome(dev, claim, store.obs(dev.id), now, distinct);
    }
    // Memory across sessions: repeat-count sentence is now emitted by the engine via priorProblems.
    return f;
  }
  const remember = (f: Finding) => { store.append({ kind: 'verification', id: store.newId('vf'), at: nowIso(), device_id: f.device_id, finding: f }); };
  const spoken = (f: Finding) => `${f.label}. ${f.headline}${f.limitations[0] && f.verdict !== 'WORKED' ? ' ' + f.limitations[0] : ''}`;

  return [
    { name: 'list_devices', title: 'List devices and their evidence', description: 'Lists the devices Doublecheck can verify and what independent evidence each can offer. A device with no independent evidence can only ever be Not verified.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
      async handler() { const d = DEVICES.map(x => ({ id: x.id, name: x.name, checks: x.checks, evidence: x.evidence_note, has_independent_evidence: !/^No independent/.test(x.evidence_note) })); return ok(`${d.length} devices. ${d.filter(x => !x.has_independent_evidence).length} cannot be independently checked.`, { devices: d }); } },

    { name: 'report_claim', title: 'Record what a device or agent reports', description: 'Records that a device, routine or agent reported doing something (for example "valve closed"). This is the claim; it is not proof. Verify it with verify_outcome.', inputSchema: { type: 'object', properties: { device_id: str, command: str, state: { ...str, description: 'The state the device reports, for example closed, off, locked.' }, reported_by: str, at: { ...str, description: 'ISO time. Defaults to now.' } }, required: ['device_id', 'command', 'state'], additionalProperties: false },
      async handler(a) {
        const dev = deviceArg(a.device_id); if (!dev?.outcome) return fail(`"${a.device_id}" has no checkable claim. Use list_devices.`);
        if (a.at !== undefined && !isIso(a.at)) return fail('The time is not a valid ISO time.');
        const c = store.append({ kind: 'claim', id: store.newId('cl'), device_id: dev.id, command: a.command, state: a.state, at: a.at ?? nowIso(), reported_by: a.reported_by ?? dev.name, synthetic: true });
        return ok(`Recorded: ${dev.name} reports "${a.state}". Not yet checked.`, { recorded: true, claim: c });
      } },

    { name: 'record_observation', title: 'Record an independent reading', description: 'Records a reading from a sensor. Set independent to true only if the sensor is separate from the device whose claim it checks (for example a flow meter checking a valve).', inputSchema: { type: 'object', properties: { device_id: str, source: str, metric: { ...str, description: 'for example flow_lpm, power_w, lux' }, value: { type: 'number' }, independent: { type: 'boolean' }, at: str }, required: ['device_id', 'source', 'metric', 'value', 'independent'], additionalProperties: false },
      async handler(a) {
        if (!deviceArg(a.device_id)) return fail(`Unknown device "${a.device_id}".`);
        if (!Number.isFinite(a.value)) return fail('The value is not a finite number.');
        if (a.at !== undefined && !isIso(a.at)) return fail('The time is not a valid ISO time.');
        const o = store.append({ kind: 'obs', id: store.newId('ob'), device_id: a.device_id, source: a.source, independent: a.independent, metric: a.metric, value: a.value, at: a.at ?? nowIso(), synthetic: true });
        return ok(`Recorded ${a.metric} = ${a.value} from ${a.source}${a.independent ? ' (independent)' : ' (not independent)'}.`, { recorded: true, observation: o });
      } },

    { name: 'record_run', title: 'Record a completed run or heating cycle', description: 'Records one finished run of an appliance: a geyser heating cycle (duration, start and target temperature) or a robot cleaner run (duration, pauses, reported codes).', inputSchema: { type: 'object', properties: { device_id: str, started_at: str, duration_min: { type: 'number' }, status: { type: 'string', enum: ['completed', 'aborted'] }, start_temp_c: { type: 'number' }, target_c: { type: 'number' }, mode: str, pauses: { type: 'number' }, pause_events: { type: 'array', items: { type: 'object' } } }, required: ['device_id', 'started_at', 'duration_min'], additionalProperties: false },
      async handler(a) {
        const dev = deviceArg(a.device_id); if (!dev || !(dev.checks.includes('gradual_change') || dev.checks.includes('execution_anomaly'))) return fail(`"${a.device_id}" does not record runs.`);
        if (!isIso(a.started_at)) return fail('started_at is not a valid ISO time.'); if (!(a.duration_min >= 0) || a.duration_min > 24 * 60) return fail('duration_min must be between 0 and 1440.');
        const r = store.append({ kind: 'run', id: store.newId('run'), device_id: dev.id, started_at: a.started_at, duration_min: a.duration_min, status: a.status ?? 'completed', start_temp_c: a.start_temp_c, target_c: a.target_c, mode: a.mode, pauses: a.pauses, pause_events: a.pause_events, synthetic: true });
        return ok(`Recorded a run for ${dev.name}.`, { recorded: true, run: r });
      } },

    { name: 'verify_outcome', title: 'Check a report against independent evidence', description: 'Checks the latest report from a device (or a given claim) against independent readings. Returns Worked, Problem found or Not verified, with the evidence, the time window and the limits.', inputSchema: { type: 'object', properties: { device_id: str, claim_id: str }, required: ['device_id'], additionalProperties: false }, annotations: { readOnlyHint: false },
      async handler(a) { const f = evaluate(a.device_id, { claimId: a.claim_id }); if ('error' in f) return fail(f.error); remember(f); return ok(spoken(f), { finding: f }); } },

    { name: 'review_trend', title: 'Check for a gradual change over weeks', description: 'Compares recent heating cycles with the appliance’s own baseline from comparable cycles (similar temperature rise). Flags a sustained change even when every cycle ended normally. Never states a cause.', inputSchema: { type: 'object', properties: { device_id: str }, required: ['device_id'], additionalProperties: false },
      async handler(a) { const dev = deviceArg(a.device_id); if (!dev?.checks.includes('gradual_change')) return fail(`"${a.device_id}" has no trend check.`); const f = evaluate(a.device_id); if ('error' in f) return fail(f.error); remember(f); return ok(spoken(f), { finding: f }); } },

    { name: 'review_run', title: 'Check a finished run for hidden problems', description: 'Compares a finished run (default: the latest) with the device’s earlier comparable runs. A run can complete and still be unusual. Uses only what the device logged.', inputSchema: { type: 'object', properties: { device_id: str, run_id: str }, required: ['device_id'], additionalProperties: false },
      async handler(a) { const dev = deviceArg(a.device_id); if (!dev?.checks.includes('execution_anomaly')) return fail(`"${a.device_id}" has no run check.`); const f = evaluate(a.device_id, { runId: a.run_id }); if ('error' in f) return fail(f.error); remember(f); return ok(spoken(f), { finding: f }); } },

    { name: 'night_check', title: 'Was everything actually done?', description: 'Runs every applicable check and groups the answer by when it applies: right now, earlier today, from the last run, over recent weeks, and not verified. A past or gradual finding is never described as happening now. Optional days_ago (0 to 30) shows the report as it stood on an earlier day, using only what had been recorded by then.', inputSchema: { type: 'object', properties: { days_ago: { type: 'integer', description: 'Whole number from 0 to 30. Show the report as of this many days ago. 0 (default) is now.' } }, additionalProperties: false },
      async handler(a) {
        const raw = a?.days_ago ?? 0; if (!Number.isInteger(raw) || raw < 0 || raw > 30) return fail('days_ago must be a whole number from 0 to 30.');
        const days = raw as number;
        const fs: Finding[] = [];
        if (days === 0) {
          for (const d of DEVICES) {
            if (d.outcome && store.claims(d.id).length === 0) continue;
            if (d.checks.includes('execution_anomaly') && store.runs(d.id).length === 0) continue;
            const f = evaluate(d.id); if (!('error' in f)) { fs.push(f); remember(f); }
          }
          const n = nightCheck(fs, clock.now());
          return ok(n.spoken, { night: { current: n.current, earlier: n.earlier, run: n.run, trend: n.trend, not_verified: n.not_verified, worked: n.worked }, spoken: n.spoken, checked: fs.length, days_ago: 0 });
        }
        // An earlier day: evaluate as of that moment, with only what had been recorded by then. Nothing is remembered.
        const asOf = new Date(clock.now().getTime() - days * 86400000); const cut = asOf.toISOString();
        for (const d of DEVICES) {
          if (d.checks.includes('gradual_change')) {
            const runs = store.runs(d.id).filter(r => r.started_at <= cut); if (!runs.length) continue;
            const { summaries, keep } = compactRuns(runs, asOf);
            fs.push(trendFinding(d, pointsFromRuns(keep, summaries, asOf), asOf, runs.every(r => r.synthetic)));
          } else if (d.checks.includes('execution_anomaly')) {
            const runs = store.runs(d.id).filter(r => r.started_at <= cut); if (!runs.length) continue;
            fs.push(reviewRun(d, runs, undefined, asOf));
          } else {
            const dayStart = new Date(asOf.getTime() - 86400000).toISOString();
            const claim = store.claims(d.id).filter(c => c.at <= cut && c.at > dayStart).sort((x, y) => x.at.localeCompare(y.at)).at(-1); if (!claim) continue;
            fs.push(verifyOutcome(d, claim, store.obs(d.id).filter(o => o.at <= cut), asOf));
          }
        }
        const n = nightCheck(fs, asOf);
        return ok(n.spoken, { night: { current: n.current, earlier: n.earlier, run: n.run, trend: n.trend, not_verified: n.not_verified, worked: n.worked }, spoken: n.spoken, checked: fs.length, days_ago: days, as_of: cut });
      } },

    { name: 'get_evidence', title: 'Show the evidence behind a finding', description: 'Returns the full evidence for a finding id: the claim, every reading used, the time window and the limits.', inputSchema: { type: 'object', properties: { finding_id: str }, required: ['finding_id'], additionalProperties: false }, annotations: { readOnlyHint: true },
      async handler(a) { const f = store.finding(a.finding_id); if (!f) return fail('That finding is not in the record.'); return ok(f.headline, { finding: f }); } },

    { name: 'get_history', title: 'What did Doublecheck find before?', description: 'Past findings for a device, newest first. This is the memory that lets Doublecheck say a problem has happened before.', inputSchema: { type: 'object', properties: { device_id: str }, required: ['device_id'], additionalProperties: false }, annotations: { readOnlyHint: true },
      async handler(a) { if (!deviceArg(a.device_id)) return fail(`Unknown device "${a.device_id}".`); const h = store.verifications(a.device_id).slice().reverse().slice(0, 20).map(v => ({ at: v.at, verdict: v.finding.verdict, label: v.finding.label, headline: v.finding.headline, id: v.finding.id })); return ok(h.length ? `${h.length} earlier finding${h.length === 1 ? '' : 's'}.` : 'Nothing has been checked for this device yet.', { history: h }); } },

    { name: 'apply_fix', title: 'Apply a suggested fix (asks first)', description: 'Applies a fix suggested in a finding, only after the person approves it. The prototype’s device is simulated: approving records the action but changes no real device. A fix is an action, not a result: re-run verify_outcome afterwards and trust only that.', inputSchema: { type: 'object', properties: { device_id: str, fix_id: str }, required: ['device_id', 'fix_id'], additionalProperties: false },
      async handler(a, ctx: ToolContext) {
        const dev = deviceArg(a.device_id); const fix = dev?.fixes?.find(f => f.id === a.fix_id); if (!dev || !fix) return fail('That fix is not offered for this device.');
        const r = await ctx.elicit(`${fix.title}?\n\n${fix.description}\n\nThis is a simulated device. Doublecheck will check the result afterwards.`, { type: 'object', properties: { approve: { type: 'boolean', title: fix.title } }, required: ['approve'] });
        if (r.action !== 'accept' || r.content?.approve !== true) {
          store.append({ kind: 'fix', id: store.newId('fx'), at: nowIso(), device_id: dev.id, fix_id: fix.id, approved: false, simulated: true, note: r.action === 'accept' ? 'declined' : r.action });
          return ok(r.action === 'unsupported' ? 'This host cannot ask for approval, so nothing was done.' : 'Nothing was done.', { applied: false, reason: r.action === 'accept' ? 'declined' : r.action });
        }
        store.append({ kind: 'fix', id: store.newId('fx'), at: nowIso(), device_id: dev.id, fix_id: fix.id, approved: true, simulated: true, note: 'Approved by the person; simulated device.' });
        const claim = store.append({ kind: 'claim', id: store.newId('cl'), device_id: dev.id, command: dev.outcome!.command, state: dev.outcome!.state, at: nowIso(), reported_by: 'Doublecheck (approved fix, simulated)', synthetic: true });
        return ok(`Done on the simulated device. This is not yet a result: Doublecheck will check the ${dev.outcome!.noun} again after ${dev.outcome!.settle_s} seconds.`, { applied: true, simulated: true, claim_id: claim.id, recheck_after_s: dev.outcome!.settle_s });
      } },
  ];
}
