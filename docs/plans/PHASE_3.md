# Phase 3 — attendance administration: implementation plan

Status: **awaiting the user's confirmation** (2026-10-13). The design decisions are the user's and are not re-planned here;
this document says how they are built on what Phase 2 left, and lists what I decided myself. Four commits, a pause after each.

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

- Four reports in the existing reports framework (`late-coming`, `overtime`, `exception-summary`, `attendance-muster`), the same
  `lib/xlsx.ts` helper, `reports.view` and the same data-scope rules (a manager sees only their team), screen and export from one
  result. Overridden and manually set days carry a marker column in every one. Each report warns when placeholder rules were in
  use ("computed with rule values HR has not confirmed").
- **Overtime** has no HR rule yet, so it reports the raw minutes worked beyond the scheduled shift end (`excess_minutes`) with a
  configurable minimum to count (default 0), labelled provisional until HR defines overtime.
- Close-out: every Phase 3 screen with its URL; what stays unproven until the device is connected; and
  `docs/CONNECTION_DAY.md`, a step-by-step procedure to follow at the office (what to bring, what to run, what to check, what
  to do when each check fails).

## Permissions added (seeded to the system roles; route inventory and IDOR tests updated)

`attendance.regularization.bulk`, `attendance.override.manage`, `attendance.swipes.view` (manager-grantable, TEAM),
`attendance.finalise`, `attendance.unlock` (Super Admin only).

## Rules I am deciding myself (to be confirmed or vetoed)

1. One `attendance_overrides` table holds regularizations and manual overrides, latest wins, history kept.
2. Regularization applies to **device-capture** days; manual-capture days are corrected in the muster.
3. Holiday, week-off and leave days are not overridable (off days: "worked" only).
4. The roster is **forward-only** because the effective-dating writers are; past shifts are corrected with Shift Override.
5. Bulk caps default to 31 days and 1,000 employee-days, backdating to the previous cycle; all configurable.
6. Flagged punches awaiting a decision **block** finalisation; unmapped punches only warn.
7. The exceptions queue excludes late-in and early-out.
8. Payroll's "consumed" check is a provider that says "no" until Phase 6.
9. Self-action guards apply to every new path (own requests, own days in bulk, own overrides, own roster).
   **Question:** also guard the existing Attendance Settings assignment change for your own record (open since Phase 2)?
10. Overtime = raw minutes beyond the shift end, provisional, until HR defines it.
