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
