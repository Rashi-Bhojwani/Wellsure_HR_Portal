# Phase 2: attendance, built completely before the device

**Status: PLAN, awaiting the user's review. Nothing here is built yet.**
- Written 2026-10-08, after effective dating (EF1–EF4) was finished, as
  the user asked: "attendance is entirely date-based, so I don't want it
  built on half-fixed foundations".
- Earlier decisions recorded here on 2026-10-01 and 2026-10-03 are kept,
  and marked *(recorded)*.
- Spec: [`PROJECT_SPEC.md`](../PROJECT_SPEC.md) §4, §7.3, §8, §12.
- Contract with payroll: [`PHASE_6.md`](PHASE_6.md) "Effective-dating
  contract".

**The goal (user, 2026-10-08):** attendance built so completely that
connecting the real machine at the end is a configuration step and nothing
more. No code changes, no surprises. §11 lists exactly what stays unproven
until then.

---

## 0. Where this sits, and one thing to decide first

- **Phase order.** Phase 1.5 (the AWS staging environment) has not been
  built. Phases 4 and 5 already went ahead of it by decision, and the user
  now directs Phase 2 next.
- **Two consequences:**
  1. **ADMS push needs AWS to expose it.** It uses a dedicated HTTP
     listener restricted to the office's static IP (spec §15.4). Locally
     and in CI it is fully built and tested, but it can only face a real
     device once staging exists.
  2. **"Verified on staging"** (spec §12: from Phase 1.5 on, every phase is
     verified on staging) can't apply to Phase 2 yet.
- **Recommendation:** build Phase 2 now, then do Phase 1.5 **before the
  device-connection step**. The agent route, which is the primary one,
  also posts to the deployed API, so the machine can't be connected to
  anything real until staging exists. → **Decision D1** (§12).

**Phase 2 / Phase 3 split.** This plan covers Phase 2 in full. It also
pulls into Phase 2 the parts of Phase 3 the user listed as must-haves:
- manual entry as a daily workflow;
- explicit day sources;
- the treatment of employees with no device mapping.

The rest of Phase 3 is outlined in §10 and gets its own detailed plan
before it is built. That covers the muster, the exceptions screen,
regularization, overrides, finalisation and reports.

---

## 1. The non-negotiables (user, 2026-10-08), and where each is met

| Requirement | Where |
|---|---|
| All three ingestion routes converge on **one ingestion service and one deduplication** | §3 (commit P2-B) |
| A first-class **punch simulator**: exact ATTLOG format, every hard case, a month for 500 employees, live drip, always through the real ingestion path | §6 (P2-G) |
| A **rules engine** with shifts, grace, week-off patterns, half-day and full-day thresholds, night shifts across midnight, and every status code in UI_REFERENCE | §4 (P2-C) |
| **Every day carries its source**: DEVICE, MANUAL, LEAVE, HOLIDAY, WEEK_OFF. Manual days are visibly different everywhere | §4.4, §8 |
| **No device mapping → never auto-absent, never an exception.** Manual entry is their source of truth | §4.3 |
| **Manual entry as a fast daily workflow** for the two branches without a machine, not a buried override | §5 (P2-D) |
| **Device health**: heartbeats, alerts for silence during working hours, an admin Devices screen | §7 (P2-H) |
| **Everything admin-configurable**: shifts, grace, thresholds, week-off patterns, penalty rules | §2, §4.6 |
| **What stays unproven until the device is connected**, stated exactly | §11 |

---

## 2. Data model

All new history-like data follows the effective-dating model (a row
covers its start up to, but not including, its end; it is appended at
the end through one writer; the database forbids overlaps). Payroll and
attendance read it only through readers (`PHASE_6.md`). Raw punches are
immutable.

### 2.1 Configuration (admin-configurable, company-wide)

Company-wide by HR's confirmation (2026-09-28): shifts, week-off patterns
and rules are the same for every branch. The only branch-varying fact is
which device sits where, and whether a branch has one at all.

- **`shifts`**: code, name, start time, end time, `crosses_midnight`
  (derived: end ≤ start), and a break allowance (informational).
  - Grace in / grace out (minutes).
  - Punch window: before start (default 4 h), after end (default 6 h).
  - Active flag. Deactivated, never deleted.
  - Seed: **GEN 10:00–19:00**, the timing on the greytHR screens
    (UI_REFERENCE §1.5). Every other value is a placeholder until HR
    confirms (§12, D3).
- **`week_off_patterns`**: code, name, and rules per weekday, optionally
  per week of the month. Examples:
  - Sunday off;
  - Sunday plus the 2nd and 4th Saturday;
  - alternate Saturdays anchored to a start date.

  Seed: "Sunday off" as a placeholder (D3).
