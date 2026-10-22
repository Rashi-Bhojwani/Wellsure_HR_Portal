# payroll

Salary components/structures, employee salary assignment & revisions,
payroll runs (maker-checker), payslips, statutory outputs
(PF/ESI/PT/LWF/TDS), bank transfer batches, loans & advances,
reimbursements, and full & final settlement. See spec §7.5 and
`docs/plans/PHASE_6.md` (plan, and "14A. P6-1 as built").

## Built so far

### P6-4, submit, approve, finalise and the lock (`run/closing.ts`, `run/finaliser.ts`, `run/lock.ts`, `run/submitCheck.ts`)

| File | What it is |
|---|---|
| `run/submitCheck.ts` | What stands between a calculated run and a second person: anyone left out (named, with the reason), blocking problems, placeholder or changed rules, nobody payable, figures that moved. The server repeats it on submit; the preview shows the same list. |
| `run/closing.ts` | The five run-level approvals (`run`, `finalise`, `unlock`, `publish`, `bank-file`) as one shape: preview, request (repeats every check, needs the preview's fingerprint), decide (bound to the hash the checker saw), withdraw or reopen (previewed). Registers the RUN_APPROVAL, PERIOD_FINALISE, PERIOD_UNLOCK, PAYSLIP_PUBLISH and BANK_FILE adapters, and keeps a run's state true to its approval (`reverifyRun`). |
| `run/finaliser.ts` | The only file that may make a run final or unlock one. Each is one transaction that sets the database switch (`payroll.finalising` / `payroll.unlocking`); a source scan keeps it to this file. |
| `run/lock.ts` | The real payroll lock and the "payroll has relied on this attendance" answer, registered in `wiring.ts`. |

A run is SUBMITTED or APPROVED only while its approval is live: voiding the approval for any reason puts the run back to CALCULATED in the same transaction (`onVoided` in the approval core). A change that moves the figures voids the approval at once (adjustments, salary revisions, rule edits and an attendance unlock announce themselves through `notifyPayrollInputsChanged`), and anything that does not announce itself is caught when the run is read, decided on or finalised, because each of those recomputes the hash.

### P6-3, the calculation (`run/`)

| File | What it is |
|---|---|
| `run/rules.ts` | Every rule one calculation reads, as typed values, read through `RuleContext` (so each is pinned); a missing rule is collected with all the others, not thrown alone. |
| `run/days.ts` | Pure: days, the share of a month a person is paid, and a salary segment's share, as **exact fractions** (numerator, denominator). |
| `run/statutory.ts` | Pure: PF, ESI, professional tax, labour welfare fund, the rounding rule. No rate, ceiling or slab is written here. |
| `run/person.ts` | Pure: one person's month (lines, statutory, net, holds, exceptions, hash), from what was gathered and the rules. |
| `run/gather.ts` | Reads everything a run needs through the readers (locked attendance, salary segments, placement, bank, adjustments, encashments) and pins what a salary was frozen under. |
| `run/engine.ts` | The calculation job: lease, chunks, resume, restart, failure in words; `computeRun` works a whole run out in memory without writing. |
| `run/service.ts`, `run/variance.ts`, `run/export.ts` | Readiness, make, preview and request a calculation, discard, read; the variance report; the watermarked register workbook. |
| `run/providers.ts` | The two seams earlier phases left: what each person was paid (arrears, from a FINALISED run) and the daily rate for leave encashment. |

A run can never become FINALISED by anything but the finaliser: the database refuses unless the transaction has set `payroll.finalising`, the run was APPROVED and its two approvals are used up (a source scan keeps the switch to `run/finaliser.ts`). Payroll code reads attendance only through `finalisedAttendanceDays` and year-end items only through `committedEncashments`.

### P6-2, salary (`salary/`, `items.ts`)

| File | What it is |
|---|---|
| `items.ts` | The governed-item core shared by rules, components and structures: versions, status, append, confirm (who may vouch for what is decided here, once). |
| `salary/schemas.ts` | What a component and a structure look like as stored values, and the rules that need no database (a line may refer only to CTC or a line above it, one balance line, formulas parse). |
| `salary/breakup.ts` | Pure: annual CTC and a structure to the frozen monthly lines, exact, with the balance absorbing rounding. |
| `salary/components.ts`, `salary/structures.ts` | List, preview, save, confirm. A structure is proved to add up for a sample CTC before it can be saved. |
| `salary/revisions.ts` | The plan (recomputed from a revision's inputs every time), preview, create, submit, decide, apply, withdraw; registers the SALARY_REVISION approval adapter. |
| `salary/arrears.ts` | Arrears per locked cycle, and the provider seam P6-3 fills with what each person was paid. |
| `salary/adjustments.ts` | One-off earnings and deductions, previewed then added, cancellable until a run uses them. |
| `salary/employees.ts`, `salary/guards.ts` | Reading people's salaries; nobody changes their own pay. |

A salary row is written only by `writeSalaryChange` (`lib/effectiveDating.ts`) and read only by `salaryOn` / `salariesOn` / `salarySegments` / `salaryHistory`. The payroll-lock bypass `writeBackdatedSalaryChange` has exactly one caller, the revision apply step.

### P6-1, foundations

| File | What it is |
|---|---|
| `money.ts` | Exact decimals (`Dec`, 40 digits), six named rounding modes. Numbers are refused at runtime. |
| `hash.ts` | `payrollHash`: canonical JSON, sha256, rejects floats and `undefined`. What every fingerprint and approval is bound to. |
| `formula.ts` | The small formula language (`+ - * / ( )`, `%`, MIN, MAX, ROUND, CEIL, FLOOR). No `eval`. |
| `rules/schemas.ts` | One Zod shape per kind of rule value (percent, money, slabs, tables...). `parseRuleValue` is the only way a value is stored. |
| `rules/governed.ts` | Rules as append-only versions: list, preview an edit, edit, preview a confirmation, confirm (statutory figures need a retype), `ensurePayrollRules`. |
| `rules/context.ts` | `RuleContext` (what a run reads rules through, and what it pins), `assertRunIsReal`, the TEST watermark. |
| `approvals.ts` | Maker-checker, seven subjects. `submit`, `decide`, `consume`, `voidLive`, `noteFiguresChanged`, `checkerAvailability`. |
| `events.ts` | `payroll_events`: who changed which figures when. |
| `exports.ts` | Watermarked XLSX and HTML/PDF helpers. |

Rules for anyone adding payroll code (a test fails if you break the first three):

1. **No numeric literals, no `Number()`/`parseFloat`/`Math.round`/`.toNumber()`** in this folder. Money is `Dec`. A non-money number says so on its
   line with `allow-number: <why>`.
2. **No `new Date()` for a business date.** An instant (when a decision was made) says `allow-clock: an instant`.
3. **Nothing here reaches the network or a bank**, and there is no state that means money was sent. The bank file is for a person to upload.
4. **A figure that decides pay is a rule**, read through `ctx.rule()` / `ctx.decimal()` so the run pins it. Never a constant in code.
5. **History is read through the effective-dating readers**, never a raw `effective_to IS NULL`.
6. **Anything risky is preview, then confirm** with a fingerprint of exactly what was previewed (`PREVIEW_STALE` if it moved).

### P6-5, releasing a final run

| File | What it is |
|---|---|
| `run/payslip.ts` | `buildPayslips`: the whole content of each payable person's payslip, from a final run's stored items and lines (name as of the period end, last four digits only, net in words). |
| `run/release.ts` | **The only file that writes payslips, bank batches and release rows** (a source scan keeps it so): `publishPayslips`, `generateBankFile`. Each is carried out by somebody other than the person who decided, re-checks the approval's hash, and writes what it releases together with the release row in one transaction. The only place an account number is decrypted. |
| `run/payslipDelivery.ts`, `run/payslipHtml.ts` | The worker's job: render the PDF (Chromium), store it, notify, email (no figure), one payslip at a time, idempotent. |
| `run/payslipAccess.ts` | Who reads a payslip: an employee only their own (404 otherwise), HR with `payroll.payslip.view`, the watermarked draft preview. |
| `run/layout.ts` | The layout engine behind the bank file and the statutory files: delimited, fixed width or Excel, header and trailer rows, formats. Refuses (too wide, would change an amount, unknown field) rather than guesses. |
| `run/layouts.ts` | Layouts as governed items (`BANK_TEMPLATE`, `OUTPUT_TEMPLATE`); the debit account is encrypted inside the version and shown only as its last four digits. |
| `run/bank.ts`, `run/bankBatches.ts` | The plan of who is in the bank file (the account in force on the payment date; anyone without one is listed, never dropped), and after it: download (audited), mark paid, attach the bank's response. |
| `run/outputs.ts` | The four statutory files (each from a confirmed layout) and the salary register. |
| `run/releaseController.ts`, `payslipRoutes.ts` | The routes; `/api/payslips/mine` is the employee's own. |

Three more rules: **a layout is data from a specification, never guessed**; **no account number is stored outside the encrypted bank account row** (a batch row has only the hash, the last four digits and the IFSC); **the app never talks to a bank**.

