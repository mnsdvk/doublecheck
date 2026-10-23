# Doublecheck — "Alexa said done. Did it work?"

Doublecheck is an MCP server that checks what a device or agent **reported** against **independent evidence** and answers one of three things: **Worked**, **Problem found**, or **Not verified**. It always shows its evidence and states its limits. It is a prototype for the Alexa+ track of the Amazon Developer Hackathon.

> Everything in this repo runs on synthetic data and a simulated Alexa+ screen. Nothing here was tested against a real Alexa+ device, a real home, or real sensors.

## Three checks, one engine

| Scene | Check | What it does |
|---|---|---|
| Water valve | Contradiction | Valve reports closed; an independent flow meter still reads ~6 L/min after a 90 s settling window → **Problem found**. Approving a (simulated) re-send of the close command is followed by a re-check → **Worked**. |
| Bathroom geyser | Gradual change | Every cycle ends fine, but heating time now takes about 1.7 times as long as comparable earlier cycles, built up over the last five weeks, after months of steady cycles. Compared only with earlier cycles of the same temperature rise, against a per-setting baseline. → **Unusual change; cause not established.** |
| Floor cleaner | Abnormal execution | Run "completes" but with 5 pauses (usual 0) and 63.8 min (usual 48.7), using only the device's own run log → **Completed with an anomaly.** |

Doublecheck is not limited to these three devices. A device is described by its expected outcome, the independent evidence that can confirm it, and its history, and it then uses one of the three checks above. The demo also runs the same checks on the bedroom AC (power draw after "off") and the living-room lights (light level after "off"). A device with no independent evidence, like the front-door lock, stays Not verified instead of guessing. The three scenes are the ones fully built out and benchmarked.

A **night check** ("Was everything actually done tonight?") aggregates these and keeps timing straight: right now / from the last run / over recent weeks (not tonight) / could not confirm / confirmed. You can open the report for any of the last 30 days. A front-door lock with no independent sensor stays **Not verified**, not "failed".

## What is real and what is simulated

Real: the verification engine (`server/engine.ts`, pure, deterministic, no model calls), the MCP server (hand-written Streamable HTTP, 11 tools, `structuredContent`, approval via `elicitation/create`), the append-only local store, the benchmark and the automated tests, and the host UI talking to the server over real MCP.

Simulated: all devices, sensors and readings (labelled synthetic everywhere), the Alexa+ experience (a typed-request host with a rule-based router, not Alexa+), and the "close command" fix (no hardware is touched).

Not done: no official MCP Inspector run is claimed; no Alexa+ integration; no real-world accuracy figure.

## Kiro Crew contribution (AWS Builder Mini Challenge)

I used Kiro Crew, an AWS development tool, as part of my development workflow. It read through the Doublecheck codebase (the engine, the MCP tool layer and the test suite) and identified a meaningful reliability improvement in the core verification logic: repeat-problem awareness.

Before this change, only the tool layer knew whether a device had been found faulty before. The pure verification engine, and any caller that bypassed MCP, had no way to see it. Kiro moved that signal into the engine's own contract, which made the verification logic more complete and easier to test.

What Kiro delivered:

* An engine change in `server/engine.ts`: `verifyOutcome` now takes a `priorProblems` count, so a Problem found result says when the same device had earlier problems in the last 30 days.
* A refactor of the tool layer in `server/tools.ts`: the old after-the-fact sentence is replaced by a store lookup that passes the count into the engine, so the engine stays pure, deterministic and model-free.
* New automated tests in `test/engine.test.ts`, covering no prior problems, one, several, and the rule that a Worked result never carries the repeat line.
* Its own verification of the work: it ran the full test suite (41 of 41 passing at that time), the build, and the type-check, which reported 3 errors that were already in the project before its change.

Kiro Crew completed this in 3 minutes 19 seconds using about 5.33 credits. Doublecheck does not call any AWS service at run time, so the AWS contribution is Kiro Crew as a development tool that directly improved the reliability of the core verification engine.

## Run it (Windows PowerShell, Node 22.18+)

```powershell
npm install
npm test
npm run seed        # optional: writes the demo history
npm run dev         # builds the UI and starts http://localhost:8787
npm run benchmark   # regenerates BENCHMARK.md
npm run typecheck
```

Open http://localhost:8787. The home screen opens on "3 things need a look". Open the water valve to see the contradiction and approve the simulated fix, then the geyser and the floor cleaner. Use the date picker to see any of the last 30 days. The small circular arrow resets the demo data.

Cost: ₹0. No API keys, no cloud, no paid services; local file storage only.

## Benchmark (synthetic, not held out — see BENCHMARK.md)

* Valve: 0.0% false reassurance on the main set; **15.5% with one flow sensor stuck at zero** (indistinguishable from a closed valve; 0% with two sensors, which gives Not verified).
* Geyser: 100% detection of gradual/step change, 0% false alarms on stable, seasonal and set-point-change cases, median lead time 34 days before 2× normal.
* Cleaner: 100% detection, 0% false alarm on normal/mild runs.

These describe how the rules behave on generated scenarios I wrote, not real appliances.

## Honest limits

Doublecheck does not guarantee safety, does not diagnose failed components, and does not claim others cannot do this. A longer heating time is a warning sign, not proof of a fault.

## Layout

`server/` engine, devices, store, MCP · `host/` simulated Alexa+ UI · `shared/` · `scripts/` build, seed, benchmark, screenshots · `test/`