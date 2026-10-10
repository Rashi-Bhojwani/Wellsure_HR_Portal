# Phase 2: attendance, built completely before the device

**Status: APPROVED 2026-10-08 with the user's answers to D1–D7 (§13),
HR's answers on rules and branches, the attendance cycle, and three
additions (§3.1, §7.1, §4.7). Building P2-A → P2-I in order, pausing
after each.** Progress: **P2-A through P2-E done** (P2-E approved 2026-10-09
with its eleven rules; see "As built" at the end). P2-F next.
- Written 2026-10-08, after effective dating (EF1–EF4) was finished, as
  the user asked: "attendance is entirely date-based, so I don't want it
  built on half-fixed foundations".
- Earlier decisions recorded here on 2026-10-01 and 2026-10-03 are kept,
  and marked *(recorded)*.
- Spec: [`PROJECT_SPEC.md`](../PROJECT_SPEC.md) §4, §7.3, §8, §12.
- Contract with payroll: [`PHASE_6.md`](PHASE_6.md) "Effective-dating
  contract".

Note: the user's screenshot of greytHR's Attendance Muster didn't come
through in the session. §5.1 follows the user's written description of
it.

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
- **Decided (D1, user 2026-10-08):** build Phase 2 now, then do Phase 1.5
  **before the device-connection step**. The agent route, which is the
  primary one, also posts to the deployed API, so the machine can't be
  connected to anything real until staging exists.

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
  (derived: end ≤ start).
  - Grace in / grace out (minutes).
  - Punch window: before start (default 4 h), after end (default 6 h).
  - Active flag. Deactivated, never deleted.
  - **`shift_sessions`** (HR, 2026-10-08: "make the session structure
    configurable rather than hardcoded, since it affects how break time is
    computed"). These are ordered parts of the shift: work sessions and the
    scheduled breaks between them.
    - **Seed GEN (confirmed by HR):** in 10:00, out 19:00, in two parts:
      - Session 1, 10:00–14:00 (the first half);
      - Lunch, 14:00–14:45 (a scheduled break);
      - Session 2, 14:45–19:00 (the second half).
    - **Halves come from the sessions.** The first work session is the
      first half and the last is the second half. Split statuses (`A:P`,
      `P:A`, `PL:P`) are decided per session.
    - **Break time comes from the sessions.** Our device sends no
      direction (spec §4.1), so a lunch break can't be read off the
      punches. When a person's IN–OUT span covers a scheduled break, the
      scheduled break is deducted: actual work = span − scheduled breaks
      covered. Inferred pairing from extra punches stays an option, off
      by default.
    - Shift length, in-shift time, shortfall and excess are measured
      against the work sessions, not the raw span.
  - **Still to come from HR (open, placeholders):**
    - grace minutes (placeholder 0);
    - whether any shift other than GEN exists.
- **`week_off_patterns`**: code, name, and rules per weekday, optionally
  per week of the month (for future patterns such as alternate
  Saturdays).
  - **Seed (confirmed by HR):** "Sunday off". Monday to Saturday are
    working days, the same for everyone.
- **`attendance_policies`** (greytHR calls this an "attendance scheme";
  the spec calls it the rule set):
  - **Thresholds:** full-day minimum hours; half-day minimum hours. Both
    are **still to come from HR** (open, placeholders).
  - **Half-day minimum not met:** 1 day LOP by default, configurable
    (spec §4.4).
  - **Single punch:** status A and `MISSING_PUNCH` until regularized
    (spec).
  - **Near-duplicate window:** 2 minutes.
  - **Inferred break pairing:** off.
  - **Late and early penalty rules:** the builder exists, but **HR
    confirmed none apply.** Lateness and early exits are recorded and
    visible (flags, minutes, counts), with no money and no half-day
    penalty. The seeded policy has no penalty rules.
  - **Implausible-punch thresholds:** more than 10 min in the future, or
    older than 45 days.
- **`attendance_cycles` configuration** (user, 2026-10-08):
  - The attendance period isn't assumed to be the calendar month. It is
    admin-configurable as a cycle start day: day 1 = the calendar month;
    day 26 = the 26th to the 25th.
  - **Confirmed by the user: calendar month** (start day 1). That's the
    seeded value.
  - `cycleFor(date)` gives the cycle containing any date. The muster's
    "Select Attendance Cycle", period finalisation (Phase 3) and payroll
    (Phase 6) all use it.
  - Changing the start day is allowed only from a future cycle boundary.
    Past cycles keep the boundaries they had, so a finalised period never
    shifts.
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
  - **HR (2026-10-08): SPN and Wellsure 2 have none.** They're set on
    those branches by configuration; the seed's branch list is
    placeholder data.
  - It only guides the UI (Add Employee's default, and the Devices
    screen's consistency check). **It is never what the engine reads**
    (§4.3).
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
- **`manual_attendance_entries`** (§5): employee, date, and **one of two
  kinds**, always shown differently:
  - **`TIMED`** (the normal case, HR 2026-10-08): the employee's actual
    **IN and OUT times** as the muster records them. They go **through the
    same rules engine as device punches**, so 10:45 is late exactly as a
    punched 10:45 would be, and work hours, the scheduled-break deduction,
    shortfall and half-day/full-day thresholds are computed identically.
    An IN with no OUT behaves like a single punch (`MISSING_PUNCH`).
  - **`STATUS_ONLY`**: for a day whose times genuinely aren't known, `P`,
    `A`, `HD` (which half) or `WORKED` (a holiday or week-off). It's
    labelled "status only, no times" everywhere, and has no late,
    shortfall or work-hours figures. Leave is never entered here; it comes
    from approved leave.
  - **Common to both:** a remark, entered by and at, and how it arrived
    (`SCREEN` or `MUSTER_UPLOAD` with the batch).
  - **Append-only:** a correction supersedes and the latest wins. History
    is kept and audited.

### 2.4 Permissions (new keys; all Admin-only except `attendance.manual.enter`, which is manager-grantable but branch-limited)

- `attendance.view`: others' attendance, in data scope.
- `attendance.config.manage`: shifts, patterns, policies, assignments,
  settings.
- `attendance.manual.enter`: the manual-entry workflow (§5), **scoped to
  chosen branches** (D4, user 2026-10-08). A holder can mark only the
  branches they're assigned to in **`attendance_manual_branches`** (user ↔
  location, set by Admin, audited). The manager who marks SPN and
  Wellsure 2 gets exactly those two, and is refused anywhere else (404,
  IDOR-tested). It adds this one branch limit beside the
  SELF/TEAM/ALL scope.
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

### 3.1 Re-processing from raw punches *(user addition, 2026-10-08)*

"A wrong rule value discovered later is a recompute rather than a
data-entry exercise." So:
- **Raw punches and manual entries are the only inputs.** Every
  `daily_attendance` row is fully derivable from raw punches, manual
  entries, approved leave, holidays, assignments and the rule values.
  Nothing is typed into a day record directly.
- **Process Attendance for a date range** is built in Phase 2 (P2-C):
  - backend, job and a simple admin screen (`attendance.process`);
  - re-runs the engine for any range and any employees, **at any time
    before the period is locked**;
  - a background job with progress, audited (who, range, why);
  - the result shows how many days changed and which, e.g. after
    correcting the half-day hours.
- **Changing a rule value** (shift, sessions, grace, thresholds,
  week-off, assignment) offers that recompute from its effective date,
  with the count of affected days. A locked (finalised) period is never
  recomputed, and the screen says so.
- **Late re-mapping** works the same way: mapping an unmapped device ID
  re-resolves its stored raw punches and recomputes those days.

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
6. **Manual capture: no device mapping in force on D:**
   - a **`TIMED`** entry → its IN and OUT times are treated as the day's
     punches and **go through step 7 exactly like device punches** (late,
     hours, sessions, thresholds, flags), with source `MANUAL`;
   - a **`STATUS_ONLY`** entry → its status, source `MANUAL`, no time
     figures;
   - **nothing entered → `NM` "Not marked"**: no status, never `A`, never
     an exception, and LOP 0 (§4.3).
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
     assumed.
   - **Break time = the scheduled breaks of the shift's sessions (GEN:
     14:00–14:45) that the IN–OUT span covers**, deducted from actual
     work. Real directions or the inferred-pairing option (off) can
     refine it.
   - **Halves:** session 1 is the first half and session 2 the second.
     Each half is present, absent or on leave on its own, which gives
     `A:P`, `P:A`, `PL:P` and so on.
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
   - **Penalty rules:** none apply (HR 2026-10-08). Lateness is recorded
     and counted, with no LOP. The builder stays for the future, empty.
8. **Exception flags:** `MISSING_PUNCH`, `SHORTFALL`, `LATE_IN`,
   `EARLY_OUT`, `HALF_DAY_MIN_NOT_MET`, `NO_SHIFT`, `UNMAPPED` (punches
   exist on D for a device ID with no mapping, raised on the Devices
   screen, not the day), and `CLOCK_FLAGGED`.
   - A `TIMED` manual day gets the same time-based flags as a device day
     (a 10:45 manual arrival is `LATE_IN`).
   - **A day with nothing entered (`NM`) and a `STATUS_ONLY` day never
     get exceptions.**

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
- **Add Employee** (D2, user 2026-10-08): the Device User ID becomes
  optional, **as a deliberate choice, not a blank field.**
  - The wizard asks "**Attendance capture**" with two options: *Biometric
    device* (enter Device User ID) or *No device: attendance is marked
    manually*. It defaults from the branch's `has_biometric_device`.
  - Choosing manual shows "This person's attendance will be marked
    manually by whoever marks their branch." The profile shows "Manual
    attendance" as a badge.
  - The Excel import gets the same column, `attendanceCapture`
    (`DEVICE`/`MANUAL`). A blank device ID with `DEVICE` is an error.
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
| `MANUAL` | From a manual entry (manual-capture employee) | **a hand icon and a dotted border on the cell, "Manual" in the day detail with who entered it and when, and an "M" marker in grids and exports.** A `STATUS_ONLY` entry also says "**status only, no times**" |
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
- **`OFF`**: how the muster shows a week-off (greytHR shows Sunday as
  OFF). It's the same status as `O`, given the muster's label.

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

## 5. Manual entry and the editable muster (P2-D)

**How HR works today (2026-10-08).** SPN and Wellsure 2 have no machine.
**One manager marks attendance for both**, entering each employee's
actual IN and OUT times into a muster, which is then uploaded. So manual
entry is **time-based** first, with status-only as the clearly-labelled
exception.

