# Function parity for Workforce Management (A-10)

Session A, branch `feat/hr-payroll-separation`. Written 2026-11-04 **before** any A-10 code. Functions only: our own design system, menus, wording; never the other
product's text or screenshots. Public repo, no real data. Format as in A-9 (`GREYTHR_PARITY_EMPLOYEE_ADMIN.md`): status, evidence (checked in code), who, group.

**Owner answers (final):** cycles other than the calendar month only if payroll already depends on one; IP restriction (12) NOT WANTED; shift rotation calendar (6)
NOT WANTED; no GPS, device identifiers or map links on swipes or remote attendance; regularization rules and module are A-5's (item 16: Review and Monitor screens only);
everything else wanted if missing or partial.

Ground facts (checked):
* The attendance cycle is already configurable and effective-dated (`AttendanceCycleRule.startDay`, `configService.scheduleCycleChange`, `GET /api/attendance/muster/cycles`),
  and payroll runs read finalised cycles (`attendance/finalisation.ts`, `lockedPeriods.ts`). So a 26th-to-25th cycle is **already supported**: nothing new is built for it.
* The day record is `DailyAttendance` (status string such as `P`, `A`, `A:P`, `H`, `O`, `NM`, `NS`, a leave code; `lopDays`, `source`, `exceptionFlags`), written only by
  the engine (`attendance/compute.ts`, `engine/engine.ts`). Holidays are **company-wide** (`Holiday`, unique per date, read in `compute.ts:166`); week-offs come from the
  person's effective-dated assignment (`compute.ts:271`).
* No money is held or shown by any attendance screen; `lopDays` is days.

## W1 Muster

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 1 | Monthly grid, per-person totals, month/cycle selector, employee / location / department filter, category filter, year range, Excel export, legend | **PARTIAL** | `attendance/manual/muster.ts` (`getMuster`, `totalsFor`: paid days, present, absent, half days, LOP, leave, holidays, off, not marked, missing punch), `GET /muster/cycles` (13 recent cycles), `/muster/export`, `MUSTER_LEGEND` (`shared/attendance/muster.ts`), `pages/admin/attendance/muster/MusterPage.tsx`. **Missing:** an "unresolved" total (not marked + no shift), a category (employment type) filter, cycles older than 13 (year range) | `attendance.view` (HR switch VIEW_ATTENDANCE), manual markers in their branches | G1 |
| 2 | Status vocabulary as data, labels as settings | **PARTIAL** | codes exist in the engine (`P`, `A`, half splits, `O`, `H`, leave codes, `NM`, `NS`, LOP days, `source` OVERRIDE / HOLIDAY / WEEK_OFF / LEAVE); the legend is hard-coded. **Missing:** one catalogue (code → meaning → kind), labels a setting (Not set = our own wording), derived markers (regularized/override from `source`, alert for deduction from `lopDays`, grace from late-within-grace, work from home from an approved remote day). "Rest day", "on duty" and "ignored" are not produced by the engine: **NEEDS OWNER DECISION** (does the company need a second kind of off day, or an on-duty status?) | — | G1 |
| 3 | Click a day to override with an allowed status, reason, audited; allowed set is a setting | **PARTIAL** | `override/manualOverride.ts` (preview → confirm with fingerprint, reason, audit; statuses `P`, `A`, `HD_FIRST`, `HD_SECOND`, `WORKED`), `ManualOverridePage.tsx`. **Missing:** the allowed-statuses setting | `attendance.override.manage` (HR switch CORRECTIONS) | G1 |

