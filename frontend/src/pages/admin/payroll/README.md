# Payroll app

Salary components/structures, employee salary & revisions, Payroll Run,
variance report, maker-checker, payslip publishing, statutory outputs, IT
declaration review, Form 16/TDS, loans, reimbursements, full & final
settlement, bank disbursement. Phase 6+. See spec §7.5 and
`docs/plans/PHASE_6.md`.

## Built so far

| Screen | File | What it is |
|---|---|---|
| Rules and Setup | `RulesPage.tsx` (+ `RuleValueInput.tsx`, `ruleValues.ts`) | Every figure that decides a payslip, Not set / Placeholder / Confirmed; a statutory figure is confirmed only by typing it again (P6-1) |
| Salary Components | `ComponentsPage.tsx` | What a line of a salary is: kind, taxable, PF, ESI, pro-rating. Preview, save as unconfirmed, confirm by a different person (P6-2) |
| Salary Structures | `StructuresPage.tsx` | How much each line gets out of CTC. The editor proves the lines add up for a sample CTC before it saves (P6-2) |
| Employee Salaries | `EmployeeSalariesPage.tsx` | Everyone's current salary and each person's timeline. Nothing is edited here (P6-2) |
| Salary Revisions | `SalaryRevisionsPage.tsx` | The only way a salary is written: prepare with a preview, a different person approves, the preparer applies (P6-2) |
| Adjustments | `AdjustmentsPage.tsx` | One-off earnings and deductions, and the arrears a back-dated revision made (P6-2) |
| Payroll Runs, one run | `PayrollRunsPage.tsx`, `PayrollRunPage.tsx` | Start a run, calculate it, read every person and why, the difference from last month, what it used (P6-3); the Approval panel on the run says what is next (P6-4) |
| One step on a run | `RunStepPage.tsx` | Submit for approval, close the period, unlock it, publish payslips, the bank file: look at exactly what it would do, say you have, ask or decide. **The people a run leaves out are the first thing on the submit page.** (P6-4) |

Shared pieces live in `components/payroll/` (`ItemStatusTag`, `CheckersNote`, `ItemDialogs`, `RevisionPlanTable`) and `lib/money.ts`, which formats
exact decimal strings as rupees without ever turning them into a JavaScript number.
