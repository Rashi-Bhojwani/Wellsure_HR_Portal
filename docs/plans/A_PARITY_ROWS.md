# Session A: payroll rows from the parity audit — written 2026-11-12 before the code

Source: `docs/plans/PARITY_COVERAGE.md` §(d), "Session A (payroll): 38 rows". Tier 1 first, then the rest smallest first. A row that needs an owner decision
or a real value is skipped and listed (with the screen or mechanism built and the value Not set where that is possible). Not built here, by instruction: the
greytHR-file readers (IE-12) and the parallel-run kit (PY-32). Nothing reads `docs/samples/`.

Every row below: Zod on input; `authenticate` + `refuseDeveloper` + a pay permission at the router and a director check in the service (a person's own
document is read by the person only); a route-inventory entry; tests that an employee cannot read another's and that the Developer gets 403; sealed fields in
the field-encryption registry; an audit row on every state change and every download; design-system screens checked in light, dark and at 390.

## Already done (verified, no code)

| Row | Evidence |
|---|---|
| LC-09 Loan recovery in full and final | `offCycleLoanE2E.test.ts` (step 4, c6af1ce): the settlement's `LOAN_OWED` line equals the loan's balance from its source; paid once through an off-cycle run; the loan reads RECOVERED_AT_EXIT. |
| ST-23 Form 16 Part B data (draft until confirmed) | `tax/form16.ts` `requestConfirmation` / `decideConfirmation`; `form16.test.ts` "stays DRAFT ... a different director confirms". The row's requirement *is* the draft-until-confirmed flow. |

## Built in this block

**Tier 1**

1. **ST-24 + SS-05: Form 16 PDF, DRAFT until confirmed.** A PDF of the Part B data the system already holds (`partB`), rendered by the existing locked-down
   renderer. Until a different director confirms the year (and the tax year is confirmed) every page carries "DRAFT: not yet confirmed by a second
   director". Part A is never made: the PDF says it comes from the tax department's portal (ST-25 pairing stays open). Routes:
   `GET /api/payroll/tax/me/form16/pdf?fy=` (the person's own) and `GET /api/payroll/tax/form16/:fy/people/:employeeId/pdf` (directors). Each download is
   audited (`payroll.form16.pdf_downloaded`: year, person, draft or not — no figure). PAN by its last four only.
2. **PY-27 / PY-28 / PY-29: settlement guide (facts only; every rule Not set).** `GET /api/settlements/guide?separationId=`: date of joining, last working day,
   the length of service in years, months and days (exact calendar arithmetic), the last finalised run's earnings lines (the last drawn pay), the leave balance
   in days, and the three rules — gratuity rule, notice period, encashment per-day rate — each shown **Not set** (they are the owners', spec §14). The guide
   never proposes an amount; a director still types each line with its source. Shown beside the prepare form on Payroll → Settlements.
3. **ST-21: quarterly TDS data export.** `.xlsx` and `.csv` of the existing quarterly data (our own layout, PAN by last four, challan serials by their last
   digits), audited with no figures. The official return format stays Not built (ST-22).
4. **IE-09: salary assignment import, our own template.** Upload a `.csv` or `.xlsx` in our template (employee code, structure key, structure version, annual
   CTC, effective from); every row is checked and previewed; committing creates ordinary **salary revisions** (the only path that writes a salary row), grouped
   by structure, CTC and date, each waiting for a different director as any revision does. Nothing is written to a salary row by the import itself. The
   greytHR file layout is not read (IE-12).

**Tier 2 and 3, smallest first (no owner decision)**

5. **ST-03 / ST-06: PF and ESI challan records.** A register like the TDS challans: month, deposited on, amount, the challan reference (sealed; shown by its
   last four; a keyed hash refuses a duplicate), entered by one director and confirmed by a different one retyping the amount and reference. Beside each
   month: what the finalised runs worked out for PF (employee + employer) or ESI (employee + employer) and the confirmed deposits — shown, never computed.
6. **LC-07: loan changes on a screen.** On Payroll → Loans: prepare a change (prepaid, waived, stop the instalments still to come) with a reference; the other
   director approves or rejects; each change shows its state. Reschedule is not in the API and is not built (left Partial).
7. **PY-37: bank summary PDF.** For a written bank file (monthly run): company, run, payment date, rows, total, per bank name the count and total, who prepared
   and who approved it, and a line to sign. No account number, no person's name. Audited.
8. **PY-24: reimbursement statement per run.** For a finalised run, each claim it paid (the consumed reimbursement adjustments): the person sees their own,
   directors see everyone's for a month. Shown on the employee's claims page and on Payroll → Reimbursements. (As built: monthly runs only; a claim paid by an off-cycle run is not listed in this statement — it shows on the off-cycle run.)

## Skipped (owner decision or real value; listed in the report)

LV-14, PY-30, LC-16, ST-30, LC-13, LC-15, ST-07, ST-09, PY-43, ST-02, ST-05, PY-23, PY-41, ST-29, PY-27/28/29 amounts, ST-15, ST-08, ST-16, ST-17, ST-18,
ST-22, ST-25, ST-19; IE-12 and PY-32 by instruction. Where a mechanism with the value Not set already exists (PT, LWF, PF ECR and ESI layouts, the encashment
rate setting) nothing new is built.