### 5.1 The editable muster (built like greytHR's)

As the user described greytHR's Attendance Muster:
- **A grid of employees × days for a cycle.**
  - "**Select Attendance Cycle**" sits beside the month (§2.1; calendar
    month by confirmation).
  - Filters by branch and department, or **a single employee**.
  - Columns per day; Sunday shows **OFF**.
  - Right-hand totals: **P = paid days for the cycle**, then A, HD, LOP,
    leaves, H, OFF and NM.
  - **A legend at the bottom.**
  - **Export to Excel**: the same grid, with source markers.
- **Directly editable: click a day cell and type.**
  - A status letter (`P`, `A`, `HD`; the legend lists what's allowed)
    makes a `STATUS_ONLY` entry.
  - **Or times**: `10:05-19:10`, or the cell's IN/OUT popover, makes a
    `TIMED` entry. A timed cell shows the computed status, with the times
    in a tooltip and a "late 35m" mark where it applies.
  - Tab/Enter moves to the next cell, and one save writes the batch.
- **What's editable depends on who and which day:**
  - **Manual-capture employees, in branches the user is assigned to**
    (`attendance.manual.enter`, branch-scoped): editable. Each edit is a
    manual entry, recomputed through the engine, audited, and live on
    every screen.
  - **Holidays, approved leave and week-offs are pre-filled and locked**
    (source-labelled). Working on an off day is entered as `WORKED` or
    with times.
  - **Device days are read-only in Phase 2.** Correcting a device day is
    a Manual Override, a Phase 3 action that uses this same grid.
  - **Finalised (locked) cycles are read-only** (Phase 3).
- **The whole muster (all employees, read-only)** is visible to
  `attendance.view` holders. The SPN/Wellsure 2 manager sees and edits
  only their two branches.

### 5.2 Muster upload (how the times arrive today)

- **Import Center → "Manual attendance muster"**: download a template for
  a branch and cycle (employees × days, IN/OUT columns per day, legend
  letters allowed instead), fill it in, and upload.
- The flow is parse → **preview** (per cell: timed / status-only / blank
  / invalid; clashes with leave or holidays shown) → commit.
- Each cell becomes a manual entry (`via MUSTER_UPLOAD`, with the batch)
  through the same engine. Only the uploader's assigned branches are
  accepted; other rows are rejected and listed.
- Re-uploading a corrected file supersedes entries; it never duplicates
  them.

### 5.3 Daily speed and safety nets

- **"Mark all present 10:00–19:00"** for a day, then change the
  exceptions. It writes `TIMED` entries at the shift times, labelled as
  bulk-filled.
- **The week strip** above the grid shows, per day, how many are still
  `NM`.
- **A reminder** (configurable, default 18:00 on working days) goes to
  the person assigned to a branch while today still has `NM` rows.
- **Not an override.** Overrides (Phase 3) correct device days and are
  exceptional. Manual entry is the routine source for manual-capture
  employees.

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
  be empty**. The timings are checked against the committed baseline (D5, §12 G2).
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
- **Device log retention guard** *(user addition, 2026-10-08)*. This is
  the one real data-loss risk: a device keeps only so many punches. If
  nothing syncs for longer than it holds, the oldest are overwritten.
  - **`retentionDays`** and **`retentionRecords`** are configured per
    device in the app (Devices screen) and sent to the agent. **The
    default is pessimistic: 3 days / 20,000 records** until the model is
    known.
  - Each cycle the agent compares the **time since the last successful
    sync** (and, where the device reports it, its log count against
    capacity) with retention:
    - **50%: warning.** Heartbeat state `RETENTION_WARNING`, shown on
      the Devices screen.
    - **75%: alarm.** A `RETENTION_RISK` incident, with in-app plus email
      to everyone on the device alert list, and an urgent banner for
      admins: "*Device X hasn't synced for N days; punches older than ~M
      days may be overwritten soon.*"
  - **The agent alarms locally too.** It writes to the Windows event log
    and its own log, because the reason it can't sync may be that the
    API is unreachable. The server side **raises the same alarm from
    silence alone**: last successful batch against retention, so an agent
    that has died entirely still triggers it.
- **Clock drift** *(user addition)*:
  - each cycle the agent reads the device's clock (`deviceTime`) and
    reports the offset from server time in the heartbeat;
  - ADMS devices are checked from their handshake time and punch arrival;
  - beyond a threshold (**default 2 minutes**, configurable) the Devices
    screen shows a **warning banner** for that device, and a
    `CLOCK_DRIFT` incident notifies the alert list ("a drifting clock
    silently corrupts attendance for everyone");
  - drift is charted over time;
  - it is never auto-corrected. Setting the device clock is a deliberate
    admin action, documented in `INSTALL.md`.
- **`DeviceDriver` interface**, the seam:
  - `connect`, `readSince(cursor)`, `deviceTime`, `info`, `disconnect`;
  - implementations:
    - `SimulatedDriver` (the simulator);
    - `Zk4370Driver`. **Decided 2026-10-09 (D-F1): our own read-only
      implementation of the protocol, not `node-zklib` or `zkteco-js`.**
      Neither library supports the comm key, and `zkteco-js` derives punch
      times from the PC's timezone (see "P2-F build design" at the end);
  - everything else in the agent is tested through `SimulatedDriver`.
- **Windows service:**
  - install/uninstall scripts, start on boot, restart on failure, log
    rotation;
  - **packaged as a single executable**, so the office PC needs no Node
    install;
  - mechanism: **NSSM** (D6, decided), with the agent key in **Windows
    Credential Manager** and never in the config file;
  - **CI tests install → start → reboot-survival (restart) → uninstall on
    a GitHub Windows runner**, so the service mechanics are proven before
    any office PC is touched;
  - `biometric-agent/INSTALL.md`: **install, upgrade and uninstall**,
    step by step, for someone who isn't the user (D6). It includes
    storing the key in Credential Manager, checking the service and logs,
    rotating the key, and what the retention and drift alarms mean.

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
  - **Clock drift** beyond the threshold (§7.1).
  - **Retention risk**: the gap since the last successful sync is
    approaching the device's retention (§7.1), raised by the agent *and*
    by the server.
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
    - **manual-capture employees, shown as manual** (their entered IN
      time with the manual marker, "marked present (status only)", or
      "not marked yet"), never as absent.
  - It does **not** claim who has left the building.
- **The Attendance Muster** (§5.1): the editable grid with the cycle
  selector, totals, legend, single-employee filter and Excel export.
  **Devices** (§7.2), with the retention and clock-drift warnings.
  **Process Attendance** (§3.1). **Attendance Settings** (§4.6),
  including the cycle and the manual-entry branch assignments.
- **The menus** stop showing the Phase 3 placeholders for what Phase 2
  builds. Attendance Info stops being phase-marked: the mock-up was
  retired 2026-10-03.

---

## 9. The commit split (each one green, reviewable, pausing after each as usual)

| Commit | Content |
|---|---|
| **P2-A** | Configuration model: shifts **with sessions**, week-off patterns, policies (no penalty rules), **attendance cycle**, `attendance_assignments` (EF history, writer and readers), `has_biometric_device`, the **deliberate "Attendance capture" choice** with the optional Device User ID (D2), permissions including the **branch-scoped** `attendance.manual.enter`, settings, seed (GEN 10:00–19:00 with lunch, Sunday off, calendar month; placeholders for grace and thresholds), config screens |
| **P2-B** | Ingestion: the shared ATTLOG parser and fixture, devices and agents (keys), `raw_punches` (immutable), batches, the service, the agent endpoints, `/iclock/*`, the Import Center "Punches (ATTLOG)" dataset, the unmapped queue and map-to-employee, clock flags |
| **P2-C** | Rules engine (pure function, loader, writer): sessions and the scheduled-break deduction, halves, `daily_attendance`, recompute jobs (debounced, bulk), nightly 02:00 and catch-up, **Process Attendance (re-process a range from raw data before lock)**, the real `AttendanceLeaveSink`, holiday/assignment triggers, sources, `NM`, the exhaustive table tests |
| **P2-D** | Manual entry: `TIMED` and `STATUS_ONLY` entries (append-only) through the engine; **the editable muster** (cycle selector, totals, legend, single-employee filter, Excel export); **muster upload** via the Import Center; bulk "mark all present"; reminders; branch scope enforced and IDOR-tested |
| **P2-E** | Screens: employee and admin Attendance Info with day detail, Who Is In?, live events, source markers everywhere |
| **P2-F** | `biometric-agent`: the driver interface, SimulatedDriver, the Zk4370Driver (protocol-tested), the outbox and cursor, backoff, heartbeat with **clock offset and retention state**, the **retention guard**, the single-executable build, NSSM service scripts with **Credential Manager** for the key, the CI Windows-runner test, `INSTALL.md` (install, upgrade, uninstall). **Split (D-F5) into F1** (the agent, our read-only driver, the server side, verified end to end locally) **and F2** (Windows packaging, the service, Credential Manager, the Windows CI job, `INSTALL.md`); see "P2-F build design" |
| **P2-G** | Punch simulator: scenarios with intended outcomes (including manual-capture branches and `TIMED` entries), the three routes, replay (500 × month) with a golden diff, drip, production refusal, the dev roster endpoint |
| **P2-H** | Device health: checks, incidents (silence, agent silence, morning check, **clock drift, retention risk**), alerts and recovery, the Devices screen and charts |
| **P2-I** | Acceptance and review: the four §12 gates measured and recorded, **the performance baseline committed as a regression guard** (D5), the docs (GETTING_STARTED, DEPLOYMENT, PROGRESS) and a Phase 2 review |

---

## 10. Phase 3, outlined (detailed plan to follow before building)

What's left after Phase 2:
- Employee Swipes;
- the muster's device-day editing (Manual Override in the same grid). The
  muster itself is built in Phase 2 (§5.1);
- Process Attendance is already built in Phase 2 (§3.1);
- the Exceptions screen with bulk resolve;
- Manual Override for device days;
- Shift Override (single dates);
- **Regularization** beyond the forgot-to-punch request P2-E brought
  forward (request, approval queue, bulk; managers by grant,
  as recorded). **It must cover days with no punches at all** (user,
  2026-10-09). P2-E's request only covers days with exactly one punch,
  and the other common case is a day with none:
  - someone forgot to punch entirely: they give both IN and OUT;
  - **the device was down**: every device-captured person at that branch
    has no punches for the outage, at once. Phase 3's plan must say how
    that is handled in bulk (e.g. HR records the outage and the affected
    days are corrected together), not as dozens of single requests;
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
   driver is our own read-only implementation (D-F1), checked against
   pyzk's reference behaviour and a protocol-level fake that `zkteco-js`
   reads correctly, but not against our machine. Unknowns:
   - whether our firmware speaks the protocol exactly as documented
     (TCP and UDP framing, the buffered read, the 40-byte record);
   - the comm-password handshake;
   - **whether reading the log without pausing the device is consistent
     on our firmware, and never stops anyone punching** (user,
     2026-10-09: "the one failure employees would notice immediately").
     The agent never pauses the device (P2-F rule 1), so a punch made
     mid-read is simply picked up on the next cycle. What to watch on
     connection day is in "P2-F build design: connection day";
   - how the device's record columns map onto ATTLOG's (status, verify
     mode, workcode). They are stored, never relied on;
   - how the device returns logs: all of them each time (so the cursor
     filters) or only new ones;
   - its log capacity and whether it overwrites when full. **If the agent
     is offline longer than the device holds, punches are lost. That's
     the one real data-loss risk.** It is now *guarded* (§7.1: a warning
     at 50% and a loud alarm at 75% of a pessimistic 3-day default, from
     the agent and independently from the server), but **the true
     capacity is unknown until we know the model**, and the setting has to
     be made then.
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
   the agent only after the poll. **Accepted (D7, user):** the difference
   that matters is "same day vs month end".
7. **Data entry, not code:**
   - the device-user-ID ↔ employee mappings for the ~125 enrolled IDs
     (2–126);
   - setting `has_biometric_device` off for SPN and Wellsure 2;
   - the open rule values (grace, half-day and full-day hours, other
     shifts);
   - the device's retention, once the model is known.

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
  the intended outcomes. It must come in within ingest ≤ 2 min and
  recompute ≤ 5 min on a dev machine.
  - **D5, user: a regression guard, not a target.** The measured times
    are committed as a baseline (`perf/baseline.json`). The replay job
    reports each run against it and **fails if any figure is more than
    2× the baseline**, even if it's still under the absolute limit.
- **G3 — health:** a silenced simulated device raises an HR alert during
  working hours (and doesn't on a Sunday or holiday). A silenced agent
  does too. Recovery notices follow.
- **G4 — manual capture:** a manual-capture employee with nothing entered
  is `NM`, never `A`, never an exception.
  - A `TIMED` manual 10:45 arrival is `LATE_IN` with the same minutes a
    punched 10:45 would give.
  - A status-only `P` shows as status-only.
  - The SPN/Wellsure 2 manager is refused on any other branch.
  - Every change shows live, with the manual marker.

## 13. Decisions (answered by the user, 2026-10-08)

- **D1:** build Phase 2 now; do Phase 1.5 before connecting the device.
- **D2:** Device User ID optional in Add Employee, as an **explicit
  "attendance marked manually" choice**, never a forgotten field (§4.3).
- **D3 (HR):**
  - working days are Monday to Saturday, and Sunday is the weekly off,
    the same for everyone;
  - the shift is 10:00–19:00 in two sessions, 10:00–14:00 and
    14:45–19:00, with lunch 14:00–14:45. The sessions are configurable;
  - **no late penalty**: lateness is recorded and visible only.
  - **Still open:**
    - grace minutes;
    - half-day and full-day minimum hours;
    - whether other shifts exist.

    These stay placeholders and are kept in PROGRESS.
- **D4 (HR):**
  - SPN and Wellsure 2 have no machine;
  - one manager marks both, entering **IN/OUT times** into a muster that
    is uploaded;
  - manual entry is time-based through the same engine, with a clearly
    distinguished status-only option;
  - `attendance.manual.enter` is branch-scoped, and this manager gets SPN
    and Wellsure 2 only.
- **D5:** ingest ≤ 2 min and recompute ≤ 5 min as a starting point.
  **The committed baseline guards against regression (more than 2× fails).**
- **D6:** a single executable under NSSM, with the key in Windows
  Credential Manager. Install, upgrade and uninstall are documented for
  someone else to do.
- **D7:** about 30 s on the agent route is fine. The device isn't pushed
  harder.
- **Attendance cycle:** admin-configurable. **The calendar month is
  confirmed by the user.**
- **Additions:**
  - the retention guard (§7.1);
  - the clock-drift warning (§7.1, §7.2);
  - re-processing from raw punches before lock (§3.1).

## 14. Open questions carried (spec §14; do not guess)

- The device's model name, and whether it supports ADMS push. *(Brand,
  platform, serial, address, port and timezone answered 2026-10-09: spec
  §4.1a. The agent route is primary and is built against
  `192.168.29.213:4370`.)*
- The device's admin password and comm key (supplied at install, never
  stored in the repo).
- Whether an always-on office PC exists for the agent (Windows version)
  and how many devices there are.
- Employee Code vs Device User ID default in Add Employee (our device IDs
  2–126 differ from the 1000-series codes).
- Whether the office has a static public IP (decides ADMS exposure).
- Working hours and days for the silence alert (defaults until HR
  confirms).
- **Still open from HR (D3):** grace minutes, half-day and full-day
  minimum hours, and whether any shift other than GEN exists.
- The device's real attendance-log capacity (retention) and whether it
  overwrites when full (§7.1). Its enrolment capacity (3,000 fingerprints,
  2,000 faces) is known and is a different number.
- *(Answered 2026-10-08:*
  - *the no-device branches are SPN and Wellsure 2, marked by one
    manager;*
  - *week-off, shift and sessions, and no penalty;*
  - *the calendar month.)*


---

## As built

### P2-A (2026-10-08)

As planned, with these specifics:
- `attendance.manual.enter` is **manager-grantable** (the SPN/Wellsure 2
  marker is a manager, and a MANAGER holder can only ever hold grantable
  keys). It stays safe because it is branch-limited by
  `attendance_manual_branches` and only touches non-finalised days.
- Grace and the day thresholds are placeholders listed per row in
  `placeholder_fields`; a value counts as confirmed when HR changes it or
  presses "Confirm values".
- A cycle start-day change must be dated on the new start day and after the
  current cycle ends; the cycle before it is clipped. One scheduled change at
  a time.
- Shift and policy edits apply in place (no versioning). Recompute-from-date
  arrives with the engine in P2-C.
- **Deferred to later Phase 2 commits:** the roster generator (with Shift
  Roster, P2-E) and the penalty-rule builder (HR confirmed no penalties; the
  column exists and stays empty). Branch enforcement of manual entries is
  P2-D.

**Follow-up after P2-A approval (user, 2026-10-08):**
- "Wellsure 2" added as a branch (`WS-2`, no biometric machine, placeholder
  address; exact name and address open in PROGRESS). Priya `1003` is
  seeded to mark both SPN-Panchsheel and Wellsure 2.
- Reaffirmed for P2-D: HR's manager records actual IN and OUT times. A
  `TIMED` entry goes through the same rules engine as device punches, so
  lateness, work hours, the scheduled-break deduction and the half-day and
  full-day thresholds come out identical. `STATUS_ONLY` is only for days
  whose times genuinely aren't known, and is always visibly distinguished
  ("status only, no times") wherever it appears (§2.3, §4.2, §5.1).
- The muster screenshot still didn't come through. P2-D builds §5.1 from
  the user's written description.

### P2-B (2026-10-09)

As planned, with these specifics:
- **The one permitted change to a raw punch** is re-resolving `employee_id`
  (the "map to employee" flow), enforced by the trigger; every received
  column is frozen. Flag decisions live in `punch_flag_resolutions`, so the
  punch itself never changes.
- **Plausibility thresholds** come from the company default policy (a punch
  isn't known to be anyone's until it's resolved).
- **Agent payload**: the agent sends ATTLOG lines, exactly the device's
  format, so all three routes share the one parser. The response's highest
  punch time is for the cursor; P2-F decides whether the agent's cursor is
  that time or the device's record position.
- **`requestRecompute`** is a seam (`modules/attendance/recompute.ts`): a no-op
  until P2-C registers the engine's debounced job.
- **Map to employee** defaults to the first unmapped punch's date (never
  before joining). A first mapping may be extended back to cover earlier
  punches — there was no row there to rewrite; an existing history is never
  rewritten.
- **The ATTLOG upload** lives under the biometric module (preview batch →
  commit) and appears as an Import Center tab for `attendance.devices.manage`
  holders, rather than as an xlsx dataset (the file is plain text and needs
  a device).
- **Deferred:** the `CLOCK_SKEW` incident (consistently skewed device) and
  every other health check are P2-H; the Devices screen's health columns too.

### P2-C (2026-10-09)

Built as planned: a pure engine (`modules/attendance/engine/`), a loader and
writer (`compute.ts`, through the EF readers only), `daily_attendance`
(source and capture on every day, `engine_version`, locked rows never
rewritten), debounced live recompute, the 02:00 nightly with catch-up,
Process Attendance (API, background job with progress, screen), the real
`AttendanceLeaveSink`, and recompute triggers for punches, mappings, leave,
holidays and assignment changes. Also: `writeDeviceMapping` now has the
366-day limit and the already-scheduled check, like every other writer.

**Placeholders are a recompute, never a disaster.** Every day is derived only
from stored inputs and the rule values; re-running with nothing changed writes
nothing, and a test pins that correcting a threshold and recomputing gives
exactly what computing from scratch with the new value gives — and that
changing it back restores every day.

**Rules decided here because neither HR nor the spec covers them** (each is
pinned by a named test in `engine.test.ts`, and each is a small, local change
if HR wants it otherwise):

1. **Which half a half day is.** When hours make a half day, the half whose
   scheduled work the person covered more of (as a fraction) is present
   (`P:A` or `A:P`). Equal coverage gives `HD` with no half named.
2. **Where the halves split.** At the scheduled break nearest the middle of
   the shift (GEN: lunch). A shift with a single work session splits at its
   midpoint.
3. **Near-duplicates chain.** Each punch is compared with the last punch
   *kept*, and the first of a cluster is kept (0 s, 90 s, 180 s with a 120 s
   window keeps 0 s and 180 s).
4. **Overlapping punch windows.** The nearer shift start wins; an exact tie
   goes to the earlier date. A punch in no window counts toward no day and is
   recorded on its calendar date's record (`outsideWindowPunches`).
5. **Lateness to the second.** Any second past start + grace is late; late and
   early minutes round up, worked durations round down.
6. **A lone punch is never "late".** On a closed day it might be the out, so it
   gives `A` + `MISSING_PUNCH` (1 day LOP until regularized) with no `LATE_IN`.
7. **Today is provisional.** Until a day's shift window closes (GEN: 01:00
   next day) someone who has punched is `P` so far and someone who hasn't is
   `A` so far with no LOP; `MISSING_PUNCH`, `EARLY_OUT`, `SHORTFALL` and
   `HALF_DAY_MIN_NOT_MET` wait for the window to close. The nightly makes it
   final.
