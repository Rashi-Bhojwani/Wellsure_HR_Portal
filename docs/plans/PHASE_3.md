# Phase 3 — attendance administration: implementation plan

Status: **approved 2026-10-13, with three changes (below)**. The design decisions are the user's and are not re-planned here;
this document says how they are built on what Phase 2 left, and lists what I decided myself. Four commits, a pause after each.

## Changes the user made on approval (2026-10-13)

1. **A leave day the person actually worked can be corrected.** The common real case: an approved leave day where the person came in.
   HR overrides the day to *worked* **and reverses the leave consumption in the ledger so the balance comes back**: an explicit action
   with a reason, never a silent side effect, visible on both the attendance day and the leave ledger. This replaces rule 3 below for
   leave days (holiday and week-off days still allow "worked" only). It is built in two steps: **the attendance side with Manual
   Override (commit 2)**, and **the leave-ledger reversal as its own small commit straight after it**, so the day never reads
   worked while the ledger still says consumed (the action is one transaction, shipped when both sides exist). Regularization requests
   stay off leave days (an employee cannot give leave back; HR does, through Manual Override).
2. **No "overtime" until HR defines it.** The report column and the report are called **Excess hours** (what the engine already
   computes, minutes worked beyond the scheduled shift end), and the report says plainly that an overtime policy is undefined and
   that excess hours are not payable overtime. (Replaces rule 10's wording; commit 4.)
3. **Nobody changes their own shift, week-off pattern or policy.** The existing Attendance Settings assignment change (single, bulk
   and cancelling a scheduled change) refuses the actor's own record, like the other self-action guards; the other Super Admin acts
   for them. Built in commit 1.

## What Phase 2 left that this builds on

- `regularization_requests` (one request type: a forgot-to-punch time on a one-punch device day), approve/reject by the
  manager (grant) or HR, never one's own; the engine's `correction` input adds one time to a day's points; `daily_attendance`
  already has `override_kind` / `override_ref` and `is_locked`.
- The engine's evaluation order has a reserved step 5, "manual override (Phase 3)": after holiday, week-off and leave, before
  manual capture and punches.
- `finalisePeriod` is the only writer of `is_locked` and refuses while blockers remain (placeholder rules, NM, NS, stale days,
  pending requests, period not over). It has no route and no screen. `attendance.process` readiness endpoint exists.
- The effective-dating writers (`writeAssignmentChange`) **append forward only**: a change dated before the latest row's start is
  refused, and scheduling is capped by `history.maxScheduleAheadDays` (366). There is no `shift_overrides` table.
- Reports: `modules/reports` + `lib/xlsx.ts` + `reports.view` (manager-grantable, data-scoped). No attendance reports yet.
- Menu placeholders exist for Manual Override, Shift Override, Shift Roster (still labelled "Phase 2"), Employee Swipes, Period
  Finalisation and Attendance Exception.

## Schema (four migrations, one per commit that needs it)

| Commit | Change |
|---|---|
| 1 | `regularization_requests`: add `reason_code` (enum FORGOT_TO_PUNCH, DEVICE_DOWN, ON_DUTY_ELSEWHERE, OTHER), `in_time`, `out_time`, `target_status`, `batch_id`; copy the old `missing`/`time` into `in_time`/`out_time` (reason code FORGOT_TO_PUNCH) and drop `kind`, `missing`, `time`. `reason` stays as the free-text note. New `regularization_batches` (who, when, reason code, note, counts). New `attendance_overrides` (see below). `AttendanceSource` gains `OVERRIDE`. |
| 2 | New `shift_overrides` (employee, date, shift, reason, who; append-only with supersede, like manual entries). |
| 3 | New `attendance_period_locks` (period start/end, finalised by/at, unlocked by/at/reason, status), the record the Finalisation screen lists. |
| 4 | None (reports are read-only). |

**`attendance_overrides` (one table for every day-level correction).** Append-only (trigger, like `manual_attendance_entries`),
one *active* row per employee-day, a newer row supersedes the older and the history stays. Columns: employee, date,
`origin` (REGULARIZATION | MANUAL_OVERRIDE), `kind` (ADD_TIME | TIMES | STATUS), `in_time`, `out_time`, `status`
(P, A, HD first/second half, WORKED), reason, request id (for a regularization), who, when, `superseded_by`. The engine reads
the active row. This gives one precedence rule (latest wins), a full history, and one place the UI and exports read the
"this day was corrected by hand" marker from. Raw punches are never touched.

**Engine.** Step 5 reads the active override: `STATUS` is taken as entered (same semantics as a manual status-only entry, but
on any capture); `TIMES` (both in and out) are used *instead of* the device punches for the day; `ADD_TIME` (one time) joins the
punches exactly as the Phase 2 correction does. Holiday, week-off and approved-leave days are not overridable (leave has its own
ledger; off-days allow only "worked", as manual entry does). `source = OVERRIDE`, `override_kind` = REGULARIZATION |
MANUAL_OVERRIDE. Existing results do not change, so `ENGINE_VERSION` stays 2.

## Commit 1 — Regularization, complete

- **Request:** one type for any correctable day: reason code, free-text note, and either corrected times (in and/or out) or a
  target status. Eligible: a device-capture day in the current or previous attendance cycle, employed, not a holiday/week-off,
  not on approved leave, not finalised, and over (not provisional). Manual-capture days stay with the muster.
  A day with no punches needs both times; one time on a day with punches adds it (the Phase 2 case); both times replace the
  device's for the day; a status sets the day.
- **Approval:** the employee's manager if granted (`attendance.regularization.approve`, TEAM scope), or HR (ALL). Nobody
  approves their own (existing guard, kept and tested for every path). Approval writes the active override and recomputes the day;
  the raw punches stay. A **pending request blocks finalisation of its period** (existing blocker, now covering every kind).
- **Bulk (HR):** new permission `attendance.regularization.bulk` (HR Admin, Super Admin; not manager-grantable). HR picks a
  date range and employees (by branch, department or list; typically a branch after an outage), a reason code, a note and the
  correction (times or status), then **Preview** (exactly which employee-days change and from what to what; days that can't be
  corrected listed with why; the actor's own days left out and counted), then **Confirm** (reason + tick, fingerprint of the
  previewed set as with bulk accept) to **raise** (pending for the approver) or **raise and approve** in one action. One audit
  row per employee-day, written in the same transaction; one `regularization_batches` row groups them.
- **Caps (admin-configurable, System Settings → Attendance → Regularization):** bulk range ≤ 31 days, bulk size ≤ 1,000
  employee-days, backdating = the current and the previous cycle (`backdateCycles` = 1; 0–3 allowed).
- **Endpoints:** `POST /api/attendance/me/regularizations` (extended body), existing cancel/approve/reject; `GET
  /api/attendance/me/regularizations/eligibility?date`; `POST /api/attendance/regularizations/bulk/preview` and `/bulk`;
  `GET/PUT /api/settings/regularization`.
- **Screens:** employee Attendance Info's request dialog (any correctable day, reason code, times or status);
  Workforce → Attendance → **Regularizations** (queue with reason code, times/status, filters; bulk raise/approve dialog);
  the muster/Attendance Info day detail shows an "Overridden / Regularized" marker with who and why.
- **Tests:** engine table tests for each override kind; integration for raise → approve → recompute → marker → raw punches
  unchanged; backdating limits and finalised refusal; own-approval refused on every path; manager sees only their team (IDOR);
  bulk preview/cap/fingerprint/own-days-left-out/one audit row per employee-day/atomicity; pending blocks finalisation;
  migration copies old requests; settings; route inventory; cleanup policies.

### Commit 1 — as built (2026-10-13)

Built as planned; what differs from, or was decided beyond, the plan above:

- **Migrations (two):** `20261013090000_attendance_source_override` (the enum value, alone because Postgres cannot use a new enum
  value in the transaction that adds it) and `20261013090100_regularization_generalised` (everything else). Old approved
  MISSING_PUNCH requests are copied into `attendance_overrides` and their `daily_attendance` rows re-marked, so earlier corrections
  keep reading "corrected by hand". `attendance_overrides.request_id` is `ON DELETE RESTRICT`: a request that produced a correction
  cannot be deleted from under it.
- **`attendance_overrides` has a `seq` serial** (not a `superseded_by` pointer): the active row is the one with the highest `seq`.
  Un-doing is a `CLEARED` row. Append-only trigger as for manual entries (the test-purge exception is the same one).
- **Where the override applies in the engine:** step 5, and only if the day is not a holiday, week-off or fully-on-leave day (the
  override is dropped there, not applied). Half-day leave plus an override is evaluated like any other day.
- **A day that already carries a correction cannot be given another request** (`ALREADY_CORRECTED`). Changing a corrected day is
  Manual Override's job (commit 2), which appends a newer row. The employee screen says so.
- **Why a day is refused is a code the screens show in words:** `TOO_OLD`, `NO_RECORD`, `NOT_OVER`, `LOCKED`, `MANUAL_CAPTURE`,
  `OFF_DAY`, `ON_LEAVE`, `ALREADY_CORRECTED`, `PENDING_EXISTS`, `NO_SHIFT`, plus the times checks `OUT_OF_WINDOW`, `BAD_TIMES`,
  `NEEDS_BOTH_TIMES`. The eligibility endpoint and the bulk preview use the same function, so the dialog and the server agree.
- **Bulk:** the preview reports, per reason, what was left out: days before the person joined or after they left are skipped
  silently (not employed), days with no computed record are counted as `NO_RECORD`, the actor's own days are counted as
  `OWN_ATTENDANCE`. Confirm is refused with 409 `SELECTION_CHANGED` if the set differs from the previewed one. `RAISE_AND_APPROVE`
  needs `attendance.regularization.approve` as well as the bulk permission.
- **Settings:** System Settings → Attendance → Regularization (`backdateCycles` 1, `bulkMaxRangeDays` 31, `bulkMaxEmployeeDays` 1,000
  defaults; the plan said 1,000 employee-days and 31 days as well). `GET/PUT /api/settings/regularization`, audited.
- **Self-action guards:** a request can't be decided by the person it is for (`OWN_REQUEST`); bulk leaves out the actor's days
  (`OWN_ATTENDANCE`); and, user's change 3, the Attendance Settings assignment change, bulk assignment change and cancelling a
  scheduled assignment change refuse the actor's own record (`OWN_ATTENDANCE`).
- **Visible marker:** `daily_attendance.override_kind` is `REGULARIZATION` or `MANUAL_OVERRIDE`; Attendance Info day panel reads
  "Corrected by hand (not from the device)" with who, why and the request; the muster cell is marked; the Attendance Info month
  `corrected` flag uses it. Exports for this are added with the reports in commit 4 (nothing exports a Phase 3 override yet).
- **Not done here, by design:** HR correcting a day that is not a request (commit 2), the leave-day-worked reversal (commit 2 + its
  own small commit), the corrected-day marker in Excel exports (commit 4).

## Commit 2 — Override, roster, swipes

- **Manual Override** (`attendance.override.manage`, HR Admin and Super Admin, never manager-grantable): HR sets a day's
  status (P, A, half-day, worked) for one or many employee-days (same preview/confirm/cap as bulk regularization), reason
  required, one audit row per employee-day, raw punches untouched, never one's own, never a finalised day or a leave/off day.
  Distinct from manual entry (which is a branch marker's data entry for manual-capture people).
- **Shift Override** (same permission and pattern): a shift for specific dates for an employee (`shift_overrides`), read by the
  engine ahead of the assignment's shift. Reason required, audited, can be backdated within the same cycle limits, never into a
  finalised period, never one's own.
- **Shift Roster:** bulk shift assignment by branch, department or selection, and the **rotation generator** (a pattern of N
  shifts over M days, repeating from a start date). It writes through `writeAssignmentChange`, so it is effective-dated and
  subject to its rules: **forward only** (from today, appended in order, up to `history.maxScheduleAheadDays`); regenerating
  replaces the scheduled rows after the start date (cancel then append) all-or-nothing, with a preview. Past days are corrected
  with Shift Override. Menu label "Phase 2" removed.
- **Employee Swipes** (`attendance.swipes.view`, manager-grantable at TEAM scope): the raw punch log exactly as received
  (device, device user ID, employee if mapped, device time as recorded and the instant, route, batch, flag and its decision,
  whether used in a computed day), filters (date range, device, branch, employee, route, used/not used, flagged, unmapped), paged
  server-side, **Excel export** (capped). Unmapped and other-people punches are visible only at ALL scope.
- **Tests:** engine (shift override precedence, override on off/leave days refused); roster (rotation math, forward-only,
  all-or-nothing, regenerate); swipes (shows flagged/unmapped/duplicates verbatim, "used" flag matches `computed_from`, scope IDOR,
  export); self-action guards; route inventory.

## Commit 3 — Finalisation and exceptions

- **Finalisation screen** (`attendance.finalise`: HR Admin, Payroll Admin, Super Admin): per period (the attendance cycles),
  status (open / finalised / unlocked), every blocker grouped by reason with counts and a link to the affected days, refresh, and
  **Finalise** when clear. New blockers: flagged punches awaiting a decision in the period. Unmapped punches are shown as a warning,
  not a blocker. `PLACEHOLDER_RULES` stays a hard block. **Unlock** (`attendance.unlock`, Super Admin only, non-grantable):
  reason required, audited, shows a warning and needs an explicit confirmation if payroll has consumed the period. Payroll
  does not exist yet (Phase 6): the check is a registered provider that answers "not consumed" until Phase 6 registers itself,
  and is wired through the existing `isPeriodLocked` hook.
- **Exceptions queue** (`attendance.view`, data-scoped): one list of problem days, **server-paged for volume** (cursor/pages,
  counts per type up front): missing punch, shortfall, half-day minimum not met, no shift assigned, clock-flagged (employee-days
  from `daily_attendance`) and unmapped device IDs (grouped by ID with punch count and dates). Filters: branch, department,
  date range, type. Late-in/early-out are reported, not queued (they are not problems). Bulk resolve only where unambiguous:
  *map a device ID* (bulk "map every suggested match" where the ID equals exactly one employee's code, each audited) and *assign a
  shift* to the selected no-shift days (effective-dated writer). The rest route to Regularization or Override with the selection
  carried over. Bulk actions use the preview/confirm/fingerprint pattern and leave out the actor's own days.
- **Tests:** blockers per reason with counts and links; finalise → days locked → locked days refuse every writer; unlock rules;
  payroll-consumed warning via the provider; exceptions counts vs a seeded month, filters, paging, scope IDOR, volume (500
  employees), bulk map/assign with audit, self-action guards.

## Commit 4 — Reports and close-out

- Four reports in the existing reports framework (`late-coming`, `excess-hours`, `exception-summary`, `attendance-muster`), the same
  `lib/xlsx.ts` helper, `reports.view` and the same data-scope rules (a manager sees only their team), screen and export from one
  result. Overridden and manually set days carry a marker column in every one. Each report warns when placeholder rules were in
  use ("computed with rule values HR has not confirmed").
- **Excess hours** (not "overtime": user's change 2) reports the raw minutes worked beyond the scheduled shift end
  (`excess_minutes`) with a configurable minimum to count (default 0). The report states that overtime policy is undefined and
  that these hours are not payable overtime.
- Close-out: every Phase 3 screen with its URL; what stays unproven until the device is connected; and
  `docs/CONNECTION_DAY.md`, a step-by-step procedure to follow at the office (what to bring, what to run, what to check, what
  to do when each check fails).

## Permissions added (seeded to the system roles; route inventory and IDOR tests updated)

`attendance.regularization.bulk`, `attendance.override.manage`, `attendance.swipes.view` (manager-grantable, TEAM),
`attendance.finalise`, `attendance.unlock` (Super Admin only).

## Rules I am deciding myself (to be confirmed or vetoed)

1. One `attendance_overrides` table holds regularizations and manual overrides, latest wins, history kept.
2. Regularization applies to **device-capture** days; manual-capture days are corrected in the muster.
3. Holiday and week-off days are not overridable except "worked". **Leave days: overridable to "worked" by HR with an explicit leave reversal (user's change 1).**
4. The roster is **forward-only** because the effective-dating writers are; past shifts are corrected with Shift Override.
5. Bulk caps default to 31 days and 1,000 employee-days, backdating to the previous cycle; all configurable.
6. Flagged punches awaiting a decision **block** finalisation; unmapped punches only warn.
7. The exceptions queue excludes late-in and early-out.
8. Payroll's "consumed" check is a provider that says "no" until Phase 6.
9. Self-action guards apply to every new path (own requests, own days in bulk, own overrides, own roster).
   **Answered yes (user's change 3):** the existing Attendance Settings assignment change is guarded too.
10. "Excess hours" = raw minutes beyond the shift end, until HR defines overtime (user's change 2).
