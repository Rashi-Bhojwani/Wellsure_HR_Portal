# Phase 6 — Payroll: plan

**Status: approved 2026-10-16 with the answers in §0A. P6-1 (foundations) is built, see §14A; P6-2 (salary) is built, see §14B and §14C; P6-3 to P6-6 are not.** It follows the brief you gave on 2026-10-16 (commit A approved;
Phase 1.5 commits B to F paused until after Phase 7; Phases 6 and 7 built and tested locally). Spec references: §5.2–5.3 (PL, ledger),
§7.5 (payroll app), §9 (security), §11 (data model), §12 Phase 6 (maker-checker), §14 (open questions). The effective-dating contract
(EF4) that payroll must obey is kept verbatim at the end of this file (Appendix A).

How to read it: §1 maps each of your principles to the mechanism that enforces it and the test that proves it. §2 is what already exists.
§3 is the one design idea everything else hangs on (governed items: rules, structures and templates all carry Placeholder/Confirmed).
§4–§10 are the design in the order a payroll month happens. §11 is screens, permissions and jobs; §12 the tables; §13 how it is proved; §14 the build split (six commits, a pause after each). §15 is **the
rules I decided myself**. §16 is **what I need from you to turn Placeholders into Confirmed**. §17 is what stays unproven locally.

---

## 0A. Your answers (2026-10-16), and what they changed

1. **"Changing a Confirmed rule":** my reading is right. An edit takes effect at once as an unconfirmed value, usable for drafts and blocked for real runs until a
   different person confirms it. Testing a proposed change on a draft first is the point.
2. **Salary revisions need a checker.** They are a **seventh subject** in the same maker-checker core (§6), alongside the six: "nobody approves their own pay".
3. **Shipped figures, narrowed.** PF and ESI figures ship as placeholders **only where the figure is genuinely a statutory rate or ceiling**, and **every one is
   labelled "From memory, unverified"** so nobody mistakes it for a confirmed value. **Anything company-specific ships empty** (shown as *Not set*; a run that needs
   it says so; an administrator enters a value, which is a Placeholder until confirmed). This replaces my earlier plan to ship neutral company choices (pay-days
   basis, payment date, rounding of lines, leaver timing and the like): those are now empty. **New safeguard:** the Confirm action on a statutory figure shows the
   placeholder's source label and **requires the confirmer to type the confirmed value again**; a mismatch is refused. Confirming means checking, not clicking.
4. **My 20 rules (§15) are accepted**, including arrears for back-dated revisions, no unlock once payslips are published or a bank file exists, and no figures in
   payslip emails.
5. **The payroll audit screen is restricted to exactly the people who can see salary.** It has no permission of its own: it requires `payroll.salary.view`, so it
   cannot be more open than the salary screens. The shared audit-log viewer also hides payroll-private rows from anyone without `payroll.salary.view`. Tests prove both.
6. **Makers and checkers.** The two Super Admins can be checkers for each other, but an owner must not be the only possible checker for everything. **What happens with
   exactly one eligible checker (built in P6-4, behaviour decided now, and made visible, never a silent block):** the Approvals screen and every run page show the
   count of eligible checkers for the action at hand and name them. With exactly one, approvals still work, but a persistent warning says "all approvals depend on
   one person" and Super Admins are notified once. When that one person is also the maker or edited the figures, **nobody is eligible**: the action shows the state
   "Blocked: no eligible checker" with the reason, to the maker and to every Super Admin, and the way out is to appoint another checker. There is no override and no
   bypass. P6-1 already ships the eligibility query and shows it on the rules screen.
7. **A new system role, `PAYROLL_APPROVER`,** carries the checker permissions. I did not reuse the existing `APPROVER` role, which holds leave approval for whoever has
   it: giving it payroll figures would have widened what those people see.

---

## 0. In one paragraph

