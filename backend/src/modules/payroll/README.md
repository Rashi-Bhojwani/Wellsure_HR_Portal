# payroll

Salary components/structures, employee salary assignment & revisions,
payroll runs (maker-checker), payslips, statutory outputs
(PF/ESI/PT/LWF/TDS), bank transfer batches, loans & advances,
reimbursements, and full & final settlement. See spec §7.5 and
`docs/plans/PHASE_6.md` (plan, and "14A. P6-1 as built").

## Built so far (P6-1, foundations)

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
