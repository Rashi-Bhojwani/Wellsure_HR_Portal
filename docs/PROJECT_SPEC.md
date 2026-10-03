# HR Portal — Product Specification

Version 1.0 · Owner: (your name) · Target: replace greytHR module by module

---

## 1. Background

Our company has used **greytHR** for years for HR, attendance, leave and payroll. We are building our own portal that does everything greytHR does for us, with one major improvement: **real-time data**.

Today, attendance from our biometric punching machine only reaches greytHR when HR clicks a "view/sync" button, usually at month end. Employees cannot see their attendance daily. In the new portal, every punch must appear on the employee's screen within seconds, and so must leave approvals, kudos, joinings, birthdays, anniversaries and announcements.

**Company facts**
- ~150–500 employees (confirm), across multiple **branches in multiple cities** — this is not a small fixed list. HR creates and manages branches themselves (e.g. 3 separate branches in Ajmer alone, historically all just called "Ajmer"), and more are added over time. See §7.8/§11 for the City → Location (branch) model this implies. Seed data (docs/PROGRESS.md) uses placeholder branch names — C-10 Panchsheel, SPN-Panchsheel and B-22 Panchsheel from greytHR, plus 3 Ajmer branches — pending HR's confirmed list and city assignment.
- One or more biometric punching machines (ZKTeco / eSSL family expected — confirm model).
- Default shift: **General (GEN) 10:00–19:00**.
- Leave year: **January–December**.
- Currency INR, timezone Asia/Kolkata, Indian statutory compliance (PF, ESI, PT, LWF, TDS).

**Migration strategy:** greytHR keeps running in parallel. We go live with attendance + leave first; payroll runs in parallel for at least 2–3 months before greytHR is switched off.

---

## 2. Users and roles

| Role | Scope |
|---|---|
| `EMPLOYEE` | Own data only |
| `MANAGER` | Own + direct and indirect reports; approves leave and regularizations |
| `HR_EXECUTIVE` | All employees; **no** salary or bank data |
| `HR_ADMIN` | All employees incl. salary, bank; all configuration |
| `PAYROLL_ADMIN` | Payroll run, statutory, bank file |
| `APPROVER` | Second approval (checker) for payroll and bank batches |
| `SUPER_ADMIN` | Everything, incl. user/role management and unlocking finalised periods |

Permissions are granular strings (e.g. `employee.view`, `employee.salary.view`, `employee.bank.view`, `attendance.override`, `attendance.finalise`, `leave.grant`, `payroll.run`, `payroll.approve`). Roles map to permission sets. A user can hold multiple roles. Every query applies a data scope: `SELF`, `TEAM`, `ALL`.

### 2.1 The three-level hierarchy (model A, Phase 5 commit E2)

- **Admin** is the top level: the Super Admins. It is a synthetic root.
  Nobody points to it, and there is no single "boss of all managers".
- **Managers and HR Admins** sit directly under Admin. They have **no**
  reporting manager. HR Admins never have a team.
- **Everyone else** reports to exactly one **active `MANAGER` holder**.
  That includes HR Executives, Payroll Admins and Approvers. An employee
  with no valid manager (none, an inactive one, or one who lost the role)
  is **Unassigned**. HR sees Unassigned people in Manager Management and
  as a count on the Admin home.
- A reporting manager always holds `MANAGER`: never an Admin, never a
  plain employee. `MANAGER` can be combined only with `EMPLOYEE`.
- **Where the rules are enforced:**
  - the service layer (Add Employee, Change job details, Manager
    Management, role assignment);
  - the Excel import;
  - the seed assertion.
- **Leave routing:**
  - a manager's or HR Admin's own leave goes to every Super Admin;
  - HR (ALL scope + `leave.approve`) can always decide it;
  - nobody approves their own.
- **Manager Management** (Admin Tools; `manager.appoint`,
  `manager.team.assign`, `manager.permissions.manage`, held by HR_ADMIN by
  default):
  - appoints and removes managers. Removal needs an empty team and a new
    manager for the person.
  - moves people between teams as **effective-dated job history rows,
    never in-place edits**. Future dates are refused until job history
    can represent a pending change (PROGRESS.md open issue, needed before
    Phase 6).
  - edits a manager's per-person overrides.

### 2.2 What a manager can ever hold (the manager-grantable list)

A `MANAGER` holder can only ever hold these keys, all at most `TEAM` scope:
- `employee.view`
- `leave.view`
- `leave.approve`
- `leave.apply.onBehalf`
- `employee.documents.view`
- `letters.generate`
- `reports.view` (added in Phase 5 commit F; every report is computed over
  the viewer's scope. Leave liability needs `reports.liability.view` too,
  which is not on this list.)

**This overrules everyone, Super Admin included.**
- It applies to the `MANAGER` role definition, to per-manager overrides,
  and again when access is resolved, so no stale row can widen a manager.
- Bank, statutory and (later) salary data are never on the list.
- Widening the list is a code change with its own team-scope tests, never
  a checkbox.
- Every endpoint reachable with a grantable key applies TEAM scope.
  A route-inventory test classifies every API route and fails on an
  unclassified one. Each manager-reachable route has an IDOR test: an
  outsider's record is a 404.

### 2.3 Access administration rules (Phase 5 commit E1)

- **Super Admin:** permissions are computed in code (every key, ALL
  scope). They can't be edited, revoked or overridden by anyone.
