# Phase 2: attendance, built completely before the device

**Status: APPROVED 2026-10-08 with the user's answers to D1–D7 (§13),
HR's answers on rules and branches, the attendance cycle, and three
additions (§3.1, §7.1, §4.7). Building P2-A → P2-I in order, pausing
after each.** Progress: **P2-A and P2-B done** (see "As built" at the end).
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
    - `Zk4370Driver` over `node-zklib` or `zkteco-js`, chosen at build
      after evaluating both against a protocol-level fake (§11);
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
| **P2-F** | `biometric-agent`: the driver interface, SimulatedDriver, the Zk4370Driver (protocol-tested), the outbox and cursor, backoff, heartbeat with **clock offset and retention state**, the **retention guard**, the single-executable build, NSSM service scripts with **Credential Manager** for the key, the CI Windows-runner test, `INSTALL.md` (install, upgrade, uninstall) |
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
- **Still open from HR (D3):** grace minutes, half-day and full-day
  minimum hours, and whether any shift other than GEN exists.
- The device's real log capacity (retention), once the model is known
  (§7.1).
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
