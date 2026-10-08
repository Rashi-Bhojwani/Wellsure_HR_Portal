# Effective dates: one "as of" model, before any payroll code

Status: **Approved 2026-10-03 (all six decisions as recommended). EF1
built 2026-10-04. EF2 built 2026-10-08. EF3 and EF4 follow straight on
(user, 2026-10-08: finish EF2–EF4, then plan Phase 2).** Required before Phase 6 (Phase 5 review §5.1;
PROGRESS open issue "Future-dated job changes take effect immediately").

**Added by the user on approval:** the data repair must show exactly what
it would change before changing it, with a preview of every row and why,
a person's approval, and only then the apply. Built as `npm run
history:repair` (§4, EF1).

**Settled while building EF1** (consistent with decisions 1–2; flagged for
review):
- **A change dated the same day as the latest row amends that row.** The
  alternative is a zero-length row, which the new CHECK forbids. This is
  a correction within the latest period, audited with before and after.
- **Separations:**
  - the last working day can't be before the date of joining, or before
    a job change already in force (that would rewrite history);
  - scheduled job changes dated after the last day are dropped when the
    separation completes, with an audit entry;
  - if history can't be closed cleanly, the separation stays pending and
    an audit entry is written each day, rather than guessing.
- **Import:** one device ID can't be two people on the same day. An
  ex-employee whose dates overlap the ID's later holder is a per-row
  error, not a crash.

**Settled while building EF2:**
- **Pre-joiners.** A new person's first name, placement and bank rows start
  on the earlier of their date of joining and the day they're added
  (`firstHistoryDay`), so "in force today" includes them: named, and in
  their manager's team, exactly as before. Joiner, headcount and every
  "employed on D" figure reads `dateOfJoining` / `lastWorkingDate`, never
  these rows. The device mapping still starts on the date of joining.
  - Pre-joiners added before EF2 are a new `history:repair` category:
    preview → approve → apply, never automatic.
- **Status vs employed-on-date (decision 6).** The reports already answer
  "employed on D" from `dateOfJoining`/`lastWorkingDate`. The remaining
  `status: "ACTIVE"` filters are all "people you can act on today", so they
  stay as they are.

## 1. The problem, in one paragraph

Four tables hold history with a start and end date:
- `employee_job_history`: department, designation, branch, grade, cost
  centre, reporting manager;
- `employee_name_history`;
- `employee_bank_accounts`;
- `device_user_mappings`.

Almost every query reads "the current row" as **`effective_to IS NULL`**:
the row with no end date. That is only true when every change takes
effect today. Today it already goes wrong in four ways:

1. **Future-dated changes apply at once.** A job change dated next month
   closes today's row and opens the new one immediately, so team scope,
   approvals, department and branch all switch early. E2 blocked
   future-dated *team moves* as a stopgap, but department, branch and
   designation still switch early.
2. **Back-dated changes can corrupt the timeline.** `updateJob`,
   `updateName` and `updateBank` accept any date. If it is earlier than
   the current row's start, the current row gets an end date before its
   start (an inverted interval), and the new row overlaps older history.
   Nothing in the database stops this.
3. **Separation closes the timeline one day early.** History rows are
   half-open, `[effective_from, effective_to)`: the end date itself is
   *not* covered. But a separation sets `effective_to = last working
   day`, so **on their last working day a leaver has no placement and no
   device mapping**. The F reports carry a workaround ("use the latest
   started row for leavers"). Payroll would get a leaver's last day wrong,
   and so would attendance for punches on that day.
4. **"Today" is computed inconsistently.** `updateBank` defaults to
   `new Date()`, a UTC timestamp. Between 00:00 and 05:30 IST that lands
   on yesterday's date.

Payroll is entirely "as of date D": the salary, branch (for PT/LWF
state), cost centre, bank account and name in force on each day of the
month, plus mid-month changes and a leaver's last month. It cannot be
built on "whatever row has no end date".

## 2. The model we'd adopt

**One convention, everywhere history is stored: half-open intervals.**
- A row is *in force on day D* when `effective_from <= D` and
  (`effective_to IS NULL` or `effective_to > D`).
- `effective_to` is the first day the row no longer applies, i.e. the
  next row's `effective_from`.
- Every history writer uses this, separations included (`effective_to =
  last working day + 1`).

**"Current" means "in force today"**, where today is `businessToday()`
(the IST date). It no longer means "the row with no end date". The row
with no end date can be a scheduled future change.

**One module owns it:** `backend/src/lib/effectiveDating.ts`.
- `inForceOn(day)`: the Prisma `where` fragment for
  `effectiveFrom`/`effectiveTo` tables.
- `mappingInForceOn(day)`: the same for `validFrom`/`validTo`.
- `inForceSql(alias, day)`: the same condition for raw SQL. Today that
  is only the team-scope recursive query.
- Functions that build the includes every module currently copies:
  `currentNameInclude()`, `currentJobInclude()` and `currentBankWhere()`.
  They are **functions, not constants**, because "today" changes at
  midnight. Today, several modules hold
  `{ where: { effectiveTo: null } }` in module-level constants; those go.
- Payroll-facing readers, each taking an explicit day:
  - `placementOn(employeeId, day)`;
  - `placementsOn(ids, day)`, moved here from reports;
  - `nameOn(employeeId, day)`;
  - `bankAccountOn(employeeId, day)`;
  - `deviceMappingOn(deviceUserId, day)`;
  - `employedOn(day)`: joined on or before D, and no last working day
    before D. Kept separate from `status`, which stays the login and
    account lifecycle.
- `changeTimeline(tx, table, employeeId, effectiveFrom, data)`: **the
  only writer**. It locks the employee's rows (`SELECT … FOR UPDATE`),
  applies the insertion rule below, sets the previous row's end date to
  the new row's start, and inserts the new row.

**Insertion rule: changes are only ever appended at the end of the
timeline.**
- A change dated D must be **on or after the start of the latest row**,
  whether that row is current or scheduled.
  - D inside the latest row splits it (back-dating within the current
    period is fine).
  - D before an already-scheduled change is refused: cancel the
    scheduled change first.
  - D before the latest row's start, which would rewrite older history,
    is refused with a clear message.
- **Cancel a scheduled change** (one that is not yet in force): the row
  is removed and the previous row is reopened (`effective_to = NULL`),
  with an audit entry holding the full removed row. A change already in
  force can't be cancelled; you supersede it with a new change.
- A cap on how far ahead a change may be scheduled is configurable;
  default 366 days.
- From Phase 6, a change dated inside a **locked payroll period** is
  refused. We add the hook now (`assertNotInLockedPayroll(day)`, a no-op
  until Phase 6), the same way leave already has
  `assertNoLockedPeriod`.

**The database enforces it, not just the code.** Per history table:
- `CHECK (effective_to IS NULL OR effective_to > effective_from)`: no
  inverted or empty rows.
- `EXCLUDE USING gist (employee_id WITH =, daterange(effective_from,
  effective_to, '[)') WITH &&)`: **no two rows for one employee may
  overlap.** It needs the `btree_gist` extension, which is available on
  RDS Postgres 16.
- Device mappings: no overlap per `device_user_id`, so one device ID is
  never two people on the same day, and none per `employee_id`.
- The existing "one open row" partial unique indexes stay.

## 3. Blast radius: what changes, ranked by risk

There are **99 call sites in 37 backend files**, plus the seed and 6 test
files. Every one is listed in §7, by file.

| Area | Sites | What it decides | Risk if wrong | Payroll reads it? |
|---|---|---|---|---|
| **Team scope**: the recursive query in `lib/dataScope.ts`, `managers/hierarchy.ts` | 3 | Who a manager can see and approve, the IDOR boundary | **Security**: a wrong date widens or narrows a manager's reach | Indirectly (approvals feed LOP) |
| **History writers**: job (`employee/service`, `managers/service` ×4, `hierarchy`, `access/service`), name, bank (`updateBank`, change-request approval, import), separations | 12 | The stored timeline | **Data integrity**: a bad write is permanent history | **Yes**: every as-of read |
| **Separation close** (`markSeparatedInTx`) and existing rows closed on the last working day | 2 + data | A leaver's last day | **Wrong last-day placement and device mapping** | **Yes**: the leaver's last month, F&F |
| **Placement reads**: leave approval routing, the no-team-approver check, team counts, Manager Management, directory, org chart, grid, dashboard, leave calendar, engage location/department filters, announcement and document audience, socket rooms, import reconciliation | ~30 | What's shown, who's notified, who's in an audience | Medium: wrong department, branch or manager until the change date | **Yes**: branch (PT/LWF state), cost centre, grade |
| **Bank reads**: masked display, grid export, import de-duplication | 4 | Which account is shown or exported | Medium: shows the wrong account in a changeover month | **Yes**: the bank transfer file |
| **Device mappings**: import validator, separations, device code | 3 | Which person a punch belongs to | High once Phase 2 ingests punches | **Yes**: attendance, so paid days and LOP |
| **Name reads**: about 50 includes, display only | ~50 | Names on screens, notifications and exports | Low: a scheduled name change shows early | **Yes**: payslip name (`nameOn`) |
| **Already as-of**: letters, `reports/context.placementsOn` | 2 | — | Low: switch them to the shared helper and drop the leaver workaround | — |

**Untouched:**
- Leave and delegation date ranges keep their user-facing *inclusive*
  end dates. "Leave until 14 Dec" means the 14th is included.
- Leave balances: the append-only ledger, already as-of by `entry_date`.
- Audit logs.

**Approval routing stays "as of today", deliberately.** A request is
decided by whoever is the employee's approver *today*, not on the
leave's dates. This matches greytHR and how people expect an inbox to
work. A change scheduled for next month moves the inbox next month.

## 4. How it would be built: four commits, each green and reviewable

**EF1: foundation (no behaviour change for users).**
- `lib/effectiveDating.ts`.
- `lib/clock.ts`: `businessToday()` reads a clock that tests can set, so
  tests can "travel" to a date. Never settable outside tests.
- `changeTimeline` with the insertion rule; every writer is moved onto
  it.
- Separation fix: `effective_to = last working day + 1` for both job
  history and device mapping.
- **Migration:**
  1. A *pre-flight check* that aborts with a readable report if any
     inverted or overlapping rows exist.
  2. Shift separation-closed rows (`effective_to = last_working_date`
     on separated employees) to the day after.
  3. `CREATE EXTENSION btree_gist`.
  4. The CHECK and EXCLUDE constraints.
- Tests:
  - timeline property tests: random sequences of changes and
    cancellations against an in-memory reference model, asserting
    contiguous, non-overlapping and correctly in force on every day;
  - the database rejects overlaps;
  - a leaver is in force on their last working day.

**EF2: the read-path sweep.**
- All ~85 read sites move to the helpers; module-level
  `effectiveTo: null` constants become function calls.
- The team-scope recursive query uses `inForceSql`.
- **A lint guard:** a test that greps the backend and **fails** on any
  `effectiveTo: null`, `effective_to IS NULL`, `validTo: null` or
  `valid_to IS NULL` outside `effectiveDating.ts`, the writers and
  migrations. Same idea as the route-inventory guard: a new query can't
  quietly reintroduce the bug.
- Reports switch to the shared `placementsOn`; the leaver workaround is
  removed.
- **Time-travel tests:** schedule a team move for D+7.
  - Before D+7: the old manager sees and approves the employee; the new
    one gets 404.
  - On D+7: reversed.
  - The same pattern for department and branch filters, the directory,
    the dashboard and audiences.

**EF3: scheduled changes go live (the user-visible part).**
- Lift E2's stopgap: future-dated team moves are allowed in Manager
  Management and in Change job details.
- Profile → Job history shows **"Scheduled from 1 Nov"** rows with
  **Cancel**. The Change job, Name and Bank dialogs say whether a date
  is "takes effect now" or "scheduled". A refused date explains why
  ("a change is already scheduled for 1 Nov — cancel it first").
- **A daily rollover job** (00:05 IST, before separations at 01:00), for
  each change that takes effect today:
  - re-rooms the person's live sockets (`dept:`, `location:`,
    `manager:`);
  - refreshes team counts and Manager Management;
  - notifies the employee and their old and new manager ("From today,
    you report to X"). They were also told when it was scheduled.
- Manager Management shows scheduled joiners and leavers per team.

**EF4: the payroll contract (documentation plus tests, small code).**
- A section in `docs/plans/PHASE_6.md` that names the readers payroll
  must use: `placementOn`, `bankAccountOn`, `nameOn`, `employedOn` and
  `deviceMappingOn`, and *never* raw history queries.
- The `assertNotInLockedPayroll` hook is wired into `changeTimeline`.
- Tests pinning mid-month behaviour: a transfer on the 16th gives two
  placements in the month; a leaver's last day is in force; a bank
  change on the 10th pays into the new account for a payment dated the
  25th.

Each commit gets the usual checks: a fresh devcheck seed, the full
suites, lint, typecheck, a browser walkthrough and green CI. Real data:
the migration's pre-flight check runs against `wellsure_hr` only with
your go-ahead (standing rule); devcheck and the test DB are covered.

## 5. Decisions I need from you

My recommendation is listed first in each.

1. **Interval convention.** Half-open `[from, to)` for all history
   tables, with separations fixed to match. *(Recommended: it is what
   job, name and bank already use; separation is the odd one out.)* The
   alternative is inclusive end dates everywhere, which touches every
   writer and the letters and reports readers.
2. **Back-dating.** Allowed only within the latest period (append-only
   timeline). Corrections to older history are out of scope for now.
   *(Recommended: payroll never sees a past period silently rewritten.)*
   The alternative is to allow inserting anywhere and cascade, which is
   much riskier.
3. **Cancelling a scheduled change.** The row is removed and the
   previous row reopened, with the full removed row in the audit log.
   *(Recommended: the row never took effect.)* The alternative is to
   keep cancelled rows with a `cancelled_at` flag, and filter them out
   in every reader.
4. **Approval routing.** Decided by today's approver, not the approver
   on the leave dates. *(Recommended, and what happens today.)*
5. **How far ahead a change may be scheduled.** Default 366 days,
   configurable in System Settings.
6. **`status` vs employed-on-date.** `status` stays the login and
   account lifecycle; as-of questions use `employedOn(D)`. The 37
   `status: "ACTIVE"` filters are reviewed in EF2, but only the ones
   answering "who was employed on D" (reports, dashboard, payroll later)
   switch. Inboxes and lists of people you can act on today keep
   `status`.

## 6. Risks and how they're contained

- **The migration meets bad historical data.** The pre-flight check
  aborts before any change, with a per-employee report. Devcheck and
  test are clean today (0 overlaps, 0 inverted rows, 0 future rows,
  checked 2026-10-03).
- **A missed read site.** The grep guard in EF2 makes a miss a red test,
  not a silent bug.
- **Midnight edge.** One clock (`businessToday`, IST), used by readers,
  writers and the rollover job. `updateBank`'s `new Date()` default is
  replaced.
- **Performance.** The overlap constraint adds a small GiST index per
  table; history tables are tiny (rows per employee per year are
  single digits). `inForceOn` uses the existing
  `(employee_id, effective_to)` indexes plus `effective_from`, and we
  add `(employee_id, effective_from)` where needed.
- **Realtime drift.** Without the rollover job, sockets would stay in
  the old `dept:`/`manager:` rooms until reconnect. EF3 handles it, and
  until EF3 no future-dated change can be made, because the stopgap
  stays.

## 7. Every call site (snapshot 2026-10-03)

`grep -rn "effectiveTo: null|effective_to IS NULL|validTo: null|valid_to IS NULL"`,
backend `src/`, excluding tests:

| File | Sites | Kind |
|---|---|---|
| `employee/service.ts` | 10 | job, name and bank writers; profile reads |
| `people/directory.ts` | 9 | directory and org chart placement and name |
| `managers/service.ts` | 8 | team writers; counts; lists |
| `employee/grid.ts` | 6 | grid placement, name, bank export |
| `engage/posts.ts` | 5 | names; location and department filters |
| `auth/service.ts` | 5 | names |
| `import/service.ts` | 4 | bank writer; reconciliation counts |
| `employee/separations.ts` | 4 | **close on last working day** (fix); team-orphan count |
| `leave/requests.ts`, `leave/calendar.ts` | 3 + 3 | approval routing; team calendar |
| `admin/dashboard.ts` | 3 | dashboard populations |
| `access/service.ts` | 3 | job writer (role change); names |
| `reports/context.ts` | 2 | placement and names (already as-of; switch helper) |
| `managers/hierarchy.ts` | 2 | reporting-line writer; team members |
| `leave/yearEnd.ts`, `import/rowValidators.ts`, `engage/employeeSearch.ts`, `engage/autoPosts.ts`, `employee/changeRequests.ts`, `documents/service.ts`, `delegations/service.ts`, `auditLog/service.ts`, `lib/dataScope.ts` | 2 each | names; bank and device de-duplication; **team-scope CTE** |
| `realtime/socket.ts`, `lib/audience.ts`, `tasks`, `letters` (already as-of), `leave/recalculator`, `leave/noTeamApprover`, `helpdesk`, `engage/groups`, `engage/comments`, `employee/deviceCode`, `announcements`, `access/recovery`, `access/bootstrap`, `lib/securityAlerts` | 1 each | socket rooms; audience; names |