8. **LOP per day.** `A` = 1; a half day = 0.5; an unpaid-leave half = 0.5;
   `NM`, `NS`, `H`, `O` and paid leave = 0; half-day minimum not met = the
   policy value (default 1, spec). With one half on leave, the worked half
   failing the half-day minimum is 0.5, not the policy's full day.
9. **`SHORTFALL` is an exception only when hours made it a half day.**
   Shortfall minutes are always recorded, but flagging every day someone left
   a few minutes early would bury real exceptions.
10. **Half-day leave days.** Lateness is measured from the working half's
    start (14:45 after a morning off), early-out to its end (14:00 before an
    afternoon off); the worked half needs the half-day minimum.
11. **Work on a holiday or week-off.** Any punch (or a manual P/WORKED) marks
    it worked; hours are recorded for the comp-off decision; it never raises
    an exception.
12. **No shift assigned.** Status `NS` with `NO_SHIFT`, no LOP — a
    configuration gap never turns into an absence. (Every employee gets the
    company default, so this shouldn't occur.)
13. **Source on a half-leave day** is the worked half's (`DEVICE` or
    `MANUAL`); the leave shows in the half status and leave code. A full leave
    day is `LEAVE`.
14. **Shortfall and excess** are against the scheduled work of the working
    halves (GEN 8 h 15 m), not the span.
