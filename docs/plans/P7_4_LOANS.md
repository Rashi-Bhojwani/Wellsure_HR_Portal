# P7-4: loans and advances, written before the code

Session continuing Session A, 2026-11-06, on `PHASE_7.md` §8 and the owners' decisions in force (directors are the whole payroll team; every money
value is entered by a director; no preset values; maker-checker; Principal Part and Interest Part are director-created input heads, D-31/D-35).

## What is built

1. **Loan types** (directors): name, the maximum amount and number of instalments, the yearly interest rate (a figure the directors enter; zero is a
   valid choice, but nothing is preset), whether employees may ask for one, and the **three pay heads** a loan uses: the head the money is paid
   under (an earning), the head the principal part is recovered under and the head the interest part is recovered under (deductions). Each Not set
   until a director chooses; a type with any of them Not set cannot be sanctioned. Append-only versions; a type is retired, never deleted.
2. **Request.** An employee asks (only for a type that allows it), or a director enters one for a person. Draft until sanctioned.
3. **Sanction is maker-checker** (`LOAN_SANCTION`, bound to a hash of principal, rate, instalments, the first recovery month and the schedule): one
   director prepares, a **different** director approves (always: it is money). Nobody prepares or approves their own loan. Rejecting closes it.
4. **The schedule** is worked out exactly (decimal, paise) when the sanction is prepared: equal instalments by the reducing-balance method at the
   type's rate (zero rate: equal principal), the last instalment taking the rounding remainder, so the parts sum to the principal to the paisa.
   It is stored with the loan and shown before the sanction.
5. **Money moves only through payroll runs.** On approval the system adds, as pending adjustments: one earning (the disbursement) for the next
   run, and for each instalment a principal deduction and (when non-zero) an interest deduction, each **due in its month** (a run reads only
   instalments due in or before its cycle). A run pays and recovers them like any adjustment; finalising consumes them; unlocking returns them.
   A net pay that cannot cover an instalment stops the run (the existing "negative net" refusal); what to do then (skip and extend, part) is a
   director choice per run, not a preset rule — **Not built: the choice; until owners decide, the director cancels and re-plans the instalment.**
6. **The ledger is never a mutable balance.** The loan's statement is read from what happened: the disbursement paid (its adjustment consumed),
   each principal part recovered (consumed), and append-only `loan_events` (PREPAID with a reference, WAIVED with a reason — both maker-checker),
   balance = principal − recovered − prepaid − waived, worked out on reading. Instalments not yet due or not yet paid are listed as to come.
7. **Changes** (prepayment, waiver, cancelling unpaid instalments) are prepared by a director and approved by a different director.
8. **Statements.** The employee sees their own loans (Salary → Loans and Advances), never anyone else's. Directors see all. HR, managers and the
   Developer role see nothing (no route, menu, count).
9. **Perquisite** on a concessional loan: **not built** — it needs the owners' rule (and source note) in the tax year; recorded as open.

## Tests
Routes refuse HR, managers, employees (except their own) and the Developer role; the sanction needs a different director; nobody acts on their own
loan; the schedule against an independent BigInt paise model (many random loans: parts sum to the principal; interest by reducing balance); a run
pays the disbursement and recovers only due instalments; finalise consumes, unlock returns; the statement's balance against an independent sum;
append-only events (database); mutation checks on each rule.
