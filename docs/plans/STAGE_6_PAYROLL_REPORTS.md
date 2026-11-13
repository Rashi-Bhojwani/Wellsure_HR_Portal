# Stage 6: payroll reports — written 2026-11-12 before the code

Covers parity rows **RP-09** (payroll summary, department cost), **PY-42** (cost by department), **RP-08** (PF, ESI and PT in a report gallery), **RP-10** (CTC),
and the owner's list for this block: head-wise summary, bank-transfer summary, loan and claim summaries, statutory summary, variance between months. Not here: the
exit report (RP-11) and the query builder (RP-12) are in the other session's list; nothing reads `docs/samples/` (not clean).

**Where.** Payroll folders only (`backend/src/modules/payroll/reports/`, `frontend/src/pages/admin/payroll/PayrollReportsPage.tsx`), its own catalog in
`shared/constants/payrollReports.ts`. The general Reports app (another session's folder) is not touched.

**Who.** Directors only: router gate `payroll.salary.view` (HR never holds it) plus a director check in the service; the Developer role refused outright. Every
report reads company-wide (data scope ALL is the directors'). Managers and employees are refused.

**What each report reads** (finalised runs only, never a draft, so a figure on a report is a figure that was paid or held; exact decimals throughout, shown to
the paisa; money is never rounded before it is added up):

| Key | Report | Filters | Rows |
|---|---|---|---|
| `payroll-summary` | Payroll summary | from / to month | one per finalised run: people paid and held, gross, deductions, employer contributions, net paid, net held, cost to company |
| `department-cost` | Department-wise cost | month, department, location | one per department the run placed people in |
| `head-wise` | Head-wise summary | month, department, location | one per pay head (code, label, earning / deduction / employer / rounding): people and total |
| `bank-transfer` | Bank-transfer summary | from / to payment date | one per bank file (run, repayment, off-cycle): rows, total, file name, sent to the bank, rows the bank rejected — never an account number |
| `loans` | Loan summary | as of | one per sanctioned loan: principal, rate, instalments, recovered, balance, where recovery stands |
| `claims` | Claim summary | from / to date spent | one per claim type and state: claims, claimed, approved |
| `statutory-summary` | Statutory summary | month | one per statutory line (PF, ESI, PT, LWF, TDS): people, employee share, employer share |
| `statutory-by-person` | PF, ESI, PT, LWF and TDS by person | month, department, location | one per person: each statutory line the run worked out |
| `variance` | Variance between months | month and the month to compare with, department, location | one per person in either run: gross and net in each, change, change % |
| `ctc` | CTC | as of, department, location | one per employee with a salary in force: annual and monthly CTC, structure, from |

No report works out a tax or statutory figure: each one adds up what finalised runs already worked out from the rules the directors confirmed.

**Columns ("Default, change in settings").** Each report ships with a conventional set of columns switched on; the screen lets a director switch columns on and
off for what they are looking at and export exactly those. A director may save a column choice as the company's layout for that report (with a reason;
audited; kept as an append-only history, the newest in force). Until one is saved the screen says "Default, change in settings".

**Exports.** `.xlsx` and `.csv`, of the columns chosen, with the filters printed above the rows. Every export writes an audit row (report, format, filters,
columns, number of rows — never a figure). CSV cells that start with `=`, `+`, `-` or `@` and are text are quoted with a leading apostrophe (formula injection).

**Tests.** HR, a manager, an employee and the Developer refused every route; no sign-in refused; each report's totals against an independent sum of the run's own
rows (exact, in paise); department and location filters; the variance against an independent model; exports carry only the chosen columns, contain no account number,
and are audited; layout saves audited, append-only, refused to non-directors; mutation checks on the arithmetic and the gates.