- **`attendance_policies`** (greytHR calls this an "attendance scheme";
  the spec calls it the rule set):
  - **Thresholds:** full-day minimum hours; half-day minimum hours.
  - **Half-day minimum not met:** 1 day LOP by default, configurable
    (spec §4.4).
  - **Single punch:** status A and `MISSING_PUNCH` until regularized
    (spec).
  - **Near-duplicate window:** 2 minutes.
  - **Inferred break pairing:** off (spec §4.1: the device sends no
    direction).
  - **Late and early penalty rules:** a list, **off by default**. For
    example, "N late-ins in a month = ½ day LOP", or "late beyond X
    minutes = half day".
  - **Implausible-punch thresholds:** more than 10 min in the future, or
    older than 45 days.
- **`attendance_assignments`**: effective-dated, per employee: shift,
  week-off pattern and policy. It's a history table under EF rules: the
  writer, the constraints, scheduled changes and the readers
  `assignmentOn(employeeId, day)` / `assignmentSegments`.
  - A new hire gets the company defaults (System Settings) on the day
    they're added, the same as the EF2 first-row rule.
  - A **roster** (rotating shifts) is a set of date-specific
    `shift_overrides` generated from a rotation pattern.
  - The Shift Roster screen's generator is in this phase; editing a
    single date is Phase 3's Shift Override.
- **`locations.has_biometric_device`**: whether a branch has a machine.
  It only guides the UI (Add Employee hides the device ID field for a
  no-device branch, and the Devices screen checks consistency). **It is
  never what the engine reads** (§4.3).
- **System Settings → Attendance:**
  - company default shift, week-off pattern and policy;
  - the nightly recompute time (02:00 IST);
  - live recompute debounce (1 s);
  - device-silence minutes (30), agent-heartbeat minutes (5), morning
    check time (10:30), working hours and days for alerts;
  - who is alerted (roles plus an email list).

### 2.2 Devices, agents, ingestion

- **`devices`**: serial number (unique; ADMS authenticates on it), name,
  `location_id` (exactly one branch, spec §7.3), timezone (default
  Asia/Kolkata), model and firmware (free text until known), route
  (`AGENT` | `PUSH`), `agent_id` (if polled by an agent), LAN IP (agent
  use only), `is_simulated`, active flag.
  - Last heartbeat, last punch received, health state.
  - `is_simulated` is refused on a production target, and the engine
    never reads it.
- **`biometric_agents`**: name, host, version, the API key (stored as a
  hash and shown once, like any credential), last heartbeat, reported
  reachability per device, cursor lag, active flag.
- **`ingestion_batches`**: one per agent post, ADMS upload or file import.
  - Route, device, agent or uploader, received at.
  - Counts: new, exact duplicate, unmapped, rejected, flagged.
  - Rejected lines are kept verbatim for HR.
