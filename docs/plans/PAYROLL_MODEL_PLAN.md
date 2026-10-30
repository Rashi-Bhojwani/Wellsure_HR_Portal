# Stage 3 — Payroll model (capabilities only, no values)

Written before any Stage 3 code. Everything below is a capability the directors can configure; the real company ships with nothing chosen
("Not set"). Only the DEMO company may carry made-up values. Statutory figures carry a **source note** and an **effective-from date**
(no CA flag), confirmed by a different director — Confirmed/Placeholder as before.

## 3.0 What already exists (checked in the code, not from memory)

| Capability | Status | Where |
|---|---|---|
| Pay heads | **Partly.** Called *components*: governed, versioned, Placeholder→Confirmed. Fields today: name, type (earning / deduction / …), taxable (required yes/no), PF applicable, ESI applicable, prorates, payslip label, payslip order. Structures hold the lines: calc = percent of CTC or of an earlier line, fixed amount, per-person, formula, balance. Cycles, one balance line and "refer only to CTC or a line above" are already validated. | `salary/schemas.ts`, `salary/components.ts`, `salary/structures.ts` |
| Pay-head options still missing | type one-off / reimbursement / counter / statutory; method slab-or-lookup and "input from Monthly Inputs"; one-time; taxable *Not set*; link to arrears head and reversal head; carry-forward; reimbursement flag; CTC group; YTD flag; bank-transfer flag; payslip visibility; active from/to; counters and salary-master values as building blocks; derived calculation order shown; "inactive head cannot be referenced"; "a head used in a finalised run cannot be deleted, only retired". | — |
| Salary rules | **Partly.** `RULE_CATALOG` has pay-days basis, fixed days, LOP divisor, line / PF / ESI / net rounding, payment date, negative net, arrears payout and PF/ESI-on-arrears. Missing: per-head rounding, LOP-reversal look-back, arrear-on-arrear, look-back override setting. **Shipped statutory placeholders still exist** ("From memory, unverified": PF 12 / 8.33 / 3.67 / 0.5 / 0.5, ceiling 15000, ESI 0.75 / 3.25 / ceiling 21000, PF and ESI rounding modes). These contradict "no preset values" and are removed in 3.2. | `shared/constants/payrollRules.ts` |
| Run refuses while a required rule is Not set | **Yes** (`RulesMissingError`, collects all missing keys at once). Must also cover the new rules and the removed placeholders; tested. | `run/rules.ts`, `rules/context.ts` |
| Arrears | **Partly.** A back-dated salary revision creates one pending adjustment per locked cycle with a per-component breakdown, computed as (new − old) × share actually paid. Never alters a finalised run. Missing: arrears lines **linked to source month and head** on the payslip, arrear-on-arrear (arrear lines feeding dependent heads), the setting for it. | `salary/arrears.ts`, `salary/revisions.ts`, `PayrollAdjustment` |
| Reversals / LOP reversal after a run | **Missing.** Attendance corrected after a finalised run produces nothing today. No look-back, no override, no idempotency key. | — |
| Hold / release | **Partly.** Automatic holds exist (no bank account, negative net, attendance not final, …) and a "people without a payslip" list. Missing: a **director's** hold of a person for a month with a reason, carry-forward of the held amount, a director release that appears in the next run, held pay in full-and-final. | `run/held.ts`, `HoldReason` |
| Rounding | **Yes**, six exact modes (`money.ts`), global rules. Per-head: missing. | `money.ts`, `run/statutory.ts` |
| Rule hierarchy (company → department → employee) | **Missing.** Every rule is company-wide, read through `RuleContext`. | `rules/context.ts` |
| Payslip "Why?" | **Missing.** `PayrollRunLine.basis` (JSON) holds working per line; no screen or API explains a line, and nothing shows a rule's source note, effective-from date or confirmer. | `run/payslip.ts` |
| Money in the muster / attendance finalisation | **None found** (checked the attendance models and services: only day counts such as LOP days; no amount, salary or CTC). Stage 3 does not stop. A test that pins this is a Stage 4 item. | — |

## Design (plain language)

**Principles.** Extend, never rename or rebuild. Old stored versions must still read (every new field is optional on read; absent means *Not
set*). A head that has any required choice *Not set* cannot be used in a run; the run says which. All changes are effective-dated, saved as
Placeholder and confirmed by a different director (existing governed-item machinery, existing director authority settings).

### 3.1 Pay heads
* Extend the component value with the missing options. Nothing preselected; "taxable" accepts true / false / *not set*.
* Calculation methods added to a structure line: *slab or lookup* (a table, entered by the directors) and *monthly input* (value comes from the
  Stage 4 grid; until Stage 4 the method can be chosen and the run treats a missing input as a blocking problem, not zero).
* Building blocks selectable in formulas and percentages, none chosen for anyone: counters (days in month, employee workdays, effective workdays,
  LOP days) and salary-master values (full basic, full HRA, full special allowance, annual CTC, monthly CTC) — as names, resolved by the engine.
* Links: an arrears head and a reversal head are ordinary heads; the link is a field pointing at them.
* Validation, all pure functions with tests: no cycle (including through the new links), an active head cannot reference an inactive one,
  a head used in a finalised run is retired (active-to date) rather than deleted, the calculation order is derived from dependencies and
  returned for display (topological order, ties by payslip order).
