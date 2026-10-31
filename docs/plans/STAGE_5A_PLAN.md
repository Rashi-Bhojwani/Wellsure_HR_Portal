# Stage 5a: remote attendance (check in and check out, decided by the directors)

**Source of the feature list.** The owner's earlier "D-10" list was not in the material this session could read. This plan is built from the Stage 5a paragraph of the owner's last instruction; where that paragraph is silent the choice is listed under "Decided by me" and in `DECISIONS_FOR_OWNERS.md`. Nothing here ships a value: nobody is remote until a director marks them, and the reminder threshold and the suggested rejection outcome are Not set.

## What it does
* **Who is remote.** A director marks a person remote (or not remote) from a date, with a reason. Marks are append-only (a database trigger refuses a change or a delete, and refuses any writer who is not a Super Admin). On a day, the latest mark effective on or before it decides; no mark means not remote.
* **The day.** A remote person has *Check in* and *Check out* on Attendance Info. The server stamps the time. Nothing about place is asked for, sent or stored: the table has no such column, and a test reads the column list. One check-in and one check-out a day. Check-out sends the record to the directors (a notice to each director except the owner of the record).
* **Decision, by a director only.** Approve a full day; approve a half day (the director says which half, nothing is chosen for them); or reject with a **required reason** and a **required outcome** (Absent or Loss of pay, chosen then; a separate suggested outcome setting exists and is Not set). A database check refuses a rejection with no reason or outcome. A director never decides their own record or answers their own request: the other director does.
* **Bulk.** Bulk approve is for full days (a half day needs the half named, so it is one at a time). Bulk reject needs a reason and an outcome. Records a director may not decide, or that are no longer waiting, are skipped and reported.
* **Reopen** (a decided record, with a reason): the day's override is cleared and the record waits again. **Correction request** (a person asks to fix a wrong time before the day is decided) and **review request** (a person asks a director to look again after a decision); a director accepts or declines with a note. An accepted correction changes the times; an accepted review reopens the day.
* **Reports** (per person: days, full, half, absent, loss of pay, waiting, hours). **Notifications**: the person is told of a decision (with the reason if rejected), a reopening and the answer to a request; directors are told of a waiting record and a request. **Reminder**: `sendDueReminders` tells the directors about records waiting longer than the threshold, once each; with the threshold Not set it sends nothing.

## How the outcome reaches attendance and payroll
A decision is one attendance **override** row (the engine's own path: append-only, latest wins), then the day is recomputed. Full day → status Present (no loss of pay). Half day → the half named is present, the other absent (half a day of loss of pay). Rejection → Absent (one day of loss of pay). Payroll reads `lop_days` from the day exactly as it reads any other; **the payroll calculation is unchanged**. Absent and Loss of pay are two choices a director makes; today both reach attendance as the same absent day, and the record keeps which was chosen. A finalised day (attendance locked) refuses a decision or a reopening until the period is unlocked.

## Access
Directors' routes use the permission `attendance.unlock` (held only by Super Admin) and an explicit director check in the service on every call. HR, managers and the Developer role get 403 on all of them; a decision's reason is visible to directors and to the person themselves, and is deliberately kept out of the audit row. The person's own routes are SELF: a request on somebody else's record answers 404.

## Decided by me (to confirm)
1. Absent and Loss of pay are the same engine outcome (one day of loss of pay) and differ only in what is recorded. If the owners mean something different for payroll (for example a leave-without-pay entry in the leave ledger), say so.
2. A half day names its half; no default.
3. Bulk approve is full days only.
4. Check-in works only on the day itself; a forgotten check-out is fixed by a correction request.
5. One decision-and-reopen cycle at a time, no limit on reopenings; each is in the history.
6. A dedicated permission key was not added: the existing Super-Admin-only `attendance.unlock` is reused, with the director check. A dedicated key would be cleaner.
7. The reminder threshold is whole hours (1 to 200).

## Commit
One group: schema and migration, rules, service, routes, tests (rules, database and routes, mutation checks), screens (employee card; director page with Waiting, All days, Requests, Who is remote, Report, Settings), walkthrough.