15. **A manual time on a night shift** earlier than the punch window's start is
    read as the next morning.
16. **A day that should no longer exist** (a joining or leaving date
    corrected) is deleted on recompute, unless locked.
17. **Edits to a shift, policy or week-off pattern don't recompute by
    themselves**; the save message points to Process Attendance (the plan's
    "nothing recomputes silently"). An assignment change dated today or
    earlier does recompute that person from its date.
18. **The nightly** starts the day before the last run's end (a night shift's
    window closes the next morning) and catches up at most 31 missed days.

**One consequence HR should see before confirming the thresholds.** With the
P2-A placeholder full-day minimum of 8 h against GEN's 8 h 15 m of scheduled
work, anyone more than 15 minutes late or early (net) was a half day: a
de-facto lateness penalty, though HR said there is none. **Fixed 2026-10-09
(user: "a placeholder should fail safe, not fail harsh"):** the placeholders
are now 6 h / 3 h (see "Fail-safe thresholds and the finalisation gate"
below). When HR gives the real minimums, this is the number to check. A night
shift (7 h 30 m of work) would need its own policy.

### Fail-safe thresholds and the finalisation gate (2026-10-09)

- **Thresholds.** Default policy placeholders 6 h full day, 3 h half day:
  - 2 h 15 m below GEN's 8 h 15 m of work, so lateness alone (11:30 → 19:00
    is 6 h 45 m) never makes a half day;
  - 3 h is below either half's length (4 h, 4 h 15 m), so a genuine half
    day still counts as one;
  - applied by migration `20261010090000_failsafe_thresholds` only where the
    values were untouched; still marked as placeholders.
- **The gate** (`modules/attendance/finalisation.ts`), a hard block the
  server enforces; Phase 3's Period Finalisation is built on it:
  - blocks while a shift or policy in use in the period (by assignment or as
    recorded on a computed day) still has a placeholder field, while any
    `NM` or `NS` day remains, before the period has ended, or while any day
    isn't up to date: a dry run of the engine over the period
    (`computeAttendance(…, { dryRun: true })`, no writes) would change it.
    That catches a confirmed value that differs from the placeholder when
    the period wasn't re-processed, unprocessed punches, leave or holidays,
    days never computed and provisional days;
  - 409 `FINALISATION_BLOCKED` with every blocker in the message and in
    `error.details.blockers` (names the rule and fields, lists the days);
  - `finalisePeriod` is the only writer of `is_locked` (guard test);
  - readiness: `GET /api/attendance/finalisation/readiness?from&to`
    (`attendance.process`) and the "Ready to finalise?" card on Process
    Attendance.
- **Left for Phase 3**: the Period Finalisation screen, unlock (Super Admin,
  with a reason) and the payroll lock check, all on top of `finalisePeriod`.

### P2-D build design (2026-10-09, written before building)

§2.3 and §5 stand; these are the specifics decided for the build.

- **`manual_attendance_entries`**: append-only (a trigger refuses UPDATE and
  DELETE, with the same test-only purge as `raw_punches`). Kinds:
  - `TIMED` (`in_time`, optional `out_time`, "HH:MM");
  - `STATUS_ONLY` (`P`, `A`, `HD_FIRST`, `HD_SECOND`, `WORKED`);
  - `CLEARED`: withdraws the entry, so the day returns to `NM`.

  The latest entry per employee-day wins; every earlier one stays as
  history. `via` is `SCREEN`, `MUSTER_UPLOAD` (with the upload id) or
  `BULK` ("mark all present"). Each entry also stores remark, entered by
  and entered at.
- **The engine's manual loader** (P2-C's `setManualEntryLoader` hook) is the
  real query, registered with the engine. A `CLEARED` latest entry means no
  entry.
- **Who may mark a day:**
  - `attendance.manual.enter`, for an employee whose placement on that day
    is in one of the holder's `attendance_manual_branches`;
  - holders with ALL data scope (HR) may mark every branch, so HR can
    cover for the marker. (Decided here; it's the same reach HR has
    through `attendance.view`.)
  - Outside that: 404, never confirming the employee exists (IDOR-tested,
    `managerReach.test.ts`).
- **Which cells are editable**, all of these:
  - a manual-capture day (no device mapping in force);
  - employed that day, not after today, not locked;
  - not a full-day leave.

  On a holiday or week-off, only `W` or times are allowed (work on an off
  day). A half-day leave day takes the worked half. Everything else is
  read-only, with the reason in the tooltip.
- **What a cell accepts** (shared parser in `shared/attendance/muster.ts`;
  the legend under the grid lists them):
  - times: `10:05-19:10`, also `1005-1910`, `10.05-19.10` or `10:05 19:10`.
    An IN alone (`10:05-`) is a single punch: absent with `MISSING_PUNCH`,
    as the engine rule says;
  - `P`, `A`;
  - `P:A` (half day, present in the first half), `A:P` (present in the
    second half);
  - `W` (worked a holiday or week-off);
  - `-` (clear).

  Anything else is refused in place with the reason. `HD` alone is refused
  with "which half? P:A or A:P".
- **Seeing the muster:**
  - `attendance.view`: everyone in the holder's data scope, read-only
    except where they may also mark;
  - `attendance.manual.enter` alone: only the manual-capture employees in
    their branches.

  Device days are always read-only in P2-D (Manual Override is Phase 3).
