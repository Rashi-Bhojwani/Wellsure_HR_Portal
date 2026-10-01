# Phases 2 and 3: attendance, built completely before the device

**Status: direction RECORDED 2026-10-01 (user).** Not started. Phases 1.5
and the rest of Phase 5 (D2, E1–E3, F, G) come first, in order. When Phase
2 is reached, the detailed schema, endpoints, screens and commit split are
written here and shown for approval before anything is built, as usual.
Spec: [`PROJECT_SPEC.md`](../PROJECT_SPEC.md) §4 (rewritten for this), §7.3,
§8, §12.

## The decision

1. **Phases 2 and 3 are built completely, now, without the physical
   machine.** That covers:
   - ingestion, the rules engine, shifts, week-offs and rosters;
   - exceptions, regularization, muster, manual entry, period
     finalisation;
   - every screen and report.

   All of it is fully tested and production-ready. **The only thing left
   for later is plugging in the actual device.**
2. **A punch simulator is a first-class development tool** (spec §4.6),
   not a throwaway script. It's how all of the above is built and verified.
3. **No month-end file export as the daily process.** greytHR's current
   export-and-upload stays *only* as an emergency fallback. The daily path
   is automatic.
4. **Three ingestion routes, all built, converging on one ingestion
   service and one deduplication**, so the engine cannot tell them apart:
   - **Sync agent (primary):** `biometric-agent/`, LAN port 4370, 30 s
     polling, HTTPS plus API key, local cursor, backoff, catch-up,
     heartbeat, **Windows service**.
   - **Device push (ADMS):** `/iclock/*`, for models that support it.
   - **Manual file upload:** emergency only, through the Import Center
     with staging and validation.
5. **Device health monitoring is built now** (spec §4.7): last seen per
   device and per agent, alerts when nothing arrives during working hours
   plus a morning check, and an admin Devices screen. If a machine stops
   sending, HR finds out that morning.
6. **The device connection is the final step, not the first.**

## Architecture, as recorded (detail to be designed at Phase 2)

```
 sync agent ─┐  POST /api/biometric/agent/punches  (API key, batches)
 (primary)   │
 ADMS push ──┼─▶  IngestionService ─▶ raw_punches ─▶ mapping ─▶ attendance.recompute
 /iclock/*   │    (validate, device tz,   (unique key =      (unmapped →    (BullMQ, debounced
 file upload ┘     dedupe, batch record)   exact-dup drop)    HR queue)      per employee-date)
 (emergency)                                                                    │
                                                         rules engine (§4.4) ◀──┘
                                                         ─▶ daily_attendance ─▶ Socket.IO (§8)
```

- **One service, three thin adapters.** Each route only translates its
  wire format into the same `IngestPunch[]` call, so there is one place
  for validation, dedupe, mapping and enqueueing, and one set of tests.
- `raw_punches.source` records the route for audit only. **Nothing
  downstream reads it.**
- **Dedupe, two layers:**
  - exact duplicates are dropped at ingestion (unique key), which makes
    agent catch-up, retries, ADMS re-sends and overlapping emergency files
    idempotent;
  - near-duplicates seconds apart are kept raw and collapsed by the engine
    (2-minute window, configurable).
- **Every agent post, ADMS upload and file import gets an ingestion batch
  record** with counts (new / duplicate / unmapped / rejected). This feeds
  the volume charts and makes a silent failure visible.
- **Timezone and clock:**
  - device-local timestamps are interpreted in the device's configured
    timezone (default Asia/Kolkata);
  - out-of-order and late punches are processed by `punched_at`;
  - implausible timestamps (device clock wrong) are flagged for HR.
- **ATTLOG layout: CONFIRMED** from a real export from our device (spec
  §4.1). It has six tab-separated columns: device user ID, timestamp,
  status, verify mode, workcode, reserved.
  - Status is always `1`, with **no direction**: the first punch is IN and
    the last is OUT, inferred by the engine.
  - Device user IDs are low integers (2–126), so mapping goes **only**
    through `device_user_mappings`.
  - The real sample, including user 113's duplicate punch three seconds
    apart, is a mandatory test fixture.
  - The parser stays tolerant: extra columns and whitespace are fine, and
    bad lines are rejected individually.

## The punch simulator (spec §4.6)

To be designed in detail at Phase 2. Recorded requirements and the
proposed shape:

**Requirements:**
- Generates realistic punch streams **in exactly the confirmed ATTLOG
  format** (status 1, verify 255, workcode 1, reserved 0, low-integer device
  user IDs, no direction), for real
  employees, from their actual shifts, week-offs, holidays and leave, so
  every run has an *expected* outcome the engine's output is checked
  against.
- **Hard cases**, as named, reusable scenarios:
  - normal days, late arrivals, early exits, break OUT/IN pairs;
  - missing punches (single punch / no OUT), and duplicates seconds apart;
  - people who never punch at all (the manual branches);
  - work on holidays and week-offs, night shifts across midnight;
  - unmapped device IDs, out-of-order and catch-up delivery;
  - a wrong device clock;
  - a device or agent going silent (to trigger the §4.7 alerts).