- **Role definitions:** only a Super Admin changes a role's keys or scope.
- **Granting:**
  - nobody can grant a key they don't hold;
  - **meta-permissions** (power over others' access) only by a Super
    Admin, and never to a manager.
- **Per-person overrides** (GRANT/REVOKE on top of roles):
  - a Super Admin may set them on anyone but a Super Admin;
  - holders of `manager.permissions.manage` only on managers, within §2.2;
  - nobody on themselves.
- **Role assignment:**
  - admin roles are assigned by a Super Admin only;
  - `MANAGER` goes through Manager Management;
  - only an existing Super Admin can create another.
- **Lockout:** the last active Super Admin can't lose the role, be
  deactivated, suspended or separated (a scheduled separation refuses and
  alerts instead). With two or more, either may go as long as one
  remains. Recovery when every in-app route is gone is the loud
  break-glass CLI (§9).
- **Audit:** every access change is in the append-only audit log, with
  before and after.


### 2.4 Workflow delegation (Phase 5 commit E3)

A manager away for a date range can delegate their leave approvals.
- **The delegate must already hold `leave.approve`.** Delegation never
  grants a permission. It only adds the delegator's current team to the
  delegate's reach in the approval flows: the review queue, the request,
  approve/reject, the requester's balances, and Tasks. It never adds
  profiles, documents or dashboards.
- **Not transitive.** The delegator keeps their own access.
- **Self-approval stays blocked.**
- **No overlaps:** one delegator can't have overlapping non-revoked
  delegations.
- **Dates:** inclusive, starting today or later.
- **Revoke, never delete:** revoking records who and why.
- **Audit:** every decision reached through a delegation records the real
  actor **and** `on_behalf_of` (the delegator), in the audit log and on
  the request.
- **Only `MANAGER` holders delegate.** Super Admins don't need to: the two
  cover each other, and HR Admins (ALL scope) can approve any manager's
  leave. Letting a Super Admin delegate to a manager would create peer
  approval.
- **HR** (`delegation.manage`) sees everyone's delegations, sets one up for
  a manager, and revokes any.
---

## 3. Employee onboarding and login flow (exact business process)

1. The new employee is first **registered on the biometric machine**, which assigns a **device user ID** (e.g. `1042`).
2. HR opens **Add Employee** in the admin portal and enters that ID as the **Device User ID**. The **Employee Code** field defaults to the same value, pre-filled but editable — in the normal case the two stay identical, matching how HR already thinks of it ("the ID from the machine is the username"). Employee Code is the employee's permanent login username; Device User ID is the live pointer (`device_user_mappings`, one active mapping per device ID at a time) used to resolve biometric punches to an employee. They're the same value unless a collision forces them apart:
   - **Device ID reuse:** biometric machines eventually reassign a freed device user ID to a new joiner, but Employee Codes are **never reused**, even after separation. If the ID entered is already permanently held by a separated employee, HR sees a clear message — *"Employee Code 1042 was already used by \<name\>, separated on \<date\>. Employee Codes are never reused."* — and the wizard suggests the next available code by appending `-2`, `-3`, … (e.g. `1042-2` for the first reuse of `1042`). HR can accept the suggestion or type a different code. The Device User ID is still set to the raw `1042` either way, so punches from the machine keep resolving to the right (new) employee. Excel import runs the same check as a **row-level warning, not a hard failure**, so one collision doesn't stop a batch import.
3. HR completes the onboarding wizard:
   - **Official:** employee code, date of joining, department, designation, location, reporting manager, shift, employment type, official email (optional)
   - **Personal:** full name, DOB, gender, personal email (Gmail, **required**), mobile, current/permanent address, emergency contact, blood group, photo
   - **Statutory:** PAN, Aadhaar, UAN / PF number, ESI number
   - **Bank:** account holder name, account number (entered twice), IFSC (validate format, auto-fill bank/branch if possible), bank name, branch
   - **Salary:** salary structure and CTC (Phase 6; field can be empty earlier)
   - **Review → Save → Send invite**
4. The system emails the employee a **set-password link** (single-use token, stored hashed, valid 48 h). HR can resend.
5. The employee opens the link, creates a password (min 8 chars, mixed; strength meter), and is logged in.
6. Thereafter login = **Employee Code + password**. "Forgot password" sends a reset link to the personal email on file.
7. Accounts lock for 15 min after 5 failed attempts. HR/Admin/Payroll roles must enable TOTP 2FA.
8. On separation, login is disabled automatically after the last working day.
9. A rejoining employee is onboarded as a **brand-new employee record with a new Employee Code** — their previous record, job/name history and separation are never reopened or reused.

Employees can edit limited personal fields (address, emergency contact, photo); changes to bank or statutory data by an employee create a **change request** that HR approves.

---

## 4. Biometric integration and real-time attendance

### 4.1 Ingestion: three routes, one ingestion service

**Approach (user decision, 2026-10-01).** Phases 2 and 3 are built
**completely, before the physical device is connected**: ingestion, the
rules engine, shifts, week-offs, exceptions, regularization, muster, manual
entry, period finalisation, and every screen and report. All of it is
production-ready and tested against the punch simulator (§4.6).
**Connecting the real device is the final step, not the first.** It means
installing the agent on the office PC, registering the device, and
checking live data against the confirmed ATTLOG layout (§4.1). Nothing downstream of
the ingestion service changes when it happens.

**No month-end file exports as the daily process.** greytHR's current
practice (export a file from the device at month end and upload it) is
kept *only* as an emergency fallback. The daily path is automatic and
near-real-time.

Three ingestion routes, all built:

1. **Sync agent (primary route), `biometric-agent/`.** Runs on an office PC
   on the device's LAN:
   - connects to each device on **port 4370** using a ZKTeco/eSSL protocol
     library (e.g. `node-zklib` / `zkteco-js`, chosen when built);
   - **polls every 30 s** (configurable) and POSTs new punches to
     `POST /api/biometric/agent/punches` over **HTTPS with an agent API
     key**;
   - keeps a **local cursor** per device (last synced punch), so a restart
     neither re-sends everything nor loses anything;
   - **retries with exponential backoff** when the API or device is
     unreachable, and **catches up automatically after downtime**: the
     backlog is sent in order, in batches;
   - sends a **heartbeat** (`POST /api/biometric/agent/heartbeat`) every
     cycle, carrying agent version, host, per-device reachability and
     cursor position;
   - **installs as a Windows service** (install/uninstall scripts, auto-start
     on boot, restart on failure), so it survives reboots without anyone
     remembering to start it.

   The device driver sits behind an interface. The real 4370 driver and the
   simulator's driver (§4.6) are interchangeable, so the agent code that
   ships is the code that was tested.
2. **Device push (ADMS / "cloud server" mode)**, for models that support
   it:
   - the device protocol endpoints under `/iclock/*`: `cdata` GET for
     handshake/options, `cdata` POST for ATTLOG/OPERLOG uploads,
     `getrequest`, `devicecmd`;
   - devices are authenticated by serial number against the `devices`
     table; unknown serials are rejected and logged;
   - responses are in the plain-text format the device expects;
   - exposure on AWS per §15.4.
3. **Manual file upload: emergency only.** Through the Import Center with
   staging and validation like every other import: upload → parse → preview
   (new / duplicate / unmapped / invalid rows) → commit. Audit-logged. It is
   never the routine path.

**All three converge on one ingestion service.** It validates, resolves the
device and timezone, deduplicates, inserts into `raw_punches`, resolves
the employee, and enqueues recompute. The `source` column records the
route, for audit only; the rules engine never reads it, so it cannot tell
the routes apart.

**Deduplication, two layers:**
- **Exact duplicates** (same device, device user ID and timestamp) are
  dropped at ingestion by the unique key. This makes agent catch-up,
  retries, ADMS re-sends and a file that overlaps already-synced data all
  idempotent.
- **Near-duplicates** (the same person punching twice seconds apart) are
  stored raw, as they happened, and collapsed by the rules engine (§4.4,
  within 2 minutes, configurable).

**ATTLOG line format: CONFIRMED from a real export from our device**
(user-supplied sample, recorded 2026-10-01). One punch per line, six
tab-separated columns:

```
18	2021-09-01 18:30:19	1	255	1	0
44	2021-09-01 18:30:38	1	255	1	0
113	2021-09-01 19:02:25	1	255	1	0
113	2021-09-01 19:02:28	1	255	1	0
```

| # | Column | Notes |
|---|---|---|
| 1 | Device user ID | Low integers on our machine (observed **2–126**), **not** our 1000-series Employee Codes. Punches are therefore resolved **only** through `device_user_mappings` (§3, §4.3), never by matching Employee Code. |
| 2 | Timestamp | `YYYY-MM-DD HH:MM:SS`, device-local time with no zone. Interpreted in the device's configured timezone (default Asia/Kolkata). |
| 3 | Status | **Always `1` on our device. It carries no in/out direction.** |
| 4 | Verify mode | `255` in the sample. Stored as-is. |
| 5 | Workcode | `1` in the sample. Stored as-is. |
| 6 | Reserved | `0` in the sample. Stored as-is. |

Consequences:
- **Direction is inferred, never read from the device.** Raw punches are
  stored with `direction = UNKNOWN`. The rules engine (§4.4) treats the
  first punch of the employee's shift window as IN and the last as OUT.
  Intermediate punches are kept and shown (Employee Swipes, day detail)
  but don't create break time by default. Inferring break pairs from them
  is a configurable option, off by default, since nothing on the device
  says which punch was which.
- **Real duplicate punches happen:** user 113 punched twice, three seconds
  apart. Both rows are distinct raw punches (different timestamps). The
  engine's near-duplicate window (§4.4, 2 minutes) collapses them. This
  sample is a mandatory test fixture.
- **The parser stays tolerant.** It reads the six columns, tolerates extra
  trailing columns and surrounding whitespace, and records an unparseable
  line as rejected (with the line kept for HR) instead of failing the
  batch. Other firmware may send different status values, so status and
  verify mode are stored but not relied on.
- **This sample is an export from the device, so the emergency file upload
  (route 3) accepts exactly this format.** ADMS push (route 2) carries
  ATTLOG records in the same layout. The punch simulator (§4.6) produces
  exactly this format: `status` 1, verify 255, workcode 1, reserved 0, and
  low-integer device user IDs.

**Clock and ordering safeguards:**
- Punches may arrive out of order or late (catch-up), and are processed
  by `punched_at`, not arrival.
- Punches implausibly far in the future or past (device clock wrong;
  thresholds configurable) are flagged for HR rather than silently
  trusted.

### 4.2 Data layers

- **`raw_punches`** — immutable: `device_id, device_user_id, punched_at (timestamptz), direction (IN/OUT/UNKNOWN), verify_type, source (PUSH|AGENT|IMPORT|MANUAL), raw_payload, received_at`. Unique `(device_id, device_user_id, punched_at)`.
- **`daily_attendance`** — one row per employee per business date: `shift_id, first_in, last_out, total_work_mins, break_mins, actual_work_mins, work_mins_in_shift, late_in_mins, early_out_mins, shortfall_mins, excess_mins, status, first_half_status, second_half_status, lop_days, exception_flags[], is_overridden, is_locked, processed_at`.
- **`attendance_overrides`**, **`shift_overrides`**, **`regularization_requests`** — corrections that never touch raw data.
- **`devices`**, **`biometric_agents`** (API key stored hashed, last heartbeat, version, host), **`device_health_incidents`** (§4.7), and an ingestion batch record per agent post / ADMS upload / file import (counts of new, duplicate, unmapped and rejected), so volume and failures are visible per route.

### 4.3 Real-time pipeline

1. Punch arrives by any route (§4.1) → the ingestion service inserts into `raw_punches` (exact duplicates skipped).
2. Resolve `device_user_id` → employee **via `device_user_mappings` only**, as active on the punch date. Our device's IDs (2–126) are not Employee Codes (§4.1), so matching on `employees.employee_code` would mis-map punches. If unresolved, the punch is recorded in the unmapped list for HR.
3. Enqueue BullMQ job `attendance.recompute { employeeId, date }` (debounced/deduplicated per employee-date).
4. Worker recomputes that day, saves, and emits Socket.IO events:
   - `attendance.updated` → room `user:{id}` and `manager:{managerId}`
   - `whoisin.updated` → room `role:hr`
5. **Nightly cron (02:00 IST)** recomputes the previous day for everyone; flags absentees and exceptions.
6. Manual "Process Attendance" for any date range (job with progress reporting).

### 4.4 Attendance rules engine

Evaluate in this order for each employee and date:

1. Employee not active on that date (before DOJ / after LWD) → no record.
2. Holiday (company-wide — see §11's note on branch scoping) → `H` (if punches exist → eligible for comp-off).
3. Week-off per employee's week-off pattern → `O` (if punches exist → eligible for comp-off).
4. Approved leave → leave code; half-day leave combines with worked half.
5. Manual override → apply override status.
6. Otherwise compute from punches:
   - Shift = shift override for that date, else roster assignment, else employee default shift.
   - Pair punches within the shift window (shift start − 4 h to shift end + 6 h, configurable). **Night shifts crossing midnight** belong to the shift's start date.
   - Ignore duplicate punches within 2 minutes.
   - First punch = first in, last punch = last out (our device sends no direction, §4.1). Break time from OUT→IN gaps only when a punch carries a real direction, or the optional inferred-pairing setting is on (off by default).
   - Late-in = first_in − (shift start + grace). Early-out = (shift end − grace) − last_out.
   - Full day if actual hours ≥ `full_day_min_hours`; half day if ≥ `half_day_min_hours`; else absent.
   - **Half-day minimum not met → 1 day LOP** (current greytHR rule; configurable).
   - Single punch only → exception `MISSING_PUNCH`, status `A` until regularized.
   - Late-coming penalty rules (e.g. N lates per month = half-day LOP) — configurable, off by default.
7. Save exception flags: `MISSING_PUNCH, SHORTFALL, LATE_IN, EARLY_OUT, HALF_DAY_MIN_NOT_MET, NO_SHIFT, UNMAPPED`.

Status codes: `P` present, `A` absent, `HD` half day, `H` holiday, `O` week-off, `L:<code>` leave (e.g. `PL`, `WFH`), `LOP`, and split days like `A:P` (first half absent, second present) as greytHR shows.

### 4.5 Period finalisation

HR finalises a payroll month's attendance. Finalised days are locked (`is_locked = true`); recompute, overrides and regularizations are blocked. Unlock requires `SUPER_ADMIN`, a reason, and is audit-logged. Payroll only reads finalised attendance.

### 4.6 Punch simulator (first-class development tool)

A maintained tool, not a throwaway script, because it's how Phases 2–3
are built and verified before the device exists. It must:
- **Generate realistic punch streams in exactly the confirmed ATTLOG format
  of §4.1** (six tab-separated columns, status always `1`, verify `255`,
  workcode `1`, reserved `0`, low-integer device user IDs, no direction), for
  real (seeded or staging) employees, using their actual shifts,
  week-offs, holidays and leave, so the engine's output can be checked
  against what was intended.
- **Cover the hard cases**, each as a named scenario:
  - normal days, late arrivals, early exits, and break OUT/IN pairs;
  - missing punches (single punch, no OUT), and duplicates seconds apart;
  - people who never punch at all (the absent / manual-entry branches);
  - work on holidays and week-offs (comp-off eligibility), and night
    shifts crossing midnight;
  - unmapped device user IDs, and out-of-order or late (catch-up)
    delivery;
  - a device with a wrong clock;
  - a device or agent going silent, to exercise the health alerts in
    §4.7.
- **Two modes:**
  - **Replay:** a whole month for 500 employees (load test of ingestion and
    the engine, with throughput and recompute time reported).
  - **Live drip:** single punches in real time, so a screen can be watched
    updating (§8).
- **Feed through exactly the ingestion routes the real device will use.**
  It does this as an ADMS device posting to `/iclock/*`, as the real
  `biometric-agent` running with a simulated device driver, or as an
  emergency upload file. It never writes to the database directly, so
  when the machine arrives nothing downstream changes.
- **Be deterministic** (seedable), so a scenario reproduces exactly in
  tests and CI.
- **Never touch production.** It refuses to run when the target is
  production, and simulated devices can't be registered there.

### 4.7 Device and agent health monitoring

If a machine stops sending, **HR must find out that morning, not at month
end.** Built in Phase 2, in the application itself. Phase 5.5's
CloudWatch alarm is an additional infrastructure-level safety net, not
the only one.
- **Last seen, per device and per agent:** devices record last heartbeat
  and last punch received; agents record last heartbeat, version, host and
  per-device reachability.
- **Alerts** (in-app notification plus email to HR/admin roles, once per
  incident, with a recovery notice):
  - no punches from a device for N minutes during working hours (default
    30, configurable; working hours, working days and company holidays
    respected, so there are no alerts on Sundays or holidays);
  - an agent heartbeat missed for N minutes (configurable);
  - a **morning check** at a configurable time: any device that normally
    receives punches but has none today.
- **Admin Devices screen** (§7.3): device and agent status at a glance;
  **unmapped punches** with "map to employee"; recent ingestion volume per
  device and per route (hourly/daily); and incident history.


---

## 5. Leave management

### 5.1 Leave types (seed)

| Code | Name | Notes |
|---|---|---|
| `PL` | Privilege / Earned Leave | The accruing leave (rules below) |
| `LOP` | Loss of Pay | Unpaid; no balance limit |
| `COF` | Comp-Off | Credited when employee works on holiday/week-off (min hours configurable); expires after 60 days (configurable) |
| `WFH` | Work From Home | Counts as present; granted balance configurable |
| `RH` | Restricted Holiday | Choose from RH list; yearly quota configurable |

### 5.2 Our company's PL policy (must be exact)

- **Accrual:** 1.0 day credited **every month**.
- **Eligibility:** accrual starts only after the employee completes **3 months** from date of joining. Make the exact rule configurable: `ACCRUE_FROM_NEXT_MONTH_AFTER_ELIGIBILITY` (default) vs `PRORATE`.
- **Carry forward:** unused balance rolls over month to month with no cap (cap configurable).
- **Year-end (31 Dec):** remaining PL balance is **encashed** — paid as money in the next payroll — and the balance resets for the new year. Encashment per-day rate formula is configurable (default: monthly Basic ÷ 30) and must be confirmed by our CA.
- Negative balance not allowed by default (configurable).
- Half-day leave allowed.

### 5.3 Leave ledger

Balances are never stored as a mutable number. Table `leave_ledger`: `employee_id, leave_type_id, leave_year, entry_date, entry_type (OPENING|ACCRUAL|CONSUMED|REVERSAL|GRANT|DEBIT|CARRY_FORWARD|ENCASHMENT|LAPSE|EXPIRY), days (±Decimal(5,2)), reference_type, reference_id, remarks, created_by`. Balance = sum of entries. Provide a materialised/cached balance for speed but always recomputable.

### 5.4 Flows and screens

- **Apply leave** (employee): type, from/to, half-day options, reason, attachment; live balance check; shows team members already on leave those days.
- **Approve/reject** (manager, HR can override); bulk approve; comments. On approval → ledger `CONSUMED` → recompute attendance for those dates → notify employee in real time + email. Cancelling approved leave → `REVERSAL`.
- **Leave Calendar** (team/org), **Holiday Calendar** (company-wide — see §11's note on branch scoping), **Leave Balances** (employee view, cards per type with granted/consumed/balance, downloadable).
- **Admin — Employee Leave:** all requests, filters, apply on behalf.
- **Admin — Leave Granter:** bulk grant/debit with remarks, Excel upload.
- **Admin — Leave Recalculator:** replay accruals for selected employees/date range after a policy change or backdated joining.
- **Admin — Year End Process:** preview (per-employee closing balance, encashment days, amount) → approve → commit (creates `ENCASHMENT` entries, pushes earnings to next payroll, opens new year). Downloadable report. Re-runnable safely.
- **Admin — Leave Overview dashboard:** leaves taken by type for a selected month (donut), total leaves by month (bar), employees on leave per RH.

### 5.5 Scheduled jobs

- 1st of month 00:30 IST: monthly PL accrual (idempotent per employee-month).
- Daily: comp-off expiry.
- 31 Dec: reminder to HR to run Year End Process (the process itself is manual with preview).

---

## 6. Employee portal (ESS) — screens

Match the greytHR layout employees already know: left sidebar, header with Quick Links, notifications bell, logout.

- **Home:** greeting + quote, Review (pending approvals if manager), Upcoming Holidays, Payslip widget (latest month, paid days, gross/deduction/net masked until "Show Salary"), Quick Access (reimbursement payslip, IT statement, YTD, loan statement), IT Declaration & POI status, Track (my pending requests).
- **Engage:** feed of posts, kudos, polls, auto-posts for joinings, birthdays, work anniversaries; filters (activity type, groups, location, department); reactions and comments; Give Kudos, Create Poll. **Real-time.**
- **My Worklife:** Kudos received, Feedback.
- **To do:** Tasks, Review (approvals).
- **Salary:** Payslips (month picker, earnings/deductions, net in words, PDF download), Reimbursement payslip, YTD Reports, IT Statement, IT Declaration, Loans & Advances, Reimbursement claims, Proof of Investment, Salary Revision history. *(Phase 6+; show "coming soon" earlier.)*
- **Leave:** Apply, Balances, Leave Calendar, Holiday Calendar.
- **Attendance → Attendance Info:** month calendar with status per day and shift code; stats cards (avg work hrs, avg actual work hrs, penalty days, insights); exception-day banner with **Regularize**; day detail panel (shift, first in, last out, late in, early out, total/break/actual hrs, shortfall, excess, status details, session details); list/grid toggle; **My Regularizations**. **Real-time.**
- **Document Center:** company policies, forms, my letters, payslips, Form 16.
- **People:** employee directory (name, photo, designation, department, location, contact per privacy settings), org chart.
- **Helpdesk:** raise ticket to HR by category, track status, chat-style replies.
- **Request Hub:** all my requests (leave, regularization, profile change, reimbursement) in one place.
- **Workflow Delegates:** manager delegates approvals to someone while away (date range).
- **Profile (View My Info):** all personal, official, statutory (masked), bank (masked) details; request changes.

---

## 7. HR / Admin portal — screens

Top bar with **app switcher**, **Payroll Month selector** (global context sent with every request), employee filter (All / location / department), search, settings, logout.

### 7.1 Homepage
- **Welcome:** My Favourites (configurable shortcut tiles, e.g. Add Employee), My Tasks split into *Things to review* (I am approver) and *Things to monitor* (pending with others) with counts by type (attendance regularization, leave, profile changes…) and a Monitor link; Latest Updates (internal announcements).
- **Dashboard:** editable widget grid — Years in Service distribution, Additions & Attrition (joined vs resigned, last 12 months), Employee Count by Location, Age Distribution, Gender split, Department headcount, **Today's attendance (live)**. Cached in Redis.

### 7.2 Employee app
- **All Employees master grid** — the single place to see everyone: code, name, photo, department, designation, location, manager, DOJ, status, shift, mobile, email, CTC/gross/net, PF/ESI flags, bank (masked), leave balance, today's status. Search, filters, column chooser, saved views, pagination, Excel/CSV export (export of salary/bank requires permission and is audit-logged).
- Add Employee wizard (§3), employee profile with tabs (Official, Personal, Statutory, Bank, Salary & Revisions, Documents, Leave, Attendance, Assets, History/audit), resend invite, reset password, deactivate.
- Bulk import (see §10), profile change-request approvals, separation/exit with checklist and last working day, letter generation from templates (offer, appointment, experience, relieving, address proof) to PDF.

### 7.3 Workforce Management — Attendance
- **Who Is In?** live board (present, in-time, late, not yet in, on leave, week-off) filterable by location/department — real-time via sockets.
- **Shift Roster** — define and assign shifts and rotation patterns in bulk.
- **Employee Swipes** — raw punch viewer with filters and export.
- **Attendance Muster** — month grid, employees × days, status codes, totals (P, A, HD, LOP, leaves, holidays, week-offs, paid days), Excel export.
- **Attendance Info** — any employee's calendar and day detail.
- **Process Attendance** — recompute for date range / employees, background job with progress.
- **Attendance Period Finalisation** — lock/unlock per payroll month.
- **Attendance Exception** — list of exception days with bulk resolve.
- **Manual Override** — set a day's status with reason (audited).
- **Shift Override** — change shift for specific dates.
- **Regularization queue** — approve/reject, bulk, comments.
- **Devices** — registered biometric devices and sync agents, status at a glance (online / silent / offline), last heartbeat, last punch received, unmapped punches with "map to employee", recent ingestion volume per device and route, health incident history (§4.7). Each device maps to exactly one branch (`location_id` on `devices` — see §11's note); that mapping is the *only* thing that varies by branch in the attendance pipeline — which device a punch arrived from tells the rules engine which employees' punches it's looking at, nothing about the rules themselves changes per branch.

### 7.4 Workforce Management — Leave
Leave Overview dashboard, Leave Calendar, Employee Leave, Leave Granter, Year End Process, Leave Recalculator, leave type and policy configuration, one company-wide holiday and RH list (see §11's note on branch scoping — HR confirmed 2026-09-28 that holidays, leave policies, shifts, week-off patterns and attendance rules are identical for every branch).

### 7.5 Payroll app (Phase 6+)
Salary components (earning/deduction, taxable, PF/ESI applicability), salary structure templates with formulas (e.g. Basic = 40% of CTC), employee salary assignment and revisions (effective-dated, arrears), **Payroll Run** for the selected month (reads finalised attendance: paid days, LOP; leave encashment; arrears; reimbursements; loan EMIs), variance report vs previous month, **maker-checker approval**, publish payslips (PDF + real-time notification), statutory outputs (PF ECR file, ESI, PT, LWF, TDS), IT declaration and proof-of-investment review, Form 16 / quarterly TDS return data, loans & advances, reimbursements, full & final settlement.

**Salary disbursement:** after checker approval, generate the **bank bulk-transfer file** in our bank's exact format (configurable template: CSV/XLSX/fixed-width) + summary PDF. HR uploads it to corporate net banking where the authorised signatory releases payment. HR then marks the batch paid or imports the bank response. Every step audited. **No direct money transfer from the app.**

### 7.6 Reports
Headcount, joiners, leavers/attrition, birthdays & anniversaries, attendance muster, late-coming, overtime, exceptions, leave balance & leave liability, LOP, salary register, PF/ESI/PT, bank statement, exit report. Plus a **custom report builder** (choose fields, filters, grouping; save; export; schedule by email).

**Built in Phase 5 commit F:**
- headcount (as of a date);
- joiners;
- leavers and attrition (leavers ÷ average of opening and closing
  headcount);
- birthdays and anniversaries (day and month only);
- leave balance (as of a date);
- leave liability;
- LOP (leave LOP only).

Each report:
- is gated by `reports.view` and scope-filtered (a manager sees their
  team);
- has a list view and an Excel export through `lib/xlsx.ts`, with each
  export audited.

Leave liability also needs `reports.liability.view` (HR_ADMIN and
PAYROLL_ADMIN) because it becomes salary-derived in Phase 6. The UI
flags its rate as provisional until the CA confirms it.

The attendance reports come with Phase 3, the salary and statutory
reports with Phase 6, and the custom builder with Phase 8.

### 7.7 Engage admin
Post announcements (org / location / department), moderate posts, manage groups, configure auto-posts (joining, birthday, anniversary templates and time).

### 7.8 Admin Tools
Organisation setup (company, **cities** and **locations/branches** — two levels only, city → branch, with create/edit/merge-near-duplicates on both and deactivate (not delete) on a closed branch so its history stays intact — departments, designations, grades, cost centres), holiday calendars, shift master, week-off patterns, leave types & policies, approval workflows (multi-level chains), workflow delegates, users/roles/permissions, email & letter templates, devices, data import/export, **audit log viewer**, system settings.

**Holiday calendars, shift master, week-off patterns, leave types & policies, and attendance rules are all company-wide** (HR-confirmed 2026-09-28), not per-branch — one holiday list, one set of leave policies, one set of shifts and week-off patterns for the whole company, regardless of how many branches exist or where an employee is posted. A branch (`Location`) stays a real, first-class concept — employees still belong to one, grids/dashboards/reports still filter and group by branch and city, `EmployeeJobHistory` is unchanged — but it is purely an *organisational and reporting* attribute plus, from Phase 2, a *biometric-device* attribute: each device (`devices.location_id`) maps to the one branch its punches come from, so the rules engine knows whose punches it's looking at. That device-to-branch mapping is the only place "branch" enters the attendance/leave rule pipeline; none of the rules themselves vary by which branch an employee is at. Adding a branch is a data change in Organisation Setup, never a code change, same as before — it's just that holidays/shifts/week-offs/policies are no longer part of what a new branch needs configured.

If the company ever does need a genuinely branch-specific holiday (a local festival observed at one branch only), reintroducing that is a small, additive change: add an optional `locationId` back onto `Holiday` (nullable — `null` = company-wide, a value = that branch only), union company-wide with branch-specific rows wherever holidays are read, and add a branch picker to the admin screen. Nothing about this simplification (dropping the column now, one company-wide list) makes that harder later — it's a door left ajar, not closed.

---

## 8. Real-time layer

Socket.IO with Redis adapter. Authenticate the socket handshake with the access token. Rooms: `user:{id}`, `manager:{id}`, `dept:{id}`, `location:{id}`, `role:{role}`, `org`.

| Event | Rooms |
|---|---|
| `attendance.updated` | user, manager |
| `whoisin.updated` | role:HR_* |
| `leave.applied` / `leave.decided` | approver / applicant |
| `regularization.submitted` / `.decided` | approver / applicant |
| `tasks.counts` | affected approvers |
| `engage.post`, `engage.kudos`, `engage.reaction` | org (or scoped) |
| `engage.birthday`, `engage.joining`, `engage.anniversary` | org (daily 08:00 cron + on joining) |
| `payslip.published` | each employee |
| `notification.new` | target user |

Every notification is also persisted in `notifications` (bell icon, read/unread) and optionally emailed. Frontend uses socket events to invalidate TanStack Query caches.

---

## 9. Security and compliance

- HTTPS only; helmet; strict CORS; rate limiting (login, forgot-password, public endpoints); CSRF protection for cookie-based refresh.
- argon2id password hashing; token hashes for invites and resets; refresh-token rotation with reuse detection.
- AES-256-GCM encryption for bank account, PAN, Aadhaar, UAN; key via env/KMS; masked by default. Each encrypted field also stores a plaintext last-4 column (masked display without decrypting) and an HMAC-SHA256 blind-index column keyed by a pepper separate from the encryption key (exact-match duplicate detection and search) — grids and imports use these, never live decryption. A dedicated, permission-gated reveal endpoint is the only path that decrypts, and every call is audit-logged.
- Authorization on every route + data-scope filter; automated IDOR tests.
- Audit log (actor, action, entity, entity_id, before, after, ip, user agent, timestamp) — append-only, written only through one shared service function that redacts sensitive values (PAN/Aadhaar/account numbers → last 4) out of `before`/`after` before the write, so no call site can forget to. `profile_change_requests.changes_json` goes through the same redaction helper.
  - **Append-only is enforced by the database** (since Phase 5 commit E1.1; before that it was only a convention). Triggers refuse every UPDATE, DELETE and TRUNCATE on `audit_logs`. The one exception lets the test suite remove its own fixture rows, and only in a database the development seed has marked; staging and production are never seeded, so they have no exception. The actor column is deliberately not a foreign key, so nothing that happens to a user can alter an audit row. Phase 1.5 adds a second layer: the application's database role gets no UPDATE/DELETE grant on `audit_logs` at all.
- **Break-glass access and its honest limit.** The break-glass tools (`admin:recover`, `admin:bootstrap`, run from a server shell; see GETTING_STARTED.md §12) are deliberately loud:
  - before anything changes, every active Super Admin and an optional outside address are emailed;
  - a log line is written outside the database;
  - a security banner stays in the app until a Super Admin *other than the person concerned* acknowledges it.

  **They are not a guarantee against a malicious operator.** Anyone who can run them has a shell on a backend container and the database credentials. They can skip the tools entirely, use SQL directly, or drop a trigger, and nothing inside the application can prevent that. The controls that can't be undone from inside are the records kept **outside the database**: the CloudWatch log line (alarmed on), the ECS Exec session log, CloudTrail's record of which AWS identity opened the shell, and the alert email already delivered to the owners. That is why Phase 1.5 must wire up and alarm on the `security.breakglass` log event, and why server shell access must stay limited to the owners.
- File uploads: type and size validation, private storage, signed URLs with short expiry.
- Daily automated Postgres backups (documented restore procedure).
- India **DPDP Act 2023**: privacy notice acknowledgement on first login, purpose limitation, data retention policy for ex-employees (configurable), export of an employee's own data, breach logging.

---

## 10. Data migration from greytHR

Build an **Import Center** (Admin Tools) with downloadable Excel templates:
1. Organisation masters (locations, departments, designations)
2. Employee master (official + personal)
3. Statutory details
4. Bank details
5. Opening leave balances as of cutoff date (become `OPENING` ledger entries)
6. Historical attendance / punches (optional, 6–12 months)
7. Salary structures and YTD figures (Phase 6)

Every import: upload → parse into staging table → validate (duplicates, missing required fields, PAN/IFSC/email/mobile formats, unknown department/location/manager, device ID collisions) → show row-level error report downloadable as Excel → HR fixes and re-uploads → commit in one transaction → summary. Provide a **reconciliation report** (headcount by location, leave balance totals) to compare with greytHR before sending invites. Invitations are sent in batches, HR-triggered, never automatically on import.

---

## 11. Core data model (starting point — refine in Prisma)

**Identity & org:** `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `refresh_tokens`, `invitation_tokens`, `password_reset_tokens` (looked up by Employee Code, not personal email — personal email is not unique, see Employees below and §3), `audit_logs` (redacted before write, see §9), `system_settings`, `company`, `cities`, `locations` (branches — a growing, HR-managed list, not a small fixed set; two levels only, city → branch: an optional `city_id` on `locations` for reporting/grouping, independent of `locations`' own free-text address fields which are unchanged; `is_active` instead of delete, since a closed branch keeps historical employees/attendance attached; merge for near-duplicates on both `cities` and `locations`), `departments`, `designations`, `grades`, `cost_centres`. **Branch scoping, precisely (HR-confirmed 2026-09-28):** holidays, leave types/policies, shifts and week-off patterns are company-wide — none of them reference `locations` at all. The *only* table that references `locations` for a branch-varying reason is `devices` (Phase 2): each device maps to exactly one branch, since that's how the system knows which branch's punches it's looking at — a real difference between branches, unlike holidays/shifts/policies, which were never actually different per branch. `employee_job_history` still references `locations` too, but as an organisational/reporting attribute (which branch an employee belongs to), not a rule-scoping one.
**Employees:** `employees` (Employee Code, permanent and never reused; Device User ID lives in `device_user_mappings`, not here — see §3), `employee_personal` (personal email intentionally **not** unique — a shared family email or a rejoin would otherwise collide), `employee_name_history` (effective-dated full name, so a past payslip or letter still shows the name as of its own date after a later name change), `employee_statutory` (encrypted + last-4 + blind-index hash), `employee_bank_accounts` (encrypted + last-4 + blind-index hash, effective-dated), `employee_job_history` (effective-dated dept/designation/location/manager/grade/cost centre), `employee_documents`, `profile_change_requests` (`changes_json` redacted, see §9), `separations` (a rejoin is a new `employees` row, never a reopened one)
**Attendance:** `device_user_mappings` (**built in Phase 1**, as groundwork for the Employee Code / Device User ID split — see §3; the rest of this bucket is still Phase 2), `devices` (**maps to exactly one branch** via `location_id` — this is the one and only place "branch" affects the attendance pipeline; the rules engine itself, `shifts`, and `week_off_patterns` are company-wide, see §11's note above), `raw_punches`, `unmapped_punches`, `shifts`, `week_off_patterns`, `shift_assignments`, `shift_overrides`, `daily_attendance`, `attendance_overrides`, `regularization_requests`, `attendance_periods` (lock state)
**Leave:** `leave_types`, `leave_policies` (both company-wide, no location scoping), `leave_ledger`, `leave_requests`, `holidays`, `restricted_holidays` (both company-wide, one list for the whole company — no `location_id`, see §11's note above), `comp_off_credits`, `year_end_runs`
**Engage & workflow:** `posts`, `kudos`, `polls`, `poll_options`, `poll_votes`, `reactions`, `comments`, `groups`, `notifications`, `approval_workflows`, `approval_steps`, `approval_instances`, `workflow_delegates`, `helpdesk_tickets`, `helpdesk_messages`, `announcements`, `user_favourites`, `dashboard_layouts`
**Payroll (Phase 6):** `salary_components`, `salary_structures`, `employee_salaries`, `payroll_runs`, `payroll_run_items`, `payslips`, `payslip_lines`, `bank_transfer_batches`, `bank_file_templates`, `tax_declarations`, `tax_proofs`, `loans`, `loan_emis`, `reimbursement_claims`, `statutory_settings`

---

## 12. Delivery phases

Build strictly in this order. At the end of each phase: tests green, migrations applied, seed updated, `docs/PROGRESS.md` updated, committed.

**Phase 0 — Foundation**
Plain folder structure (`backend/`, `frontend/`, `biometric-agent/`, `shared/`, `infra/`), each an independent npm project with its own `package.json`/`package-lock.json`, TS configs, ESLint/Prettier, PostgreSQL 16 and Redis 7 installed and run locally (no Docker for local dev — see README.md "Local setup"; a local-filesystem storage adapter and a console/`.eml` mail transport stand in for S3/SES, see §15.3), `.env.example`, Express app skeleton (helmet, cors, pino, error handler, Zod validation middleware, `/health` + `/ready`, graceful SIGTERM shutdown), config module that loads and validates all env vars with Zod, Prisma setup, React + Vite + AntD shell with routing and theming, `shared/` wired up via the `@shared/*` path alias, Vitest in both `backend/` and `frontend/`, **production multi-stage Dockerfile for `backend/`** (non-root user, includes Chromium for Puppeteer, built from the repo root so `shared/` is included) with one entrypoint that can start as `api`, `worker`, `scheduler` or `migrate` via an env var/argument, empty `infra/` CDK app, GitHub Actions CI (lint, typecheck, test, docker build), README.
✅ Done when `npm run dev` runs both `backend/` and `frontend/`, the Docker image builds and starts in all four modes locally, and CI passes.

**Phase 1 — Auth, RBAC, org, employees**
Users, roles, permissions, login (employee code + password), refresh rotation, logout, invite/set-password, forgot/reset password, lockout, TOTP 2FA for admin roles, audit log, encryption helper (with last-4 + blind-index columns for masked grids and duplicate detection without decrypting). Org masters. Employee CRUD, Add Employee wizard (Employee Code vs Device User ID and the reuse convention — see §3), profile tabs, effective-dated job history/bank accounts/name history, `device_user_mappings` groundwork for Phase 2, All Employees grid with filters/export, Excel import with staging & validation. Employee "View My Info". Seed: company, locations, departments, roles, a super admin, 20 demo employees.
✅ Done when HR can create an employee, the employee receives the email as a `.eml` file in `.mail/` (local dev) or a real inbox (staging, via SES), sets a password, and logs in; and IDOR tests pass.

**Phase 1.5 — AWS staging environment**
Implement the CDK stacks in §15 for `staging`: VPC, RDS, ElastiCache, S3 buckets, CloudFront, ECR, ECS cluster with api/worker/scheduler services, ALB, ACM, Route 53 records, Secrets Manager, KMS, SES domain identity, CloudWatch log groups and alarms, WAF, GitHub OIDC deploy role. Add the GitHub Actions deploy workflow (build → push to ECR → run migrate task → roll ECS services → upload web build to S3 → CloudFront invalidation). Write `docs/DEPLOYMENT.md` (first-time bootstrap, DNS, SES verification, how to deploy, how to roll back, how to restore a DB backup).

Security wiring required in Phase 1.5 (Phase 5 commit E1.1, §9 "Break-glass access"):
- a CloudWatch metric filter on the `security.breakglass` log event (and `security.breakglass.aborted` / `.alert_undelivered`), with an alarm that emails the owners via SNS;
- ECS Exec enabled only for the owners' IAM identities, with session logging to CloudWatch Logs or S3 and CloudTrail covering `ExecuteCommand`;
- separate database roles: the app role has no UPDATE/DELETE/TRUNCATE on `audit_logs` or `security_events`, and only the migrate role owns tables;
- RDS log export (or pgaudit) covering writes to `users` and `audit_logs`, the only trail for the direct-SQL last resort;
- `SECURITY_ALERT_EMAIL` set to an inbox outside this system.
✅ Done when a merge to `main` automatically deploys to `staging.<domain>`, an invite email is delivered via SES, and file uploads land in S3.
From here on, every phase is verified on staging, not only locally.

**Phase 2 — Biometric ingestion + attendance engine + real-time**
**Built completely without the physical device (user decision, 2026-10-01; plan in `docs/plans/PHASE_2.md`).**
- Ingestion:
  - devices and agents, and one ingestion service fed by all three routes
    (§4.1): the `biometric-agent/` sync agent (primary, Windows service),
    `/iclock` ADMS push, and the emergency file upload via the Import
    Center;
  - raw punches, two-layer dedupe, mapping, the unmapped queue.
- Attendance:
  - shifts, week-offs, rosters;
  - the rules engine (§4.4) with thorough unit tests (night shift, missing
    punch, half-day min, grace, holiday work);
  - BullMQ recompute jobs and the nightly cron.
- Real-time and screens:
  - Socket.IO with the Redis adapter;
  - the Who Is In? live board;
  - the employee Attendance Info calendar and day detail.
- **The punch simulator (§4.6)** as a first-class tool.
- **Device and agent health monitoring (§4.7)** with alerts and the
  Devices screen.

✅ Done when:
- a simulated punch, through each of the three routes, shows on the
  employee's calendar and HR's Who Is In? within 5 seconds;
- a full simulated month for 500 employees ingests and recomputes
  correctly;
- a silenced simulated device raises an HR alert during working hours.

**The real device connection is the last step of Phase 3**, not the first
of Phase 2. It means:
- installing the agent as a Windows service on the office PC;
- registering the device;
- checking live punches against the confirmed ATTLOG layout (§4.1);
- a short parallel check against greytHR.

**Phase 3 — Attendance administration**
Built completely and production-ready before the device is connected (all verified with the simulator):
- Employee Swipes;
- Attendance Muster;
- Process Attendance (with progress);
- Exceptions;
- Manual Override, including manual entry for people who never punch;
- Shift Override;
- Regularization (employee request, approval queue, bulk);
- Period Finalisation (lock/unlock);
- attendance stats cards and insights;
- every report and export.

**Final step: connect the real device** (see Phase 2), after which
attendance is ready for go-live alongside leave.

**Phase 4 — Leave**
Leave types/policies, ledger, monthly accrual job with our PL rules (§5.2), apply/approve/cancel, balances, leave calendar, holiday & RH calendars, comp-off credit/expiry, Leave Granter, Leave Recalculator, Year End Process (preview → commit), Leave Overview dashboard, attendance integration. Unit tests for accrual eligibility, carry-forward and encashment.

**Phase 5 — Homepage, dashboards, engage, notifications, documents, helpdesk, reports**
Employee Home widgets, Admin Welcome (favourites, my tasks), Admin Dashboard widgets, notifications center, Engage (posts, kudos, polls, reactions, auto birthday/joining/anniversary posts), Document Center, People directory + org chart, Helpdesk, Request Hub, Workflow Delegates, core reports + exports, PWA install.
➡ **Go-live for attendance + leave** after UAT and data migration.

**Phase 5.5 — AWS production environment and go-live hardening**
Production CDK stack (Multi-AZ RDS, deletion protection, longer backup retention, larger task sizes, ECS auto-scaling), production deploy workflow on git tag with manual approval, WAF rules tuned, CloudWatch dashboards and alarms (5xx rate, latency, CPU/memory, RDS storage/connections, queue backlog, **no punches received from a device for 30 minutes during working hours**), AWS Backup plan, restore drill documented and performed once, load test with 500 concurrent simulated users and punch bursts at 10:00, security checklist review.
✅ Done when production is live on the real domain, a restore drill has succeeded, and alarms reach the admin email.

**Phase 6 — Payroll (parallel run with greytHR)**
Components, structures, employee salaries, payroll run, LOP from finalised attendance, leave encashment, arrears, payslips (PDF), variance report, maker-checker, bank transfer file, PF/ESI/PT/LWF outputs, salary register.
**Revisit offer letters here:** until Phase 6, the offer letter (Phase 5 commit D2) is generated against the employee record created at joining, with HR typing figures such as CTC at generation time. Once salary structures exist, those figures should be pulled from the employee's salary assignment rather than typed (user decision, 2026-10-01).

**Phase 7 — Tax & benefits**
IT declarations (old/new regime), proof of investment, TDS projection, IT statement, YTD, Form 16 data, loans & advances, reimbursements, full & final settlement, salary revision letters.

**Phase 8 — Extras**
Assets management, performance/review cycles, custom report builder, scheduled reports, mobile app (React Native or keep PWA), multi-language.

---

## 13. Definition of done (every feature)

- Works for the correct roles and is **blocked** for others (tested).
- Validated inputs, helpful error messages, loading and empty states in UI.
- Responsive on mobile width.
- Real-time updates where §8 says so.
- Audit logging where §9 says so.
- Tests for business logic; no failing lint/typecheck.
- Documented in `docs/PROGRESS.md`.

## 14. Open questions (Claude Code: do not guess these — keep configurable and list in PROGRESS.md)

- The eSSL device **model number**, and whether it supports ADMS push. Not blocking: Phases 2–3 are built against the simulator, and the device is connected last.
- The device's **LAN IP address**, and its **admin password** (needed by the sync agent). The password is supplied at install time and stored only in the agent's local configuration or a secrets store, **never in the repo or docs**.
- Whether an **always-on office PC** exists to run the sync agent as a Windows service (and its Windows version), and how many devices there are.
- Working hours and working days for the "no punches" alert (§4.7): configurable defaults until HR confirms.
- **Employee Code vs Device User ID default (§3):** §3 pre-fills Employee Code from the Device User ID, but our device's IDs (2–126) differ from our 1000-series Employee Codes. Should Add Employee stop pre-filling, or is the 1000-series only for existing staff? Punch mapping is unaffected: it always goes through `device_user_mappings`.
- Exact PL eligibility boundary (credit on completing 3 months vs from next month) and pro-rating.
- Leave encashment formula and its tax treatment (to be confirmed by CA).
- Bank bulk-transfer file format (from bank).
- PT/LWF applicability per location's state.
- Actual headcount and full location list.
- Company domain name for the portal (e.g. `hr.company.com`) and whether DNS is on Route 53.
- Whether the office has a static public IP (needed to restrict device push traffic).
- AWS account structure (single account with two environments, or separate staging/production accounts).

---

## 15. AWS deployment architecture

### 15.1 Overview

Region **ap-south-1 (Mumbai)** for all resources that hold employee data (keeps data in India and gives low latency). CloudFront and ACM certificates for CloudFront live in `us-east-1` as AWS requires; no employee data is stored there.

```
Employees / HR (browser, PWA)
        │ HTTPS
        ▼
Route 53 ──► CloudFront (+ WAF) ──► S3 (web static build, private, OAC)
        │
        └──► api.<domain> ──► ALB (+ WAF, ACM TLS) ──► ECS Fargate: api service (REST + Socket.IO)
                                                     │
Office LAN                                           ├─► ECS Fargate: worker service (BullMQ)
  Biometric device(s) ──(push, see 15.4)──► ALB      ├─► ECS Fargate: scheduler service (1 task)
  Biometric agent PC ──HTTPS + API key────► ALB      │
                                                     ├─► RDS PostgreSQL 16 (private subnets)
                                                     ├─► ElastiCache Redis (private subnets, TLS)
                                                     ├─► S3 documents bucket (SSE-KMS)
                                                     ├─► SES (email), Secrets Manager, KMS
                                                     └─► CloudWatch Logs / Alarms → SNS email
```

### 15.2 CDK stacks (`infra/`)

Organise as separate stacks, parameterised by `-c env=staging|production`:

1. **NetworkStack** — VPC across 2 AZs; public subnets (ALB, NAT), private subnets (ECS tasks), isolated subnets (RDS, Redis). One NAT gateway in staging, two in production. VPC endpoints for S3, ECR, Secrets Manager, CloudWatch Logs to reduce NAT cost.
2. **DataStack** — RDS PostgreSQL 16 (staging: single-AZ small burstable instance; production: Multi-AZ, deletion protection, 14–30 day backup retention, Performance Insights), ElastiCache Redis (TLS, auth), S3 documents bucket (block public access, versioning, SSE-KMS, lifecycle rules), KMS keys (one for field encryption, one for S3/RDS), Secrets Manager secrets. All with `RemovalPolicy.RETAIN` in production.
3. **AppStack** — ECR repository, ECS cluster, Fargate task definitions and services:
   - `api`: min 2 tasks in production, auto-scale on CPU/request count; ALB target group with health check `/ready`; **stickiness enabled** and Socket.IO configured for websocket transport (Redis adapter handles cross-task broadcasts).
   - `worker`: 1–3 tasks, auto-scale on queue depth (custom CloudWatch metric published by the app).
   - `scheduler`: exactly 1 task, registers BullMQ repeatable jobs (monthly accrual, nightly attendance, daily engage posts, comp-off expiry). Repeatable-job registration must be idempotent.
   - `migrate`: task definition only (no service), run as a one-off task by CI before rolling the api.
   - ALB with HTTPS listener (ACM cert), HTTP→HTTPS redirect, WAF (AWS managed common rules, known bad inputs, IP rate limiting, stricter limit on `/api/auth/*`).
   - Task IAM roles with least privilege (S3 bucket prefix access, SES send, KMS encrypt/decrypt with the field key, Secrets Manager read of its own secrets, CloudWatch PutMetricData).
4. **WebStack** — private S3 bucket for the React build, CloudFront distribution with Origin Access Control, SPA fallback to `index.html`, security headers policy (CSP, HSTS), WAF, custom domain via Route 53 + ACM (us-east-1).
5. **EmailStack** — SES domain identity with DKIM, custom MAIL FROM, configuration set with bounce/complaint notifications to SNS. Document that SES starts in **sandbox** and production access must be requested from AWS before go-live.
6. **ObservabilityStack** — log groups with retention (staging 14 days, production 90+), dashboards, alarms → SNS topic → admin email: ALB 5xx, target response time, ECS CPU/memory, task restarts, RDS CPU/free storage/connections, Redis memory, BullMQ backlog and failed jobs, **device silence alarm**, SES bounce rate.
7. **CiStack** — GitHub OIDC identity provider and deploy role scoped to this repository and branch/tag conditions.
8. **BackupStack** (production) — AWS Backup plan for RDS and S3, cross-region copy optional.

### 15.3 Configuration and secrets

- The app reads everything from env vars validated at boot (fail fast on missing config).
- ECS injects secrets from Secrets Manager (`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AGENT_API_KEYS`) and plain config as env (`APP_ENV`, `S3_BUCKET`, `KMS_FIELD_KEY_ID`, `SES_FROM`, `WEB_BASE_URL`, `TZ_BUSINESS=Asia/Kolkata`).
- Field encryption uses **KMS envelope encryption**: a data key from KMS encrypts fields with AES-256-GCM; the encrypted data key is stored alongside. Locally, a static dev key from `.env` is used through the same interface.
- Storage and email are behind interfaces (`StorageService`, `MailService`) with local (filesystem, console/`.eml`) and AWS (S3/SES) implementations selected by env.

### 15.4 Biometric connectivity on AWS

- **Agent path (recommended, always build):** the office agent calls `https://api.<domain>/api/biometric/agent/punches` over TLS with an API key; outbound HTTPS only, no firewall changes at the office.
- **Push/ADMS path:** many ZKTeco/eSSL devices can only push over **plain HTTP** to an IP/port and do not support modern TLS. Therefore:
  - Expose `/iclock/*` on a dedicated ALB listener (e.g. port 8081 HTTP) that forwards **only** `/iclock/*` paths to the api service; all other paths return 404 on that listener.
  - Restrict that listener with a WAF IP set / security group rule to the **office static public IP(s)** only.
  - Authenticate every request by device serial number registered in the `devices` table; unknown serials are rejected and logged.
  - If the office has no static IP, do not expose the push path; use the agent only.
- Heartbeats from devices/agents update last-seen timestamps. The application raises HR alerts itself (§4.7), and the observability stack (Phase 5.5) alarms independently if a device is silent during working hours.
- The **emergency file upload** (§4.1 route 3) goes through the normal authenticated Import Center over HTTPS; it needs no extra exposure.

### 15.5 CI/CD (GitHub Actions)

- `ci.yml` on every PR: install, lint, typecheck, test (with Postgres and Redis service containers), docker build.
- `deploy-staging.yml` on push to `main`: assume AWS role via OIDC → build and push image to ECR (tag = git SHA) → build web → `cdk deploy` (if infra changed) → run `migrate` ECS task and wait for success → update api/worker/scheduler services to the new image → wait for stable → sync web build to S3 → CloudFront invalidation → smoke test `/health`.
- `deploy-production.yml` on tag `v*`: same steps, gated by a GitHub Environment with required reviewer; posts `cdk diff` for review.
- **Rollback:** redeploy the previous image tag (documented one-command workflow_dispatch). Migrations must be backward compatible (expand → migrate → contract) so rollback is safe.

### 15.6 Sizing and cost guidance

For ~150–500 employees, start small and scale on metrics: api 0.5 vCPU / 1 GB × 2 tasks (production), worker 0.5 vCPU / 1 GB (1 GB+ if Puppeteer PDFs), scheduler 0.25 vCPU / 0.5 GB, small burstable RDS instance, smallest ElastiCache node. Staging uses single tasks, single-AZ RDS and one NAT gateway, and can be scaled to zero outside office hours via a scheduled scaling action. Add AWS Budgets alerts for both environments. Document estimated monthly cost per environment in `docs/DEPLOYMENT.md`.

### 15.7 Compliance notes on AWS

- All employee data stored in ap-south-1; S3 and RDS encrypted with KMS; TLS everywhere including Redis.
- CloudTrail enabled for the account; S3 access logging for the documents bucket.
- No public access to RDS, Redis or S3 buckets; administrators access the DB only through SSM Session Manager port forwarding, never by opening the database to the internet.
