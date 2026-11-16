# Session A part 3 — written 2026-11-13 before the code (owner decisions of 2026-11-13)

Speed rule: commit as I go with each feature's tests; one check script per phase (stops at the first failed step); full backend suite alone once at the end,
after the last pull (no pull while it runs); CI read once on the final code commit. Golden regression tests are captured from the code as it is BEFORE each change.

## Golden baseline (first)
`goldenRun.test.ts` builds the shared closing world (three people, real rules, one finalised August run, a director hold) and compares every item's figures and lines
(pay-head prefix removed) with `fixtures/golden-run.json`, written once from today's code (`GOLDEN_WRITE=1`). Every later phase must keep it identical while the new
settings are Not set and with one company.

## Phase A — the other session's requests 4, 5 and 6 (mechanisms; every value Not set)
- **A1 dated statutory IDs (owner decision: effective-dated, conventional).** `employee_statutory_dated`: a copy of PAN last four, UAN and ESI (sealed as stored) and
  their last fours, with the day it took effect, written by a database trigger on every write to `employee_statutory` (so every write path is covered). Backfill: today's
  row. Reader `statutoryOn(ids, day)`: the latest copy on or before the day; before a person's first copy, their first copy (the first value known applies backwards).
  Payslips, the PF/ESI files and Form 16 read it for the date they process. Limit: a change is recorded when the PAN hash or a last four changes (UAN and ESI have no
  keyed hash). The encrypted columns join key rotation; the guard allows only re-encryption updates.
- **A2 overtime pay.** Behaviour setting `payroll.overtimePay`, Not set, proposed by one director and confirmed by another: the pay head, and either a flat rate per
  hour or a multiplier of an hourly rate (chosen heads of the salary in force ÷ hours a month). A director posts a month: approved overtime (the other session's
  `overtime_claims`) becomes one pending pay adjustment per person, only when the overtime setting is on AND the pay setting is confirmed. Exact arithmetic; tested with
  fake values labelled TEST against exact fractions.
- **A3 leave encashment (in the year and at exit).** Behaviour setting `payroll.leaveEncashment`, Not set, two directors: the pay head, the heads of the salary in force
  forming the per-day basis and the divisor (a fixed number of days, or the month's calendar days). In the year: a director pays approved requests (the other session's
  `leave_encashment_requests`) — a pending pay adjustment and the leave-ledger ENCASHMENT entry in one transaction, once. At exit: the settlement's leave-balance line
  gets its amount only when the setting is confirmed; while Not set it stays days only, as today.
- Golden: the baseline unchanged with approved overtime and encashment present and the settings Not set; settlements unchanged.

## Phase B — requests 7 and 8
- **B1 company filter on the payroll reports** (the other session's `legal_entities` / `employee_legal_entities`; no row = the main company).
- **B2 payroll per company, small steps:** (a) per-company statutory and bank settings (registrations, bank layout) — Not set; (b) a run for one company: the run's
  company recorded beside it, and the people it gathers limited to that company; with one company everything is as today (golden).
- **B3 statutory registers** from finalised runs: register of wages (per person, each head as its own column), register of deductions, overtime register — layouts as
  conventional defaults ("Default, change in settings"), directors may change them; no statutory figure invented.

## Not touched
`customFields.test.ts` (the other session is fixing it).
