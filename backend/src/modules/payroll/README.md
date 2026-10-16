# payroll

Salary components/structures, employee salary assignment & revisions,
payroll runs (maker-checker), payslips, statutory outputs
(PF/ESI/PT/LWF/TDS), bank transfer batches, loans & advances,
reimbursements, and full & final settlement. See spec §7.5 and
`docs/plans/PHASE_6.md` (plan, and "14A. P6-1 as built").

## Built so far

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