- **Cells:**
  - the status code, with week-off as `OFF`, holiday `H`, leave by its
    code, `NM` grey;
  - a status-only entry is marked as such (dashed outline, "status only,
    no times");
  - a timed day shows the times and any "late Nm" in its tooltip;
  - a missing-punch day is marked red ("one time only: forgot to punch
    out?") and counted in its own totals column, so it is easy to find
    and fix.
- **Totals per row:**
  - **Paid days** = sum over the cycle's computed days of (1 − LOP),
    counting `NM` and `NS` days as 0 until they are resolved (the column
    says so), and never counting future days;
  - then Present (½ per present half), Absent, Half days, LOP, Leave, H,
    OFF, NM and Missing punch.
- **Save:** one batch per Save, up to 2,000 cells. Every cell is validated
  first, and nothing is written unless every cell is valid. The batch is
  then written, the touched employee-days are recomputed synchronously
  and the updated rows returned. The usual `attendance.updated` events
  reach every open screen. The batch is audited.
- **Mark all present** (a day, a branch) writes `TIMED` entries at each
  person's shift start and end, `via BULK`, for `NM` cells only. It never
  overwrites an entry.
- **Muster upload** (Import Center → "Manual attendance muster"):
  - the template is per branch and cycle, one row per manual-capture
    employee, with IN and OUT columns per day, pre-filled with the current
    entries so it round-trips. Off days, leave and locked days are shaded
    and ignored;
  - preview lists every cell as timed, status-only, clear, unchanged or
    invalid; rejected rows and cells are listed with reasons;
  - commit writes only the cells that differ from the current entry, so a
    corrected re-upload supersedes and never duplicates;
  - a blank cell leaves the day as it is; `-` clears it.
- **Reminder:**
  - daily at `attendance.manualReminderHour` (default 18 IST, a System
    Setting read when the scheduler starts);
  - each marker with `NM` rows today in their branches gets a
    notification with the count and a link to the muster;
  - nothing is sent on a day with none (a Sunday is `OFF`, not `NM`).
- **Where it lives:**
  - Workforce → Attendance → Attendance Muster (admin portal);
  - for a marker who is a manager, the employee portal gains Attendance →
    Mark Attendance, the same grid, shown only to holders of
    `attendance.manual.enter`.
- **Export:** the grid as `.xlsx`, totals, legend, and markers for status-only
  (`*`) and missing-punch (`!`) cells.

### P2-D (2026-10-09)

Built as the design above. Specifics, and the **rules decided here** (neither
HR nor the spec covers them; listed for review):

1. **Nobody marks their own attendance**, HR included. Priya's own row is
   read-only to her; HR marks it. (Found in the walkthrough: Priya sits at
   SPN, so she could otherwise have marked herself.)
2. **HR (ALL data scope) may mark every branch**, so they can cover for the
   marker.
3. **A blank cell in an upload leaves the day as it is; `-` clears it.**
   **`HD` alone is refused** ("which half? P:A or A:P").
   *Follow-up (user, 2026-10-09: "confirm there's a way to actively clear a
   day, and that it's obvious"):*
   - the template says so in a bold red line above the header: "To clear a
     day marked by mistake, type - (a dash) in its IN cell. Deleting what's
     in the cell does NOT clear it.";
   - the upload panel shows the same as a warning;
   - the preview lists each change as *Now → Becomes*, with a clear shown in
     red as "clears the day (back to NM)" next to what it removes;
   - in the grid, emptying a marked cell and saving clears it too (the
     cell shows "clear" until saved). Only the upload keeps blank = leave
     as is, so a partly filled sheet can't wipe anything;
   - tested: a dash clears; an emptied upload cell changes nothing.
4. **An IN with no OUT is accepted.** It counts like a single punch: absent
   with `MISSING_PUNCH`, per the engine rule HR is confirming. The muster
   marks it with a red corner, counts it in a "1×" column, and a correction
   (`10:05-19:00`) fixes it.
5. **Opening the muster computes any day that has happened but has no
   record yet** (e.g. today, before the nightly). Every cell is a real
   engine result.
6. **Paid days** = Σ (1 − LOP) over the days so far. NM halves and NS days
   count 0 until resolved, and future days aren't counted.
7. **Mark all present** fills only `NM` working days, at each person's
   shift start and end. It never overwrites an entry.
8. **Committing an upload re-validates every cell.** If anything changed
   since the preview (e.g. leave approved), nothing is written and the
   upload goes back to preview. Only the uploader can commit their upload.
9. **One remark per Save** (applied to every cell in it), not per cell.
10. **The reminder goes only to the people assigned in Attendance Settings →
    who marks which branch**, not to every ALL-scope HR user.
11. **Limits:** 2,000 cells per save, and up to 400 days back.
12. **Live:** `attendance.updated` also reaches each branch's markers, so
    their muster refreshes on someone else's change. Unsaved typing is kept.

Also as built:
- **Where it is.** The muster is at Workforce → Attendance → Attendance
  Muster. The upload is on the muster page ("Upload muster") and also in
  Import Center → "Manual attendance muster" (the plan named only the
  Import Center; Priya, a manager, has no Import Center).
- **The marker's route.** The employee portal has Attendance → Mark
  Attendance, shown only with `attendance.manual.enter`. The menu gained an
  optional `permission` per item.
- **Self-check pass:**
  - the upload preview applies the same day rules as Save (a `P` on a Sunday
    is listed as a problem, not as a change);
  - only the uploader can commit an upload.
- **Not done here:**
  - the reminder hour is a seeded System Setting row, not yet on the System
    Settings screen;
  - regularization (an employee asking for a missing-punch day to be
    corrected) stays in Phase 3, as planned.

**Tests:**
- `manual.test.ts` (18): the parser; a TIMED entry equals device punches
  at the same times; status-only; IN-only; supersede, clear, append-only;
  no duplicates; off days, leave, device days, the future, finalised days,
  self-marking; branch IDOR; totals and paid days; mark all present; export;
  upload round-trip, preview, commit, re-upload without duplicates, foreign
  files; reminder (quiet on a Sunday).
- `managerReach.test.ts`: 7 muster routes, the manager's branch only.
- `finalisation.test.ts` (9).

### P2-E build design (2026-10-09, written before building)

§8 stands. P2-E also takes the **forgot-to-punch-out request**, brought
forward from Phase 3 (user, 2026-10-09). The user's words: "the employee
raises it from their own attendance view, their manager or HR approves,
and the day recomputes with the corrected time and an override marker.
The fuller regularization workflow can still come in Phase 3."

**The forgot-to-punch-out request (the first kind of regularization):**
- **`regularization_requests`** (the spec's table), with `kind =
  MISSING_PUNCH` only. Phase 3 adds kinds to the same table, keys and
  screens. Columns:
  - employee, date;
  - `missing` (`OUT`, the usual case, or `IN`), `time` ("HH:MM");
  - `reason` (required);
  - status `PENDING` → `APPROVED` / `REJECTED` / `CANCELLED`;
  - raised by, decided by and at, decision note.

  One pending request per employee-day (partial unique index). Every
  change is audited.
- **Who can raise one:** the employee, for **their own day**, when that day
  qualifies on every count:
  - device capture, with exactly one usable punch (`MISSING_PUNCH`);
  - not finalised;
  - in the current or previous attendance cycle.

  Manual-capture days are fixed by their marker in the muster. A day with
  no punches at all is Phase 3's full regularization.
- **The time must make sense:**
  - an OUT comes after the recorded punch, an IN before it;
  - it falls inside the shift's punch window;
  - it is more than the near-duplicate window away from the punch.
- **Who decides:**
  - the key `attendance.regularization.approve`, for an employee in their
    data scope (TEAM: their reports; ALL: everyone), never their own
    request;
  - `attendance.regularization.view` shows the queue without deciding.
    These are spec §2.2's "two grantable keys, TEAM scope, IDOR-tested",
    created now;
  - both are held by HR_ADMIN and HR_EXECUTIVE; managers only by grant.
    The seed grants them to Karan (`1002`) for the demo.
- **Approval recomputes the day.**
  - The engine gets the approved time as one more point on the day. It is
    a *corrected time*, never a raw punch: raw punches stay immutable.
    The engine then works the day out exactly as if a second punch
    existed.
  - The day records `override_kind = MISSING_PUNCH_CORRECTION` and the
    request id. That is the override marker, shown on the calendar, the
    day detail, the muster and its export ("✎ corrected, approved by …").
  - A real punch that arrives later (agent catch-up) simply joins the
    points.
- **Finalisation gate:** a pending request in the period is a new blocker
  (`PENDING_REGULARIZATIONS`).
- **Notifications and live events:**
  - raising notifies the employee's reporting manager if they hold the
    approve key; HR sees every pending request in its queue;
  - a decision notifies the employee;
  - `regularization.submitted` / `.decided` (spec §8) refresh the queues
    and the employee's view.
- **Where it shows:**
  - the Tasks inbox (new source `REGULARIZATION_APPROVAL`) and the
    Request Hub (new type `REGULARIZATION`), the seams those modules left
    for it;
  - managers decide in To do → Review (a new "Attendance" tab);
  - HR decides in Workforce → Attendance → Regularizations.

**Attendance Info** (employee: Attendance → Attendance Info; admin: Workforce
→ Attendance → Attendance Info, any employee in `attendance.view` scope,
read-only):
- **Month calendar** (previous/next):
  - each day has a colour by status, the status code (`OFF` for a week-off,
    as in the muster) and the shift code;
  - markers: device or manual entry, status only, corrected, missing punch.
- **Stats cards:**
  - average work hours and average actual hours (days with times);
  - late days;
  - LOP days. *Decided here:* LOP replaces greytHR's "penalty days", which
    would always be 0, since HR confirmed there are no penalties.
- **Exception banner:** "N exception days" (any exception flag), listing
  the kinds; clicking selects the first.
- **Day panel:**
  - the exception explained in words;
  - shift name, code, timings, policy, "Processed on";
  - First In / Last Out / Late / Early / Total / Break / Actual / In shift /
    Shortfall / Excess;
  - status details:
    - status and source;
    - for manual days, who entered it and when, and whether it is status
      only;
    - the correction, if any;
  - half statuses;
  - **the day's raw punches** (first and last marked, near-duplicates shown
    collapsed, outside-window and flagged ones labelled);
  - the forgot-to-punch-out block.
- **Live:** `punch.received` and `attendance.updated` refresh the calendar
  and the open day within seconds.

**Who Is In?** (Workforce → Attendance, `attendance.view`):
- today, by branch and department;
- it computes today for everyone shown on first load, then updates live
  (`punch.received.batch`, `attendance.updated`);
- the honest groups from §8:
  - **arrived** (first punch time, late flag);
  - **not yet arrived**;
  - **away** (leave, holiday, week-off);
  - **manual capture** (entered IN, "status only", or "not marked yet");
- a note says it shows who has punched, not who has left.

**Routes:**
- self: `GET /api/attendance/me/month`, `GET /api/attendance/me/day/:date`;
- self: `POST /api/attendance/me/regularizations` and its `/:id/cancel`;
- admin, data scope: `GET /api/attendance/employees/:employeeId/month` and
  `/day/:date`;
- admin: `GET /api/attendance/who-is-in`;
- scoped, manager-reachable, IDOR-tested:
  - `GET /api/attendance/regularizations`;
  - `POST /api/attendance/regularizations/:id/approve`;
  - `POST /api/attendance/regularizations/:id/reject`.

### P2-E (2026-10-09)

Built as the design above, including the forgot-to-punch request brought
forward from Phase 3. **Approved by the user 2026-10-09, including the
eleven rules below.** Follow-up: days with no punches at all are recorded
for Phase 3's regularization (§10). **Rules decided here** (listed for
review):

1. **Which days can be corrected:** only days with exactly one punch, in the
   current or previous attendance cycle, not finalised. A day with no
   punches at all, or an older one, waits for Phase 3's full
   regularization.
2. **The corrected time is a point, not a raw punch.** The engine takes
   first and last over all points. A corrected IN is therefore subject to
   lateness exactly like a punched one.
3. **One approved correction per day.** Once a day is corrected, no further
   request can be raised for it (a partial unique index enforces it).
4. **Notifications:** only the reporting manager is notified, and only if
   they hold the approve key. HR finds requests in its queue and in Admin
   Home's task counts, without a notification each (to avoid noise).
5. **Rejecting needs a reason in the UI** (the employee is told why). The
   API accepts an empty note.
6. **Workflow Delegates don't extend regularization reach** (they cover
   leave only, as built in E3). A manager's queue is their reporting tree.
7. **A manager deciding a request sees the recorded punch and the shift in
   the queue row.** They don't get the team's calendars: `attendance.view`
   stays non-grantable.
8. **Attendance Info is by calendar month**, like greytHR's. The muster is
   by attendance cycle, and the two are the same while the cycle is the
   calendar month.
9. **Stats cards:** "LOP days" replaces greytHR's "penalty days" (no
   penalties exist). The exception banner counts missing punch, below the
   half-day minimum, shortfall, no shift and a flagged clock. Lateness is
   recorded but is not an exception.
10. **Who Is In works lateness out from the first punch** (shift start plus
    grace), so it is shown even when the day has only that punch.
11. **Admin Attendance Info is read-only:** nobody raises a request on
    someone else's behalf in this minimal version.

Also as built:
- the override marker is `daily_attendance.override_kind =
  MISSING_PUNCH_CORRECTION` plus `override_ref` (the request). It shows as ✎
  on the calendar, "Corrected" in the day panel, `~` in the muster export
  and in the muster tooltip;
- `RegularizationRequestSink` (Admin Home task counts), the Tasks inbox and
  the Request Hub got their regularization sources, through the seams
  Phase 5 left for them;
- a pending request is a finalisation blocker;
- the keys are in the HR role defaults (`systemRoles.ts`) and in the
  migration (for existing databases). Karan (`1002`) is seeded with both;
- live: `useAttendanceRealtime` refreshes any attendance screen on
  `punch.received`, `attendance.updated` and `regularization.*`.

**Tests:**
- `attendanceInfo.test.ts` (13): month, day, punch roles; admin view and
  refusals; eligibility; time sanity; raise with notification, tasks, hub and
  counts; finalisation blocker; queue scope; IDOR and own-request refusals;
  approval recompute and marker with the raw punch untouched; reject and
  re-raise; cancel; Who Is In groups;
- 4 engine tests for corrections;
- 3 reach cases in `managerReach.test.ts`.

### P2-F build design (2026-10-09, approved, written before building)

§7.1 stands except where this section changes it. The user approved
D-F1 to D-F5 and the rules below on 2026-10-09.

**What the library evaluation found (D-F1).** Both candidates were read
in full (`node-zklib` 1.3.0, `zkteco-js` 1.7.2):
- **Neither supports the comm key** (the `CMD_AUTH` handshake). If our
  device has a non-zero comm key, neither can connect.
- `zkteco-js` builds each punch time as a JavaScript `Date` in **the PC's
  own timezone**, then stringifies it, so punch times would depend on how
  the office PC's clock is set ("wrong attendance that nobody could
  trace", user).
- `zkteco-js` treats 1 s of silence as "the read has finished", so a slow
  read could come back cut short without an error. It also logs to the
  console throughout.
- `node-zklib`: last released 2022, an older copy of the same code.

So `Zk4370Driver` is **our own read-only implementation** of the ZKTeco
protocol (TCP, with UDP as a fallback), about 500 lines. Two independent
checks keep it honest, since a fake built from the same reading of the
protocol could share its mistakes:
- the comm key, checksum, time encoding and record decoding are checked
  against **test vectors produced by pyzk** (the widely used Python
  implementation), recorded with their provenance;
- the protocol-level fake device must be readable by **`zkteco-js`**
  (installed as a test-only dependency). That proves the fake behaves
  like the devices that library is used with.

**Rule 1, the most important (user: "a structural guarantee with a
test"): the agent never changes anything on the device.** The device is
live, greytHR still reads it at month end, and people punch on it all
day. So:
- the driver can send only the commands on a fixed allowlist: connect,
  authenticate, exit, read options (serial, platform), firmware version,
  record counts, device time, and the buffered read of the attendance log
  with its free. **No command that writes exists in the driver at all**:
  no clearing the log, setting the clock, disabling the device, or
  touching users;
- the send path refuses anything outside the allowlist, and a test
  asserts it;
- the fake device fails any test in which it receives a command outside
  the allowlist;
- the agent **never pauses the device** while reading (libraries and
  examples often do), so nobody is ever blocked from punching. A punch
  made mid-read is picked up on the next cycle;
- `INSTALL.md` (F2) says plainly that the agent cannot change or disrupt
  the machine.

**The cursor (D-F2): a position plus a fingerprint, never a timestamp.**
- The device returns its whole log, in storage order, on every read. The
  agent remembers how many records it has taken, and a fingerprint (user
  ID, time, status, verify mode) of the last one. Someone correcting the
  device clock backwards would make a timestamp cursor skip a week of new
  punches silently.
- **Normal case:** the count grew and the record at the remembered
  position still matches, so the new records are those after it.
- **Log cleared, or wrapped when full:** the remembered record isn't where
  it was. The agent looks for it from the end. Found: everything after it
  is new. Not found: every record in the log is sent again; the server's
  exact-duplicate key drops the ones it has.
- **Cheap polling:** the agent asks for the record count first (one small
  command). The full log is read only when the count changed, or when the
  log is full (a wrapping log can change without its count changing).
- **The outbox:** new records are written to an on-disk outbox (one file
  per batch of at most 1,000 lines, written and flushed, then renamed into
  place) **before** the cursor moves. An outbox file is deleted only when
  the API acknowledges it. So a long API outage can't leave punches only
  on the device, where they could be overwritten; a crash at any step
  re-sends rather than loses.

**"Sync punches from" (D-F3).** Each device gets a date on the Devices
screen, defaulting to the day it was registered. The agent never sends a
punch dated before it, and moves its cursor past such records. The
device has been recording since Dec 2022; without this, the first sync
would send years of history and flood the Flagged queue (anything older
than 45 days is flagged). **Moving the date earlier** makes the agent
read the whole log again and send from that date; the server drops exact
duplicates. The screen says so before saving.

**Accounts and secrets (D-F4, built in F2).** Credential Manager stores
secrets per Windows user, so the service runs as its own low-privilege
local account (not LocalSystem). The agent key **and each device's comm
key** go in that account's Credential Manager; `config.json` holds no
secrets. On Linux (development, CI) secrets come from environment
variables.

**The commit split (D-F5).**

*F1: the agent, the driver, the server side.*
- **Shared contract** `shared/attendance/agentProtocol.ts`: the punches
  post, the heartbeat request and reply, and their limits, used by both
  the backend's validators and the agent.
- **Schema** (one migration):
  - `devices.sync_from` (date; existing devices get the day they were
    created), `devices.retention_days` (3) and `devices.retention_records`
    (20,000), labelled "pessimistic until the device model is known";
  - `devices.agent_report` (the agent's latest report for that device)
    and `devices.agent_report_at`;
  - the setting `attendance.deviceHealth`: warning at 50% and alarm at 75%
    of the retention window, log nearly full at 90%, clock drift beyond
    120 s. Created by the migration on every database.
- **Heartbeat:**
  - the reply carries, per device assigned to the agent: serial, name,
    timezone, sync-from date, retention values and the simulated flag,
    plus the thresholds. A change in the app reaches the agent within one
    cycle, with no restart;
  - the agent reports, per device: its state (`OK`, `UNREACHABLE`,
    `SERIAL_MISMATCH`, `AUTH_FAILED`, `NOT_ASSIGNED`,
    `UNSUPPORTED_FORMAT`), last successful read, last error, the log count
    and capacity the device reports, firmware and platform, the device
    clock's offset from the server (positive = device ahead), the outbox
    backlog and the retention state; and for itself: version, host, start
    time, total backlog, last successful post and last error;
  - stored on each assigned device (`agent_report`) and on the agent (as
    before);
  - a heartbeat emits `device.status` (signal only) to
    `perm:attendance.devices.manage`, so the Devices screen updates live.
- **Clock drift is visible to HR, not just in the agent's logs** (user,
  2026-10-09: "nobody would think to look"):
  - the Devices screen shows each device's offset, and a **warning banner**
    for any device beyond the threshold, saying the clock must be set from
    the device's own menu (never automatically);
  - **Admin Home** shows the same warning to holders of
    `attendance.devices.manage`, next to the existing alerts, together
    with any device whose retention state is at warning or alarm (that is
    punches at risk of being overwritten);
  - P2-H adds the `CLOCK_DRIFT` incident, the in-app and email
    notification to the alert list, and the drift chart.
- **Devices screen:** columns for the agent's report (state, last read,
  clock offset, retention, log count and capacity, backlog); "Not
  configured on the agent PC" for a device assigned to an agent whose
  heartbeat doesn't include it; the device form gains sync-from and the
  two retention fields. Changes are audited.
- **System Settings → Attendance → Device health** (`settings.manage`,
  audited): the four thresholds. P2-H adds the silence and morning-check
  settings to the same card.
- **The agent** (`biometric-agent/src`):
  - `config`: `config.json` validated with Zod (API URL, poll interval
    30 s, data folder, secrets source, devices: serial, host, port 4370,
    transport `auto`/`tcp`/`udp`, driver `zk4370`/`simulated`). HTTPS is
    required except for localhost;
  - `device`: the `DeviceDriver` interface; `zk/` (packet framing,
    checksum, comm key, time and record decoding, TCP and UDP transports,
    the driver); `SimulatedDriver` (in memory; P2-G drives it);
  - `sync`: the per-device reader, the cursor, the outbox, the sender, the
    heartbeat, the retention guard and the clock-offset estimate;
  - `api`: the HTTPS client;
  - commands: `run`, `diagnose` (connects, prints serial, firmware,
    platform, log count and capacity, the clock and its offset; sends
    nothing), `check-config`, `version`;
  - a development fake device (`npm run fake-device --prefix
    biometric-agent`) that speaks the real protocol, so the whole route
    can be run locally;
  - logs are JSON lines on stdout.
- **How each cycle runs** (one loop per device, every 30 s, so a device
  that is down never holds up the others):
  1. connect (with the comm key if one is stored);
  2. **confirm the device's own serial matches the configuration**; on a
     mismatch, read and send nothing (a wrong IP would otherwise put one
     branch's punches on another);
  3. ask for the record count; read the full log only if needed;
  4. turn new records into ATTLOG lines with the same shared code the
     server parses with (`shared/attendance/attlog.ts`), skipping any
     before the sync-from date;
  5. write them to the outbox, then move the cursor;
  6. read the device clock; disconnect.

  Separately, the sender drains the outbox in order (backoff 5 s doubling
  to a 5-minute cap, with jitter), and a heartbeat goes every cycle. If
  the server rejects the agent key (401) or a device (403), the agent
  keeps reading into the outbox and stops sending until it is fixed.
- **The retention guard**, per device: the time since its last successful
  read against `retention_days` gives `WARNING` at 50% and `RISK` at 75%;
  the log count against capacity (as the device reports it, else
  `retention_records`) gives `LOG_NEARLY_FULL` at 90%. The last values
  the server sent are kept on disk, so the guard works while the API is
  unreachable, which is when it matters. (F2 adds the Windows event-log
  entry on each change of state.)
- **Tests:**
  - agent: pyzk vectors; the fake device over TCP and UDP (comm key,
    direct and chunked reads, a log cleared or wrapped, a dropped
    connection mid-read, a skewed clock); `zkteco-js` reading the fake;
    the allowlist; the cursor in every case above; a crash at each step
    losing nothing; an API outage and catch-up in order; backoff; 401 and
    403; serial mismatch; sync-from (and moving it earlier); retention
    and log-full states; HTTPS required; the heartbeat contract;
  - backend: the heartbeat reply and stored reports, `device.status`,
    the device fields, the thresholds setting, the Admin Home warnings,
    audit, the route inventory.
- **Verification:** a fresh devcheck migrate and seed; backend, frontend
  and agent suites; lint and typecheck; live, the real agent reads the
  fake device and Arjun's calendar and Who Is In update in two browsers;
  the Devices screen and Admin Home show a skewed clock and a retention
  warning live; an API outage drains afterwards; an agent killed mid-run
  resumes with nothing lost.

*F2: Windows packaging and the service.*
- A single executable (Node's single-executable application, built on
  the CI Windows runner).
- A release zip: the executable, NSSM (downloaded in CI and checked
  against a pinned SHA-256, never committed), `install.ps1`,
  `upgrade.ps1`, `uninstall.ps1`, an example `config.json`.
- `install.ps1`: creates the service account, stores the secrets in its
  Credential Manager, registers the event-log source, configures NSSM
  (start on boot, restart on failure, log rotation), and warns if the PC
  is set to sleep.
- The agent writes to the Windows event log on every change of retention
  state, and when the clock drifts beyond the threshold.
- **CI on a Windows runner:** install the real executable; check it runs
  as the dedicated account and that punches from the fake device reach a
  fake API; kill the process and see it restart; restart the service; cut
  the API and watch the outbox drain; uninstall cleanly. (A runner can't
  reboot, so restart-on-failure plus automatic start stand in for
  "survives a reboot".)
- `biometric-agent/INSTALL.md`: install, upgrade and uninstall for
  someone who isn't the user; a plain statement that the agent cannot
  change or disrupt the device; rotating the key; `diagnose`; what the
  retention, log-full and drift warnings mean; setting the device clock
  by hand.

**Rules decided while designing** (approved 2026-10-09):
1. The agent never changes anything on the device (above).
2. Log-nearly-full has its own threshold (90%). 50%/75% applied to how
   full the log is would alarm permanently on a device recording since
   2022.
3. A simulated driver is allowed only for a device the server marks as
   simulated, so a production PC can never send made-up punches.
4. HTTPS is required except for localhost.
5. Clock drift is shown and never corrected.

**Connection day: what to watch** (§11.1; told to the user on the day).
The one failure employees would notice at once is the device refusing
or delaying punches while the agent reads it. On the day:
1. run `diagnose` first and note the log count, capacity, firmware and
   the clock offset;
2. while the agent runs its first full read (the slowest one, since it
   reads the whole log), have someone punch repeatedly at the device and
   confirm each is accepted at once, with no "working…" or busy screen;
3. confirm those punches arrive in the next cycle or the one after;
4. watch the agent's log for read timeouts or retried chunks over the
   first hour; repeated ones mean the device is slow to serve the log,
   and the poll interval or chunk size is the setting to change;
5. compare a morning's punches with greytHR's view of the same device
   before relying on them.

If reading ever blocks punching, stop the agent (stopping the service is
instant and changes nothing on the device), and the fix is in the driver
alone.

### P2-F, commit F1 (2026-10-10)

Built as the design above: the shared contract
(`shared/attendance/agentProtocol.ts`), the server side, our read-only
`Zk4370Driver` with its fake device, the agent, and the screens. F2 (Windows
packaging) follows.

**What the independent checks caught.**
- **The fake device wasn't behaving like a real one.** `zkteco-js` read a
  small log from it but stalled on a chunked one: the fake sent a chunk's three
  packets (prepare, data, acknowledgement) in one TCP write, and `zkteco-js`
  handles one packet per network read, which works with real devices only
  because they send those packets separately. The fake now sends them
  separately by default, like a device. Our driver is tested against all three
  ways a TCP stream can carry them: separate, joined in one write, and split
  into 7-byte pieces.
- pyzk's vectors matched our comm key, checksum, packet headers, time encoding
  and both record layouts on the first run.

**Rules decided while building** (neither HR nor the spec covers them; each is
small to change):
1. **Any timeout or protocol surprise ends the session.** The next cycle starts
   clean, so a late reply can never be read as the answer to a later command.
   Packets that arrive unasked are dropped before each command.
2. **The agent reports in before it reads.** It needs each device's sync-from
   date. A device the server hasn't described yet is `NOT_YET_READ`; once
   heard, the server's settings are kept on disk, so the agent keeps reading
   (and the retention guard keeps working) while the API is down.
3. **What the server can't accept stays on the PC.** A rejected agent key
   (401): reading carries on into the outbox, sending stops, and the agent
   reads the stored key again on each retry, so a corrected key works without
   a restart. A refused device (403): that device's batches wait (backoff at its
   cap); others still go. A batch refused as it stands (400/413/422) is moved
   to `outbox-rejected/` for a person, never deleted, and counted in the
   heartbeat.
4. **The retention state on screen is worked out by the server when the page is
   read**, from the agent's "seconds since the last read" placed on the
   server's clock. If the agent dies, its devices climb to WARNING and RISK on
   their own (§7.1's "the server raises the same alarm from silence alone",
   shown on screen now; P2-H adds the incident, notification and email).
5. **A new device state, `CONFIG_REFUSED`**: the PC's configuration for a device
   is refused (a simulated driver for a real device, P2-F rule 3).
6. **Record columns.** ATTLOG's status ← the record's punch state; verify mode
   ← its verify type; workcode ← the 16-byte record's workcode, else `0`. All
   stored, never relied on. **8-byte records** (very old firmware, user IDs only
   through the user table) are `UNSUPPORTED_FORMAT`, not read. Our device's
   face and finger-vein firmware is expected to use 40-byte records (§11).
7. **The comm-key scramble wraps at 32 bits**, as the vendor's C original does;
   pyzk raises instead. Only a key whose bit-reversal plus the session id
   overflows is affected.
8. **"Sync punches from" can't be in the future**, and has a database default of
   today (IST) for any insert path. Retention: 1–365 days, 100–10,000,000
   records. Thresholds: warning below alarm (both checked on save).
9. **Device warnings on Admin Home** go to holders of
   `attendance.devices.manage`, the same people as the Devices screen.
10. **"Not configured on the agent PC"**: a device assigned to an agent that has
    reported since, without mentioning it.
11. **One agent per data folder.** Two agents on one outbox and cursor would
    send punches twice and fight over the cursor, so `run` takes a lock file in
    the data folder and a second agent exits with "already running". The lock
    is refreshed every 20 s and is taken over once it is a minute old, or at
    once if its process is gone. A process ID alone isn't enough: Windows
    reuses IDs after a reboot, so an old lock could name an unrelated live
    process and keep the agent down for good. A crashed agent therefore
    restarts within a minute at most; the service manager's restart (F2)
    retries until then.

**Also as built.**
- The heartbeat accepts an agent a version older or newer than the server:
  only each device's serial and reachability are required.
- `diagnose` reads firmware, platform, log count and capacity, and the clock
  straight from the device and sends nothing: the device-checklist questions
  (log capacity above all) can be answered from it once a PC on the
  192.168.29.x network can reach the device.
- The clock offset is device − PC plus PC − server (from each heartbeat's round
  trip), so a wrong PC clock doesn't make a right device look wrong (tested).
- **npm 10.9.4 can't resolve vitest from scratch** (a peer-dependency bug in
  npm: even an empty project fails). The agent's lockfile was resolved once
  with npm 11; npm 10's `npm ci` and `npm install` both install from it
  (checked).

**Tests:**
- agent (70): pyzk vectors; framing; the attendance buffer; the allowlist; the
  driver against the fake over TCP and UDP (direct and chunked reads, joined
  and fragmented TCP, 16-byte records, the comm key right and wrong, a punch
  mid-read, a silent device, a connection dropped mid-chunk, nothing
  listening, every write command refused before a byte leaves); `zkteco-js`
  reading the fake (3,000 records, chunked) exactly as our driver does; the
  cursor in every case (including a clock set back an hour); the outbox,
  backoff, clock offsets, config and secrets; the agent end to end (sync-from,
  cheap polling, a wrapped and a cleared log, sync-from moved earlier, 2,500
  punches in batches of 1,000, an API outage while the device overwrites, a
  crash between outbox and cursor, a lost answer, a rotated key (with and
  without a restart), a 403 and a
  400, a serial mismatch, not yet read / not assigned, one device down, a
  simulated driver refused and allowed, the retention guard at 50% / 75% with
  the API down and back, a nearly full log, clock drift against the server not
  the PC, start and stop; one agent per data folder: a second refused, a dead
  agent's lock taken over at once, a stale lock taken over even when its
  process ID belongs to something else);
- backend `agentDevices.test.ts` (15): the device fields, the heartbeat reply
  and stored reports (the last read on the server's clock), `device.status`,
  "not configured on the agent PC", clock drift, retention climbing when read
  later, a nearly full log, the thresholds setting (audited, warning below
  alarm, reaching the agent), permissions, another agent's key.
- **Live walkthrough** (fresh `wellsure_hr_devcheck`; the real agent and our
  driver reading the fake device over TCP; HR and Arjun in two browsers):
  - a new device syncs from today, and the 8 older records on the device were
    never sent;
  - Arjun punched: his open day panel listed it 1.9 s later, his calendar day
    turned A → P at 3.0 s, and HR's open Who Is In listed him under Arrived
    (0 → 1, late 62 min) at 3.1 s, with no reload (the agent polls every 5 s
    here, 30 s in production);
  - the device clock set 5 minutes ahead: the Devices screen's warning
    appeared in 7.9 s with no reload, Admin Home showed it to HR, and it
    cleared by itself once the clock was put right; the 9-of-10 log showed as
    nearly full;
  - API stopped: the agent kept reading into the outbox, and all 3 punches
    made during the outage arrived once the API was back;
  - a second agent on the same data folder was refused; the first was killed
    outright (SIGKILL), restarted as a service manager would, took over its
    lock, and sent exactly the one punch made while it was down (4 stored, no
    duplicates);
  - the fake device received only read commands (100 of them);
  - the Devices screen at 390 px has no horizontal overflow.

### P2-F, follow-up to F1: HR is told when punches are set aside (2026-10-10)

Added on the user's review of F1 ("a quarantine nobody checks is the same as
data loss, just slower"). Small, so it has no design section of its own.
- **Why:** a batch the server refuses as it stands (400/413/422) is moved to
  `outbox-rejected/` on the agent PC. The count was in the heartbeat but the
  server ignored it, so those punches were neither in attendance nor on any
  screen.
- **Surfaced:** the heartbeat's `quarantinedBatches` (now part of the shared
  contract, optional so an older agent is fine) raises a `BATCHES_SET_ASIDE`
  warning, red, on the Devices screen and Admin Home (the same people and the
  same live `device.status` refresh as the other device warnings). It clears
  by itself when the PC reports 0. The Sync agents tab shows the count per
  agent.
- **Rules decided while building:**
  1. **The reason the server refused it is kept beside the batch**
     (`<batch>.reason.json`), since a person looking at it a week later
     couldn't otherwise tell why.
  2. **A way to deal with them, since a banner nobody can clear gets ignored:**
     `quarantine` (list, with the reason), `quarantine --export <folder>`
     (each batch as a plain ATTLOG file that Import Center → Punches (ATTLOG)
     accepts, which gives line-by-line reasons and takes the valid ones), and
     `quarantine --done` (moves them to `outbox-rejected/handled/`: still
     never deleted, and the warning clears). Safe beside a running agent.
  3. **`keyRejected` is no longer in the heartbeat.** A rejected key means the
     heartbeat is rejected too, so the server could never have received it;
     the case is covered by the key-rejected warning in the agent's log, and
     (P2-H) by the agent going silent.
- **Also:** the npm 10 / vitest lockfile problem is now in GETTING_STARTED's
  troubleshooting (user note).
- **Tests:** agent 71 (+1: reason, list, export, handled; the heartbeat carries
  the count); backend +1 (the warning appears, shows on the agents list, clears
  on the next report, and an older agent raises nothing). Live, on a fresh
  devcheck: a 1,001-line batch (over the server's 1,000 limit) in the outbox
  was refused with HTTP 400 and set aside; the Devices screen warned 5.9 s
  after the agent started, Admin Home and the Sync agents tab showed it,
  `quarantine` listed it with the reason, `--export` wrote all 1,001 punches,
  `--done` moved (not deleted) the files, and the banner cleared by itself.

### P2-F, commit F2 build design (2026-10-10, written before building)

D-F4 (a dedicated low-privilege account; the agent key and comm keys in its
Credential Manager) and the F2 bullet list in "P2-F build design" above were
approved on 2026-10-09; the user's instruction on 2026-10-10 was "Build F2".
This section is the detail underneath them, and the rules I decided where the
approved text didn't reach are listed at the end for review.

**Where each thing can be proven.** F2 is mostly Windows, and this container
is Linux, so the proof is split:
- *Here:* the executable is built and run for real (the same single-executable
  recipe works on Linux) against the fake device and a fake API; the
  Credential Manager and event-log code against a fake PowerShell, so the logic
  is tested even though the Windows calls aren't; every `.ps1` is parsed with
  PowerShell 7's own parser.
- *The CI Windows runner:* the real thing: `install.ps1`, the service account,
  Credential Manager, NSSM, restart on failure, event log, uninstall.
- *Only the office PC:* see "Unproven" below.

**The executable.** The agent is bundled with esbuild into one CommonJS file
(zod is its only runtime dependency; `zkteco-js` stays test-only and never
ships), then turned into a Node single-executable application: the SEA blob is
injected (postject) into a copy of `node.exe`. The result, `wellsure-agent.exe`,
needs nothing installed on the PC. The Node version it embeds is the one CI
builds with (22.x), and `wellsure-agent.exe version` prints both versions. It is
not code-signed (no certificate exists); INSTALL.md says what Windows may say
about that and what to do.

**The release.** A zip built by CI (and attached to the CI run as an artifact,
named for the agent version): `wellsure-agent.exe`, `nssm.exe`, `install.ps1`,
`upgrade.ps1`, `uninstall.ps1`, `set-key.ps1`, `config.example.json`,
`INSTALL.md`, `VERSION.txt`, and `SHA256SUMS.txt` of the lot. NSSM 2.24 is
downloaded in CI and its zip checked against a pinned SHA-256 before use; it is
never committed, and the downloaded zip is cached by hash so a flaky
nssm.cc can't break a rerun.

**Layout on the PC.**
- `C:\Program Files\Wellsure Agent\` : the executable and `nssm.exe`. Anyone
  can read, only administrators can change.
- `C:\ProgramData\Wellsure Agent\` : `config.json` (no secrets), `state.json`,
  `outbox\`, `outbox-rejected\`, `agent.lock`, `logs\`. Inheritance removed:
  administrators, SYSTEM and the service account only. It holds punch data.

**The account and its secrets (D-F4).** `install.ps1` creates the local account
`WellsureAgentSvc` (random 24-character password, never shown or stored by the
script, member of Users only, may not change the password, never expires),
registers the service to run as it, and stores:
- the agent key at Credential Manager target `WellsureAgent/agent-key`;
- each device's comm key at `WellsureAgent/commkey/<serial>`.

Credential Manager belongs to a user, so the secrets have to be written *as*
that user. The script starts the agent's own `secrets set` as the service
account (`Start-Process -Credential -LoadUserProfile`), handing the value over
in a temporary file that only that account and the administrators can read and
that is deleted straight after, never on a command line. The agent reads
Credential Manager through Windows PowerShell and the system's `CredRead`
(no native module to ship), once at start and again after a 401, so a rotated
key works without a restart. Prompts hide what's typed.

**The service (NSSM).** Automatic (delayed) start, so the network is up;
restart on exit after 5 s (throttled if it keeps failing), and the Windows
service-recovery actions as a second net should NSSM itself die; stdout and
stderr to `logs\agent.log`, rotated at 10 MB, 10 kept; a stop first sends
Ctrl+C and waits up to 15 s (the agent finishes what it is sending, writes its
state and releases its lock). A fresh lock after a kill makes the restarted
agent exit with "already running" and NSSM try again, which is the
behaviour proven in F1's walkthrough.

**The Windows event log.** Source `WellsureAgent` in Application, registered
by `install.ps1`; the agent writes with `eventcreate` (nothing to install). One
entry on each change of a device's retention state (warning, error, recovered),
on the log being nearly full, on the clock drifting beyond the threshold (and
recovering), when batches are first set aside, and when the service starts and
stops. Event IDs are fixed and listed in INSTALL.md so someone can find them.

**Commands added** (all work on Linux too, so they are testable here):
- `status`: what is true right now, in sentences, read from the data folder
  and the lock: is an agent running, each device's last read, state and
  punches waiting, anything set aside. For the person at the PC over the phone.
- `secrets set agent-key|comm-key --serial <s> --from-file <f>` and
  `secrets check`: write/verify Credential Manager (on Linux it says the
  secrets come from environment variables). Values are never printed.

**The scripts** (Windows PowerShell 5.1, which every Windows 10/11 and Server
has; no PowerShell 7 features):
- `install.ps1`: must be run as administrator (checks, and says how). Asks the
  few things only the installer knows (the app's address, the agent key hidden,
  and for each device its serial, IP address and comm key if any) or takes
  them as parameters for unattended use. Safe to run again: it updates the
  configuration and secrets and leaves punches waiting in the outbox alone. It
  checks the device can be reached before starting (`diagnose --no-read`),
  warns if the PC is set to sleep, starts the service, and doesn't say "working"
  until the agent has actually reported in.
- `upgrade.ps1`: stops the service, keeps the old executable as `.previous`,
  puts the new one in, starts it, confirms the new version reported; puts the
  old one back if the new one doesn't start.
- `uninstall.ps1`: stops and removes the service and the event source. Keeps
  `C:\ProgramData\Wellsure Agent` (it may hold punches the server hasn't
  received) unless `-RemoveData`, and says how many are waiting before it does.
- `set-key.ps1`: rotating the agent key: asks for the new one (hidden), stores
  it, restarts the service.

**CI on a Windows runner** (a new job, `agent-windows`): unit tests on Windows
(catching path and lock differences); build the executable and the zip;
then, against a fake API and the fake device on the runner: install with
`install.ps1` unattended; the service is running as `WellsureAgentSvc` and a
punch from the fake device reaches the fake API; Credential Manager holds the
key (`secrets check` as that account); kill the process and see it restarted;
restart the service; stop the API, make punches, restart the API and see the
outbox drain; make the device clock drift and see the event-log entry;
`upgrade.ps1` to a rebuilt copy; `uninstall.ps1 -RemoveData` leaves no service,
account or event source. A runner can't reboot: restart on failure plus
automatic start stand in for "survives a reboot".

**INSTALL.md** is written for someone at the office who isn't a developer,
possibly on the phone with the user: before you start (what to have in hand),
the steps with what each is for, what "working" looks like (in the app and on
the PC), what to do when it isn't (a symptom list), upgrade, uninstall,
rotating the key, setting the device clock by hand, what the warnings mean,
punches the server refused, and a plain statement that the agent only ever
reads the device and cannot change, clear, pause or disrupt it.

**Rules decided while designing** (neither HR nor the spec covers them; each is
small to change):
1. **NSSM stays, but its host is the weak point.** nssm.cc is the only
   official source and is known to be unreliable, so the zip is hash-pinned and
   cached. If CI shows it unreachable, the fallback is WinSW (hosted on
   GitHub); I'd ask before switching.
2. **Credential Manager is reached through Windows PowerShell**, not a native
   module: there is nothing to build or ship for Windows, at the cost of about
   a second at start and on a 401.
3. **Secrets reach the service account through a temporary file** with a
   restricted ACL (never the command line or an environment variable of a
   long-lived process).
4. **The data folder is administrators + SYSTEM + the service account only**,
   since the outbox is punch data.
5. **Uninstall keeps the data folder by default**, because it may hold punches
   not yet sent.
6. **`install.ps1` is idempotent** and never reports success until the agent has
   reported in.
7. **No code signing** (no certificate), so INSTALL.md covers SmartScreen and
   antivirus.
8. **The agent writes start/stop and the alarm changes to the event log**, not
   only the alarms the plan named, so "what did it do last night" has an answer
   without opening a log file.
9. **`status` and `secrets` are agent commands**, so the phone call can be
   "run status and read me the second line".

**Unproven until the real PC** (to join §11.1):
- Antivirus or application-control policy on the office PC blocking or
  quarantining an unsigned executable. If it does, an exclusion for
  `C:\Program Files\Wellsure Agent` is the fix.
- The office PC's own configuration (a domain policy that blocks local account
  creation, "log on as a service" being restricted, PowerShell restricted by
  policy). `install.ps1` checks each and says which one failed.
- Survival across a real reboot and a real sleep/hibernate.
- The PC reaching the app over HTTPS from the office network (proxy, firewall).