- **`raw_punches`** *(spec §4.2)*: immutable (a database trigger blocks
  UPDATE and DELETE).
  - Device, device user ID, `punched_at` (timestamptz, from device-local
    time in the device's zone).
  - Direction `UNKNOWN` on our device.
  - Status, verify mode and workcode as received; the raw line.
  - Route (`AGENT`/`PUSH`/`IMPORT`; audit only, never read downstream);
    batch; received at.
  - Resolved `employee_id` (via `employeeForDeviceUserOn(deviceUserId,
    punch business date)`, EF4), or null = unmapped.
  - `flag` (`FUTURE`/`TOO_OLD`).
  - **Unique (device_id, device_user_id, punched_at)**: the exact-duplicate
    layer.
- **`unmapped_punches`** is a view: raw punches with a null employee.
  "Map to employee" creates or extends a `device_user_mappings` row
  through the EF writer, re-resolves those punches, and recomputes the
  affected days. It is audited.
- **`device_health_incidents`**: device or agent, kind (`DEVICE_SILENT`,
  `AGENT_SILENT`, `MORNING_NO_PUNCHES`, `CLOCK_SKEW`), opened at, resolved
  at, who was notified, and the recovery notice sent.

### 2.3 The day record

- **`daily_attendance`** *(spec §4.2, extended)*: one row per employee
  per business date.
  - Shift snapshot: id, code and times as used that day.
  - Times: `first_in`, `last_out`, total, break, actual work, work in
    shift time; late-in, early-out, shortfall and excess minutes.
  - Status: `status`, `first_half_status`, `second_half_status`,
    `lop_days`.
  - Exceptions: `exception_flags[]`.
  - **`source`** (`DEVICE` | `MANUAL` | `LEAVE` | `HOLIDAY` | `WEEK_OFF`)
    and **`worked_on_off_day`** (punched, or marked worked, on a holiday
    or week-off; comp-off eligible).
  - `punch_count`, `computed_from` (the ids of the raw punches or manual
    entry used, for "Info").
  - `is_locked` (written by Phase 3 finalisation; the engine already
    obeys it), `processed_at`, `engine_version`.
  - Unique (employee_id, date).
- **`manual_attendance_entries`** (§5): employee, date.
  - **Status:** `P`, `A`, `HD` (with which half), `WFH`-style codes are
    leave and not entered here, and `WORKED` for a holiday or week-off.
  - Optional in and out times; a remark.
  - Entered by and at. Superseded entries are kept (append-only; the
    latest wins). Audited.

### 2.4 Permissions (new keys, all Admin-only, never manager-grantable)

- `attendance.view`: others' attendance, in data scope.
- `attendance.config.manage`: shifts, patterns, policies, assignments,
  settings.
- `attendance.manual.enter`: the daily manual-entry workflow (§5, D4).
- `attendance.process`: recompute a date range.
- `attendance.devices.manage`: devices, agents, keys, mapping unmapped
  punches, simulator controls on non-production.

None of these join `MANAGER_GRANTABLE_KEYS`. The two regularization keys
come in Phase 3, exactly as recorded (manager-grantable, TEAM scope,
IDOR-tested). Every new route is classified in the route inventory;
`attendance.view` routes are `scoped`, with IDOR cases.

---

## 3. Ingestion: three routes, one service, one dedupe *(recorded, now detailed)*

```
 sync agent ─┐  POST /api/biometric/agent/punches   (agent API key)
 (primary)   │  POST /api/biometric/agent/heartbeat
 ADMS push ──┼─▶ IngestionService.ingest(batch) ─▶ raw_punches ─▶ resolve employee ─▶ enqueue
 /iclock/*   │   (parse → validate → device tz →   (unique key:    (device_user_mappings  attendance.recompute
 file upload ┘    flag clock → insert ON CONFLICT   exact dups     in force on the punch  {employeeId, date},
 Import Center    DO NOTHING → batch counts)        dropped)       date; else unmapped)   debounced)
```

**One service, three thin adapters.** Each adapter only turns its wire
format into `IngestBatch { route, deviceId, lines: AttlogLine[] }`. The
service does everything else. There is one test suite for the service,
plus a small suite per adapter.

- **Parser.** `shared/attendance/attlog.ts`, used by the backend and by
  the simulator, so they can't drift apart.
  - It reads the six confirmed tab-separated columns.
  - It tolerates extra trailing columns and surrounding whitespace.
  - A bad line is rejected individually, kept verbatim and counted, and
    never fails the batch.
  - The user-supplied sample (users 18, 44 and 113, including 113's two
    punches three seconds apart) is a **mandatory fixture**.
- **Business date of a punch.** The date of `punched_at` in the device's
  zone, for mapping only. Which attendance day a punch *counts toward* is
  the engine's job (night shifts, §4.2).
- **Clock safeguards.** Implausible timestamps are stored but flagged,
  surfaced on the Devices screen and excluded from computation until HR
  accepts or discards them. A device whose punches are consistently
  skewed opens a `CLOCK_SKEW` incident.
- **Out-of-order and late punches** (catch-up) recompute every day they
  touch, ordered by `punched_at`.
- **Agent endpoints:**
  - `POST /api/biometric/agent/punches`: batches of up to 1,000 lines per
    device. The response gives the counts and the highest accepted
    timestamp, which **the agent advances its cursor to only on success**.
  - `POST /api/biometric/agent/heartbeat`.
  - Both authenticate with `Authorization: Bearer <agent key>`, are
    rate-limited, and accept only devices assigned to that agent.
- **ADMS endpoints** (`/iclock/*`, the ZKTeco push protocol), implemented
  as documented for ZK/eSSL push firmware:
  - `GET /iclock/cdata?SN=…&options=all` → the handshake with our
    options;
  - `POST /iclock/cdata?SN=…&table=ATTLOG` → `OK: <n>`;
  - `OPERLOG` accepted and ignored;
  - `GET /iclock/getrequest?SN=…` → `OK` (no commands);
  - `POST /iclock/devicecmd`.

  Requests are authenticated by a registered serial; unknown serials are
  rejected and logged. The responses are plain text, as the device
  expects. The protocol's firmware-specific details are listed in §11 as
  unproven.
- **File upload:** a new Import Center dataset, **"Punches (ATTLOG)"**. HR
  chooses the device the file came from, because ATTLOG lines carry no
  device. The flow is upload → parse → preview (new / duplicate /
  unmapped / rejected / flagged) → commit, through the same service. It is
  audited and **labelled emergency use**: commit asks for a reason.
- **Realtime:**
  - `punch.received` → `user:{id}` (the employee's own screens) and the
    Who Is In? room;
  - `device.status` → `perm:attendance.devices.manage`.

---

## 4. The rules engine

### 4.1 Shape

- **A pure function, no I/O.** It takes everything about one employee
  and one date:
  - the assignment and the shift (after any shift override);
  - holiday, week-off and approved leave for the date (and the half);
  - the manual entry, if any;
  - whether a device mapping was in force;
  - the candidate raw punches;
  - the policy.

  It returns the day record. This makes every case table-testable.
- **A loader** gathers those inputs through the EF readers. The engine
  never queries history itself, which the EF4 guard enforces.
- **A writer** upserts `daily_attendance` **unless the day is locked**
  (`is_locked`, Phase 3 finalisation). It emits `attendance.updated` to
  the employee and their manager, and `whoisin.updated` for today.
- **`attendance.recompute`** (BullMQ) is deduplicated per
  (employee, date), with a 1 s debounce for live punches. Batch mode
  (replay, Process Attendance, nightly) loads per date in bulk.
- **Nightly 02:00 IST:** recomputes yesterday for everyone, so absences
  and exceptions are finalised for the day. A catch-up run covers any
  missed night.
- **Triggers that recompute:**
  - punches;
  - a mapping change (unmapped punches mapped);
  - manual entry;
  - leave approved or reversed (the existing **`AttendanceLeaveSink` seam
    from Phase 4** gets its real implementation; the leave module doesn't
    change);
  - a holiday added, changed or removed;
  - an assignment or shift change from its effective date onward (capped
    at the open period);
  - EF job changes don't affect attendance rules, so they don't trigger
    one.

### 4.2 Evaluation order *(spec §4.4, with this plan's additions in bold)*

For each employee and business date D:
1. **Not employed on D** (`employedOn`, joined after D or left before
   it) → no record.
2. **Holiday** → `H`, source `HOLIDAY`. Punches or a manual "worked" set
   `worked_on_off_day` (comp-off eligible: Phase 4's comp-off credit
   stays an HR action, now shown as a suggestion).
3. **Week-off** by the assigned pattern → `O`, source `WEEK_OFF`. Worked
   is handled the same way.
4. **Approved leave** → the leave code (`L:<code>`), source `LEAVE`. Half-
   day leave combines with the other half, which is computed or entered
   (e.g. `PL:P`).
5. **Manual override** (Phase 3) → as overridden. The source is that of
   the data entered, with `is_overridden` set.
6. **Manual capture: no device mapping in force on D** → the manual entry
   if there is one (source `MANUAL`), **otherwise `NM` "Not marked"**: no
   status, never `A`, never an exception, and LOP 0 (§4.3).
7. **Compute from punches** (source `DEVICE`):
   - The shift is the shift override for D, else the roster, else the
     assignment.
   - **Candidate punches** are those inside the shift window: start −4 h
     to end +6 h, both configurable. A **night shift crossing midnight
     belongs to its start date.** Where two consecutive days' windows
     overlap, a punch goes to the window whose shift start is nearer. The
     tie and edge rules are pinned by tests.
   - Near-duplicates within 2 minutes collapse to the first.
   - First punch = first in; last punch = last out; no direction is
     assumed. Break time is computed only from real directions or the
     inferred-pairing option (off).
   - **Late-in** = first in − (start + grace in). **Early-out** = (end −
     grace out) − last out. **Shortfall and excess** are against shift
     length.
   - **Full day** if actual ≥ full-day minimum, **half day** if ≥ half-day
     minimum, else absent.
   - **Half-day minimum not met** → 1 day LOP (configurable). The flag is
     `HALF_DAY_MIN_NOT_MET`.
   - **One punch only** → `A` and `MISSING_PUNCH`, until regularized
     (Phase 3).
   - **No punches** on a working day → `A`.
   - **Penalty rules** (off by default) run after the month's days, and
     only on DEVICE days.
8. **Exception flags:** `MISSING_PUNCH`, `SHORTFALL`, `LATE_IN`,
   `EARLY_OUT`, `HALF_DAY_MIN_NOT_MET`, `NO_SHIFT`, `UNMAPPED` (punches
   exist on D for a device ID with no mapping, raised on the Devices
   screen, not the day), and `CLOCK_FLAGGED`. **Never on a manual-capture
   day.**

### 4.3 Employees with no device mapping *(user, 2026-10-08)*

- **The rule is data-driven: manual capture = no device mapping in force
  on D** (`employeeForDeviceUserOn` / the mapping history, EF4).
  - It is not a branch setting the engine reads, and not a checkbox on
    the employee.
  - A branch without a machine simply has employees without mappings.
  - Someone moving to a device branch gets a mapping from that date, and
    their days switch to device capture automatically.
- **Never auto-absent, never an exception, never LOP from silence.**
  - A manual-capture day with nothing entered is `NM` "Not marked",
    neutral grey everywhere.
  - Phase 3 finalisation **refuses to lock a period while any `NM` day
    remains**, listing them. Paid days are then never guessed.
- **Add Employee:** the Device User ID becomes **optional** (it's
  required today). That's needed for the two no-device branches. →
  **Decision D2.**
- **The safety net for a mistake** (someone at a device branch without a
  mapping, so their days would silently become manual):
  - the Devices screen lists "**Employees at device branches with no
    mapping**";
  - the morning check includes that count.
- Leave, holidays and week-offs apply to them exactly as to everyone else.

### 4.4 Sources and status codes

| Source | When | Shown as |
|---|---|---|
| `DEVICE` | Computed from punches | the normal cell |
| `MANUAL` | From a manual entry (manual-capture employee) | **a hand icon and a dotted border on the cell, "Manual" in the day detail with who entered it and when, and an "M" marker in grids and exports** |
| `LEAVE` | Approved leave | the leave colour |
| `HOLIDAY` | A company holiday | light blue |
| `WEEK_OFF` | The assigned pattern | grey |

**Status codes** (UI_REFERENCE §1.5 and spec §4.4):
- `P` present, `A` absent, `HD` half day, `H` holiday, `O` week-off.
- `L:<code>` leave (`PL`, `LOP`, `COF`, `WFH`, `RH`, or whatever HR adds).
- `LOP`.
- Split days for the first and second half, in every combination greytHR
  shows: `A:P`, `P:A`, `PL:P`, `P:PL`, `HD` with the half named.
- **`NM` "Not marked"**: new, manual-capture only.

**Colours** follow UI_REFERENCE §1.5:
- present: light green;
- absent or exception: peach;
- holiday: light blue;
- week-off: grey;
- leave: by type;
- **not marked: neutral, never red.**

### 4.5 Correctness guarantees and tests

- **Table-driven unit tests for every rule.** Each case gets a test
  named after it:
  - grace edges (at the second);
  - exactly the half-day and full-day thresholds;
  - a night shift with punches on both sides of midnight;
  - overlapping windows;
  - a single punch;
  - duplicates 3 s apart (fixture 113);
  - holiday and week-off work;
  - half-day leave plus a worked half;
  - a leaver on their last working day (in force, EF1) and the day after
    (no record);
  - a joiner before and after the date of joining;
  - an assignment changed mid-month (EF segments);
  - a mapping that starts mid-month (the switch from manual to device);
  - a locked day not rewritten.
- **Golden scenarios from the simulator** (§6): each scenario carries its
  *intended* outcome per employee-day, and the engine's output must equal
  it. This is how a 500 × 30 replay is checked "correctly", not just
  "fast".
- **`engine_version`** is stored on every day. Changing a rule bumps it,
  and a recompute shows what changed.

### 4.6 Configuration screens (Workforce → Attendance → Settings)

- Shifts.
- Week-off patterns, with a 6-week preview.
- Policies, including the penalty-rule builder.
- Assignments: the per-employee history and bulk assignment by
  branch/department, effective-dated and schedulable (EF3 UI).
- The roster generator.
- System Settings → Attendance (alert timings, working hours, default
  assignment).

Every change is audited. Changing a shift or policy offers "recompute
from <date>" (capped at the open period) with a count of the affected
days. Nothing recomputes silently.

---

## 5. Manual entry: a fast daily workflow (P2-D)

The two branches without a machine. → **Decision D4: who enters it.**

- **The screen:** Workforce → Attendance → **Mark Attendance**. One branch
  and one date (today by default) opens **one row per manual-capture
  employee there**.
  - **Pre-filled**: holiday, week-off and approved leave are already
    shown and locked (source-labelled). Only working days need input.
  - **Speed:**
    - "**Mark all present**" (one click), then change the exceptions;
    - keyboard: ↑/↓ moves, P/A/H sets the status, T types times;
    - optional in and out times;
    - a remark.
  - **One save writes the batch.** Each entry is audited, and the days
    recompute and appear live on everyone's screens.
  - **The week strip** above the grid shows, per day, how many are still
    `NM`, so a missed day is obvious. A **reminder notification**
    (configurable time, default 18:00 on working days) goes to whoever
    enters for that branch if today still has `NM` rows.
  - **Edit:** any non-finalised day can be changed. The entry is
    superseded, never overwritten, so the history shows who changed what.
- **Visibly manual everywhere** (§4.4 table): the calendar, day detail,
  Who Is In?, grids and exports.
- **Not an override.** Overrides (Phase 3) correct *device* days and are
  exceptional. Manual entry is the *routine* source for manual-capture
  employees.

---

## 6. The punch simulator (P2-G) *(requirements recorded; design now)*

- **Where it lives:** `biometric-agent/` (it shares the parser and the
  device driver interface).
  - `npm run simulate --prefix biometric-agent -- <scenario> --route
    agent|push|file [--replay <month> | --drip [--rate N/min | --employee
    <code>]] [--seed N]`.
- **The roster it simulates:**
  - `GET /api/dev/simulator/roster`: employees, device IDs, assignments,
    holidays, week-offs and approved leave for a date range.
  - **Mounted only outside production**; the route doesn't exist in a
    production build.
  - The simulator **refuses to run** against a production URL, and
    `is_simulated` devices can't be registered there.
- **Format:** exactly the confirmed ATTLOG lines (status 1, verify 255,
  workcode 1, reserved 0, low-integer device IDs, tab-separated), produced
  by the same `shared/attendance/attlog.ts`.
- **Named scenarios.** Each is reusable, seeded and deterministic, and
  carries its intended outcome:

  | Scenario | What it produces |
  |---|---|
  | `normal-day` | In within grace, out after the shift end |
  | `late-arrival` | Beyond grace, several sizes |
  | `early-exit` | Before end − grace |
  | `missing-punch` | One punch only |
  | `duplicate-seconds` | Two punches 1–10 s apart (the 113 pattern) |
  | `never-punches` | Mapped employees with no punches (→ `A`). Manual-capture employees with no entry (→ `NM`, not `A`) |
  | `holiday-work`, `weekoff-work` | Punches on an off day |
  | `night-shift` | Across midnight, including window-overlap edges |
  | `unmapped` | An unknown device ID |
  | `out-of-order`, `catch-up` | A late backlog after an "outage" |
  | `wrong-clock` | A device clock off by a set amount |
  | `device-silent`, `agent-silent` | Stops sending, to trigger the §7 alerts |
  | `month-realistic` | A weighted mix of all of the above, by a seeded distribution |

- **Routes**, always the real path:
  - `agent`: runs **the real `biometric-agent`** with the **simulated
    driver** behind the same `DeviceDriver` interface as the real one;
  - `push`: plays the ADMS device against `/iclock/*` (handshake, then
    ATTLOG posts);
  - `file`: writes the ATTLOG file for the Import Center.

  It never writes to the database.
- **Replay:** a whole month for **500 employees**. It reports punches
  sent, ingestion throughput, time until every day is recomputed, and
  **a diff of engine output against the intended outcomes, which must
  be empty**. → **Decision D5: the pass threshold.**
- **Live drip:** single punches in real time, at a rate or for one named
  employee, so Who Is In?, the calendar and the Devices screen can be
  watched updating.
- **In CI:** small seeded scenarios through all three routes, plus the
  golden-outcome diff. The full 500-employee replay runs as a separate
  job, also on demand, recording its numbers in PROGRESS.

---

## 7. The sync agent (P2-F) and device health (P2-H)

### 7.1 The agent *(recorded, now detailed)*

- **Configuration:** `config.json` on the office PC.
  - API URL, agent key (or from Windows Credential Manager, D6), poll
    interval (30 s).
  - Devices: id, IP, port 4370, and the comm password (**the device admin
    password is supplied at install and never stored in the repo**, a
    standing rule).
- **The cycle, per device, every 30 s:**
  1. read the records after the cursor;
  2. post them in batches;
  3. **advance the local cursor only after the API acknowledges**;
  4. send the heartbeat (version, host, reachability per device, cursor
     lag, queue size).

  A device that's down is reported, and the others carry on. With the API
  down it backs off exponentially (capped) and keeps an **on-disk outbox**,
  so a long outage loses nothing and catches up in order.
- **`DeviceDriver` interface**, the seam:
  - `connect`, `readSince(cursor)`, `deviceTime`, `info`, `disconnect`;
  - implementations:
    - `SimulatedDriver` (the simulator);
    - `Zk4370Driver` over `node-zklib` or `zkteco-js`, chosen at build
      after evaluating both against a protocol-level fake (§11);
  - everything else in the agent is tested through `SimulatedDriver`.
- **Windows service:**
  - install/uninstall scripts, start on boot, restart on failure, log
    rotation;
  - **packaged as a single executable**, so the office PC needs no Node
    install;
  - mechanism: **NSSM (recommended)** or `node-windows` (D6);
  - **CI tests install → start → reboot-survival (restart) → uninstall on
    a GitHub Windows runner**, so the service mechanics are proven before
    any office PC is touched;
  - a step-by-step install guide for whoever sets up the PC
    (`biometric-agent/INSTALL.md`).

### 7.2 Health monitoring *(spec §4.7)*

- **Last seen:** devices (last heartbeat, last punch) and agents (last
  heartbeat, version, host, reachability).
- **Alerts:** in-app plus email, to `attendance.devices.manage` holders
  plus a configured email list. **One per incident, with a recovery
  notice.**
  - **Device silent:** no punches for N minutes (30) **during working
    hours on working days, never on holidays**.
  - **Agent silent:** heartbeat missed for N minutes (5).
  - **Morning check** (10:30, configurable): a device that normally has
    punches has none today. It also counts employees at device branches
    with no mapping, and unmapped punches yesterday.
  - **Clock skew** on a device.
- **The checks run on the scheduler** (every minute: a cheap query on
  last-seen timestamps), and work against simulated devices identically.
- **Devices screen** (Workforce → Attendance → Devices):
  - status at a glance: online / silent / offline;
  - agents and devices;
  - **unmapped punches** with "map to employee";
  - flagged-clock punches to accept or discard;
  - ingestion volume per device and per route (hourly and daily charts);
  - incident history;
  - "Employees at device branches with no mapping";
  - register a device or agent, and rotate an agent key (shown once).

---

## 8. Screens built in Phase 2 (P2-E), real-time throughout

- **Employee → Attendance Info** (UI_REFERENCE §1.5):
  - the month calendar, colour by status, with the shift code and status
    code and **the source marker**;
  - stats cards (average work hours, average actual hours, penalty days);
  - the exception banner;
  - **the day detail panel**:
    - first in and last out;
    - late, early, total, break, actual, in-shift, shortfall and excess;
    - shift block: name, timings, policy, "Processed on";
    - status details with the **source**, who entered it and when (manual
      days);
    - **the day's raw punches** (inferred first/last marked; duplicates
      shown as collapsed);
  - live: a new punch updates the calendar within seconds (§12 gate);
  - the Regularize link appears in Phase 3.
- **Admin → Attendance Info**: any employee in scope, the same view
  (`attendance.view`).
- **Who Is In?**: a live board by branch and department.
  - **Honest semantics:** our device sends no direction, so "in" means
    "**has punched today**". The board shows:
    - arrived (with time, late flag);
    - not yet arrived;
    - on leave, holiday or week-off;
    - **manual-capture employees, shown as manual** ("marked present by
      <who>", or "not marked yet"), never as absent.
  - It does **not** claim who has left the building.
- **Mark Attendance** (§5), **Devices** (§7.2), **Attendance Settings**
  (§4.6).
- **The menus** stop showing the Phase 3 placeholders for what Phase 2
  builds. Attendance Info stops being phase-marked: the mock-up was
  retired 2026-10-03.

---

## 9. The commit split (each one green, reviewable, pausing after each as usual)

| Commit | Content |
|---|---|
| **P2-A** | Configuration model: shifts, week-off patterns, policies, `attendance_assignments` (EF history, writer and readers), `has_biometric_device`, the optional Device User ID (D2), permissions, settings, seed placeholders, config screens |
| **P2-B** | Ingestion: the shared ATTLOG parser and fixture, devices and agents (keys), `raw_punches` (immutable), batches, the service, the agent endpoints, `/iclock/*`, the Import Center "Punches (ATTLOG)" dataset, the unmapped queue and map-to-employee, clock flags |
| **P2-C** | Rules engine (pure function, loader, writer), `daily_attendance`, recompute jobs (debounced, bulk), nightly 02:00 and catch-up, the real `AttendanceLeaveSink`, holiday/assignment triggers, sources, `NM`, the exhaustive table tests |
| **P2-D** | Manual entry: Mark Attendance, entries (append-only), reminders |
| **P2-E** | Screens: employee and admin Attendance Info with day detail, Who Is In?, live events, source markers everywhere |
| **P2-F** | `biometric-agent`: the driver interface, SimulatedDriver, the Zk4370Driver (protocol-tested), the outbox and cursor, backoff, heartbeat, the single-executable build, Windows service scripts and the CI Windows-runner test, `INSTALL.md` |
| **P2-G** | Punch simulator: scenarios with intended outcomes, the three routes, replay (500 × month) with a golden diff, drip, production refusal, the dev roster endpoint |
| **P2-H** | Device health: checks, incidents, alerts and recovery, the morning check, the Devices screen and charts |
| **P2-I** | Acceptance and review: the three §12 gates measured and recorded, the docs (GETTING_STARTED, DEPLOYMENT, PROGRESS) and a Phase 2 review like Phase 5's |

---

## 10. Phase 3, outlined (detailed plan to follow before building)

What's left after Phase 2:
- Employee Swipes;
- Attendance Muster (with source markers and totals: P, A, HD, LOP,
  leaves, holidays, week-offs, paid days, NM);
- Process Attendance with progress (the engine supports it from P2-C);
- the Exceptions screen with bulk resolve;
- Manual Override for device days;
- Shift Override (single dates);
- **Regularization** (request, approval queue, bulk; managers by grant,
  as recorded);
- **Period Finalisation**:
  - locks `daily_attendance` for a payroll month;
  - refuses while `NM` days remain;
  - registers the EF4 payroll-lock check and the leave module's
    `isPeriodLocked`;
  - unlock is Super Admin only, with a reason;
- stats and insights;
- every report and export;
- then **the final step: connecting the device**.

---

## 11. What stays unproven until the real device is connected

Everything downstream of the ingestion service is proven before the
device arrives, because the simulator feeds exactly the routes the
device will use, in the confirmed format. That covers the parser on the
confirmed layout, dedupe, mapping, the engine, sources, manual entry,
health alerts, every screen, the agent's sync, cursor, outbox and
backoff logic, and the Windows service mechanics (CI runner).

**What we're taking on faith, exactly:**

1. **The 4370 protocol against our actual model and firmware.** The
   driver is built on an open-source ZK library and tested against a
   protocol-level fake, but not against our machine. Unknowns:
   - whether the library speaks our firmware's variant;
   - the comm-password handshake;
   - how the device returns logs: all of them each time (so the cursor
     filters) or only new ones;
   - its log capacity and whether it overwrites when full. **If the agent
     is offline longer than the device holds, punches are lost. That's
     the one real data-loss risk, and its size is unknown until we know
     the capacity.**
   - whether reading logs affects the device.

   *Contained by:* the driver interface. A firmware difference changes
   the driver (or its configuration) only. **This is the one place a code
   change might still be needed at connection time.** It's isolated to
   one file, with a new fixture recorded from the real device.
2. **ADMS push**:
   - whether our model supports it at all;
   - the exact handshake options and table names its firmware sends;
   - plain-HTTP behaviour.

   It is implemented to the documented ZK push protocol and tested with
   the simulator, not with real firmware. It also needs Phase 1.5 (AWS)
   and the office's static IP, both open. If the model doesn't support
   it, the agent route is used alone, as already decided.
3. **Our device's real clock behaviour.** How far it drifts, and whether
   it changes for DST (India has none, but devices sometimes ship with a
   zone set). Flagging and skew detection are tested with simulated
   skew; the right thresholds come from watching the real one.
4. **Status values on other firmware.** Our sample is always `1`, and
   we never rely on it. Another model or a firmware update could send
   directions. That's harmless (stored, not trusted), but it is
   unobserved.
5. **The office environment.** That an always-on PC exists, its Windows
   version, its antivirus, and the LAN path from the PC to the device on
   port 4370. The single-executable service is proven on a clean
   Windows CI runner, not on that PC.
6. **End-to-end latency in production.** The 5-second gate (§12) is
   measured locally, through all three routes. On the real network it
   adds the office uplink (agent → AWS) and the 30 s poll interval. **A
   punch through the agent route therefore reaches the screen within
   about 30–35 s, not 5.** The 5 s target holds for ADMS push, and for
   the agent only after the poll. → **Decision D7.**
7. **Data entry, not code:**
   - the device-user-ID ↔ employee mappings for the ~125 enrolled IDs
     (2–126);
   - the list of which branches have no machine;
   - the real shift and policy values.

   These are configuration. A wrong mapping is caught by the unmapped
   queue and the "device branch, no mapping" list, not by the engine.

---

## 12. Acceptance gates (spec §12, made measurable)

- **G1 — latency:** a simulated punch through **each** route
  (agent-simulated driver, ADMS push, file commit) reaches the employee's
  calendar and Who Is In? **within 5 s of ingestion**, measured from
  agent post / ADMS POST / file commit to the socket event in a
  browser-level test. For the agent, the time from the punch to the post
  is the poll interval (§11.6).
- **G2 — a month at scale:** a 500-employee month replayed through the
  agent route is ingested and recomputed with **zero differences** from
  the intended outcomes, within the D5 threshold, and recorded in
  PROGRESS.
- **G3 — health:** a silenced simulated device raises an HR alert during
  working hours (and doesn't on a Sunday or holiday). A silenced agent
  does too. Recovery notices follow.
- **G4 — manual capture:** a manual-capture employee with nothing entered
  is `NM`, never `A`, never an exception. Marking the branch present
  updates every screen live, with the manual marker.

## 13. Decisions needed before building (recommendation first)

- **D1 — Phase 1.5 timing.** Build Phase 2 now (local + CI), and do
  Phase 1.5 (AWS staging) before the device-connection step.
  *Recommended.* The alternative is to do 1.5 first.
- **D2 — Device User ID optional in Add Employee**, for people at
  no-device branches (it's required today). *Recommended: yes.* "Manual
  capture" then follows from having no mapping, with no separate flag.
- **D3 — the real rule values.** I won't guess them. They're seeded as
  placeholders and listed in open questions until HR confirms:
  - grace minutes;
  - half-day and full-day minimum hours;
  - the week-off pattern (Sunday only? which Saturdays?);
  - whether any late penalty applies;
  - other shifts besides GEN 10:00–19:00.
- **D4 — who does manual entry for the two no-device branches**, and
  which branches they are.
  - *Recommended:* a permission `attendance.manual.enter` limited to
    chosen branches, so someone at each branch (or HR centrally) can mark
    only their branch. This adds a "branches" limit to that one
    permission; data scope today is only SELF/TEAM/ALL.
  - The alternative is HR only, centrally, with no new scoping.
- **D5 — the replay pass threshold** for 500 employees × one month
  (~24k punches, ~15k employee-days). *Proposed:* ingest ≤ 2 minutes,
  recompute complete ≤ 5 minutes on a dev machine, and re-measured on
  staging (Phase 5.5's load test sizes production).
- **D6 — the agent's Windows packaging and secrets.**
  *Recommended:* a single executable run under NSSM, with the agent key
  in Windows Credential Manager. The alternative is `node-windows` with
  the key in the config file (restricted ACL).
- **D7 — the live-latency expectation for the agent route.** With a 30 s
  poll, a punch reaches screens in about 30–35 s. *Recommended:* accept
  that (it's still live, and far from month-end). Alternatively, poll
  every 10 s; the cost is more device load, which is unproven (§11.1).

## 14. Open questions carried (spec §14; do not guess)

- The device brand and model, and whether it supports ADMS push.
- The device's LAN IP and admin password (supplied at install, never
  stored in the repo).
- Whether an always-on office PC exists for the agent (Windows version)
  and how many devices there are.
- Employee Code vs Device User ID default in Add Employee (our device IDs
  2–126 differ from the 1000-series codes).
- Whether the office has a static public IP (decides ADMS exposure).
- Working hours and days for the silence alert (defaults until HR
  confirms).
- **New:**
  - which two branches have no machine, and who marks their attendance
    (D4);
  - the real shift, grace, threshold, week-off and penalty values (D3).
