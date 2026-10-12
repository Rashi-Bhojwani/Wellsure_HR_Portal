# Phase 2 — acceptance: the four gates, what proves each, and what is still unproven

Spec §12 and `docs/plans/PHASE_2.md` §12 set four acceptance gates for Phase 2. This file says,
for each one, **which automated test proves it, where it runs, what was measured, and how to re-run
it**, so "Phase 2 is done" is a statement anyone can check rather than a claim.

A note on names: the build-step labels used in commits and PROGRESS ("G1", "G2a", "G2b" under
P2-G, then "H", "I") are *build steps* of the simulator work. The gates below are the *acceptance
gates* of PHASE_2.md §12, also called G1–G4. They are different lists; this file always says "gate".

Everything below runs on a machine with no biometric device. What a device could still change is the
last section, stated exactly, and it is the same list as PHASE_2.md §11.

## Gate 1 — latency: a punch reaches the screen within 5 seconds

**The claim.** A punch through each route (the sync agent with the simulated driver, ADMS push, and
a file commit) shows on the employee's own calendar and on Who Is In? within 5 s of the server
receiving it.

| | |
|---|---|
| **How it is measured** | A real browser (Playwright, `playwright-core`) is signed in as the employee and as HR. A `MutationObserver` in the page records when the **rendered screen changes**, not when a socket event fired. The clock starts when the server receives the punch (agent and push) or just before the commit (file). |
| **Proof it can fail** | Checked once by hand when it was built (recorded in PROGRESS, P2-G G2b): with the server's attendance socket events disabled the test fails, because nothing changes on screen within the gate. The pass/fail rules themselves are unit-tested (`latencyStats.test.ts`). |
| **Test** | `npm run test:latency --prefix biometric-agent` (`biometric-agent/src/simulator/latency/run.ts`, statistics in `stats.ts` with its own unit tests). |
| **Where it runs** | CI job `latency`, on every push. |
| **Gate** | 5 s, per sample. |
| **Regression guard** | `biometric-agent/perf/latency-baseline.json`, recorded from the CI runner: a route's slowest sample fails if it is both more than twice its baseline and over 2 s. |
| **Recorded figures** (CI run 38053097275, commit b2b7629) | Employee's own screen: agent 109 ms, push 203 ms, file 149 ms. Who Is In?: agent 1219 ms, push 1457 ms, file 1552 ms. |

**What it does not cover, said plainly.** The real network adds the office uplink to AWS, and the
agent route adds its poll interval (about 30 s, decision D7). So a punch from the real device
reaches the screen in roughly 30–35 s, not 5. The 5 s holds for ADMS push, and for the agent only
after it has read the device. The user accepted this (D7): the difference that matters is the same
day versus month end.

## Gate 2 — a month at scale: zero differences, inside the time budget

**The claim.** A 500-employee month, ingested and recomputed, gives **zero differences** from the
outcomes each scenario declared in advance, in an ingest and a recompute that stay inside 2 and 5
minutes (and inside 2× the committed baseline).

| | |
|---|---|
| **What decides "correct"** | An independent reference model (`shared/attendance/simulator/`), kept separate from the engine, and the scenario catalogue in [`PHASE_2_SCENARIOS.md`](PHASE_2_SCENARIOS.md) (generated from the code; a test fails if the file is stale). Every scenario declares its outcome before the engine runs. |
| **Tests** | `backend/src/modules/attendance/__tests__/simulator/golden.test.ts` (small, in the ordinary suite, with teeth: a deliberately wrong engine must produce differences), `month500.replay.test.ts` (500 employees, through the real ingestion service), `routes.replay.test.ts` (40 employees through each real route: the agent route with the simulated driver, ADMS push, and file upload, then diffed exactly as above). |
| **Where it runs** | The golden test in the ordinary backend suite; the 500-employee and route replays in CI job `attendance-replay` (`npm run test:replay --prefix backend`). |
| **Regression guard** | `backend/perf/baseline.json`, recorded from the CI runner; the replay fails if any figure exceeds 2× the baseline. |
| **Recorded figures** (CI run 38045839418, commit 0ce0e11) | 500 employees, August 2026, 21,559 punches sent: **ingest 8.7 s** (limit 120 s), **recompute 23.0 s** (limit 300 s), **0 differences**. |

**A decision recorded rather than hidden.** The 500-employee month goes through the real ingestion
service that the agent route calls, not over HTTP: an HTTP replay of 500 would add transport time
only and would need a 500-employee world in a dev database, which the simulator is deliberately not
allowed to create. The route replays at 40 employees cover the transport. The server stamps arrival
with its own clock, so only on-time deliveries can be replayed over HTTP; late and stale deliveries
stay covered by the 500-employee replay.

