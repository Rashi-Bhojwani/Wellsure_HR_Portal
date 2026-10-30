# Stage 4 — Monthly Inputs and their import (directors only)

Written before the code. Nothing here ships a value: the input heads are created by the directors (Not set until they do), the month is judged open only after attendance is finalised, and no figure is entered by the developer outside tests and the demo company.

## What already exists (checked)
* A pay head can be flagged `inputItem` ("takes its value from Monthly Inputs", Stage 3.1b); such a head is never a salary-structure line.
* Attendance finalisation locks days per employee and cycle (`finalisedAttendanceDays`, `payrollLockedBetween`); the muster holds no money.
* One-off adjustments (`PayrollAdjustment`) already flow into a run as lines with PF/ESI flags from the head. Maker-checker (`approvals.ts`) binds an approval to a canonical hash and voids it when the figures move.
* Nothing exists for: the grid, the monthly figures, their history, the import, or the run's refusal for missing inputs.

## Design
**Figures.** `payroll_monthly_inputs`, append-only (database trigger, test-purge exception as for the other payroll ledgers): one row per entry — employee, head code, payroll month (`cycle_start`), an exact decimal amount (or a *clear*), who, when, a reason and, when it came from a file, the batch. The current figure of a cell is its newest row. **Blank means nothing entered; zero means entered as zero**: a clear writes a row that returns the cell to blank. A value only changes by a new dated entry; nothing is overwritten.

**States of a month.** attendance not finalised → *closed* (the grid refuses entry and says why) → *open* (attendance finalised) → *confirmed* (a different director approved these exact figures) → *locked* (a payroll run for that month has been calculated and not voided). A change after the lock goes through the existing unlock (maker-checker) or as an adjustment / arrear in a later month; the refusal says so.

**Confirmation.** A new approval subject `MONTHLY_INPUTS` (subject id = the month's first day). Its hash is the canonical hash of every current figure of the month, sorted; any entry after the request or the approval changes the hash and voids it (the same mechanism as a run). The second-director choice for this step is a new director step with no default (Not set until the directors choose), like every other payroll step.

**Grid.** Server-side pagination and filters (department, employee, head, status: not entered / entered / changed this month / confirmed). Rows are employees; columns are generated from the heads flagged `inputItem` and active in the month, never hard-coded. Bulk edit (up to 500 cells per request). Per-cell history; a Salary Input History view. Usable on a phone (cards, one head at a time).

**Import.** The layout of `Bulk Salary Overrides`: *Employee Number, Override From, Override Till, Principal Part, Interest Part, Remarks*, then one column per input head. `.xlsx` and `.csv`. Header names are matched to the heads' names or codes, case-insensitively; "Overide" (the sample's spelling) and "Override" both read. Flow: upload → preview (every row, line numbers, errors in words) → a director confirms. Nothing is saved before that. The same file (by hash) is never applied twice. **Any invalid row refuses the whole file** unless the director explicitly chooses "skip the invalid rows", which is recorded. Whole confirm is one transaction. Full audit (no figures in the audit row).
* *Override From / Till* is **unconfirmed by the owners**: it is read as an inclusive range of payroll months (the months containing those dates), the figures apply to each month in the range, and the screen says so.
* *Principal Part* and *Interest Part* belong to loans (a later stage). They are read, shown in the preview and kept on the batch, but **not posted to any payroll month**; the preview says so.
* *Slab Salary Bonus*, *Training Exp*, *Old Month Discrepancy* are **not assumed to mean anything**: they are only column names. They import only if a director has created a head with that name and flagged it.

**Run.** A run for a month refuses to calculate while a flagged head has no confirmed figure for somebody in the run, naming each (employee and head), and while the month's inputs are not confirmed. The confirmed figures become lines of the run (earning or deduction as the head says, PF/ESI by the head's flags), through the same line path as an adjustment; the calculation itself is unchanged.

**Access.** Directors only, on every route and screen. HR, managers, employees and the Developer role are refused (403) and see no menu entry.

## Commit list
1. 4.1 plan, schema + migration (ledger, batches, approval subject, step), pure rules (state of a month, hash, the cell model).
2. 4.2 grid API, entry, history, confirmation (request / decide), the run's refusal and lines.
3. 4.3 import (parse, preview, confirm, idempotency, skip-invalid), tests with the sample layout.
4. 4.4 screens (grid, import, history, confirmation), light / dark / phone, second-director confirm.
