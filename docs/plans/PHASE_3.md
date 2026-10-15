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

### Commit 2 — design as decided before building (2026-10-15)

**Changes the user made on approving commit 1 (2026-10-15)**

1. **Leave days are not refused.** Someone on approved leave who comes in and works is common; refusing it would make the person
   silently lose a leave day they did not take. HR corrects it with Manual Override **in this commit**, as one explicit action
   (the attendance side and the leave-ledger reversal in a single transaction, so the day never reads worked while the ledger still
   says consumed; the "own small commit" fallback was not needed). On the employee's own request screen, a leave day is still not
   something the employee can fix themselves (an employee cannot give leave back), but the message now **says where to go**: ask HR,
   who can mark the day as worked and return the leave balance.
2. **The muster's Excel export carries the corrected marker now**, not in commit 4: the exported muster gets a "Corrected by
   hand" distinction on every cell that was set by a regularization or an override, and the same for the shift override. Exports do
   not stay silently inconsistent between commits.
3. **Local timing is not a baseline.** This sandbox runs the 500-employee replay 2–4× slower than the CI runner (ingest 19.5 s vs
   8.7 s, recompute 92.5 s vs 23 s, 2026-10-13). CI's figures (`backend/perf/baseline.json`, recorded from the CI runner) are the
   only baseline; a local timing failure of the "2× baseline" guard is not a regression. Check CI before chasing it.

**Leave day worked (HR, Manual Override on a leave day)** — the explicit "release leave" action:
- Only HR with `attendance.override.manage` can do it; the form has a separate, ticked option "They worked on a day of approved
  leave: release the leave and return the balance", with the reason required. Without the tick a leave day is reported in the
  preview as "on approved leave" with a pointer to that option, not silently changed.
- One transaction, per leave request covering the date: a `leave_day_releases` row (employee, date, leave request, leave type,
  which part of the day, days returned, the override id, reason, who), a **REVERSAL** row in `leave_ledger` for exactly the days
  that date had consumed (1 for a full day, 0.5 for a half; capped at what the request still has consumed), referencing the
  override, with remarks naming the date and reason; comp-off (COF) is restored **per lot** from the ledger's own per-lot rows; the
  attendance override row (STATUS present / half day, or corrected times); and one audit row.
- The engine then sees no leave for that date (the release removes it for that request), so the day computes as an ordinary day
  with the override applied. It reads "Corrected by hand" plus "Approved leave released: PL 1 day returned" in the day panel, and the
  employee's leave ledger shows the REVERSAL line with the same words. The employee is notified.
- Cancelling the whole leave request later reverses only what is still consumed (the released days are not returned twice); the
  leave calendar and the "leave taken" dashboard skip released days.
- A release is not undone by clearing the override (that would need the leave consumed again). If it was a mistake, HR applies
  leave for the person again through Employee Leave. Clearing is refused for a day with a release, saying so.
- Not allowed: releasing to "absent"; a finalised day; the actor's own day; a day with a pending regularization request.

