# P7-6: full and final settlement, and off-cycle runs — written before the code

Session continuing Session A, 2026-11-10, on `PHASE_7.md` §10 and the owners' decisions (directors are the payroll team; no CA, so every statutory
figure is director-entered with a source note and confirmed by a different director; money moves only through payroll runs and manual bank files).

## Built in this step: the settlement, prepared and confirmed

For a separation that is not cancelled, a director prepares a settlement. Its lines, each with its source:

| Line | Where it comes from | Built as |
|---|---|---|
| Pay held in a final run | each HELD item of a FINALISED run for the person not yet released | automatic: the item's net pay, referencing the item |
| Pending adjustments | the person's PENDING adjustments (approved reimbursements, arrears, loan instalments not yet recovered…) | automatic, each referenced |
| Loan still owed | the balance of each sanctioned loan (read from what was paid and recovered) less instalments already pending | automatic recovery line per loan |
| Leave balance | the days in the leave ledger at the last working day | automatic **days only**; the amount is a director-entered line (the encashment formula is an open question, spec §14) |
| Notice pay or recovery, gratuity, final TDS, anything else | the directors | director-entered lines, each with a source note |

The total is worked out exactly. A negative total is never paid; it is shown as an amount to recover outside payroll.
The settlement is immutable once prepared; a change is a new settlement that replaces it. It is confirmed by a **different director**
(`FNF_SETTLEMENT`, bound to a hash of every line); nobody prepares or confirms their own. HR, managers and the Developer role see nothing.

## Not built in this step: paying it (off-cycle runs)

Paying a settlement needs an **off-cycle run** for one person on its own road (calculate, approve, finalise, payslip-like statement, bank file) that
does not lock the attendance cycle and consumes the held items and adjustments exactly once. That is a change to the core run engine (run kind, a
partial unique index, gather, finalise, closing, the bank file) and is planned as its own item (**P7-6b**). Until it exists, a confirmed settlement shows
"Confirmed — waiting for an off-cycle run" and nothing is paid. Nothing here moves money.

## Tests
Routes refuse HR, managers, employees and the Developer role; a different director confirms, never one's own; automatic lines match their sources
(an independent sum); a negative total is never payable; immutability; mutation checks.

## P7-6b: off-cycle runs (design, written 2026-11-11 before the code)

**Ordinary runs are not touched.** The regular run engine (one run per cycle, its calculation, its finaliser) is unchanged; an off-cycle run is its own
pipeline over figures that are already exact and confirmed (a confirmed settlement, or the net pay of a HELD item of a final run). Regression: the whole
existing payroll suite must pass unchanged, and a test proves a regular run's figures are identical with an off-cycle run present for the same person.

**What it pays.** `SETTLEMENT` (a confirmed settlement with a positive total) or `HELD_PAY` (one HELD item of a FINALISED run, not released). Lines are
copied from the source; the net is never negative.

**The road, the same rules as a regular run:**
1. A director prepares it (never for their own pay), with a payment date. The real company is refused while the Ready-for-first-run list has any
   blocker; the demo company may rehearse.
2. Approval: `OFF_CYCLE_RUN` through the approvals core, under the **same second-director choice as a regular run** (`RUN_APPROVAL`: a different director
   decides, or the acting director alone if the owners chose that; an unchosen step refuses).
3. Finalise: by someone other than the approver (unless the director-authority choice), after checking every source is still unpaid. In one transaction:
   the approval is consumed, a finalisation row is written (**unique per source: nothing is paid twice**), held items get a release row (unique per item,
   shared by both kinds), the settlement's pending adjustments are marked paid (so no regular run pays them again), each loan's exit recovery is recorded
   (the loan's balance reads it), and the statement (payslip-like, stored whole) is kept.
4. Bank file: `OFF_CYCLE_BANK` approval under the **same choice as a regular bank file** (`BANK_FILE`), carried out by a non-approver; the confirmed bank
   layout; the account in force on the payment date (checked against its blind index); the demo company's file is named and marked DEMO and only from a
   layout that says DEMO; the real company's never is. Downloaded files can be marked sent to the bank, once.

**Tables (immutable, test-only purge):** `off_cycle_runs`, `off_cycle_finalisations` (unique run; unique kind+source), `off_cycle_held_releases` (unique
item), `off_cycle_loan_recoveries`, `off_cycle_bank_batches` (unique run); `bank_file_sent_marks` gains an off-cycle file column.

**Tests:** routes refuse HR, managers, employees and the Developer role; the second-director choice; finalising twice and paying the same source twice
are refused (and a mutation that drops the unique key is caught); a regular run's figures are unchanged; the settlement arithmetic against an
exact-fraction model; the demo file is named DEMO; the real company is refused while readiness is red.