- **Replay mode:** a whole month for 500 employees, as a load test of
  ingestion and recompute that reports throughput and end-to-end time. The
  pass threshold is set when Phase 2 is planned, and re-run on staging
  sizing.
- **Live drip mode:** single punches in real time (an optional rate, or one
  named employee), to watch Who Is In?, the calendar and the Devices screen
  update live.
- **Same ingestion path as the real device:**
  - as an ADMS device, it POSTs ATTLOG bodies to `/iclock/cdata`;
  - as the agent, it runs **the real `biometric-agent`** with a *simulated
    device driver* behind the same driver interface as the 4370 driver;
  - as an emergency file, it writes an upload file for the Import Center.

  It never writes to the database directly.
- **Deterministic** (seeded) for tests and CI.
- **Never production:** it refuses a production target, and simulated
  devices (flagged on the device record, which the engine never reads)
  can't be registered there.

**Proposed shape:**
- It lives in `biometric-agent/` (it shares the device-protocol code and
  the simulated driver).
- It's run as `npm run simulate --prefix biometric-agent -- <scenario>
  --route agent|push|file [--replay month | --drip]`.
- Its roster (who exists, device IDs, shifts) comes from a dev/staging-only
  API endpoint, which is disabled in production.

## The sync agent (primary route)

- One process per office PC, configured with the API URL, API key and one
  or more device IPs (port 4370).
- Each cycle, every 30 s (configurable), per device:
  1. read new punches since the local cursor;
  2. POST them in batches;
  3. advance the cursor **only after the API acknowledges**;
  4. send a heartbeat (agent version, host, per-device reachability, cursor
     lag).
- Offline handling:
  - the API down means exponential backoff, and the backlog is sent in
    order on recovery (catch-up after downtime);
  - a device down is reported in the heartbeat, and the agent keeps
    serving the other devices.
- **Windows service:**
  - install/uninstall scripts, start on boot, restart on failure, log
    rotation;
  - the mechanism (`node-windows` or NSSM) is chosen at build time;
  - a step-by-step install guide for whoever sets up the office PC.
- **The driver interface is the seam:** the 4370 driver (real device) and
  the simulated driver (simulator) are interchangeable. Everything else in
  the agent ships tested.

## Device and agent health monitoring (spec §4.7)

- Last heartbeat and last punch per device, and last heartbeat, version,
  host and reachability per agent.
- **Alerts** (in-app plus email to HR/admin roles, once per incident, with
  a recovery notice):
  - a device silent for N minutes in working hours (default 30);
  - an agent heartbeat missed for N minutes;
  - a **morning check** at a configured time: a device that normally has
    punches has none today.

  Working hours, working days and company holidays are respected.
  Everything is configurable in System Settings.
- **Devices screen:**
  - status at a glance (online / silent / offline);
  - unmapped punches with "map to employee";
  - ingestion volume per device and per route (hourly/daily);
  - incident history.
- Phase 5.5's CloudWatch alarm stays, as an independent infrastructure
  safety net.

## Phase 3: built completely, also against the simulator

Every item is production-ready before the device is connected:
- Employee Swipes;
- Attendance Muster;
- Process Attendance (with progress);
- Exceptions (bulk resolve);
- Manual Override, including manual entry for people who never punch;
- Shift Override;
- Regularization (request, approval queue, bulk);
- Period Finalisation (lock/unlock);
- stats cards and insights;
- every report and export.

## Final step: connecting the real device

The last commit of Phase 3. It's done only when the machine is available:
1. Answer the open questions: model, ADMS support, static IP, the office
   PC, device count.
2. Register the device and agent, and install the agent as a Windows
   service on the office PC.
3. Check the first live punches against the confirmed ATTLOG layout
   (spec §4.1); any firmware differences go into parser configuration and a
   new fixture.
4. Turn on ADMS only if the model supports it *and* the office has a
   static IP (spec §15.4); otherwise use the agent only.
5. Run a short parallel check: the same days in greytHR and here, compared
   employee by employee.

Nothing downstream of the ingestion service changes in this step. If
something does, that's a bug in how the simulator modelled the device,
and it gets fixed in the simulator too.

## Open questions carried (spec §14; do not guess)

- The device brand/model and whether ADMS push is supported.
- The device's LAN IP address and admin password (the password is
  supplied at install, never stored in the repo).
- Whether an always-on office PC exists for the agent.
- Employee Code vs Device User ID default in Add Employee (spec §14): our
  device IDs (2–126) differ from the 1000-series codes.
- Whether the office has a static public IP (decides whether ADMS is
  exposed).
- The office PC for the agent (Windows version, always on), and the
  number of devices.
- Working hours and days for the silence alert (configurable defaults
  until HR confirms).