* Screen: the existing component/structure screens gain the new fields, the derived order, and "Not set" markers.

### 3.2 Salary rules
* Add to the rule catalog, all company rules shipping empty: per-head rounding (a head may override the global mode), LOP-reversal look-back (months),
  look-back override allowed (yes/no), arrear-on-arrear (yes/no). Pay-days basis keeps its three options; no other basis is invented
  (any extra would be a guess about the owners' law/policy).
* Remove every shipped statutory placeholder from `RULE_CATALOG` and from the seed/ensure step. The demo company sets its own made-up values.
  `SHIPPED_PLACEHOLDER_KEYS` becomes empty and a test pins that. The statutory rule screens say "Not set — enter from your source".
* `notRequiredForFirstRun` unchanged. Required-and-Not-set rules refuse a run with the whole list; tested for each new rule.

### 3.3 Arrears, reversals, retro LOP, hold
* **Arrears lines.** Each arrear line is stored with source month, source head and the revision it came from (columns on the adjustment breakdown,
  unique on revision + month + head). Paid in the run the directors choose (existing adjustment consumption). With arrear-on-arrear ON, an arrear
  amount on a base head is also an input to heads defined as a percentage of that head; OFF, it is not. A finalised run is never altered
  (already enforced by the database; kept).
* **LOP reversal.** A new append-only table of attendance corrections for a period whose run is final, with idempotency key
  month + employee + correction id (unique). For each prorated head the engine posts a reversal line (amount = head amount × days restored ÷ pay-days
  basis, exact fractions, rounded by the head's rule) in the next run; consumed exactly once. Older than the look-back: refused with a clear message;
  a director may record an override reason when the setting allows it. Attendance finalisation itself still carries no money.
* **Hold salary.** New append-only table: hold (employee, month, reason, director, time) and release (director, time). The run marks the person HELD
  with a new reason `DIRECTOR_HOLD`, carries the unpaid amount forward as a visible carry line, and pays it in the run in which the release is
  recorded. Held pay appears in the full-and-final calculation. The Hold-Release report is Stage 6.
* Both are director-only actions (existing permission + director authority), audited, with notices to the other director.

### 3.4 Rule hierarchy
* A table of rule overrides: rule key, level (COMPANY default stays in the existing rule store; DEPARTMENT; EMPLOYEE), target id, effective-from /
  effective-to, reason (required), source note (required for rate / ceiling / eligibility overrides — replaces the old CA flag), registration
  reference, Placeholder/Confirmed with a different confirmer, audit. Coverage, voluntary contribution and tax regime stay ordinary per-person
  choices (not overrides).
* One resolver `resolveRule(key, employee, date)` returns {value, level, overrideId, sourceNote, effectiveFrom, confirmer, registrationRef}. The
  most specific effective, Confirmed level wins; overlaps at the same level and target are refused when saved. Every calculation reads rules
  through it (via `RuleContext`, so the run pins what it used). A Placeholder override is used only in a test run, like any placeholder.
* Registration reference is stored on each rule set (company and overrides) so statutory files can later be split; no single registration assumed.
* "Why?" and the salary register show "from override" and the level. No override is preselected.

### The payslip "Why?" (needed by 3.3 and 3.4)
* An API and a drawer on the payslip: per line, the head, the formula in words, the inputs, the rule used with its **source note, effective-from date
  and confirmer**, whether it came from an override and at which level, and the source of any arrear (month and head), reversal or released hold.
  Built from `PayrollRunLine.basis`, which the engine fills for every new line kind. Employees see only their own lines and no one sees pay data
  they lack permission for (HR stays hard-locked).

### 3.5 Tests
* Property tests with a reference model in exact fractions (existing `rational.ts` helper) over random structures, proration, every rounding mode,
  arrears and reversals, hold/release, and the hierarchy. Boundary tests at month ends, 29 Feb, and 1 April.
* Mutation check on every new rule, done by editing the source and restoring it, reported per rule.

## Commit list (one commit per step, each with the full verification)
1. `docs`: this plan, checklist, report entry.
2. 3.1a — pay-head options and validation (schema, migration if needed, tests).
3. 3.1b — derived calculation order, retire-not-delete, screens for pay heads.
4. 3.2 — new rules; shipped placeholders removed; refusal tests; screens say "Not set".
5. 3.3a — arrears lines linked to month and head; arrear-on-arrear.
6. 3.3b — LOP reversal (table, look-back, override, idempotency).
7. 3.3c — hold / release.
8. 3.3d — payslip "Why?" (API + drawer) for all line kinds.
9. 3.4a — rule hierarchy resolver and tables; 3.4b — override screens and wiring into the run.
10. 3.5 — property, boundary and mutation tests; walkthrough (both directors, HR, employee; phone width and dark theme); STAGE_REPORTS.

## Definition of done (from the master prompt)
The plan exists (this file); every capability is configurable and *Not set* by default; refusal to run with missing settings is tested.

## Decisions I am making (to be confirmed or overruled)
* Hold and LOP-reversal tables are new append-only tables rather than columns on the run, so a finalised run is never touched.
* "Pay-days basis" options stay at the three that exist; adding others is the owners' decision.
* The "monthly input" method is selectable now but reads from the Stage 4 grid; until then a run using it is blocked, not zero.