Payroll reads **finalised attendance** and **effective-dated history** (placement, name, bank, and now salary), through the readers only,
and computes every rupee as an exact decimal. Every number that comes from a rule (PF and ESI rates and ceilings, PT slabs, the pay-days
basis, rounding, the encashment formula, a salary structure's formulas, the bank file layout) lives in an admin-editable record that says
**Placeholder** or **Confirmed**, who confirmed it and when; a run remembers exactly which rules (and which version of each) it used. A run
made on Placeholders is a **draft**: it works, and every screen, export and payslip preview says "TEST — placeholder rules"; but it cannot be
approved, finalised, published or turned into a bank file. A small maker-checker core (a different checker, an approval bound to a hash of
the exact figures, voided by any change) guards the six actions you named. Every risky action shows a full preview first and then asks for
an explicit confirmation. Nothing in this phase talks to a bank or moves a rupee: the bank file is a file for HR to upload.

---

## 1. Your principles, and where each one is enforced

| Your principle | Mechanism | Proved by |
|---|---|---|
| **Everything configurable, nothing hardcoded; every rule an admin-editable setting at a clearly marked placeholder value, recording Placeholder or Confirmed, who confirmed, and when** | One catalog of rules (`shared/constants/payrollRules.ts`: key, label, what it affects, who should confirm it, the Zod shape of its value, its placeholder value). Values live in versioned records (§3). The calculator can only read a rule through `ctx.rule(key)`, which records the read | A test fails if any payroll code holds a rate, ceiling, slab, divisor, rounding scale or percentage as a literal: a source scan over `modules/payroll` (allowed literals: 0, 1, 2, 12 months, 100 for percent conversion, listed explicitly). A test that every catalog rule has a placeholder, a label and an owner |
| **A run cannot be finalised, approved, published, or turned into a bank file while any rule it used is still a Placeholder. Draft runs on placeholders are allowed, watermarked "TEST — placeholder rules" on screen, in exports and on payslip previews** | Each run pins `(rule key, version)` for every rule it actually read. `assertRunHasNoPlaceholders(run)` is the first line of submit, approve, finalise, publish-request, publish, bank-file-request and generate. One `watermarkFor(run)` feeds the screen banner, the Excel writer (a banner row and a sheet-name prefix on every sheet) and the payslip PDF (a diagonal mark and a header line) | A gate test per action (six); a test per output channel that a draft's screen payload, workbook and PDF carry the mark and a confirmed run's carry none; a test that a rule *not read* by the run (PF disabled for everyone) does not block it |
| **Every important or risky action shows a full preview (figures, who is affected, difference from last month), then explicit confirmation** | One shape for all of them: `…/preview` returns the figures, the people affected, the difference from the last comparable run, and a **fingerprint** of exactly that; `…/confirm` must carry the fingerprint and recomputes it, so what is confirmed is what was shown (the pattern of bulk regularization and flagged-punch accept) | A test per action that confirm without a preview, or with a stale fingerprint, is refused, and that nothing changes on a refused confirm |
| **Maker-checker (different checker; approval bound to the exact figures; voided if anything changes) on: approving a run, publishing payslips, generating the bank file, finalising or unlocking a payroll period, changing a Confirmed rule** | One small core, `payroll_approvals` (§6), used by exactly these six subjects. The checker is never the maker, nor anyone who changed the figures since submission. The approval stores the hash it approved; the consuming action re-computes the live hash and refuses on a mismatch | For every subject: same person refused; a person who edited the figures refused; approve then change one input of each class (an adjustment, a salary row, a rule value, an attendance day, a bank account, a component amount) and the approval is void, the consuming action refuses, and the run is back to Draft |
| **Changing a Confirmed rule resets it to unconfirmed until re-approved; every change audited with before and after** | A rule edit never mutates a version; it appends a new version, which has no confirmation. "Confirmed" is a fact about one version: a row in `payroll_item_confirmations` made by someone other than the version's author | Edit a Confirmed rule: it reads Placeholder (edited), the last Confirmed version is still shown beside it, any run that pinned the old version stays valid and any run on the new one is a draft; the audit row has before and after |
| **Nothing moves money. The bank file is for HR to upload to the bank's own portal** | No bank API client, SDK or credential exists in the codebase; the file is built, stored, approved, downloaded and marked paid by a person | A scan test fails if `modules/payroll` imports an HTTP client or a bank SDK; the batch has no state that means "sent" |
| **Payroll reads history only through the effective-dating readers; money is exact decimals throughout** | See Appendix A. Salary joins the same writer rules (append-only, DB overlap constraint). Money is `Prisma.Decimal` (decimal.js) until rendering; hashes are over canonical decimal strings | `currentRowGuard` extended to `employeeSalary`; a scan test fails on `Number(`, `parseFloat`, `toNumber(` or a float literal in money paths of `modules/payroll`; property tests that every line sums to its total exactly |
| **Housekeeping 1: two test runs cannot share a database** | Done in this turn: a Postgres advisory lock held by global setup (`scripts/lib/testRunLock.ts`) | `lib/__tests__/testRunLock.test.ts`, and a real second `vitest` process refused while the first ran unharmed |
| **Housekeeping 2: a running list of everything that assumes a local environment** | `docs/plans/LOCAL_ASSUMPTIONS.md`, a row added in the same commit as the code | Reviewed at each commit's close-out |

---

## 2. What already exists and payroll sits on

- **Finalised attendance.** `daily_attendance` has, per employee-day, `status`, `lopDays` (Decimal, from the engine: unpaid leave, absence,
  half-day-minimum-not-met) and `isLocked`. `attendance_period_locks` (append-only) records FINALISE/UNLOCK of an attendance cycle; the cycle
  rule (calendar month today) is `attendanceCycle`. Payroll reads only a cycle in which **every** day is locked, and refuses (with a list of who
  and why) otherwise. Attendance unlock already takes a `confirmPayrollConsumed` flag that today always answers "no": Phase 6 makes it real.
- **The payroll lock hook.** `setPayrollLockCheck` / `assertNotInLockedPayroll` is called by every history writer (job, name, bank, assignment,
  device mapping, separation) and pinned by `payrollContract.test.ts`. Phase 6 registers the real check: a day inside a payroll period that is
  finalised refuses changes (`PAYROLL_LOCKED`).
- **The readers.** `placementOn / placementSegments`, `nameOn`, `bankAccountOn`, `employedOn`, plus the `changeTimeline` writer family (and
  `writeAssignmentChange`, the precedent for adding a new history kind). Salary becomes the fifth kind.
- **Leave.** The append-only `leave_ledger`; Year End Process (preview, approve, commit) produces `year_end_run_items` with `encashedDays`,
  `dailyRate`, `rateSource`, `encashedAmount`; the `EncashmentRateProvider` seam is waiting for a salary-based implementation (today a flat
  setting, flagged "not final").
- **Permissions.** `PAYROLL_ADMIN` exists with a read-only set; `APPROVER` exists for leave. No `payroll.*` key exists yet. A test already fails
  if any `payroll.*`, `bank.*`, `salary.*`, `employee.salary.*` or `documents.pay.*` key becomes manager-grantable.
- **Shared infrastructure.** `writeAuditLog(s)` with redaction; `StorageService`; `buildXlsx`; `renderPdf` (Chromium) used by letters;
  `notifyEmployee` and the realtime rooms; BullMQ queues and workers; the preview-then-fingerprint pattern; schema-driven test cleanup;
  the route inventory; the append-only trigger and test-purge exception pattern; `Company` (PAN, TAN, CIN, address); `Location.state` and `City.state`.
- **Frontend.** The admin menu already has Payroll placeholders ("Salary Components", "Salary Structures", "Employee Salaries", "Payroll Run",
  all marked Phase 6) and the employee portal has a Salary group marked "coming soon".

---

## 3. The idea everything hangs on: governed items

A rule, a salary component, a salary structure, a bank file layout and a statutory output layout are all the same kind of thing:
**something HR can edit that changes what money comes out, and that somebody accountable must vouch for.** So they share one mechanism:

- A **governed item** has a `kind` (`RULE`, `COMPONENT`, `STRUCTURE`, `BANK_TEMPLATE`, `OUTPUT_TEMPLATE`) and a `key`.
- Its value lives in an **append-only version** (`payroll_item_versions`: kind, key, version, value JSON, hash of the canonical value, note,
  author, time). Editing never changes a version; it appends the next one.
- A version is **Confirmed** if and only if a row exists in the append-only `payroll_item_confirmations` for that exact version and value hash,
  made by a **different person from the version's author** (the maker-checker for "changing a Confirmed rule"), who must hold
  `payroll.rules.confirm`. The row records who and when, and a note (for example "per CA letter dated …", "per bank sample file").
  Otherwise it is **Placeholder**, which is also the state of every shipped default.
- The **current version** of an item is its highest. If the current version is unconfirmed but an earlier one was Confirmed, the screen shows both
  ("Placeholder, edited 12 Nov by A; last Confirmed value was X, confirmed by B on 3 Nov"). Nothing silently falls back to the old value.
- A **run pins** the `(kind, key, version)` it actually read, through `ctx.rule(key)` and friends (the read itself records the pin, so a rule cannot
  be used without being pinned). `placeholderKeys(run)` is the pinned set whose version has no confirmation. The status shown for a run is always
  read live from the confirmations table, so confirming a rule with the same value turns a draft's placeholder into a confirmed one without a recalculation;
  editing the rule means the pinned version is no longer current, which marks the run **stale** (must be recalculated before it can be submitted).
- Confirmation is for a **value**, not a person: it records the value hash it vouches for, and the Confirm screen shows the value being vouched for.

This is why one change covers principles 1, 2 and 5 at once, and why "a Placeholder slipping into a real run" has exactly one place to be caught.

### 3.1 The rules catalog (placeholders)

Every rule below is editable by Payroll Admin (`payroll.rules.manage`) and starts as a **Placeholder**. Values marked ◆ are **statutory rates or ceilings** I recall from general knowledge; they ship as Placeholders labelled **"From memory, unverified"**, are **not treated as true until your CA
confirms them** (several change by government notification), and confirming one requires typing the value again. Everything else is company-specific or an open question in spec §14 and ships
**empty (Not set)**: the "placeholder value" column below then shows what it is *for*, and a draft run needs an administrator to enter a value first. (This is the narrowed version approved on 2026-10-16, §0A.)

| Group | Rule key | Ships as | Who confirms / what it is for |
|---|---|---|---|
| Period and days | `PAY_DAYS_BASIS` | Not set (CALENDAR_DAYS, FIXED_DAYS or WORKING_DAYS) | HR + CA: how a month's pay is divided |
| | `FIXED_DAYS_VALUE` | Not set | used only if FIXED_DAYS |
| | `LOP_DIVISOR` | Not set | HR + CA: LOP per day = monthly ÷ this |
| | `PAYMENT_DATE_RULE` | Not set | HR: decides which bank account is in force (`bankAccountOn(payment date)`) |
| | `LEAVER_PAYMENT_TIMING` | Not set (PAY_WITH_RUN or HOLD_FOR_FNF) | HR: final settlement is Phase 7 |
| | `NEGATIVE_NET_POLICY` | Not set (BLOCK is the safe choice) | HR |
| Rounding | `LINE_ROUNDING` | Not set | HR + CA: mode and decimals for component lines |
| | `PF_ROUNDING` | ◆ HALF_UP to whole rupees, **From memory, unverified** | CA |
| | `ESI_ROUNDING` | ◆ UP (ceiling) to whole rupees, **From memory, unverified** | CA |
| | `NET_PAY_ROUNDING` | Not set | HR |
| Provident Fund | `PF_EMPLOYEE_RATE` | ◆ 12%, **From memory, unverified** | CA |
| | `PF_EPS_RATE`, `PF_EPF_ER_RATE` | ◆ 8.33% and 3.67% of wages, **From memory, unverified** | CA |
| | `PF_EDLI_RATE`, `PF_ADMIN_RATE` | ◆ 0.5% and 0.5%, **From memory, unverified** | CA |
| | `PF_WAGE_CEILING` | ◆ ₹15,000, **From memory, unverified** | CA |
| | `PF_CEILING_MODE` | Not set (CAP_AT_CEILING or ACTUAL_WAGE) | company policy |
| Employees' State Insurance | `ESI_EMPLOYEE_RATE`, `ESI_EMPLOYER_RATE` | ◆ 0.75% and 3.25%, **From memory, unverified** | CA |
| | `ESI_WAGE_CEILING` | ◆ ₹21,000 gross, **From memory, unverified** | CA |
| | `ESI_PERIOD_RULE` | Not set (MONTHLY or STICKY_HALF_YEAR) | CA |
| Who is covered | `PF_ELIGIBLE_TYPES`, `ESI_ELIGIBLE_TYPES` | Not set | CA + HR: permanent, contract, interns |
| Professional Tax | `PT_STATE_OF_PLACEMENT` | Not set | CA (spec §14) |
| | `PT_SLABS` | Not set: no states configured, so PT is ₹0 and the screen says so | CA: which states, slabs, February exception |
| | `STATE_NAME_MAP` | Not set | HR: maps the free-text `Location.state` to a canonical state key |
| Labour Welfare Fund | `LWF_TABLE` | Not set | CA (spec §14) |
| Tax | `TDS_MODE` | Not set (Phase 7 supplies the projection; lines show ₹0 with a notice) | CA (Phase 7) |
| Leave encashment | `ENCASH_DAILY_RATE_FORMULA` | Not set (spec §5.2 names `BASIC / 30` as the default, which I will offer as a suggestion on the screen, not ship) | CA (spec §14) |
| | `ENCASH_TAXABLE`, `ENCASH_PF_APPLICABLE` | Not set | CA |
| | `ENCASH_PAYOUT_RULE` | Not set | HR |
| Arrears | `ARREARS_PAYOUT`, `ARREARS_PF_ESI` | Not set | HR + CA |
| Variance | `VARIANCE_FLAG_PERCENT`, `VARIANCE_FLAG_MIN_AMOUNT` | Not set (they only decide what the preview highlights) | HR |
| Payslip | `PAYSLIP_LAYOUT` | Not set | HR |
| Company identifiers | `PF_ESTABLISHMENT_CODE`, `ESI_EMPLOYER_CODE`, `PT_REGISTRATION`, `LWF_REGISTRATION` | Not set | HR (needed only by the outputs that print them) |
| Bank (P6-5) | `BANK_TEMPLATE` (a governed item of its own), `BANK_DEBIT_ACCOUNT` (stored encrypted), `PAYMENT_MODE_THRESHOLDS` | Not set | the bank's format (spec §14) |
| Outputs (P6-5) | `ECR_TEMPLATE`, `ESI_RETURN_TEMPLATE`, `PT_STATEMENT_TEMPLATE`, `LWF_STATEMENT_TEMPLATE`, `SALARY_REGISTER_TEMPLATE` | Not set | CA / portal format |

**Only the rows marked ◆ ship with a value** (eleven figures, all statutory rates, ceilings or prescribed rounding). Every one is a Placeholder, authored by "System (shipped placeholder)",
labelled **From memory, unverified**, and **confirming it requires typing the value again.** Rules still to be built by their own commit (bank and outputs) are added to the catalog by that
commit; a rule that does not exist yet cannot block anything.

**Not rules, and deliberately not configurable:** the maker-checker invariants (checker differs from maker; approval bound to a hash; voided by any
change), the rule that a Placeholder blocks a real run, append-only history, and exact decimal arithmetic. Making a safety property a setting would
let the setting be changed by the person it constrains. They are code and tests.

---

## 4. Salary: components, structures, and each person's salary

**Components and structures are governed items (§3), so they carry Placeholder/Confirmed too.**
- A **component** (`COMPONENT`, key = its code, e.g. `BASIC`, `HRA`): name, kind (`EARNING`, `DEDUCTION`, `EMPLOYER_CONTRIBUTION`), how its monthly amount is
  worked out (`FIXED` per person, `PERCENT_OF` another component or of CTC, or a `FORMULA`), whether it is **taxable**, **PF-applicable**,
  **ESI-applicable**, whether it **pro-rates with paid days**, its payslip order and label. Nothing about PF, ESI or tax is inferred from a component's
  name: the flags say so.
- A **structure** (`STRUCTURE`): an ordered list of components (each pinned to a component version) and how CTC splits across them (spec's example:
  Basic = 40% of CTC). Structure formulas use a small expression language I write and test myself (numbers, component codes, `+ - * /`, parentheses,
  `MIN`, `MAX`, `ROUND`); it is parsed, never `eval`'d, and evaluated in exact decimals. It can reference only components and `CTC`. A structure whose
  components do not sum to CTC is refused at save, with the difference shown.
- Statutory lines (employee and employer PF, ESI, PT, LWF, TDS) are **not** components: they are produced by the calculator from rules, under reserved codes.

**Each person's salary is effective-dated, in the same family as job, name, bank and attendance assignment.** `employee_salaries`: employee, half-open
`[effective_from, effective_to)`, structure key and version, annual CTC, per-person fixed amounts, the **frozen monthly breakup** (every component, exact
decimals, computed once at save and never recomputed), reason (`JOINING`, `REVISION`, `CORRECTION`), author. The database enforces what it enforces for the
others: a CHECK that a row does not end before it starts, an EXCLUDE constraint against overlap (per employee), append-only at the end of the timeline,
written only through `writeSalaryChange` (a new `HistoryKind`). The readers: `salaryOn(employeeId, day)` and `salarySegments(employeeId, from, to)`. The
current-row guard test is extended so payroll cannot read `employeeSalary` any other way.

Freezing the breakup is deliberate. A run that recalculated salary from today's structure would change a past month when the structure is edited; instead a
structure edit creates a new version, and people move to it by a **revision** (below), with a preview and an effective date.

**A revision** (`payroll.salary.edit`): choose people (one, a branch, a grade, or everyone on a structure version), the new CTC or the new structure version, and an
effective date. The **preview** shows, per person, the old and new monthly breakup, the difference, the first month affected, and, if the date is on or before a
month that is already finalised, the **arrears** per month. The confirmation writes the salary rows and, for arrears, creates pending adjustments (§5.4); one
audit row per person, with the amounts in the payroll tables and only references in `audit_logs` (§15 item 14).

A revision dated inside a finalised payroll period would be refused by the payroll lock like any history change. Arrears are the sanctioned route: the salary timeline
records the true effective date, the lock check is bypassed *only by the arrears flow* (a single named function, tested), and the money owed is not rewritten in the
closed month but paid as a separate adjustment line in the next run.

**Self-guard:** nobody can edit their own salary, adjustments or bank account in payroll (Super Admin included), as nobody corrects their own attendance.

**Offer letters** (spec §12: "revisit offer letters here"): the letter template can draw CTC and the monthly breakup from `salaryOn(joining date)` instead of being typed. HR-only, as
letters carrying pay already are.

**Import.** Spec §10 item 7: Import Center datasets for salary structures and for opening salary rows / YTD figures. The row shapes are designed here and built in
commit P6-2/6; the real files wait for the greytHR samples (as the converter did in Phase 1.5), so nothing assumes greytHR's columns.

---

## 5. The calculation

### 5.1 Inputs to a run, and the readiness check

A run is for **one attendance cycle** (the calendar month today: `attendanceCycle`). Starting one first shows **readiness**, the way the Finalisation screen does:

- Attendance: every employee employed on any day of the cycle has all their days locked (the cycle is finalised). Otherwise a list: who, which days, why.
- Salary: everyone employed has a salary row covering their employed days (a gap is listed; they are excluded from payment, never paid zero silently).
- Bank: everyone to be paid has a valid account on the payment date (`bankAccountOn`), otherwise they are **HELD** with the reason, visible in the preview.
- Rules: which governed items the run would use, and which of them are Placeholder (so the person starting it sees up front that it will be a TEST run).
- Pending adjustments, year-end encashments awaiting payout, and unresolved items from the last run.

Employment is `employedOn(day)`, never `status`. A joiner is paid from their date of joining; a leaver **through** their last working day (EF4).

### 5.2 Per employee, in this order

1. **Days.** Over the employed part of the cycle: payable days by `PAY_DAYS_BASIS`; LOP days = the sum of the locked days' `lopDays` (exact decimals);
   paid days = payable days minus LOP days.
2. **Salary segments.** `salarySegments(employee, from, to)`: a revision on the 16th gives two segments. Each earning component's month amount is prorated by the
   segment's share of paid days, using the LOP days that fall *inside* that segment (the daily rows are dated, so this is exact, not averaged).
3. **Placement.** `placementSegments`: cost centre, grade, department for the payslip and the register; the state for PT and LWF by `PT_STATE_OF_PLACEMENT`.
4. **Earnings** = component lines, rounded by `LINE_ROUNDING`, plus adjustment lines (§5.4) and any year-end encashment (§5.5).
5. **Statutory.** PF on the sum of PF-applicable earnings (capped per `PF_CEILING_MODE`), employee and the employer split; ESI on ESI-applicable gross if
   under the ceiling, employee and employer, rounded per `ESI_ROUNDING`; PT from the slab for the state and the month; LWF from its table; TDS from the
   Phase 7 provider (₹0 plus a notice until then). **Every rate and ceiling is read with `ctx.rule(...)`.**
6. **Other deductions**: adjustments of kind deduction; loan EMIs and reimbursement credits come from provider seams that Phase 7 fills (empty now).
7. **Net** = earnings − deductions. A negative net is handled by `NEGATIVE_NET_POLICY` (BLOCK: listed as an exception that must be resolved before submit).
8. **Item hash**: a canonical-JSON SHA-256 of every line, every input id used and the pinned rule versions, so the run hash (§6) is built from per-person hashes.

Every line stores `basis`: the inputs, the formula text, the rule keys and versions, and the days used. "Why is this ₹4,617?" is answerable on screen and in
the register without re-running anything.

### 5.3 Exact money

- `Prisma.Decimal` everywhere (decimal.js: arbitrary precision). Columns are `Decimal(14,2)` for final amounts and `Decimal(18,6)` for stored intermediates. Rounding happens
  only at the points the rules name, with the rule's mode and scale.
- Canonical decimal strings (fixed scale, no exponent) for hashing and for every export; amounts are never `Number`, never a JSON number in storage (decimals are strings in JSON).
- Property tests: for random salaries, joiners, leavers, LOP and revisions, every run's total equals the exact sum of its lines, and a shadow calculation written independently
  in rational arithmetic agrees to the paisa.

### 5.4 Adjustments

`payroll_adjustments`: one-off earnings or deductions HR adds before a run (a bonus, a recovery, an arrears line from a revision, an imported correction), each with a
component code, amount, reason, source and source reference (**unique** per source, so the same encashment or arrears cannot be added twice), and a status
(`PENDING`, `CONSUMED` by a run, `CANCELLED`). Adding or changing one is previewed. They are part of the run hash, so editing one after approval voids the approval.

### 5.5 Leave encashment

Year End Process already produces committed `year_end_run_items` (days, rate, amount). Phase 6:
- supplies the **salary-based `EncashmentRateProvider`** the seam is waiting for (formula from `ENCASH_DAILY_RATE_FORMULA`, over the person's `salaryOn(year-end)` breakup),
  with `rateSource` recorded and `isFinal` true only if the rule is Confirmed (the Year End screen already flags a non-final rate);
- makes a **committed item reach payroll exactly once**: the run that includes it creates a line with `source = YEAR_END_ENCASHMENT`, `sourceRef = item id` (unique), taxable
  and PF-applicable per the encashment rules. The amount is the one committed at year end; payroll does not recompute it;
- leaves tax treatment (an open CA question) to the rule, and to Phase 7.

### 5.6 Running it

Calculation is a BullMQ job (`payroll-calculate`) that works in chunks of employees, is **idempotent per employee** (an upsert keyed by run and employee), reports progress, can
be resumed after a worker restart, and takes a lease on the run so two calculations cannot overlap. A recalculation replaces a Draft/Calculated run's items and records
what changed; after submission it first voids the approval (with a preview that says so).

### 5.7 The variance preview ("difference from last month")

Against the previous finalised regular run: per employee, the change in gross, deductions and net, with the **reason tags** it can know (joined, left, salary revised, LOP
changed, adjustment added, encashment, statutory change), flags above `VARIANCE_FLAG_PERCENT` / `…_MIN_AMOUNT`, joiners and leavers, people with no salary or held, and the
change in totals. This is the same block shown in the submit, approve, finalise, publish and bank-file previews.

---

## 6. Maker-checker: one small core

Seven subjects (the six you named, plus salary revisions, added 2026-10-16), nothing else, nothing configurable about the invariants:

| Subject | Maker acts | Checker decides | What the hash covers | Consumed by |
|---|---|---|---|---|
| `RUN_APPROVAL` | submit the calculated run | approve or reject (reason) | every item hash, the totals, the pinned rule and structure versions, the adjustments, the salary rows used, the attendance fingerprint (days, LOP) | finalise |
| `PERIOD_FINALISE` | request to finalise the period | approve | the approved run's hash and the period | the lock |
| `PAYSLIP_PUBLISH` | request to publish | approve | every payslip's content hash | publish |
| `BANK_FILE` | request the bank file | approve | the file rows (employee, bank row id and its account hash, IFSC, amount, narration), the template version | generate |
| `PERIOD_UNLOCK` | request, with a reason | approve (and the unlock itself is Super Admin only) | the period, the reason | the unlock |
| `RULE_CONFIRM` | (the rule's author is the maker) | a different person confirms; for a statutory figure they must type the value again | the rule's value hash | marks the version Confirmed (§3) |
| `SALARY_REVISION` | prepare the revision (people, new CTC or structure, effective date) | approve | every person's old and new breakup, the dates, the arrears | writes the salary rows and creates the arrears adjustments |

Enforced in the service and tested, for each subject:
1. **Different people.** The checker is not the maker and not anyone recorded in `payroll_run_events` as having changed the run's figures since submission (recalculated,
   edited an adjustment, changed a salary row used by it). Permissions: maker `payroll.run`, checker `payroll.approve`; neither is manager-grantable.
2. **Bound to the figures.** Submitting stores the hash. Approving stores the hash the checker saw. The checker's screen shows the same preview the maker confirmed.
3. **Voided by change.** Any change that alters the live hash voids the approval at once (the mutation services void inside their own transaction, so the state shown is true) and the
   run returns to Calculated. The consuming step also recomputes the live hash and refuses on a mismatch, as a second line of defence for anything the first misses.
4. **Locked once approved.** An approved run cannot be recalculated or edited; reopening is an explicit, audited, previewed action that voids the approval.
5. **Recorded.** Submit, approve, reject, void, reopen and consume are in `payroll_run_events` and in the append-only audit log, with the hash.
6. **Rejected means a reason and a new submission.** A rejected run goes back to Calculated; the reason is shown to the maker.

Approvals do not expire in this phase (a rule can add that later if you want it; see §15).

---

## 7. Preview, then explicit confirmation, for everything risky

Previews are never state: they are computed, shown, and fingerprinted. The confirm call recomputes and must match, or it is refused with "this changed since you looked".
The list, each with the preview contents it shows beyond the common block (figures, who is affected, difference from last month):

| Action | Preview additionally shows |
|---|---|
| Edit or confirm a rule, component, structure or template | the old and new value side by side; every run and every person it would change, in rupees, computed by a dry run against the latest calculated run |
| Salary revision / bulk revision | per-person old and new breakup; arrears per month |
| Add or import adjustments | every row, who, amount, which run will pay it |
| Calculate / recalculate | what changed since the last calculation; whether it will void an approval |
| Submit for approval | the readiness result, the placeholder list (blocks), exceptions, variance |
| Approve / reject | the same, as the checker sees it |
| Finalise the period | the approved hash, the dates it will lock, the history changes it will then refuse |
| Request and approve publish | the payslip count, a sample set, the people who will be notified |
| Request and approve the bank file | every row (masked), totals, held people and why, the template and the debit account (masked) |
| Unlock a period | what unlocking allows, what the attendance and history locks do next |
| Mark a bank batch paid | the batch, the reference you typed |

---

## 8. Locking: payroll periods and the lock hook

- `payroll_period_locks` (append-only, the same shape as attendance's): FINALISE and UNLOCK events for a cycle. A cycle is locked if its latest event is FINALISE.
- Phase 6 calls `setPayrollLockCheck` with the real check: any history change, cancellation or separation dated inside a locked period is refused (`PAYROLL_LOCKED`), exactly
  as the EF4 tests already pin. The tests in `payrollContract.test.ts` that assert "lock refuses" are re-run against the real check.
- Attendance unlock's `confirmPayrollConsumed` stops answering "no": a cycle whose payroll run is submitted or beyond answers yes, and the existing warning dialog appears. Any
  attendance change that follows (unlock, reprocess, finalise again) changes the attendance fingerprint and so voids the run's approval.
- **Unlock rules (mine, §15):** a payroll period can be unlocked (maker-checker, Super Admin, reason) until payslips are published or a bank file is generated. After either, it cannot
  be unlocked: corrections go through adjustments in the next run, or an off-cycle run. Once money has been released against a file, rewriting the month under it is the worst thing the
  system could allow.
- Finalising requires: an approved, hash-valid regular run, no Placeholder, attendance cycle finalised.

---

## 9. Payslips

- `payslips`: one per run item at publish; immutable content (JSON of lines, name as of the period end via `nameOn`, masked bank and statutory identifiers, YTD placeholder until Phase 7),
  its content hash, the stored PDF key, `publishedAt`. No update path exists; the table is append-only with the usual trigger.
- The PDF is rendered from HTML by the existing Chromium renderer, in the **worker in bounded batches**, stored through `StorageService`, and downloaded with a short-lived signed
  URL. A draft preview carries the watermark; a published payslip never does (it cannot exist on Placeholders).
- Publishing = maker requests, checker approves, then the worker renders and stores everything, then marks `publishedAt` and notifies each employee in real time and by email. The email
  carries **no figure**: only "your payslip for October is ready" and a link. Emails are paced (the same SES pacing the invitations will use).
- Employees see **only their own** payslips (SELF scope, IDOR-tested); HR with `payroll.payslip.view` sees any. A manager sees none.
- Net pay in words uses the Indian lakh/crore convention, tested on awkward values (₹1,00,000, ₹99,999.50, paise).
- Reimbursement payslips and the IT statement are Phase 7.

---

## 10. The bank file, and the statutory outputs

- `BANK_TEMPLATE` is a governed item: format (CSV, XLSX or fixed width), columns in order (each a source field, a constant or a pattern), header and trailer rows, delimiter, date and
  amount formats, field widths and padding, narration pattern. It is **Placeholder** until you give me the bank's own specification or a sample file; a batch built on a Placeholder
  template cannot be generated (the gate), and a test file cannot exist as a file at all (there is no "test file" for a bank: the preview on screen shows the rows).
- A **batch** is built from a finalised, approved run: one row per PAYABLE person with the account that `bankAccountOn(payment date)` returns, decrypted only inside generation (one audit row
  per person revealed, in one batch insert), then the file is stored through `StorageService`, its SHA-256 recorded, and the batch locked. HR downloads it (every download audited), uploads it
  to the bank's own portal, and later **marks the batch paid** with the bank's reference. There is no state meaning "sent": the app never talks to a bank. HR can also attach the bank's
  response file; it is stored, not parsed, until the format is known.
- **Held people** (no valid account, negative net, leaver with `HOLD_FOR_FNF`, ₹0 net) are listed in the preview with the reason and are excluded from the file explicitly, never silently.
- Statutory outputs from a finalised run, each from a governed `OUTPUT_TEMPLATE`: the **PF ECR** text file, the **ESI contribution** workbook, **PT** and **LWF** statements, the
  **salary register**, the **variance report**. Each is Placeholder until its layout is confirmed against the portal's current format (I will say plainly that I cannot check a government
  portal from here) and carries the TEST watermark while it is.

---

## 11. Screens, permissions, jobs, realtime

**Permissions (new keys, none manager-grantable; the existing test is extended to prove it):** `payroll.rules.view`, `payroll.rules.manage`, `payroll.rules.confirm`,
`payroll.salary.view`, `payroll.salary.edit`, `payroll.adjust`, `payroll.run` (maker), `payroll.approve` (checker), `payroll.unlock` (meta, Super Admin only), `payroll.payslip.view`,
`payroll.bank.view`, `reports.salary.view`. **There is no audit permission of its own:** the Payroll audit trail requires `payroll.salary.view`. Defaults: `PAYROLL_ADMIN` gets the maker set; a new `PAYROLL_APPROVER` role gets the checker set (`payroll.approve`, `payroll.rules.confirm`, and the view keys a checker needs to see the figures they approve);
`HR_ADMIN` gets view and salary edit but **not** run/approve; `HR_EXECUTIVE` gets nothing (they never see salary or bank data); an owner who is the only possible checker is a real
case for a small company and is covered in §16.

**Admin app (Payroll):** Rules and setup (rules, components, structures, templates; Placeholder/Confirmed badges, history, the confirm dialog); Employee Salaries (timeline, revision with preview);
Adjustments; Payroll Run (a stepper: readiness, calculate, review, submit, approve, finalise, payslips, bank file, paid); Approvals inbox (the checker's list); Statutory outputs;
Salary register and variance; Payroll audit trail (same people as salary). Every screen that touches a draft shows the **TEST — placeholder rules** banner with the list of rules and one click to the rule.
**Employee portal (Salary):** Payslips (month picker, view, PDF, net in words), Salary revision history. Responsive at phone width (definition of done).

**Jobs:** `payroll-calculate`, `payroll-payslips` (render and store in batches, resumable, idempotent per payslip), `payroll-notify` (paced). The scheduler stays a single instance; none of these needs it.
**Realtime:** a pending approval reaches the checkers' room at once; a published payslip reaches `user:{id}`; run progress reaches the maker.
**Audit:** every state change in `payroll_run_events` (append-only, with the actor and hash) and in `audit_logs` (redacted; §15 item 14).

---

## 12. Data model (new tables; every one gets the usual cleanup classification, route inventory entries and, where it is history, a trigger)

| Table | Holds | Notes |
|---|---|---|
| `payroll_item_versions` | every version of every governed item (kind, key, version, value JSON, value hash, note, author, time) | append-only (trigger, test-purge exception only in a seeded database) |
| `payroll_item_confirmations` | who vouched for which version and value hash, when, with what note | append-only; author of the version cannot be the confirmer (checked in the service and by a CHECK-style trigger) |
| `employee_salaries` | effective-dated salary: structure and version, CTC, frozen monthly breakup | half-open, EXCLUDE overlap, CHECK, written only by `writeSalaryChange`; in the current-row guard |
| `payroll_adjustments` | one-off earnings, deductions, arrears, encashment lines | unique `(source, source_ref)` |
| `payroll_runs` | a run: kind (REGULAR / OFF_CYCLE), cycle, status, version counter, totals, pinned rules, run hash, lease | one non-void REGULAR run per cycle (partial unique index) |
| `payroll_run_items`, `payroll_run_lines` | per person and per component, with `basis` and item hash | replaced only by recalculation of an unapproved run |
| `payroll_run_events` | every state change with actor and hash | append-only |
| `payroll_approvals` | the maker-checker core (subject, subject id, hash, maker, checker, decision, reason, voided) | append-only decisions; a partial unique index allows one live approval per subject |
| `payroll_period_locks` | FINALISE / UNLOCK events for a cycle | append-only |
| `payslips` | immutable published payslips | append-only |
| `bank_transfer_batches`, `bank_transfer_rows` | the batch, its rows, file key and hash, paid mark | rows append-only after generation |
| `statutory_outputs` | generated PF/ESI/PT/LWF/register files | |

No salary figure is stored in `audit_logs` (§15 item 14). No table stores an account number in the clear; the bank file is the only place it is decrypted.

---

## 13. How it is proved (the test plan)

- **Rules and governed items:** version append-only; confirmation by a different person only; edit resets; same-value confirmation promotes a draft without recalculation; stale-run detection; the
  rule-literal source scan; catalog completeness (placeholder, label, owner, Zod shape for every rule); `ctx.rule` read-tracking (an unread rule is not pinned).
- **Gates:** for each of submit, approve, finalise, publish, bank file request and generate: refused on any Placeholder, allowed when none; draft allowed and watermarked on screen payload,
  workbook, and payslip PDF; no watermark on a confirmed run.
- **Calculation (golden cases, hand-worked and checked in rational arithmetic):** full month; joiner mid-month; leaver on the last working day; LOP in the first and second half of a revision
  segment; a revision on the 16th; a transfer on the 16th with the PT state decided per rule; PF below, at and above the ceiling; ESI just under and just over; PT slab edges including February; encashment
  from a committed year-end item, paid once; arrears from a back-dated revision; negative net; held (no bank); ₹0 net; rounding at each named point.
- **Exactness:** no `Number`/float in money paths (source scan); line sums equal totals to the paisa (property tests); hashes stable across runs of the same inputs and different for any single changed paisa.
- **Maker-checker (per subject):** same person; a person who edited; reject then resubmit; approve then change one input of each class (adjustment, salary row, rule value, structure version, attendance day,
  bank account, component amount, a pending adjustment cancelled) voids; a consuming step with a stale hash refuses; concurrent approve/void is safe (conditional updates).
- **Previews:** confirm without preview, with a stale fingerprint, or after the data changed: refused and nothing changes; the preview of an action equals what the action then does.
- **Effective dating (EF4):** the existing `payrollContract` tests re-run against the real lock; plus payroll-specific: bank change on the 10th with payment on the 25th, name on the payslip as of the period
  end, placement segments, `employedOn` for joiners and leavers, the current-row guard on `employeeSalary`, `PAYROLL_LOCKED` for history dated inside a finalised period.
- **Security:** every new route classified in the route inventory; none of the new keys manager-grantable; HR Executive and Manager see no salary anywhere; an employee sees only their own payslip (IDOR
  tests on every payslip route and on the PDF URL); no payroll module imports an HTTP client or a bank SDK; account numbers are decrypted only in generation; audit rows carry before and after for every
  rule change and no salary amounts.
- **Operational:** calculation resumes after a killed worker; a second calculation cannot start; payslip rendering resumes; a 500-employee run measured (time, memory) on the replay harness.
- **Mutation checks** on the new rules at each commit (a rule removed, a named test fails), as in Phases 3 and 1.5. **Live walkthrough** on a scratch database with a real browser before each UI commit closes.

---

## 14. How I would build it: six commits, pausing after each

| Commit | Contents | Pauses for |
|---|---|---|
| **P6-1 Foundations** | payroll permissions (and the non-grantable test extended); governed items (versions, confirmations, catalog, `ctx.rule`, pins, placeholder detection, `watermarkFor`); the exact-decimal and rounding library; the formula engine; the maker-checker core with all six subjects' mechanics (generic) and its tests; the guard scans (literals, floats, history reads, bank SDKs); **Rules and setup** screen (rules with Placeholder/Confirmed, history, confirm dialog); `payroll_run_events`; LOCAL_ASSUMPTIONS rows | your review |
| **P6-2 Salary** | components, structures, `employee_salaries` (migration, constraints, `writeSalaryChange`, `salaryOn`, `salarySegments`, guard extended), revisions with preview and arrears, adjustments, self-guards, Employee Salaries and Structures screens, offer-letter figures from salary, import dataset shapes | your review |
| **P6-3 Calculation** | cycle readiness, the run model, `payroll-calculate` job, days/proration/segments, PF/ESI/PT/LWF, encashment provider and year-end reach-through, TDS/loan/reimbursement seams, variance preview, explainability, Payroll Run screens up to Review, the TEST banner and watermarked workbook | your review |
| **P6-4 Approval and locking** | submit/approve/reject/void for runs, period finalise and unlock, the real payroll lock registered, attendance unlock integration, previews and fingerprints on every action, Approvals inbox, attendance-fingerprint hashing | your review |
| **P6-5 Payslips and the bank file** | payslip generation, publish with maker-checker, PDF with watermark, notifications, employee Salary screens, bank templates and batches, the file, mark paid, statutory outputs and the salary register | your review |
| **P6-6 Close-out** | the parallel-run comparison tool (**built only against your anonymised greytHR payroll sample; waits for it**), remaining reports, the 500-employee measurement, docs (`PROGRESS`, `GETTING_STARTED`, this file as built), the Phase 6 review, a walkthrough of a full month end to end, the LOCAL_ASSUMPTIONS review | your review, then Phase 7 planning |

I will plan Phase 7 (declarations, TDS, YTD, Form 16 data, loans, reimbursements, full and final, revision letters) after you have seen Phase 6; the seams in §5.2 (TDS, loans, reimbursements) are where it plugs in.

### 14A. P6-1 as built (2026-10-16)

**What exists.** Migration `20261016090000_payroll_foundations`; `backend/src/modules/payroll/` (money, hash, formula, events, approvals, exports, rules/{schemas,governed,context}); the Rules and Setup screen; 12 permissions; `PAYROLL_APPROVER` role; the payroll guard scans. Nothing in P6-1 calculates pay: it is the foundation the next five commits stand on.

| Piece | Where | What it guarantees |
|---|---|---|
| Governed items | `payroll_item_versions`, `payroll_item_confirmations` (append-only, DB triggers) | A value is Confirmed iff a row in confirmations names it, made by a **different** person than its author (checked in code and again by a trigger). Edits append the next version, unconfirmed; the last Confirmed one stays visible and stays in every run that pinned it. |
| Rules catalog | `shared/constants/payrollRules.ts` | Each rule has a label, shape, group, `origin` (STATUTORY or COMPANY) and, for the eleven statutory figures that ship, a value labelled "From memory, unverified". PT slabs and the LWF table are statutory in origin but ship empty, as every company-specific rule does. |
| Confirm | `rules/governed.ts` | Preview first (fingerprint of exactly what was shown), then confirm with a note of at least five characters. A STATUTORY rule additionally needs the confirmer to **type the value again** (`RETYPE_REQUIRED`, `RETYPE_MISMATCH`). Only the current version can be confirmed. |
| Pins and the gate | `rules/context.ts` | A run records `(key, version, valueHash)` of each rule it actually read. `assertRunIsReal` refuses with `PLACEHOLDER_RULES` while any pinned rule is a Placeholder, and `RULES_CHANGED` if a pinned rule has a newer version. `watermarkFor` returns the TEST banner; XLSX gets a banner row, a `TEST ` sheet-name prefix and a footer; HTML/PDF gets a rotated overlay. |
| Exact money | `money.ts`, `hash.ts` | Decimal at 40 digits of precision, numbers refused at runtime, six named rounding modes, canonical JSON hashing that rejects floats and `undefined`. |
| Formula engine | `formula.ts` | `+ - * / ( )`, `%`, MIN, MAX, ROUND, CEIL, FLOOR, uppercase names. No `eval`; no JavaScript numbers in the evaluator. |
| Maker-checker core | `approvals.ts`, `payroll_approvals` | Seven subjects (run approval, period finalise, payslip publish, bank file, period unlock, rule confirm, salary revision). Checker is not the maker (code and a DB CHECK), not anyone who changed the figures since submission, approval is bound to a hash taken at submit and again at decision, a changed hash voids it, and it is single-use. One live approval per subject (partial unique index). `checkerAvailability` says NONE, ONE or MANY and why, so a screen can show it. |
| Events | `payroll_events` (append-only) | Who changed which figures when; the checker rule above reads it. |
| Audit | `/api/payroll/audit`, `/api/audit-logs` | Payroll rows are hidden from the general audit viewer for anyone without `payroll.salary.view`, and the payroll audit screen needs exactly that same permission, so it is not a side door. |
| Guard scans | `payrollGuards.test.ts` | Fails on a numeric literal outside a short allowlist, `Number()`/`parseFloat`/`Math.round`/`.toNumber()` and the like, `new Date()` outside annotated instants, any HTTP or AWS client import, and any "sent to bank" state. The history-read scan in `currentRowGuard.test.ts` now covers `employeeSalary`. |

**Rules I decided myself in P6-1** (additional to section 15; veto any):

21. **Every confirmation needs a note** of at least five characters ("what did you check it against"), not just statutory ones.
22. **Only the current version can be confirmed.** If a newer value was entered after you looked, the confirm is refused as stale.
23. **`PAYROLL_APPROVER` is a new role**, separate from the leave `APPROVER`. It holds rules confirm, salary view, run approve, payslip view and bank view, and nothing that edits.
24. **`TDS_MODE` accepts only `NONE`** until Phase 7 builds TDS, so no setting can claim a calculation that does not exist.
25. **The bank-file layout and the output templates are added as governed items in their own commits** (P6-5), not stubbed here.
26. **Demo accounts:** the seed puts employee 1025 in PAYROLL_ADMIN (maker) and 1027 in PAYROLL_APPROVER (checker), so the two-person flow can be walked locally. A real tenant has neither until a Super Admin appoints them.
27. **The app database role keeps UPDATE on `payroll_approvals` only.** Every other append-only table loses it. This was a real conflict with the Phase 1.5 role step, fixed in `UPDATABLE_APPEND_ONLY_TABLES` and tested (see LOCAL_ASSUMPTIONS, note on row 11).

**How P6-1 is proved** (all in `backend/src/modules/payroll/__tests__/` unless noted): full backend suite 134 files / 1,204 tests green run alone; the database refuses a self-confirmation, a hash mismatch and any edit or delete of a version (`rules.test.ts`); a person holding both permissions cannot confirm their own value (`rules.test.ts`); the checker is never the maker or a figure editor, and any change voids an approval before and after the decision, for every subject (`approvals.test.ts`); a Placeholder or a since-changed rule refuses a run, and confirming the very version a run used promotes it with no recalculation (`context.test.ts`); the general audit viewer hides payroll rows and every payroll permission is refused to a manager (`access.test.ts`); the app role has UPDATE on `payroll_approvals` and no other append-only table (`dbRoles.test.ts`).

**Mutation checks** (each guard broken on purpose; the tests must fail): retype removed, Placeholder gate removed, stale-rule gate removed, audit filter removed, checker may equal maker, figure editor may approve, hash not checked at decision, hash not checked at consume: all caught. Guard-scan teeth: a decimal literal, `Number()`, `new Date()`, an HTTP client import, a "sent to bank" state as an identifier and as a string value: all caught (the string-value one was **not** caught until fixed in this commit). Removing only the rules-level "author may not confirm" check is *not* caught, by design: `recordCompletedApproval` and a database trigger enforce the same rule, and removing both is caught.

**Live walkthrough** (scratch database, a maker and a checker in a browser): a company rule set then confirmed by a different person; a statutory figure refused on a wrong retype and accepted on the right one, showing "From memory, unverified" and who entered it; editing a Confirmed rule shows the warning, resets it to a Placeholder and keeps the last Confirmed value and the history; the maker is offered no Confirm button and the checker no Edit button; with the second checker suspended the banner reads "Only Aditi Sharma can approve this...". The "nobody" state could not be produced live (the database will not suspend the last Super Admin); it is covered by `availabilityFrom` tests.

**The one-eligible-checker case** is shown, not silent, from this commit: the confirm dialog calls `/api/payroll/approvals/checkers` and says in plain words who can confirm and, when only one person or nobody can, that this is blocked and what to do about it. P6-4 extends the same message to run approval, publishing and the bank file.

### 14B. P6-2 build design (written before building, 2026-10-16)

**Scope (your instruction):** components, structures, each person's salary with effective dating, revisions with a checker, arrears on back-dated revisions, nobody edits their own salary (Super Admin included). Salary joins the effective-dating readers and the database overlap constraints. Also here because arrears need them: `payroll_adjustments` (manual add/cancel with preview). **Not in this commit, moved to P6-6 close-out unless you want them sooner:** offer-letter figures from salary, and the Import Center dataset shapes (the real files wait for the greytHR samples anyway).

**What a component and a structure are (a deliberate split of the plan's wording).** The plan put "how its monthly amount is worked out" on the component *and* described CTC splits on the structure. Two homes for one fact is how figures drift, so: **a component says what a line IS** (name, type EARNING / DEDUCTION / EMPLOYER_CONTRIBUTION, taxable, PF-applicable, ESI-applicable, pro-rates with paid days, payslip label and order); **a structure says how much each line gets**. Basic is 40% of CTC in one structure and 50% in another, so the percentage cannot live on Basic. Both are governed items (Placeholder until a different person confirms), stored in `payroll_item_versions` as kinds COMPONENT and STRUCTURE.

**A structure line** is one of: `PERCENT` (of CTC or of an *earlier* line), `FIXED_AMOUNT` (the same for everyone on the structure), `PER_PERSON` (typed for each employee, for example a negotiated allowance), `FORMULA` (the P6-1 expression language over CTC and earlier lines) or `BALANCE` (whatever is left, at most one, so lines always sum to CTC). Each line pins a component *version and hash*. `ctcIncludes` (which component types count toward CTC; default earnings only) is part of the structure, because what CTC includes is a company decision still waiting on you and your CA (§16). Statutory lines are never components: the codes `PF_EMPLOYEE, PF_EMPLOYER, ESI_EMPLOYEE, ESI_EMPLOYER, PT, LWF, TDS, ARREARS` are reserved.

**The breakup.** Monthly CTC is annual ÷ 12, rounded by the existing rule *Rounding of salary lines* (`LINE_ROUNDING`); each line is rounded by it; later lines see earlier lines **as rounded** (what the payslip shows); the BALANCE line absorbs the difference so the lines sum exactly to monthly CTC. A negative balance, or a structure with no BALANCE line whose lines do not sum, is refused with the difference shown. Saving a structure needs a sample annual CTC to prove it sums. The rounding rule is read through `RuleContext`, so the salary row records which version of it was used. If the rule has no value yet the screen says "set the rounding of salary lines first": nothing is rounded by a number I chose.

**`employee_salaries`** (migration `20261016120000_payroll_salary`): employee, `[effective_from, effective_to)`, reason (`JOINING`, `REVISION`, `CORRECTION`), annual CTC, monthly CTC, the structure key, version and hash, the pin of the rounding rule, the revision that wrote it, author. Its **frozen breakup** is `employee_salary_lines` (component code, component version, type, amount, order), exact decimals, so totals and ordering are SQL. The database enforces: `CHECK (to > from)`, `EXCLUDE` against overlap per employee, one open row per employee, positive CTC, **values immutable** (an UPDATE may change only `effective_to`), a row may be **deleted only while it is still in the future** (cancelling a scheduled revision), lines immutable and deletable only with a future parent. The test-purge exception applies as for every other history table. Written only through `writeSalaryChange`; read only through `salaryOn`, `salariesOn`, `salarySegments`, `salaryHistory` (all in `lib/effectiveDating.ts`). The current-row guard already forbids `employeeSalary` in `modules/payroll`.

**Rules of the salary timeline** (same family as job, name and bank history, one deliberate difference): history is only appended at the end; a change cannot be dated before the latest row started; **a change dated the same day as the latest row is refused, not amended**, because an amend would overwrite money. Correct a scheduled row by cancelling it; correct a row already in force with a revision dated after it (or, if it is wrong from its first day and no run has used it, by the arrears route below). First row on or after the date of joining; none after the last working day; leaving ends the row the day after and drops scheduled ones, like job history.

**Revisions are the only way a salary row is written** (joining, increase, structure move, correction), so there is exactly one place a checker is required. A revision picks people (explicit list, branch, grade, a structure version, or everyone employed), a change (`SET` an annual CTC, `INCREASE_PERCENT` by a percentage, and/or move to a structure version, with per-person amounts for PER_PERSON lines) and an effective date. Selections resolve to an explicit employee list **at creation** and are frozen. A person with no salary row is included only by an explicit pick (that is a JOINING row); a branch or grade pick reports who was skipped.

1. **Preview** (stateless): per person the old and new breakup, the difference, the first cycle affected and, for back-dated dates, the arrears per cycle; blockers (self, nobody to check, missing rule) listed. Its fingerprint is the hash the checker will be bound to.
2. **Submit**: creates the revision and a SALARY_REVISION approval bound to that hash. The maker needs `payroll.salary.edit`; the checker needs `payroll.approve`.
3. **Decision**: the checker sees the live preview and sends its fingerprint; a mismatch is refused (`PREVIEW_STALE`) and a changed figure voids the approval, as in the core.
4. **Apply**: one transaction. It locks the employees, recomputes, checks the hash against what was approved, consumes the approval, writes the rows, creates arrears adjustments, marks the revision applied, and records an event per person. Anything that changed in between (somebody's other revision, a new structure version) voids it and nothing is written.

**Nobody approves or edits their own pay.** The maker cannot include their own employee record (Super Admin included); a revision that includes the **checker** cannot be approved by them (new core hook `affectedUserIds`: refused as `CHECKER_IS_AFFECTED`, and they are left out of the "who can check" list with the reason). Same guard on manual adjustments.

**Arrears.** The payroll period is the attendance cycle. A revision whose effective date falls in a cycle that payroll has locked is paid as **arrears in the next run**: the salary timeline keeps the true date, the closed cycle is never rewritten, and one pending adjustment per person per locked cycle carries the money (component breakdown stored on it, source reference `revision:employee:cycle` so the same arrears cannot be added twice). The lock check is bypassed by **one named function**, `writeBackdatedSalaryChange`, which only the revision apply step may call (a source scan fails otherwise), and which refuses to write unless arrears were created in the same transaction. Arrears for a cycle = (new line − old line) × the share of the cycle the person was actually paid. That share comes from a provider that the calculation commit (P6-3) registers from the finalised run: `paid days ÷ days the month counts as` for lines that pro-rate, and all-or-nothing for lines that do not. **Until that provider exists a revision that needs arrears is refused with a clear message, never guessed.** (No cycle can be locked before P6-4 either, so nothing is blocked in practice; the tests register a fake lock and a fake provider to prove the arithmetic.) Whether PF/ESI apply to arrears is the CA question already in §16; the adjustment records its component breakdown so P6-3 can apply whatever the confirmed rule says.

**New rule:** `REVISION_CTC_ROUNDING` (company, ships Not set): how a CTC is rounded after a percentage increase. Without it a percentage revision is refused; an absolute CTC needs no rounding.

**Permissions:** view components, structures, salaries, revisions: `payroll.salary.view`; edit them and prepare revisions: `payroll.salary.edit`; confirm a component or structure: `payroll.rules.confirm` (the same checkers as rules); approve a revision: `payroll.approve`. HR Executive sees none of it.

**Tests (all in `modules/payroll/__tests__/` unless noted):** formula-driven breakup (percent, fixed, per-person, formula, balance, rounding, negative balance, no-balance mismatch) including a property test that lines always sum to monthly CTC; the salary timeline (overlap and backwards CHECK in the database, same-day refusal, scheduled cancel, leaving, readers, segments split on the day); database immutability (value update refused, delete of a past row refused, lines); a revision end to end (preview, submit, approve, apply, voided by an intervening change, voided by a structure change, rejected, withdrawn, resubmitted); self-guards at creation, at submit, at decision and for adjustments, for Super Admin too; arrears (fake lock and provider: mid-cycle date, two locked cycles, a decrease, non-prorating line, no provider refuses, unique reference, the bypass function used nowhere else, the normal writer still refuses in a locked cycle); component and structure governed flow (Placeholder until a different person confirms, edit resets, pins); access (HR Executive sees nothing; manager cannot be granted salary keys). Mutation checks as in P6-1.

### 14C. P6-2 as built (2026-10-16)

**What exists.** Migration `20261016120000_payroll_salary` (4 tables, 4 enums, 5 guard triggers); `modules/payroll/items.ts` (the governed-item core, extracted from the rules code so a rule, a component and a structure confirm through the **same** maker-checker checks, once); `modules/payroll/salary/` (schemas, breakup, components, structures, revisions, arrears, adjustments, employees, guards); the salary readers and writers in `lib/effectiveDating.ts`; 28 API routes; and the screens: Salary Components, Salary Structures, Employee Salaries, Salary Revisions, Adjustments.

| Piece | What it guarantees |
|---|---|
| `employee_salaries` and `employee_salary_lines` | `[from, to)` rows, `CHECK (to > from)`, `EXCLUDE` overlap per employee, one open row, positive CTC. **An UPDATE may change only `effective_to`**; a row may be deleted only while it is still in the future; lines are immutable. Tested by raw SQL against the live database. |
| `writeSalaryChange` | The one writer. Refuses a change dated before joining, after the last working day, before the latest row, and **the same day as the latest row (never an amend)**. Refused inside a finalised payroll period. |
| `writeBackdatedSalaryChange` | The one function that skips the payroll lock, called from exactly one place (the revision apply step), which creates the arrears in the same transaction. A source scan fails on any other caller or if the arrears step moves. |
| Readers | `salaryOn`, `salariesOn`, `salarySegments` (a change on the 16th gives two April segments), `salaryHistory`, `latestSalaries`; `employeeIdsPlacedOn`, `employeeIdsOnStructure` for choosing people. Payroll code reads salary only through them. |
| Components and structures | Governed items (kinds COMPONENT and STRUCTURE). A structure pins each component's version **and hash**; saving one proves it adds up to CTC for a sample CTC. |
| Breakup | Pure and exact: monthly CTC = annual / 12, rounded by `LINE_ROUNDING`; lines rounded by it; later lines see earlier lines as rounded; typed amounts are not rounded; the balance absorbs the difference. Property-tested: with a balance line the lines always add up, for any CTC and any rounding. |
| Revisions | preview -> create and submit -> a different person decides (bound to the figures) -> the maker applies, in one transaction that locks the employees, recomputes, checks the hash, writes, makes the arrears and consumes the approval. An applied revision reads back **as written**, never recomputed. |
| Arrears | Per person per locked cycle, with the component breakdown; the same arrears cannot exist twice (unique source reference); refused with a reason until the calculation commit supplies what each person was paid. |
| Self-guards | Nobody prepares, applies, approves or adds an adjustment for their own pay, Super Admin included. The core gained an `affectedUserIds` hook: a checker whose own pay is in a revision is refused (`CHECKER_IS_AFFECTED`) and is shown as excluded, with the reason, in "who can approve". |

**Rules I decided myself in P6-2** (continuing the numbering; veto any):

28. **A component says what a line is; a structure says how much it gets.** This differs from the plan's wording, which put "how its amount is worked out" on the component too. One fact in two places drifts; and Basic is 40% of CTC in one structure and 50% in another.
29. **Monthly CTC is annual / 12 rounded by `LINE_ROUNDING`, and the balance line absorbs the rounding**, so the lines always add up to monthly CTC exactly. A year's lines can therefore differ from the annual CTC by a few paise. If you would rather the annual figure be exact, tell me and I will carry the remainder into one month instead.
30. **Typed amounts (a fixed amount, a per-person amount) are not rounded**; only calculated lines are.
31. **A salary is never amended, even on the day it starts.** A same-day change is refused; a scheduled row is cancelled, a started one is followed by a revision dated after it.
32. **Revisions are the only way a salary row is written, including a first salary**, so there is exactly one place a checker is needed. `JOINING` is simply the reason a person with no earlier row gets.
33. **A group pick (branch, grade, structure, everyone) leaves out people with no salary and leaves out the preparer, and says so;** an explicit pick of yourself is refused. A first salary is given only by naming the person.
34. **A checker whose own pay is in the revision cannot approve it.** With only one eligible checker who is in the revision, "who can approve" says nobody can, and why.
35. **A new rule, `REVISION_CTC_ROUNDING`** (company, ships Not set), for the rounding of a CTC raised by a percentage. Without it a percentage revision is refused with that explanation; a revision that sets an exact CTC needs nothing.
36. **Arrears for a line that does not pro-rate are all-or-nothing** (the full difference if the person was paid at all in the cycle). The calculation commit uses the same `lineFactor` function, so a segment is pro-rated the same way in a run and in arrears.
37. **The salary tables have row triggers but no truncate-blocking trigger,** because the app needs UPDATE (closing a row) and DELETE (cancelling a scheduled one) on them, and the Phase 1.5 role step would remove both from any table with a truncate trigger. The app role is never granted TRUNCATE. Tested.
38. **The literal scan now catches a figure however it is spelled** (`120_000`, `1e6`, `0xFF`, `100n`). Before, separators and exponents slipped past it. Found while allowlisting this commit's field-length bounds.

**How P6-2 is proved.** Full backend suite run alone: 140 files, 1,276 tests green; frontend 21 tests; typecheck, lint and migration drift clean in both projects. New test files: `breakup.test.ts` (pure arithmetic, schema rules, a 150-run property test that lines always add up), `salaryTimeline.test.ts` (the constraints and triggers against the real database, the readers, leaving, the lock and its one bypass), `salary.test.ts` (components, structures, the revision lifecycle, self-guards for a maker, a Super Admin, a checker and an applier, group picks, access), `arrears.test.ts` (the arithmetic, and a back-dated revision end to end with a fake lock and a fake record of what was paid), `selfConfirmLayers.test.ts` (one test per layer that stops a person confirming their own value), `seedGuard.test.ts`.

**Mutation checks** (each guard broken on purpose; a test must fail): own pay picked, group pick keeping the preparer, applying by somebody in the revision, a checker or maker whose pay is in it, "who can approve" not excluding them, same-day amend, the ordinary writer ignoring the lock, the hash not checked at apply, a stale fingerprint at decision, negative balance, a structure not proved at save and in the preview, a pinned component hash not verified, arrears ignoring pro-rating, apply making no arrears, the bypass used for every write, a component's author confirming it (shared core), leaving not ending the salary, an applied revision shown from live data; plus a literal written `130_000`, one written `1e9` and a second caller of the bypass. **All caught.** Four of these were first *survivors* and each led to a test being added or sharpened: applying by somebody in the revision had no test of its own; the apply step's own hash check was hidden behind the core's identical one (its message is now asserted, so each layer is pinned); and my first "applied revision" mutation did not even parse. The database guards were proved separately by removing each one inside a transaction that rolls back: every probe is accepted without its guard.

**Live walkthrough** (a fresh database, two real browser sessions): components added by the maker and confirmed by the checker (the maker has no Confirm button, the checker no Edit); a structure built in the editor (Basic 40% of CTC, HRA 50% of Basic, Special the balance) and checked against a sample CTC, then confirmed; a first salary prepared for an employee, previewed (a date before the person joined is refused in words, at the top and on their row), submitted, approved by the checker, applied by the maker; the Employee Salaries timeline shows it in force; the maker preparing a change to their own pay is refused with "Nobody changes their own pay, whatever their role".

**Not in this commit** (so you know exactly what is missing): offer-letter figures drawn from a salary and the Import Center dataset shapes for salary (both moved to P6-6; the real import files wait for the greytHR samples anyway); **cancelling a salary row that has been written but not started** (the library function exists and is tested, but no screen or route exposes it, because cancelling a scheduled raise is itself a pay change and should go through the same checker; I would rather ask you than add a one-person path to it); the calculation, payroll lock and arrears record (P6-3 and P6-4), so arrears are proved here with a fake lock and a fake record of what was paid.

### 14D. P6-3 build design (written before building, 2026-10-17)

**Scope (your instruction):** the calculation. Paid days from finalised attendance, loss of pay, leave encashment, arrears, PF, ESI, professional tax (and LWF), draft runs with the TEST watermark, the variance report against last month. Payroll reads attendance and history **only through the readers**. A draft run on placeholders is allowed; nothing real can come out of one. Three follow-ups you asked for ride in this commit: the structure screen shows the monthly figure and the annual total side by side; cancelling a scheduled (written, not started) salary row goes through the same checker; the arrears refusal says plainly that it is waiting on payroll runs existing and the revision is fine. **Not in this commit:** submit / approve / finalise / the real payroll lock (P6-4), payslips and the bank file (P6-5), TDS, loans, reimbursements (Phase 7 seams stay empty and say so).

**The run.** One regular run per attendance cycle (a partial unique index, void runs excluded). Statuses in this commit: `NEW` (made, never calculated), `CALCULATING`, `CALCULATED`, `FAILED`, `VOID` (a discarded draft), and `FINALISED`. **Nothing in this commit can reach `FINALISED`:** a database trigger refuses any change into or out of it unless the transaction has set `payroll.finalising`, which only P6-4's one finaliser will do (a source scan keeps it to one file, the way the salary lock bypass is kept to one caller). It exists now because arrears must read "what was paid" from a finalised run, and that has to be provable today. A finalised run's items and lines are immutable by trigger.

**The inputs, and the only way to read them.**
- *Attendance:* a new reader in `lib/effectiveDating.ts`, `finalisedAttendanceDays(employeeIds, from, to)`, returns **only locked days** (status, `lopDays`); `unfinalisedEmployeeDays` says who has days missing or unlocked. `dailyAttendance` joins the history tables on the forbidden list for `modules/payroll`, so payroll cannot read an unlocked day or a different table by accident.
- *Employment span:* `employedBetween(from, to)` (a new `where`, beside `employedOn`) and `employmentSpan`. Never `status`.
- *Salary:* `salarySegments`. *Placement:* `placementSegments` / `placementOn`. *Name:* `namesOn`. *Bank:* `bankAccountOn(employee, payment date)`.
- *Year-end encashment:* a new reader in the leave module, `committedEncashments()`, not a table read from payroll (the guard forbids `yearEndRunItem` in payroll too).

**Days.** The month a cycle pays is the month of its **end** date. `basisDays` comes from `PAY_DAYS_BASIS`: the days in the cycle (calendar), `FIXED_DAYS_VALUE`, or the working days in the cycle (days that are not a holiday or week off, from the person's locked rows). `notEmployedDays` = cycle days minus the days employed. `employedShare = (basisDays - notEmployedDays) / basisDays`; `lopShare = LOP days / lopDivisorDays` (`LOP_DIVISOR`: same as the basis, calendar, fixed or working); `factor = employedShare - lopShare`. Paid days shown = `factor x basisDays`. A person who joined or left in the cycle on a **working-days** basis cannot be worked out (the days they were not employed have no attendance rows to count) so they are **held with that reason**, never guessed. Each salary segment (a revision on the 16th gives two) gets its own factor: the employed share split by its days, and the LOP that fell inside it.

**Lines.** A component line = the rounded sum over segments of `segment amount x segment factor` (`LINE_ROUNDING`, once, at the end). A component that does **not** pro-rate pays its full amount from the last segment that was paid at all. Earnings add, deductions subtract, employer contributions are shown and are not in net. Adjustments (pending, manual) and arrears (pending, from revisions) and year-end encashment are lines of their own, each carrying the id it came from, so P6-4 can mark exactly those consumed. Statutory lines are produced from rules under reserved codes: `PF_EMPLOYEE`, `PF_EPS`, `PF_EPF_ER`, `PF_EDLI`, `PF_ADMIN`, `ESI_EMPLOYEE`, `ESI_EMPLOYER`, `PT`, `LWF_EMPLOYEE`, `LWF_EMPLOYER`, `LEAVE_ENCASHMENT`, `NET_ROUNDING`. Every line stores its **basis** (inputs, days, rule keys and versions), so "why is this 4,617" is answered on screen from the stored line, not by re-running.

**Statutory (all rates and ceilings through `ctx.rule`).** PF wages = PF-applicable earnings (component flags; arrears per `ARREARS_PF_ESI`; encashment per `ENCASH_PF_APPLICABLE`), capped at `PF_WAGE_CEILING` when `PF_CEILING_MODE` says so; each contribution rounded by `PF_ROUNDING`; only for the employment types in `PF_ELIGIBLE_TYPES`. ESI: coverage is decided on the **full-month entitlement** of ESI-applicable lines against `ESI_WAGE_CEILING` (so a few days of LOP do not flip someone's cover), at the last employed day for `MONTHLY` and at the start of the half-year or the joining date for `STICKY_HALF_YEAR`; the contribution is on what was earned, rounded by `ESI_ROUNDING`. PT: the state comes from the placement on the first or last day of the person's paid span (`PT_STATE_OF_PLACEMENT`), mapped from the branch's free-text state by `STATE_NAME_MAP`; the slab is read from `PT_SLABS` on the month's gross. LWF: from `LWF_TABLE` in the listed months. **A rule the calculation needs that has no value stops the calculation, and the readiness list shows every missing rule at once.** The exception is PT and LWF (and the state map), which the approved plan says are ₹0 with a notice when nothing is set: those runs record the rule as **pinned "not set"**, which counts as a Placeholder in the gate and the watermark, so "₹0 because nobody set it" can never become a real run (a company with no PT enters an explicit empty table and has it confirmed).

**Change to the P6-1 rule shape (found while building):** the PT table's month exceptions (February) sat on the whole state, so it was ambiguous which slab they replace. They now sit **on the slab** (`slabs[].monthOverrides`), which says it exactly. Nothing stored depends on the old shape.

**Pins, extended.** A pin is now `(kind, key, version, valueHash, live)`. Rules read through `ctx` are live (an edit makes the run stale). The structure, components and rounding that a **salary row** was frozen under are pinned too, **not live**: a later structure version must not stale a run whose people were deliberately left on the old one, but if the row was frozen under a Placeholder the run is still a test. `pinStatuses`, `assertRunIsReal` and the watermark treat all kinds alike.

**Running it.** A BullMQ job `payroll-calculate`: takes a lease on the run (two calculations cannot overlap; an expired lease can be taken over), works in chunks of 50 people, each chunk written in one transaction and stamped with the run's `calcVersion`, so a killed worker resumes at the first person not yet stamped. A fingerprint of every rule's current version is taken at the start; if a rule moved while it was paused, the run starts over rather than mixing two rule sets. Progress goes to the `perm:payroll.run` room (counts only, no figures). Recalculating replaces the items. **Calculate is previewed first:** the preview computes everything in memory and shows who would change and by how much against the stored run; the confirm sends back the fingerprint of the inputs it showed and is refused (`PREVIEW_STALE`) if anything moved.

**Exceptions and holds (explicit, never silent).** *Holds* (calculated, but not payable): no salary on a day they were employed (also excluded from the totals, listed), no bank account on the payment date, leaver with `HOLD_FOR_FNF`, net exactly zero, negative net under `HOLD_PAYMENT`, working-days basis for a part month. *Blocking exceptions* (P6-4 refuses to submit while any remain): negative net under `BLOCK`, a branch whose state is not in `STATE_NAME_MAP` while PT is configured, an unmapped salary gap, LOP exceeding the days they were employed. *Notices:* TDS and loan lines are not calculated until Phase 7; PT or LWF not set; a state with employees and no PT table.

**Year-end encashment reaches payroll exactly once.** A committed year-end item becomes a pending `YEAR_END_ENCASHMENT` adjustment, created idempotently by the unique `(source, sourceRef = item id)`, when a run is calculated and the cycle is the one `ENCASH_PAYOUT_RULE` names. The amount is the one committed at year end; payroll does not recompute it. The salary-based `EncashmentRateProvider` the leave module has been waiting for is registered here: it evaluates `ENCASH_DAILY_RATE_FORMULA` over the person's `salaryOn(year-end)` lines, records `rateSource = SALARY_STRUCTURE`, and says `isFinal` only when the rule is Confirmed. **Until that rule has a value the provider defers to the existing HR-entered flat rate** (source `MANUAL_SETTING`, not final), exactly as Phase 4 behaves today, so the Year End screen does not break the day this ships.

**Arrears provider.** Registered at startup: `paidShare` reads the finalised run's item for that person and cycle and returns the share they were actually paid in the part asked for (employed days and the dated LOP days the item recorded, over the basis it used). No finalised run, or no item: the existing refusal. **The refusal now reads:** "This is dated inside a payroll period that is already closed (October 2026). What it owes is paid as arrears, and arrears are worked out from what each person was actually paid in the closed month. The salary revision itself is fine. It is waiting only because there is no finalised payroll run for that month yet. Date it after the last finalised period, or wait until payroll runs have been finalised."

**Variance.** Against the previous cycle's run: the most final one there is (`FINALISED`, else the latest calculated draft, **and the report says which** so nobody mistakes a draft baseline for a closed month). Per person: change in gross, deductions, net; reason tags it can know (joined, left, salary revised, LOP changed, adjustment, encashment, arrears, statutory change, held); highlight above `VARIANCE_FLAG_PERCENT` and `VARIANCE_FLAG_MIN_AMOUNT`; joiners and leavers; the change in totals. The thresholds only decide what is highlighted, so they are read live and **not pinned** (a Placeholder highlight threshold cannot make a run a test).

**Follow-ups.** (a) The structure editor and the structure list show the monthly figure and the annual total side by side, with the rounding difference named when the twelve months do not add to the annual CTC. (b) `PayrollSalaryRevision` gets a `kind` (`CHANGE` or `CANCEL_SCHEDULED`); a cancellation names one scheduled row, is previewed (the row removed, the salary that stays in force), is decided by a different person bound to the row's figures, and applied by a transaction that locks the person, re-checks the hash, consumes the approval and calls the existing `cancelScheduledSalary`. Same self-guards as any revision. (c) The wording above.

**Permissions.** View runs, items, variance, workbook: `payroll.salary.view`. Make, calculate, discard: `payroll.run`. No new keys.

**Tables (migration `20261017090000_payroll_runs`).** `payroll_runs` (cycle, status, calc version, lease, progress, pins, rules fingerprint, inputs fingerprint, run hash, totals, who/when), `payroll_run_items` (one per person: status, hold, spans, days, factor, totals, placement, employment type used, inputs for explainability, notices, exceptions, item hash), `payroll_run_lines` (one per line: code, kind, source, source ref, amount, basis). Adjustments gain a real foreign key to the run that consumed them.

**Tests.** Hand-worked golden cases checked against an independent rational-arithmetic model (full month, joiner, leaver, LOP, a revision on the 16th, PF below/at/above the ceiling, ESI just under/over, PT slab edges and February, LWF month, encashment once, arrears from a finalised run, negative net, no bank, zero net); property test that lines add to totals to the paisa and that the hash moves for any changed paisa; the pins (not-set, historic, live) through the gate and the watermark; attendance read only through the reader (an unlocked day is invisible); the `FINALISED` trigger; lease, resume after a killed worker, preview/confirm staleness; access (HR Executive and managers see nothing); the guard scans extended (`dailyAttendance`, `yearEndRunItem`, the single `payroll.finalising` setter). Mutation checks as before.

### 14E. P6-3 as built (2026-10-17)

**What exists.** Migration `20261017090000_payroll_runs` (3 tables, 5 enums, an enum value on adjustments, a `kind` on revisions, the triggers below); `modules/payroll/run/` (`rules`, `days`, `statutory`, `person`, `gather`, `engine`, `service`, `variance`, `export`, `providers`, `controller`, `validators`); the `payroll-calculate` queue and worker; 11 new API routes and 2 for cancelling a scheduled salary; the screens Payroll Runs (list, start with readiness), one run (People, Difference from last month, What it used), the "Why?" drawer, the calculate preview, and cancelling a scheduled salary from the salary timeline. The three follow-ups you asked for are in.

| Piece | What it guarantees |
|---|---|
| Readers | `finalisedAttendanceDays` returns **locked days only**; `unfinalisedAttendanceDays` says who has days missing; `employedBetween` / `employmentSpan` for who was employed; `salarySegmentsMany`, `bankAccountsOn`, `payrollPlacementsOn`; `committedEncashments` in the leave module. `dailyAttendance` and the year-end tables are on the list payroll code may not query (`currentRowGuard.test.ts`). |
| The factor | The fraction of each full-month line that is paid is carried as an **exact fraction** (numerator and denominator), and a line is `amount x numerator / denominator`, divided once. This was found by a property test: as a decimal quotient, a person who lost every day of a short month came out with a speck above zero and was paid the whole conveyance. Zero is now a comparison of exact numbers. |
| Pins | `(kind, key, version, hash, live)`. Rules read through the context are live; what a salary was **frozen** under (structure, components, rounding) is pinned but never stale; a rule allowed to be unset (PT, LWF) is pinned **"not set"**, which is a Placeholder, so "zero because nobody set it" cannot be real. |
| FINALISED | Unreachable: the database refuses to make a run final, or to change a final run, its items or its lines, unless the transaction has set `payroll.finalising`. A source scan keeps any code from setting it (the list of allowed files is empty until P6-4's finaliser). |
| The job | Lease on the run (two calculations cannot overlap; BullMQ handing a stalled job back takes it over because the job id is the lease owner), chunks of 50 people each in one transaction and stamped with the run's calculation version, resume writes only the people not yet stamped, a changed rule or input starts over under a new version, failures are recorded in words. |
| Preview, then confirm | Calculating is previewed (who would change, by how much, the totals before and after, the TEST status). The confirm sends the fingerprint of exactly what was shown and is refused if anything moved. |
| Arrears | `finalisedRunArrearsProvider` answers from a FINALISED run's item, as the same exact fraction the run used for those days; a draft, an excluded person or nobody answers nothing. The refusal now reads "…closed, but there is no finalised payroll run on record… The revision itself is fine: it is waiting only on payroll runs being finalised for that month." |
| Encashment | A committed year-end item reaches payroll once (unique source reference), in the run `ENCASH_PAYOUT_RULE` names, at the amount committed at year end. `SalaryBasedEncashmentRateProvider` is registered; until the rule has a value it defers to the Phase 4 flat rate. |
| Variance | Against the previous cycle's run: the finalised one if there is one, else the latest draft, **and it says which**. Reasons it can know; flags by the two thresholds, which are read live and are not pinned. |
| Follow-ups | The structure screen shows each line's monthly figure and its yearly total side by side with the difference named, on the save preview and on a worked example for any CTC. Cancelling a scheduled salary is a revision of kind `CANCEL_SCHEDULED`: previewed, decided by a different person bound to the row's figures, applied by the maker, never by the person whose pay it is. |

**Rules I decided myself in P6-3** (continuing the numbering; veto any):

39. **The month a cycle pays is the month of its end date** (for the PT month exceptions, the LWF months and the ESI contribution period).
40. **Pay days:** a month counts as the days in the cycle, a fixed number, or the working days in it. A person is paid `(basis - days not employed) / basis`, less `loss of pay / LOP divisor`. A part-month person on a **working-days** basis is **left out with that reason**, because the working days of the days they were not here are not on record. I would rather list them than guess.
41. **A line that does not pro-rate is paid in full if the person was paid at all**, from the last salary segment that was paid. A line that pro-rates is summed over the salary segments and **rounded once**.
42. **Attendance:** anyone with a day attendance has not locked is **left out and listed** (never paid from a day that can still change); anyone with no salary for a day they were employed is **left out and listed** (never paid zero silently).
43. **ESI coverage is decided on the full-month entitlement** of ESI-applicable lines (so a few days of loss of pay do not change who is covered), at the last employed day, or, under the half-year rule, at the start of the contribution period or the joining date. The contribution is on what was earned. This is my reading of the half-year rule; your CA should confirm it, and it is behind a Placeholder rule.
44. **PT and the state:** the state comes from the branch's free-text state through the rule "State names", on the first or last day of the person's paid span. A branch not in that map is a **blocking exception**, never a guess. A state the PT table does not list is charged nothing, with a notice.
45. **PT month exceptions (February) now sit on the slab** they replace, not on the whole state: the old shape was ambiguous, and nothing stored depended on it.
46. **A rule the calculation needs and nobody has set stops it, and every missing one is listed at once.** PT, LWF and the state map are the exception: they may be unset, the run charges nothing and says so, and records them "not set", which keeps the run a TEST.
47. **A negative net** is a blocking exception under BLOCK and a held person under HOLD_PAYMENT; a nil net is held; no bank account on the payment date is held; a leaver in their last month is held under HOLD_FOR_FNF. A held person is still calculated.
48. **A "no rounding" rule is honoured only while the figure fits** the six decimal places money is stored to; otherwise the calculation stops and says which figure.
49. **Draft recalculation replaces the people and lines; pending adjustments stay pending** (a draft only reads them). Marking them consumed is P6-4's finalise.
50. **The variance thresholds are not pinned.** They only decide what is highlighted, so a Placeholder threshold must not make a run a test.
51. **Employment type comes from the employee record as it is when the run is calculated**; the data model does not keep it effective-dated. The run stores the type it used for each person.
52. **People with no figures in either month are not listed on the variance;** they are on the run's own list of people left out, with the reason.

**How P6-3 is proved.** New test files (all in `modules/payroll/__tests__/`): `runPure.test.ts` (days, shares, every statutory function at its edges, ten hand-worked months, and a 300-case comparison with an independent rational-arithmetic model that agrees to the paisa), `runCalculation.test.ts` (the pipeline through the real API, job and database: golden figures, left out and held, stored totals, explanation, pins and the watermark, the confirmed path, workbook, preview and stale confirm, readiness with missing rules, access, lease, resume, restart), `runIntegrations.test.ts` (the FINALISED switch, the database's consistency checks, arrears from a finalised run, year-end encashment once, variance), `salaryCancel.test.ts`; additions to `breakup.test.ts` (annual view), `rules.test.ts` (PT shape), `payrollGuards.test.ts` and `currentRowGuard.test.ts`.

**Verification.** Full backend suite run alone: 144 files, 1,350 tests green; frontend 21 tests; typecheck, lint and migration drift clean in both projects. **Mutation checks** (a guard broken on purpose; a test must fail): 20 of 20 now caught: unlocked days visible to payroll, a non-prorating line pro-rated, PF not capped, ESI cover decided on earnings, "no rounding" silently trimming, PT slab edge inclusive, a frozen pin going stale, an unset rule not pinned, the lease ignored, resume rewriting everyone, a calculation on an out-of-date preview, an encashment paid twice, the payout rules swapped, arrears from a draft run, the register not watermarked, anybody able to make a run, a cancellation applied after its figures moved, a person preparing the cancellation of their own pay. **Two first survived:** the factor being allowed to go negative (the test only reached exactly zero; a case with more loss of pay than days and a "lost every day" person now pin it), and the variance preferring a finalised run to a draft, which was no real choice because only one live run exists per cycle (a database index), so the code was simplified instead of tested. The database's refusal to make a run final was proved by dropping its trigger inside a transaction that rolls back: the same insert is then accepted. Also found: two older tests (and one of mine) built a "stale" fingerprint by changing the last character to `0`, which is no change one time in sixteen; fixed. **Live walkthrough** (a fresh database, a worker, two real browser sessions): rules, components and a structure set and confirmed through the API; four people given salaries; the readiness list (26 people left out because their attendance is not finalised, each listed with days); the run created, previewed ("first calculation"), calculated by the worker, shown with the TEST banner naming the Placeholder rules; the "Why?" drawer for the person with three days of loss of pay (28 of 31 days, the dates, each line's basis); the register downloaded as `payroll-register-2026-08-01-TEST.xlsx`; a September run with the variance against the August draft (the draft baseline warning, the loss-of-pay change flagged at 10.76%); the checker seeing the run with no Calculate or Discard button; a scheduled raise cancelled from the salary timeline, approved by the checker and applied (the timeline afterwards shows only the salary in force); the structure screen's worked example with the month and the year side by side and the Rs 4 rounding difference named.

**Not in this commit** (so you know exactly what is missing): submitting, approving, finalising a run and the real payroll lock (P6-4: until then no cycle is locked, so arrears and the finalised-run reader are proved with a fake lock and a hand-finalised run); payslips, the bank file and statutory outputs (P6-5); TDS, loans and reimbursements (Phase 7: their lines are absent, and the run says so); off-cycle runs; a working-days basis for a part month; offer-letter figures and salary imports (P6-6).

### 14F. P6-4 build design (written before building, 2026-10-17)

Your instructions for this commit: submit, approve, finalise and the real lock; all six subjects wired; the approval bound to a hash of the exact figures and voided by any change; a full preview (variance from last month, who is affected) and an explicit confirmation before submission; placeholders block everything real; unlock refused once payslips are published or a bank file exists; the one-eligible-checker message on run approval and finalisation; **a run that leaves anybody out cannot be submitted, and the names are at the top of the submit screen**; the ESI half-year rule recorded as an open question that blocks it from being Confirmed.

**States.** `NEW -> CALCULATING -> CALCULATED -> SUBMITTED -> APPROVED -> FINALISED`, plus `FAILED` and `VOID` as before. Rejecting returns a SUBMITTED run to CALCULATED with the checker's reason shown to the maker. A SUBMITTED or APPROVED run cannot be recalculated or discarded (spec section 6 point 4); the only way back is **Reopen**, which is previewed, needs a reason, voids every live approval of the run and returns it to CALCULATED. Withdrawing a request is the same action done by the maker.

**The hash.** An approval is bound to `computeRun(cycle).runHash` worked out **fresh** at submit, at decision and at every step that consumes it (not to the stored hash). That hash already covers every item hash, the totals' inputs, the pinned rule/structure/component versions, the adjustments, and (through the item hashes) the attendance days, salary segments and bank placement each person was calculated from. Two lines of defence for "voided by any change": (1) after every payroll-owned change that can move the figures (an adjustment added or cancelled, a revision applied or cancelled, a rule/component/structure edited, an attendance period unlocked) the open runs are re-checked and an approval whose hash no longer matches is voided at once and the run returns to CALCULATED, naming what changed and who did it (so that person can no longer be the checker); (2) anything that slips past is caught when the run is read, decided on or consumed, which recompute the hash and refuse on a mismatch. Re-checking costs one full calculation in memory, only while a run is SUBMITTED or APPROVED.

**Submit (previewed, then confirmed).** `POST /runs/:id/submit-preview` returns, in this order: **who is left out** (every person with status EXCLUDED, their name, and the reason in words, listed first and in full), blocking exceptions (name and message), the rules that are still Placeholders or have changed since calculation, "nobody would be paid", the checker availability sentence (`NONE` / `ONE` with the one-eligible-checker message / `MANY`), held people with reasons (they do not block; they are visible), the totals, the **variance against last month** (which baseline, how many joined, left, changed, flagged; the flagged people), who is affected (everyone in the run; the maker's own line if they are in it), the TEST watermark, and a fingerprint of the fresh hash. `canSubmit` is false while any blocker exists. `POST /runs/:id/submit` repeats every check on the server (the preview is not trusted), refuses on a different fingerprint, and in **one transaction** creates the approval and moves the run to SUBMITTED. Refusals have their own codes: `PEOPLE_LEFT_OUT`, `BLOCKING_EXCEPTIONS`, `PLACEHOLDER_RULES`, `RULES_CHANGED`, `NOTHING_TO_PAY`, `RUN_STALE`, `PREVIEW_STALE`.

**There is no waiver.** If somebody is deliberately not to be paid in a month, the way to do it today is to resolve the cause (give them a salary, finalise their attendance, correct the dates). I did not build a "pay everyone else anyway" override because that is exactly the quiet omission you asked to stop. If you want one later it should be its own maker-checker subject, per person, with a reason; say so and it becomes a decision for a later commit.

**Approve / reject.** The checker's screen is the same preview plus the maker's note. `POST /runs/:id/decision` carries the hash the checker was shown; a different hash is `PREVIEW_STALE`. Approving moves the run to APPROVED in the same transaction as the approval; rejecting (reason required) returns it to CALCULATED. The existing core refuses the maker, anybody who changed the figures, and anybody without `payroll.approve`.

**Finalise (a second approval, then an act).** `PERIOD_FINALISE` is requested by the maker on an APPROVED run (previewed: the approved hash, the dates it will lock, the history changes it will then refuse, the adjustments it will mark paid, the attendance consequence, the one-eligible-checker sentence), decided by a checker (may be the same person who approved the run; never the maker), and then **executed by the maker** with `POST /runs/:id/finalise`. The execution is `run/finaliser.ts`, the one file allowed to set `payroll.finalising`: in a single transaction it re-verifies the hash and `assertRunIsReal`, consumes both approvals, sets the run FINALISED, writes the `payroll_period_locks` FINALISE row, marks the adjustments the run paid as CONSUMED by it (a payable or held person's ids; any that no longer exist as a row stops it), and records the event and audit row. A small window remains between the hash check and the commit in which a change could still commit; it is the mirror of the window every history writer has against the lock, and I accepted it rather than hold table locks across the whole system (rule 64).

**The real lock.** `payroll_period_locks` is append-only (a trigger), one row per FINALISE or UNLOCK of a cycle; a cycle is locked while its latest row is FINALISE; a database trigger refuses a second FINALISE without an UNLOCK between. `registerPayrollSeams()` installs the real check with `setPayrollLockCheck`, so every history writer, cancel and separation close already wired to the hook is refused with `PAYROLL_LOCKED`. The contract tests that pinned the hook with a fake are re-run against the real check.

**Unlock.** `PERIOD_UNLOCK`: requested with a reason by someone holding `payroll.unlock` (Super Admin), decided by a checker with `payroll.approve`, executed by the requester. **Refused once payslips are published or a bank file exists** (P6-5 writes a `payroll_run_releases` row in the same transaction as each; unlock refuses while any exists, at the service and again in a database trigger). It shows what unlocking allows before it is confirmed. Executing it, under `payroll.unlocking`, voids the FINALISED run (its items and lines stay as the record of what was once final), writes the UNLOCK row, returns the adjustments the run had consumed to PENDING, and voids any live payslip or bank-file approval. A new run can then be made for the cycle.

**PAYSLIP_PUBLISH and BANK_FILE.** Registered with the core and fully usable as approvals now (request with preview, decide, withdraw) on a FINALISED run; what they authorise is built in P6-5, which will extend the publish hash with the payslip content hashes. A bank file also needs a Confirmed bank template, which does not exist until P6-5, so its request is refused for that reason today. Both approvals are voided by an unlock or a reopen.

**ESI open question.** The half-year ("sticky") coverage mechanics are my reading, not a verified rule. They are recorded as an open question on the rule itself: a rule in the catalog can carry an `openQuestion` that applies to chosen values; while it is open, the confirm preview says so (`blocked`) and confirming is refused with `OPEN_QUESTION`, whatever is typed or noted. It is cleared only by a code change that removes it, made after the question is answered in `docs/PROGRESS.md`. Because the rule is then always a Placeholder, any run that reads it stays a test and cannot be submitted.

**Attendance.** The attendance unlock warning now answers "payroll has used this period" for any run that is SUBMITTED, APPROVED or FINALISED (a second hook beside the lock hook), and an unlock re-checks the open runs, which voids an approval built on days that have just been opened.

**Realtime.** Submitting tells the people who can approve (`payroll.approve` room); a decision, a reopen and a finalise tell `payroll.run`. No email in this commit.

**Proof.** Real database, real API: the whole path with two users; every refusal above (each left-out cause, blocking exception, placeholder, stale, nobody payable); the maker/checker invariants for each of the six subjects and the seventh (different people, bound to the hash, voided by a change, single use); a change of each input class voiding an approval (attendance unlock, salary, adjustment, rule); the lock refusing every writer after finalise and allowing them after unlock; unlock refused with a release row, at the service and, with the service bypassed, at the database; the finalise switch reachable from nowhere else (source scan updated to name the one file); the ESI rule unconfirmable; the one-eligible-checker message on each screen's data; guard scans; mutation checks on the new guards; a live two-browser walkthrough.


### 14G. P6-4 as built (2026-10-17)

**What exists.** Migration `20261017120000_payroll_close` (two run states, two append-only tables, three tightened database guards); `run/closing.ts`, `run/submitCheck.ts`, `run/finaliser.ts`, `run/lock.ts`; 8 new API routes (the five-step approval shape is one set of routes with a slug: `run`, `finalise`, `unlock`, `publish`, `bank-file`); the Approval panel on a run and one page for every step (`/admin/payroll/run/:id/step/:slug`); the real payroll lock and the attendance "payroll has used this period" answer registered in `registerPayrollSeams()`.

| Piece | What it guarantees |
|---|---|
| People left out | `PEOPLE_LEFT_OUT` is the first thing the submit page shows (every name, the reason in words, in full, above everything else) and the server refuses to submit while there is anyone: with the preview's fingerprint in hand, with the rules confirmed, with nothing else wrong. Confirming rules does not make such a run approvable. Also refused, each with its own code: figures that moved since calculation (`RUN_STALE`), a blocking problem (`BLOCKING_EXCEPTIONS`, with names), a Placeholder or changed rule (`PLACEHOLDER_RULES` / `RULES_CHANGED`), nobody payable (`NOTHING_TO_PAY`). |
| Bound to the figures | An approval stores `computeRun().runHash` worked out fresh. The checker approves the hash they were shown (`hash` is required, a different one is `PREVIEW_STALE`). A change that moves the figures voids the approval and returns the run to a draft in the same transaction, and records who made it so they cannot be the checker. Adjustments, salary revisions, rule edits and an attendance unlock announce themselves; anything else (an employee record edited directly) is caught when the run is read, decided on or finalised, each of which recomputes the hash. |
| State follows approval | A run is SUBMITTED or APPROVED only while its approval is live. The core's `onVoided` hook sets the run back in the same transaction as the void, whatever the reason. While SUBMITTED or APPROVED the run cannot be recalculated or discarded, and the database refuses any change to its people and lines. |
| Finalise | Two approvals, then an act: `RUN_APPROVAL` (the figures) and `PERIOD_FINALISE` (the lock), each by someone other than the maker; the act is by someone other than the person who decided. The finaliser re-checks the hash and the rules, then in one transaction uses both approvals up, marks the adjustments the run paid, makes the run FINALISED and writes the lock row. The database refuses FINALISED unless that transaction set the switch, the run was APPROVED and both approvals are used up. |
| The lock | `payroll_period_locks` is append-only; a cycle is locked while its latest row is FINALISE; the database refuses a second FINALISE without an UNLOCK and any change to the log. The EF4 hook now refuses any history change, cancellation or separation dated inside a locked cycle with `PAYROLL_LOCKED`. |
| Unlock | `payroll.unlock` (Super Admin) to ask and to carry out, a written reason, a second person to approve, the preview says what unlocking allows. **Refused once a release row exists** (payslips published or a bank file made): by the service, by the run's own trigger and by the lock log's trigger. Unlocking sets the final run aside (VOID, kept as the record of what was once final; its figures cannot be touched), opens the lock, hands the adjustments it paid back to pending, and withdraws a waiting payslip or bank-file approval. |
| Publish, bank file | Approvals on a final run, with the same preview, request, decision and withdrawal. A bank file also needs a Confirmed `BANK_TEMPLATE`, which does not exist until P6-5, so asking for one is refused today for that reason. What they authorise is P6-5. |
| ESI half-year rule | `ESI_PERIOD_RULE` set to `STICKY_HALF_YEAR` carries an open question in the catalog: the confirm preview says it cannot be confirmed (with the question), `confirmRule` refuses with `OPEN_QUESTION` before anything else is looked at, and the rules screen tags it. The monthly value is not held up. The question is recorded in `docs/PROGRESS.md` (open questions) and §16 below, and is cleared only by a code change after your CA answers. |
| One eligible checker | The preview and the Approval state of every step carry the checker availability sentence: "Only X can approve this" when there is one person, and an error when there is none, on run approval, finalising, unlocking, publishing and the bank file. |

**Rules I decided myself in P6-4** (continuing the numbering; veto any):

53. **A run is approved in two steps, as §6 says:** the figures (`RUN_APPROVAL`), then closing the period (`PERIOD_FINALISE`). The same checker may do both; the maker may do neither.
54. **There is no waiver for somebody left out.** If a person is deliberately not to be paid in a month, resolve the cause; the run is not approvable until then. A per-person, reasoned, maker-checker waiver is a possible later subject if you want it. I did not build one because it is exactly the quiet omission you asked to stop.
55. **Held people do not block submission, but are listed on the submit page with the reason.** Their lines and the adjustments behind them belong to the run, so finalising marks those adjustments paid.
56. **A SUBMITTED or APPROVED run cannot be recalculated or discarded.** Withdrawing a request (SUBMITTED) or reopening (APPROVED) is previewed, needs a reason, voids every live approval of the run and returns it to a draft.
57. **The person who decides is never the person who carries it out** (finalise, unlock), on top of the maker-and-checker rule.
58. **Unlocking sets the final run aside (VOID) rather than reopening it as a draft.** Its figures stay as the record, the cycle can have a new run, and what the run paid is owed again.
59. **Unlock needs `payroll.unlock` both to ask and to carry out;** the decision is `payroll.approve`.
60. **Publishing and the bank file can be asked for on a final run now;** the publish hash will include the payslip content hashes in P6-5, which voids any earlier approval (none will exist in real use). A bank file needs a Confirmed `BANK_TEMPLATE` first.
61. **The ESI open question blocks the half-year value only.** The monthly value is not part of the question.
62. **The attendance unlock warning counts a SUBMITTED, APPROVED or final run as "payroll has used this period"**, and says an unlock voids the approval where that is so.
63. **Realtime notices go to the people who can act** (`payroll.approve` when something is asked, `payroll.run` when it is decided or voided); no email in this commit.
64. **A small window remains** between the finaliser's last hash check and its commit in which a change could still commit. Every history writer has the mirror window against the lock. I accepted it rather than hold table locks across the system; the finalised run's hash is stored, so a difference would show.

**How P6-4 is proved.** `runClosing.test.ts` (33 tests, four worlds): anyone left out (two causes at once, with names and reasons, refused with and without confirmed rules, refused for a blocking problem, then submitted once everything is right); the whole road with two real checkers and a Super Admin (preview, wrong fingerprint, wrong permission, submit, lock, reject with reason, withdraw, approve, close-period request, decision by a Super Admin who is then refused as executor, finalise, lock, the database's refusals, attendance warning, publish approval, bank file refused, unlock with every step, the aftermath, a second run through the same road, unlock refused with a release row by the service and by the database with the service bypassed); changes that void an approval (an adjustment, a salary revision, a rule edit, an attendance unlock, a change nothing announces caught on reading, deciding and finalising), and a checker who changed the figures; the ESI question. Also `runIntegrations.test.ts` (the finalised state needs the switch, the right previous state and both approvals; an adjustment is consumed only under the switch), `payrollGuards.test.ts` (the switches are in exactly `run/finaliser.ts`).

**Verification.** Full backend suite run alone: 145 files, 1,385 tests green; frontend 21 tests; typecheck, lint and migration drift clean in both projects. **Mutation checks** (a guard broken on purpose; a test must fail): 25 of 26 caught: anyone left out submittable, moved figures submittable, a blocking problem submittable, placeholder rules submittable, nobody-payable submittable, the checker not needing to have seen the hash, a change never voiding an approval, a voided approval leaving the run submitted, an approval not moving the run, finalising trusting the approvals (both hash checks removed), the checker carrying out the finalising, the unlock ignoring a release (service), the unlock preview ignoring a release, a lock that never locks, an unlocked period staying locked, adjustments not marked paid, the ESI question not enforced, attendance never being told a run is waiting, a figure editor approving, an unlock leaving publish and bank-file approvals live, an unlock not handing adjustments back, submitting not locking the run, a withdrawal not voiding, a rule edit not telling payroll. **One first survived and is equivalent by design:** removing the unlock permission from the route's own check survived because the approval core checks the same permission again; removing both is caught (4 tests fail). Three further mutation-style findings of the same kind were turned into tests while building (a stale run at submit, an unlock carried out after a release, a run in which nobody would be paid). **The database's refusals** were proved by dropping each trigger inside a transaction that rolls back: the run guard (draft to final), the release guard (a release against a non-final run) and the lock log (an UPDATE of it) each refuse with the trigger and accept without it. **Live walkthrough** (a fresh database, a worker, three browser sessions): the run page said one person was left out; the submit page listed them by name with the reason **above everything else** and the Submit button was disabled; after their attendance was finalised and the run recalculated and every rule confirmed, the page said "Only Aditi Sharma can approve this" (the other approver's role removed for the screenshot), the Submit button stayed disabled until the confirmation box was ticked; the checker opened the run, saw the same figures and approved only after ticking; the maker asked to close the period, the checker approved, the maker closed it; the run page then read "This month is final and locked"; the Super Admin asked to unlock with a reason, the checker approved, the Super Admin carried it out and the run showed as discarded with lock rows FINALISE, UNLOCK; the rules screen tagged the half-year ESI value with its open question and its confirm dialog refused to confirm it. **Found by the walkthrough, not by the tests:** the checker could not open the preview, because its route asked for the maker's permission; it now accepts the checker's. The live check of a job change inside the locked month was refused for want of a permission rather than for the lock, so the lock itself rests on the tests (`runClosing.test.ts` writes a job change through the real lock and sees `PAYROLL_LOCKED`).

**A finding worth knowing.** The test database holds the seeded company, so every run made there also contains the seeded staff, each left out for want of finalised attendance. That is correct (it is what the same run would say on the real company), and it is why the clean-road tests move everyone else's joining date past the cycle while they run and put it back afterwards (`sidelineEveryoneBut`).

### 14H. P6-5 build design (written before building, 2026-10-19)

**What P6-5 is.** What the two P6-4 approvals (`PAYSLIP_PUBLISH`, `BANK_FILE`) authorise, and the statutory outputs. After this commit a final run can be turned into immutable payslips the employees see, into a bank file HR uploads to the bank by hand, and into the PF, ESI, PT and LWF statements, and the register.

**The pattern, the same as finalising.** Request, decision and withdrawal already exist (P6-4). New here is the *act*, carried out by a person other than the one who decided, in `run/release.ts`, the only file allowed to create payslips, bank batches and release rows (a source scan keeps it so, as for the finaliser). Each act, in one transaction: re-checks the run is FINALISED and its hash, uses the approval up, writes its rows **and the release row**. From that commit the period can no longer be unlocked (rule 9 of §15, already enforced by the service and by the triggers).

| Piece | Design |
|---|---|
| **Payslips** | Immutable `payslips`, one per PAYABLE person of the run (`payslip.content` is the whole slip: name as of the period end via `namesOn`, placement as of the period end, DOJ, paid days and LOP days, every earning and deduction line, employer contributions shown as information, net pay, net pay in words, masked bank account (last four) and masked PAN and UAN; no year-to-date until Phase 7). Content hash stored; the publish approval's hash now covers every payslip's content hash (a payslip's content is derived from the final run's items, so it cannot differ between approval and act, but the hash proves it). HELD people (no account, negative net held, leaver held for settlement, zero net) get **no payslip** and are listed in the publish preview with the reason. |
| **Delivery** | `payslip_deliveries` (one row per payslip, mutable bookkeeping, never content): PDF key and SHA-256 once rendered, in-app notice time, email status (the same SENT / FILE_ONLY / FAILED words as invitations) and error. The job `payroll-payslips` handles one payslip at a time, in a batch per job, **idempotent per payslip**: render the PDF (the existing Chromium renderer, embedded font, no network), store through `StorageService`, notify the employee in the bell and by email (**no figure in the email**, only "your payslip for October is ready" and a link built from `WEB_BASE_URL`), pace the emails. A failure is recorded against the payslip and retried by **Prepare again** on the run page; it is never reported as sent. The employee sees the payslip on screen the moment the publish commits; the PDF says "being prepared" until its file exists. |
| **Who sees a payslip** | An employee: only their own, SELF scope, a stranger's id answers 404 on every route including the PDF. `payroll.payslip.view`: any. HR Executive and managers: none. Net in words uses the Indian convention (lakh, crore), implemented on exact decimal strings in `shared/utils`, tested on awkward values. |
| **Draft preview** | A payslip preview for a person in a draft run, on screen and as a PDF that carries the TEST watermark, never stored; needs `payroll.salary.view`. A published payslip is never watermarked (it cannot exist on Placeholder rules). |
| **Bank file layout** | `BANK_TEMPLATE` is a governed item on the same road as components (preview, save as the next version, a different person confirms). **It ships empty and nothing about a real bank's layout is guessed.** The engine supports what a specification can say: delimited (any delimiter), fixed width (widths, padding and alignment per column), or an Excel workbook; header and trailer rows; per column a source field (employee code, name, account number, IFSC, bank name, amount, narration, payment date, serial, debit account, row count, total) or a constant or a pattern with `{field}` tokens; date and amount formats; line ending. A save is validated (unknown fields, missing widths, nothing to write are refused). The company's debit account is entered once with the layout, stored **encrypted** in that version (last four shown); a blind-index hash lets an unchanged account be recognised so re-saving the same layout is "no change". |
| **Bank file** | Approval `BANK_FILE`, then the act `generateBankFile`: rows are the PAYABLE people with the account **in force on the payment date** (`bankAccountsOn`); the payment date comes from the rule `PAYMENT_DATE_RULE` (Not set blocks the request, in words). Anyone payable without an account on that date is **excluded explicitly with the reason and listed in the preview and on the batch**, never silently; they are paid by a later off-cycle run once fixed. The approval hash covers the rows (employee, account blind-index hash, IFSC, amount), the template version and hash and the payment date, so a bank account change after approval voids the approval. Account numbers are decrypted only inside generation, with one audit row per person revealed written in one batch insert. The file is stored through `StorageService`, SHA-256 recorded, the batch and its rows locked (append-only rows; the batch can only move GENERATED to PAID and attach the bank's response). **The app never talks to a bank:** no state means "sent". |
| **After the file** | `GET` the batch (masked), **download** (a short-lived signed URL, every download audited, `payroll.bank.view`), **mark paid** with the bank's reference and the date (a typed confirmation; recorded and audited), **attach the bank's response file** (stored with its SHA-256, not parsed: format unknown). |
| **Statutory outputs** | `OUTPUT_TEMPLATE` governed items for `PF_ECR`, `ESI`, `PT` and `LWF`, built on the same engine with sources specific to each (UAN, member name, wages, contributions, days; ESI number; the state and amount). **Each ships empty, and an output cannot be generated until its layout is Confirmed**; the government portals' layouts are exactly what I will not guess, and I cannot test a file against a portal from here (§17). The **salary register** is our own report (a workbook of every person's lines, the totals and the held list), available from any final run, no template. Generation needs `payroll.run`; every output records who, when, the run hash, the template version and the file's SHA-256; downloads need `reports.salary.view`. |
| **Permissions and scope** | No new permission keys. Publish and bank-file acts: `payroll.run` (maker set) and never the person who decided. Payslip HR views: `payroll.payslip.view`. Bank batches: `payroll.bank.view`. Templates: `payroll.rules.manage` to save, `payroll.rules.confirm` to confirm (as rules). Payroll scope is ALL only. |

**Rules I decided myself in P6-5** (continuing the numbering; veto any):

65. **Payslips only for PAYABLE people.** A held person gets none until they are paid (off-cycle or the next run); the publish preview lists them with the reason.
66. **A payslip is visible to its employee the moment the publish commits;** its PDF follows from the worker and the screen says "being prepared" until then.
67. **A payslip is immutable and published once per run.** A correction is an adjustment in the next run or an off-cycle run, never a re-issue.
68. **Payslip emails carry no figure, are paced, and a failed one is recorded and retried, never counted as sent.**
69. **The bank account is the one in force on the payment date; payment date comes only from its rule.** No account on that date means excluded with the reason, listed, never silent. The rule not being set blocks the request.
70. **No bank layout is shipped.** The template engine is built; the layout waits for your bank's specification or a sample file. The same for the four statutory outputs. A layout I enter to test is a stand-in in my local database only (LOCAL_ASSUMPTIONS 28).
71. **The company debit account is stored encrypted in the template version;** only its last four digits are shown and audited.
72. **The act is carried out by someone other than the person who decided** (as finalising), and a release row is written in the same transaction as the payslips or the batch.
73. **Bank file downloads are audited one by one;** the file holds full account numbers, so the download needs `payroll.bank.view`, which HR Executive does not have.
74. **Marking a batch paid needs a typed bank reference and states a fact; it moves nothing,** and it is recorded as that person's statement.
75. **The bank's response file is stored and never parsed** until its format is known.
76. **The salary register is our own format and needs no template;** the four statutory files need a Confirmed layout.
77. **Only `run/release.ts` creates payslips, bank batches and release rows** (a source scan, like the finaliser's).
78. **Draft payslip previews are watermarked and never stored.**

**Also in this commit: the live proof of the payroll lock** you asked for. On a scratch database with a real run finalised through the real road: a job change dated inside the finalised month, made with a **Super Admin's token**, is refused with `PAYROLL_LOCKED`; after the unlock (before anything is released) the same change is accepted; and after payslips are published the unlock itself is refused. The exact requests and responses go into §14I.

**How it is proved (the plan for tests).** Net in words (property and awkward values); payslip content equals the run's lines to the paisa; a held person has none; employee A cannot read employee B's payslip, list, content or PDF (404); HR Executive and manager get 403; publish refused by a non-maker, by the checker as executor, with a stale approval, twice; the release row exists in the same commit and the unlock is refused afterwards (service and trigger); worker idempotence (run it twice, one file, one notice, one email) and a mail failure recorded as FAILED; the bank engine against hand-worked expected files for each format (delimited, fixed width, XLSX) including header and trailer, padding, amount formats; no layout means refused in words; a layout with an unknown field refused; the debit account never appears in a response, an audit row or a log; bank rows use the account in force on the payment date (changed on the 10th for a 25th payment); a person with no account is excluded and listed; a bank account change after approval voids the approval; account decryption only in generation (source scan) with an audit row per person; download audited; mark paid once; the response file stored, hash recorded; outputs refused until Confirmed; the register equals the run's totals; the source scan for release rows. Frontend tests for the new routes. Mutation checks on each new guard.

---

## 15. Rules I decided myself (veto any)

1. **Governed items cover more than "rules".** Components, structures, bank layouts and output layouts carry Placeholder/Confirmed and pin into runs exactly like rules, because a structure's formula (Basic = 40% of CTC) is a rule in everything but name.
2. **How I read "changing a Confirmed rule: maker-checker, resets to unconfirmed until re-approved".** An edit is allowed at once and takes effect only as an *unconfirmed* new version (usable for draft runs, blocked for real ones); the previous Confirmed version stays on record and in the runs that pinned it; a *different* person must then confirm the new value. The other reading is "the edit waits unapplied until a checker approves it". I chose mine because it lets you test a proposed change on a draft before asking anyone to vouch for it. Tell me if you meant the other.
3. **Shipped placeholder values.** PF and ESI rates and ceilings, and the rounding conventions, are figures I recall; they ship labelled "recalled, unverified" so a test run is realistic. PT, LWF, TDS, the encashment treatment, the bank layout and the company identifiers ship empty or neutral because they are open questions in spec §14 and I will not guess them.
4. **A run pins only what it actually read**, derived from the reads, not from a hand-kept list, so a rule can be neither forgotten nor over-reported.
5. **A salary row freezes its monthly breakup.** Editing a structure never moves anyone's pay; people move by a previewed revision.
6. **Back-dated revisions are paid as arrears in the next run.** The salary timeline keeps the true date; the payroll lock is bypassed only by that one named function; the closed month is never rewritten.
7. **The maker-checker invariants are code, not settings.** Different people, bound to the hash, voided by change, locked once approved.
8. **The checker also cannot be anyone who changed the run's figures since submission** (the spec's wording), and approvals do not expire in this phase.
9. **A payroll period cannot be unlocked once payslips are published or a bank file is generated.** Corrections go through adjustments or an off-cycle run.
10. **Nobody edits their own salary, adjustments or bank account in payroll** (Super Admin included), matching the attendance self-guards. A maker or checker who is on the run sees their own line highlighted in the preview; I did not block it.
11. **Salary amounts are plain exact decimals, protected by permissions, not field-encrypted.** The spec's encryption list is bank account, PAN, Aadhaar and UAN; salary needs SQL totals and ordering. Bank accounts and identifiers stay encrypted; the company's debit account is stored encrypted.
12. **Payslip emails carry no figures,** only a link to sign in.
13. **Negative net blocks the run until resolved; a ₹0 net is held, not paid, and gets no bank row.**
14. **`audit_logs` carries references and redacted salary amounts.** The audit viewer is open to more people than salary data is, so the figures live in the payroll tables and `payroll_run_events` behind payroll permissions and are shown on a Payroll audit trail screen; every change is still audited with before and after (rules in full, since they are not personal data).
15. **One regular run per cycle; off-cycle runs exist** (bonus, correction, and the Phase 7 final settlement), each with its own approvals.
16. **Leavers are paid through their last working day;** final settlement is Phase 7; `LEAVER_PAYMENT_TIMING` decides whether the last month is held for it.
17. **The bank file contains PAYABLE people only; held people are listed with reasons.** The bank's response file is stored and not parsed until you give me its format.
18. **Statutory logic is implemented as options driven by rules** (for example ESI's period rule, PF on arrears), because I can build the mechanics but cannot verify them against law; the Confirmed value is your CA's word, not mine.
19. **Payroll data scope is ALL only.** No TEAM scope exists anywhere in payroll.
20. **The test-run lock** is a Postgres advisory lock keyed by database and Redis database, so a clock-audit run (its own database) can still run beside a normal one.

---

## 16. What I need from you to turn Placeholders into Confirmed

Each is a fact or a document. I build and test against stand-ins in the meantime; none blocks P6-1 to P6-3.

**Open question that blocks a Confirm (added P6-4)**
- **ESI half-year coverage ("sticky" period).** Exactly when does ESI coverage start and stop for someone who crosses the wage ceiling part-way through a contribution period, and how is the ceiling tested at the start of the period or the joining date? The mechanics in the code (rule 43) are the developer's reading. The value `STICKY_HALF_YEAR` of the rule "ESI: coverage period rule" **cannot be marked Confirmed** until this is answered and recorded here and in `docs/PROGRESS.md`; the monthly value is not held up.

**People (needed before P6-4)**
- Who are the **makers** (prepare, submit, request) and who are the **checkers** (approve)? There must be at least two different people with `payroll.approve`/`payroll.run` between them. If the only possible checker is an owner who is not an employee, tell me; the checker must still be a user account.
- Who may **confirm rules** (`payroll.rules.confirm`) and who is the Super Admin who unlocks.

**For each group of rules (your CA, unless stated)**
| Rules | What I need |
|---|---|
| Pay days, LOP divisor, payment date, leaver timing (HR + CA) | Do you pay on calendar days, a fixed 30, or working days? When is salary paid (date and which month)? Are leavers' last-month salaries paid with the run? |
| Rounding | Whole rupees? Where does rounding happen (each line, PF, ESI up, nowhere on net)? |
| PF | Confirm the rates and the ₹15,000 ceiling, whether PF is capped or on actual wage, which employment types are covered, how arrears are treated |
| ESI | Rates, the ₹21,000 ceiling, monthly or the half-year contribution-period rule, which employment types |
| PT and LWF (spec §14) | Which states you operate in, the PT slabs per state and the February exception, LWF amounts and months, and **the list of branches with their state** |
| Encashment (spec §14) | The per-day formula (the spec's default is Basic ÷ 30), its tax treatment, which month it is paid in, whether PF applies |
| Arrears | Paid as a separate line in the next run? PF/ESI on arrears? |
| Salary structures | The component list per grade or band: names, which are taxable, PF-able, ESI-able, which pro-rate, and the split of CTC; **and what your CTC includes** (employer PF, ESI, gratuity, bonus?) |
| Company identifiers | PF establishment code, ESI employer code, PT and LWF registration numbers; the company's PAN and TAN are already on file |
| Bank file (spec §14) | Your bank's own specification or a sample bulk-transfer file; the debit account; whether the bank takes NEFT/IMPS/RTGS and the limits |
| Outputs | A recent PF ECR file you filed (anonymised), the ESI return format you use, and the PT/LWF statements as filed |

**Samples (anonymised; I will not guess a layout, as with the migration)**
- A few months of greytHR payslips and the payroll register, anonymised, for the **parallel run**. Without them P6-6's comparison tool cannot be built, though everything else can.
- A handful of real-shaped employees with the net pay greytHR gave (and the inputs), to become golden tests.
- The date of the first parallel-run month, and the YTD figures cut-off (Phase 7 needs it).

**Decisions**
- Whether my reading of the Confirmed-rule change (§15 item 2) is what you meant.
- Whether **salary revisions should also need a checker.** The spec's list does not include them and yours does not, but they are money. It is one more subject in the same core. I recommend yes.
- Whether the shipped recalled PF/ESI figures (§15 item 3) are acceptable as placeholders, or you would rather every statutory figure ship empty.

---

## 17. What stays unproven locally, and the local-environment list

- **Statutory correctness.** Until your CA confirms the rules, the arithmetic is verified against my own independent calculation, not against law.
- **Government and bank formats** (ECR, ESI, bank file) are unproven until you give me the real specifications and, for ECR, until a file is accepted by the portal.
- **A full-headcount payslip render on the real task size** and the worker's behaviour when ECS stops it mid-run are checked here in principle (resumable, idempotent) but measured only in the final stage.
- **SES pacing for payslip emails** and **S3 storage of payslips and bank files** run against the local drivers.
- Every item of this kind goes into `docs/plans/LOCAL_ASSUMPTIONS.md` in the commit that introduces it. Already added in advance: payslip PDFs and bank files through `StorageService` (#3), paced payslip email (#4), PDF memory and time at headcount (#5), idempotent resumable payroll jobs (#6), no `new Date()` for a business date (#7), the app role's privileges on the new tables (#8), links built only from `WEB_BASE_URL` (#9).

**Risks I will watch:** a changed input that the run hash does not cover (guarded by a test that mutates every input class); statutory placeholders mistaken for facts (guarded by the watermark and the gates); the rules screen becoming a wall of settings (grouped, searchable, with the "needed for the next run" ones first); and PDF rendering at headcount.

---

## Appendix A — The effective-dating contract (EF4), kept as written

Everything payroll reads that changes over time is effective-dated: the
placement (branch for PT/LWF state, cost centre, grade, department), the
name on the payslip, the bank account for the transfer file, and the device
mapping behind attendance (paid days, LOP).

The model is in `backend/src/lib/effectiveDating.ts` and
`docs/plans/EFFECTIVE_DATES.md`:
- a row covers its start date up to but not including its end;
- history is only ever appended at the end;
- the database forbids overlaps and rows that run backwards.

**Payroll (and attendance) use only these readers, always with an explicit
day:**

| Question | Reader |
|---|---|
| Where was this person placed on day D? | `placementOn(employeeId, day)` |
| Every placement across a pay period, split on change days (a transfer on the 16th gives two segments) | `placementSegments(employeeId, from, to)` |
| Everyone's placement on one day (reports, bulk) | `placementsOn(employeeIds, day)` |
| The name on a payslip or letter dated D | `nameOn(employeeId, day)` |
| The account a payment dated D goes to | `bankAccountOn(employeeId, paymentDate)` |
| Whose punch is this (device ID on day D)? | `employeeForDeviceUserOn(deviceUserId, day)` |
| Was this person employed on D? | `employedOn(day)`, a Prisma `where` on Employee built from `dateOfJoining` / `lastWorkingDate`, never `status` |

**Rules:**
- **Never query a history table directly from payroll or attendance.**
  `backend/src/lib/__tests__/currentRowGuard.test.ts` fails on any
  `employeeJobHistory` / `employeeNameHistory` / `employeeBankAccount` /
  `deviceUserMapping` access in `modules/payroll`, `modules/attendance` or
  `modules/biometric`.
- **Never use "today" inside a pay run.** Every reader takes the day.
  `businessToday()` (IST) is only for deciding what "now" is.
- **A leaver is in force on their last working day** (history ends the
  day after). The last month is paid through `lastWorkingDate`.
- **The payroll lock.** When a pay period is finalised, Phase 6 registers
  `setPayrollLockCheck(day => …)`. From then on, every history change,
  cancellation and separation dated inside a locked period is refused
  (`PAYROLL_LOCKED`). The hook is already called by every writer and
  tested (`payrollContract.test.ts`). Until Phase 6 registers a check,
  nothing is locked.
- **Salary itself will be effective-dated the same way**: salary
  revisions, arrears and structure changes. It goes through the same
  writer rules (append-only, constraints, no overlaps), not a copy of the
  old job-history pattern.
- **Money stays `Decimal` until it's rendered** (Phase 5 review §5.3):
  no JavaScript numbers for rupees, and maker-checker hashes are computed
  over canonical decimal strings.

**Pinned by tests** (`backend/src/lib/__tests__/payrollContract.test.ts`):
- a transfer on the 16th gives two segments split on the day;
- a leaver is placed and employed on their last working day and not the
  day after;
- a bank change dated the 10th sends a payment dated the 25th to the new
  account, and the 9th to the old one;
- a name change takes effect on its own date;
- a reused device ID gives a punch on the leaver's last day to the
  leaver, and after it to the new holder;
- the lock refuses changes and leavings dated inside a finalised period.