**Manual Override rules**
- Permission `attendance.override.manage` (HR Admin, Super Admin; never manager-grantable). HR picks people (list, branch or
  department), dates and a correction: set the status (present, absent, first or second half, or "worked" on a holiday or week-off),
  or give the times (both replace the device's, or one adds to them). Reason code and a written reason are required.
- Same preview, fingerprint-confirm, caps (`bulkMaxRangeDays`, `bulkMaxEmployeeDays`) and backdating limit as bulk
  regularization; one audit row per employee-day in the same transaction; raw punches untouched; the actor's own days left out and
  counted (`OWN_ATTENDANCE`); finalised days and days not yet over are reported, not changed.
- It **supersedes**: a day that already carries a regularization or an earlier override gets a newer row (history kept, the screen
  shows what it replaced). A pending regularization request on the day must be decided first (`PENDING_EXISTS`).
- Holiday and week-off days accept only "worked" (the day stays H or O with `workedOnOffDay`, comp-off is HR's call as before).
  Manual-capture people are corrected in the muster, as before; the muster's device-day cells now open Manual Override for HR.
- **Clear override**: appends a CLEARED row, the day goes back to the device's punches; refused when a leave release stands.

**Shift Override rules**
- `shift_overrides` (append-only, latest wins, `shift_id` null = cleared, test-purge exception like the others): a shift for one
  employee on specific dates. Read by the engine ahead of the assignment's shift for the punch window, the day's figures and the
  `daily_attendance` shift columns; a marker `shift_override_ref` on the day says the shift was set for that day.
- Same permission, caps and backdating limit as Manual Override; reason required; one audit row per employee-day; never one's own,
  never a finalised day; holiday, week-off and leave days are accepted (the shift matters if they work); an inactive shift is refused.
- Screen: Shift Override (people, dates, shift, reason, preview, confirm) and the list of overrides with a "clear" action.

**Shift Roster rules**
- Writes through `writeAssignmentChange` (effective-dated). **Forward only: from tomorrow** (stricter than "from today": today's
  day may already have punches evaluated; today and the past are corrected with Shift Override), up to
  `history.maxScheduleAheadDays` (366). A rotation is a list of steps (shift, number of days) that repeats from the start date
  until an end date; a single step with no end is a plain bulk shift assignment. After the end date people either **return to the
  shift they had before** (default) or stay on the last one; the preview says which.
- Regenerating replaces the scheduled rows from the start date onward (cancel, latest first, then append) in one transaction, all or
  nothing; scheduled changes before the start date are left alone. People whose history has ended, the actor, and inactive shifts are
  refused/left out in the preview with the reason. Caps: people per run use the existing bulk cap (`bulkMaxEmployeeDays`), and a person can take at most 60 shift changes in one run (a constant: a daily alternation for a year is refused with the reason, not written). No new setting was added.
- Preview shows, per person, the segments that will be written and the scheduled changes that will be replaced; confirm carries the
  fingerprint. One audit row per employee. Permission: the existing Attendance Settings manage permission.
- The "Phase 2" label on the menu entry is removed (the screen exists now).

**Employee Swipes rules**
- `attendance.swipes.view` (HR roles; manager-grantable at TEAM scope). The raw punch log exactly as received: employee (if
  mapped), device, device user ID, device time as recorded and the instant, route, batch, flag and its decision, and whether it was
  used in a computed day. Filters: dates, device, branch, employee, route, used/not used, flagged, unmapped. Paged server-side.
  **Unmapped punches and punches of people outside the viewer's scope are visible at ALL scope only.** Excel export, capped, with the
  same filters, and a header stating the filters used.
- Read-only: nothing here changes a punch.

**Schema (migration `20261014090000_manual_override_shift_override_swipes`)**: `shift_overrides` (+ trigger, check),
`leave_day_releases` (+ FK RESTRICT to the override and leave request, unique per request and date), `daily_attendance.shift_override_ref`,
permissions `attendance.override.manage` and `attendance.swipes.view`, and the roster-cap setting default is in code.

**Rules I am deciding myself in commit 2** (veto any):
1. Leave-day-worked is done in this commit in one transaction; releasing is not undone by clearing, and a mistaken release is
   corrected by applying leave again.
2. The roster starts tomorrow at the earliest, not today.
3. After a generated rotation ends, people return to their previous shift unless HR chooses otherwise.
4. Manual Override on a manual-capture person's day is refused and points to the muster.
5. A pending regularization on the day blocks Manual Override and Shift Override until decided.
6. Shift Override changes the shift only; the week-off pattern and policy stay the assignment's.
7. The device-health working window still follows the assignment's shift, not a one-day shift override.
8. Swipes shows unmapped and out-of-scope punches at ALL scope only, even to a manager who is otherwise allowed Swipes.

### Commit 2 — as built (2026-10-15)

Built as designed above; what differs, and what was added beyond it:

- **Migrations (two):** `20261014085900_override_kind_release_only` (the enum value alone, as before) and
  `20261014090000_manual_override_shift_override_swipes` (`shift_overrides`, `leave_day_releases`, `daily_attendance.shift_override_ref`,
  the widened kind check, both permissions and their role grants). Both append-only tables carry the same trigger as `attendance_overrides`.
  `shift_overrides.shift_id` is `ON DELETE RESTRICT` (a `SET NULL` would be an update, which the trigger refuses).
- **Leave day worked, as built:** done in this commit in one transaction (the "own small commit" fallback was not needed). Per leave
  request covering the date: a `leave_day_releases` row, a `REVERSAL` in `leave_ledger` (`reference_type LEAVE_DAY_RELEASE`, remarks naming
  the date and reason), comp-off restored **per lot**, the attendance override, one audit row for the day and one for each release
  (`leave.day_released`). The released day is no longer leave for the engine (the loader skips released request-dates), so it computes as an
  ordinary day. Cancelling the request later returns `total_days − released days`; the leave calendar skips released dates; the Workforce
  dashboard's leave-taken total subtracts them.
- **Added beyond the design, decided myself:**
  1. **"Follow the device"** (`attendance_overrides.kind = RELEASE_ONLY`): with the release, HR can leave the day's figures to the device's own
     punches instead of setting a status (a status override drops the person's real in and out times from the day). Only with the release.
  2. **A leave ledger view.** No screen showed ledger rows, so "visible in the leave ledger" had nothing to be visible in:
     `GET /api/leave/ledger` (same visibility as balances), a "Balance history" table on the employee's Leave Balances and a "History" drawer
     on Employee Leave. A `leave.balance.changed` socket event refreshes an open balance page.
  3. The **Granted** figure on Leave Balances no longer counts reversals (a reversal is days given back, not days granted).
  4. Muster export: see the next item.
- **Muster export (user's note 1), and a correction to what I said in commit 1:** the export already carried a `~` after corrected cells since
  Phase 2, so "exports carry no marker" was wrong. What was missing is telling the kinds apart and saying who and why. Now: `~` an approved
  correction request, `#` set by HR (Manual Override, including a released leave day), `^` shift set for that day; and a second sheet,
  **Corrected days**, with one row per marked day (what was set, reason, who, when, leave returned). The footer explains each mark. Employee
  Swipes' export states its filters and scope in the file and is audited (`attendance.swipes.exported`).
- **Refusal messages (user's note 2 to commit 1):** a leave day, a holiday or week-off, and an already-corrected day on the employee's own request
  now say to ask HR and what HR can do. Manual Override on a leave day without the release option is refused in the preview with the
  pointer to the option, not changed silently.
- **Manual Override** also opens from a person's day in Attendance Info ("Set this day") and from a device-day cell in the muster (HR only).
  The history page lists every override and approved correction with who and why, and "Remove" (refused after a release).
- **Roster caps:** no new setting (see the revised rule above). Forward only: tomorrow at the earliest.
- **Swipes:** `used` is computed in SQL from `daily_attendance.computed_from.punchIds` (±1 day for night shifts), so the filter pages correctly.
  A manager with the key sees their team's punches only; punches matching nobody and the "matching nobody" filter are for company-wide scope.
- **Day detail** now returns `employeeName`, `leaveReleased` and `shiftOverride`; the day panel shows each in words.
- **Local timing note (user's note 3) is recorded above** ("Local timing is not a baseline").

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