**The honest limit of a golden test.** The reference model and the engine were both written from the
same reading of the rules in the spec. If that reading is wrong, both are wrong in the same way and
the test passes. What the test does prove is that the engine does what the written rules say, on
every scenario, at scale, and stays doing it. Whether the rules are what HR wants is a separate
question: it is what `PHASE_2_SCENARIOS.md` is for, and the placeholder values still waiting on HR
(grace minutes, half- and full-day minimums, other shifts) are listed in PROGRESS "Open questions".

## Gate 3 — health: a silenced device or agent raises an alert, and recovers

**The claim.** A silenced simulated device raises an HR alert during working hours, and not on a
Sunday or a company holiday. A silenced agent does too. Each recovers with one notice that says what
was missed.

| | |
|---|---|
| **Test** | `backend/src/modules/biometric/__tests__/health.test.ts` (27 cases) and `healthMessages.test.ts`. The clock is an argument to the minute check, so each case places `now` exactly where it wants it. |
| **What the cases pin down** | Opens after 30 minutes without contact during working hours, once (an agent: late for 5 minutes during working hours plus a configurable margin, closing only when it is heard from again), never a second incident for the same fault (also enforced by the database: one open incident per subject and kind). Nothing on a Sunday, a holiday, after the shift or at night. Recovery says how long, how many punches arrived afterwards and who is still without one. A silent agent opens one incident of its own and its devices do not each raise another; its recovery counts the catch-up across its devices. Reachable-but-no-punches is caught by the morning check. A fresh notification if still open at the next working day's start, once, and never for an incident that closed before then. Recipients: holders of `attendance.devices.manage`, every Super Admin (switchable), and the free email list. A device never heard from is shown "not connected yet", not alarmed. Volume is bucketed in IST. |
| **Also checked live** | A walkthrough with the real agent and a simulated device, two browsers, as HR and as a second admin: silence opened an incident and notified within the minute, recovery closed it and the notice carried the gap and punch counts. The simulator's `fault` command (see GETTING_STARTED) reproduces it. |
| **Where it runs** | The ordinary backend suite (CI job `install-lint-typecheck-test`). |

## Gate 4 — manual capture

**The claim.** Manual-capture people (SPN, Wellsure 2) are handled by the same engine and the
same screens, with the differences that matter.

| Statement | Proven by |
|---|---|
| Nothing entered is `NM`: never absent, never an exception, no loss of pay | `attendance/__tests__/engine.test.ts` ("nothing entered → NM"), `compute.test.ts` ("working days are NM") |
| A timed entry of 10:45 is late by the same minutes a punched 10:45 gives | `manual.test.ts` ("a TIMED entry is computed exactly like device punches at the same times") |
| A status-only `P` shows as status-only | `manual.test.ts` ("status-only entries …") |
| The SPN / Wellsure 2 manager is refused on any other branch, and learns nothing about who exists there | `manual.test.ts` ("the marker sees only the manual-capture people of their branch …", "marking someone outside the marker's branches is a 404 for the whole batch …") |
| Every change shows live, with the manual marker | `manual.test.ts` ("a manual entry reaches the right screens live, and the day reads MANUAL (G4)"): `attendance.updated`, naming the date, reaches the employee, their manager, the branch marker and everyone holding `attendance.view`; the day reads source `MANUAL`. The test fails if the marker's emit is removed. |

**Where it runs.** The ordinary backend suite.

## What stays unproven until the real device is connected

The full list, with what contains each risk, is PHASE_2.md §11. In one paragraph: the 4370 protocol
against our actual model and firmware (and above all whether reading the log ever disturbs a punch),
whether the model does ADMS push at all, the device's real clock drift and log capacity, the office
PC (antivirus, a real reboot, the LAN path to port 4370, HTTPS out), and real-network latency
(about 30–35 s on the agent route, accepted). All of it is isolated to one driver file, the device's
settings, or data entry (device user ID mappings, the open rule values), and none is known to need a
change. `docs/plans/PHASE_2.md` "Connection day: what to watch" says what to watch on the day.

## How to re-run everything

```
npm run lint && npm run typecheck
npm run test                                  # backend, frontend and agent suites (gates 3 and 4, golden test of gate 2)
npm run test:replay --prefix backend          # gate 2: 500 employees and the three real routes
npm run test:latency --prefix biometric-agent # gate 1: needs the API, worker and frontend running (see perf/README.md)
```

CI runs all of these on every push, plus the Windows service proof (`agent-windows`) and the backend
image build.