## W2 Shifts

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 4 | Roster grid for a month: per-day shift code, working/off days, colour legend, filters, export, refresh; edits reflect in attendance | **PARTIAL** | `roster/roster.ts` + `ShiftRosterPage.tsx`: a planner (rotation steps → preview → confirm, writes assignments, attendance recomputed). **Missing:** the read-only month grid (per-day shift code, working/off days, legend) and its export | `attendance.roster.manage` (HR switch SHIFT_ROSTER) | G2 |
| 5 | Shift override list with override, edit, delete; filters | **BUILT** | `override/shiftOverride.ts` (preview/confirm/clear, list by employee and period), `ShiftOverridePage.tsx`; edit = a new override for the day, delete = clear (audited) | `attendance.override.manage` | — |
| 6 | Shift rotation calendar | **NOT WANTED** | (the roster planner's own rotation stays as it is) | — | — |

## W3 Locks

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 7 | Lock activities for a date range from an effective date, by category, for a saved filter or everyone; add / edit / void, audited; works with finalisation and the 30-day correction window | **MISSING** | only period finalisation exists (`finalisation.ts`, `lockedPeriods.ts`) and the correction window setting; no activity lock | directors (a lock is a control over HR's work) | G3 |

## W4 Attendance setup

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 8 | Attendance scheme assigned with an effective date | **BUILT** | `AttendancePolicy` + `AttendanceAssignment` (effective-dated, `configService.changeAssignment`, bulk), Attendance Settings page | `attendance.config.manage` | — |
| 9a | Employee week days, effective-dated | **BUILT** | week-off pattern on the same assignment | `attendance.config.manage` | — |
| 9b | Weekend override for a date range for chosen people | **MISSING** | — | `attendance.config.manage` | G4 |
| 10 | Holiday list per location | **PARTIAL** | `Holiday` is one company-wide list (`leave/holidays.ts`, `HolidayCalendarsAdminPage.tsx`); **missing:** a holiday limited to some locations | `leave.policy.manage` | G4 |
| 11 | Leave type reviewer per employee or group | **MISSING** | approval today: `leave.approve` within data scope + workflow delegates (`leave/scope.ts resolveApprovalReach`) | directors set it | G4 |
| 12 | IP address mapping | **NOT WANTED** | — | — | — |

## W5 Swipes and devices

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 13 | Swipes list with filters, download, shift, received on, source, status; detail panel; Reject with reason; bulk select | **PARTIAL** | `attendance/swipes/swipes.ts` + `EmployeeSwipesPage.tsx` (date range, employee, branch, export, received at, route/source, flag decision, used/unused). **Missing:** the day's shift column, a Reject (and reinstate) of any swipe with a reason, bulk reject. Location, device identifiers, map links: NOT WANTED (none added; the list already shows the device name and serial, unchanged) | `attendance.swipes.view` (view), `attendance.devices.manage` (reject) | G5 |
| 14 | Agent health per location; on-demand sync for a date range with pending list and history; cleanup | **PARTIAL** | Devices page, agents with heartbeat (`Agent.lastHeartbeat`), incidents, volume (`biometric/routes.ts`). **Missing:** sync requests (request, pending, history, cancel) | `attendance.devices.manage` | G5 |

## W6 Leave

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 15 | Leavers list (pending/done), filters, recalculate leave to the leaving date, days only | **PARTIAL** | `leave/recalculator.ts` + `LeaveRecalculatorPage.tsx` recalculates accrual from a date for chosen people; accrual does **not** know a leaving date (no `lastWorkingDate` anywhere in `modules/leave`). **Missing:** the leavers list, status, and a recalculation that stops accrual at the leaving date | `leave.recalculate` | G6 |

## W7 Workflow monitor

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 16 | Review (waiting on me, bulk) and Monitor (waiting on others) for each approval type; pending/completed; search, download, columns, filter; reasons through one display function | **PARTIAL** | Review: `tasks/service.ts` + `TasksInbox.tsx` (a list per source, no bulk, no completed); Monitor: counts only (`admin/tasks.ts`). **Missing:** both screens for leave and attendance regularizations (and remote check-ins for directors) | per approval rules and scope | G7 |

**NOT SHOWN YET:** anything not described above. **PEEPS-OWNED (not built):** leave extension (new leave types, eligibility, supporting documents), the privacy rule
for menstrual/medical leave (plugged into `displayLeaveForViewer` at merge), assets, avatars, helpdesk, exits, recruitment.

## Build plan

* **G1** shared status catalogue (`shared/attendance/statusCatalogue.ts`: code, meaning, kind) with label overrides as a director setting (Not set = our wording); muster:
  unresolved total, employment-type filter, cycles back two years; manual-override allowed statuses as a setting (Not set = no restriction beyond the engine's list).
* **G2** roster month grid (`GET /api/attendance/roster/grid`, export) and a grid view on the roster page.
* **G3** `attendance_locks` (effective from, range, categories, all or a saved segment, voided never deleted); one guard `assertNotLocked` called by leave apply,
  regularization raise (one call, rules untouched), muster entries, manual override, shift override, roster; a finalised period is never changed by a lock.
* **G4** weekend overrides and location-limited holidays, both read in `compute.ts`; leave type reviewers (an extra decider for a leave type, a location or department,
  set by a director, added to the approval reach; HR switch still governs HR).
* **G5** swipe reject / reinstate with reason (a punch rejected is not used by the engine), shift column, bulk; agent sync requests (server side + heartbeat response
  + agent re-reads the range).
* **G6** leavers list and recalculation to the leaving date (days only; status done once applied).
* **G7** `/api/workflow` Review and Monitor for leave and regularizations, bulk approve/reject through the existing decision functions (per item, idempotent, audited),
  `displayLeaveForViewer` in `shared/leave/display.ts` for every leave type or reason shown below HR level.
