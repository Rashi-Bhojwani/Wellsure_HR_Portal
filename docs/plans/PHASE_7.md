# Phase 7 — Tax and benefits: plan

> **Amendment, 2026-10-30 (owners' decision): there is no CA.** Wherever this document says CA, accountant or "CA confirmation", read: the owners enter and verify every statutory and tax figure themselves. Each carries a required source note (where the number came from) and an effective-from date, and a different director confirms it against that note. Nothing statutory is filled in by the system. See `CHECKPOINT_1_FOLLOWUP.md` §9.


**Status: APPROVED 2026-10-22 with the answers in §0A, which override anything below that differs. P7-0 is being built.** One commit at a
time, pausing after each.

## 0A. Your answers (2026-10-22), and what they changed

1. **Tax rules are per financial year**; copying a year forward creates Placeholders.
2. **Tax slabs and limits ship empty (Not set).** No recalled figures across a change of Act. The demo company supplies made-up figures.
3. **Tax rules reuse the payroll rules permissions** (`payroll.rules.manage` / `payroll.rules.confirm`); no `tax.rules.*` keys.
4. **Default regime is the new regime** when none is chosen; changing regime is allowed until the proof-of-investment window closes.
5. **After the proof cut-off only verified amounts count.** One verifier, no second checker per proof. **The verifier and the declaring employee
   are always different people, HR included**, and every verification is audited **with the amount verified**.
6. **One-offs are taxed in the month paid**, as a rule that ships **Not set** until the CA confirms.
7. **Form 16:** we generate Part B; HR uploads Part A; nothing calls the tax portal. **Every Form 16 output is labelled DRAFT until the CA has
   confirmed Part B's content** (a Confirmed rule `FORM16_PARTB_CONTENT_CONFIRMED` the CA's sign-off sets), and nothing describes it as
   filing-ready.
8. **Quarterly return:** our own workbook; the government format is an empty layout.
9. **Loan disbursement** only through the next run or an off-cycle run, never "paid outside".
10. **Reimbursements: the manager-grantable list is NOT widened.** Payroll alone approves claims (`reimbursement.process`), one step, never the
    claimant. Recorded in PROGRESS as a post-go-live item to revisit if the workload demands it. §9's two-step flow and `reimbursement.approve`
    are dropped.
11. **Separation gains resignation date, notice required and notice served.** The recovery formula stays Not set.
12. **Leavers read their F&F statement and Form 16 for N days after payment, default 90** (a setting).
13. **Mid-year opening figures:** the dataset shape now; the greytHR mapping waits for the sample.
14. **Revision letters and offer-letter figures are in;** flexible benefits are out.
15. **My self-decided rules (§16) are accepted**, including HR reopening a declaration but never editing it, and no TDS refund through payroll.

**From the docs review, built in P7-0:**
- Company PAN and TAN move into the sealed, encrypted store and the plaintext `company.pan` / `company.tan` columns are dropped.
- `FIRST_REAL_PAYROLL_RUN.md` stops promising off-cycle runs until P7-6 and says so in the procedure.
- The weekly clock audit creates its own environment in CI and is called fixed only after **one real passing run**.
- The docs show the real order of remaining work: Phase 7, the UI pass, Phase 8, the device rehearsal, then AWS (Phase 1.5).
- ESI numbers are encrypted like UANs (Phase 6 review decision 91, answered yes).

Scope (user, 2026-10-22): investment declarations and proof of investment, TDS under both tax regimes, Form 16 data, loans and advances,
reimbursements, full and final settlement. Spec §12 also lists the IT statement, YTD and salary revision letters; they are included because the
employee menu already promises them (IT Statement, YTD Reports, Salary Revision). Spec refs: §6 (Salary menu), §7.5, §9, §11, §12 Phase 7, §14.

How to read it: §1 the principles carried from Phase 6 and where each is enforced; §2 what exists that Phase 7 stands on; §3–§10 the design, one
area each; §11 permissions and the sensitive-data registry; §12 tables; §13 the commit split; §14 the decisions I need from you; §15 what needs the
CA; §16 the rules I would decide myself; §17 what stays unproven locally.

---

## 1. The Phase 6 principles, and where each is enforced in Phase 7

| Principle | Phase 7 mechanism |
|---|---|
| Every rule Placeholder or Confirmed, confirmed by a different person; nothing real from a Placeholder; TEST watermark | Every tax figure (slabs, standard deduction, rebate, surcharge, cess, section caps, HRA rules, perquisite rates, gratuity, notice recovery…) is a governed RULE read through `RuleContext` and pinned by the run or computation that read it. A TDS figure, an IT statement, a Form 16 Part B or an F&F settlement worked out from any Placeholder is TEST and cannot be approved, published or paid. |
| Preview, then explicit confirmation; maker-checker on the riskiest, bound to a hash, voided by change | New maker-checker subjects in the existing core (`payroll_approvals`): `LOAN_SANCTION`, `LOAN_SCHEDULE_CHANGE`, `FNF_SETTLEMENT`, `FORM16_PUBLISH`, `TAX_OPENING` (mid-year YTD and previous-employer figures). Everything else risky is preview + fingerprint + confirm, as in Phase 6. |
| Exact decimals; history only through the effective-dating readers | The tax engine is pure and exact (the Phase 6 `money.ts`), checked against an independent rational-arithmetic model as P6-3 was. Salary through `salaryOn`/`salarySegments`; YTD only from FINALISED runs through a new reader; bank through `bankAccountsOn`. The guard scans (`payrollGuards`, `currentRowGuard`) extend to the new modules. |
| Owners' secrets: entered by owners, visible only with the permission, absent from logs, errors, exports | Declarations and proofs are a new sensitive class. Landlord and lender PANs are encrypted like employee PANs. The challan details and TAN stay sealed. The Developer ceiling covers every new key automatically (registry test). The sentinel crawl (`releases.test.ts`, `check:sensitive-ui`) is extended to every new route and page. |
| Nothing moves money; nobody changes their own pay or declarations beyond what they are entitled to | Loans, reimbursements and settlements are paid only through a payroll run's bank file. An employee edits only their own declaration, and only while its window is open; they can never verify their own proof, approve their own claim or loan, or prepare their own settlement. HR cannot edit an employee's declaration (they can reopen it to the employee, audited). |
| Built and tested on the demo company | The demo company gains made-up tax rules, declarations, proofs, loans, claims and one leaver, so every screen runs end to end with no real figure. |

---

## 2. What Phase 7 stands on

- **Payroll run road** (P6-3 to P6-5): calculation job, lines with `basis`, pins, approvals, finalise, lock, payslips, bank file, release rows.
- **Seams waiting for Phase 7:** the run notice "Income tax (TDS), loan recoveries and reimbursements are not calculated until Phase 7";
  rule `TDS_MODE` (only `NONE`); rule `ENCASH_TAXABLE`; sealed `TAN`; component flag `taxable`; `LEAVER_PAYMENT_TIMING = HOLD_FOR_FNF`; the
  Request Hub `REQUEST_HUB_SOURCES` and Tasks inbox sources; `prepareDocumentUpload` for proofs and bills; letters with typed fields.
- **Not there, and needed:** a run **kind** (`payroll_runs` has none; rule 15 of PHASE_6 says off-cycle runs exist, they do not); a financial year
  concept (payroll is per attendance cycle; tax is per April–March year); employee date of birth is on record (age bands for the old regime).

---

## 3. Tax foundations (P7-1)

**The financial year.** `FY 2026-27` = 1 Apr 2026 to 31 Mar 2027. A payroll run belongs to the FY of the month it pays (the cycle's end date,
P6 rule 39). `financialYearOf(day)` lives in `shared/` and is the only way any code decides an FY.

**Tax rules are per financial year.** Phase 6 rules have one current value. Tax rules change every Budget, and a March run and an April run must use
different slabs, so tax rules are governed items keyed **by FY** (`TAX_SLABS_NEW` for `2026-27`, a separate item for `2027-28`). Copying a year's
rules to the next is one action that creates Placeholders (the copy is not a confirmation). A run pins the FY's versions it read.

**The tax rule catalogue** (all admin-editable; each `whoConfirms: CA`; what ships is decision D2):

| Group | Rules |
|---|---|
| Slabs | per regime: slab table; standard deduction; rebate (threshold, maximum, marginal relief on/off); surcharge table with marginal relief; cess rate; old-regime age bands (from date of birth) |
| Defaults | default regime when an employee has not chosen; rounding of the annual tax and of the monthly TDS; minimum monthly TDS (0); no-PAN rate |
| Exemptions (old regime) | HRA: metro cities list and the percentages; LTA; professional tax as a deduction; standard deduction |
| Deduction sections | a **section catalogue**, admin-editable: code, label shown to employees, which regime it applies to, cap (one or a shared group cap, e.g. one cap across 80C/80CCC/80CCD(1)), proof required, whether a third-party PAN is required. Employer NPS (both regimes) is a component flag, not a declaration |
| Spreading | how one-offs (arrears, bonus, encashment) are taxed: in the month paid or spread over the remaining months |
| Perquisites | interest-free/concessional loan perquisite rate and the small-loan exemption limit (§8) |

**Labels are data, not code.** The Income-tax Act, 2025 replaces the 1961 Act from 1 April 2026, as I understand it (unverified: CA). Section
numbers and form names change (my recollection of the new numbers is not reliable), so **no section number or form name is hardcoded**: every
section, form and certificate name is an editable label in the catalogue, shipped with a neutral working name and marked for the CA.

**The tax engine** (`modules/payroll/tax/engine.ts`, pure, no I/O): input = a person's FY income lines (actual YTD + projected), exemptions,
declarations or verified proofs, regime, age, PAN present; output = taxable income per head, tax before rebate, rebate, surcharge, cess, annual
tax, every step with its `basis`. Exact decimals. Proved by hand-worked cases and a 300-case comparison with an independent rational model,
as P6-3.

**Year to date.** A new reader `ytdFor(employeeId, fy, uptoCycle)` sums lines of **FINALISED** runs only (regular and off-cycle) plus the
person's **opening figures** (below). Draft runs never count.

**Opening figures** (`tax_openings`): for a mid-year go-live, each person's YTD gross by head and TDS deducted before the first run here
(from greytHR), and for a mid-year joiner the previous employer's salary and TDS (the declaration the employee gives). A **TAX_OPENING** approval
(maker-checker) binds the figures; an Import Center dataset shape is built, the greytHR file mapping waits for the sample (as in Phase 1.5).

---

## 4. Declarations (P7-2)

- **Window.** HR opens a declaration window per FY (from / to dates; Placeholder dates are fine, windows are not money). Outside it the
  employee reads but cannot edit. HR can **reopen** one person's declaration with a reason (audited, employee notified); HR never edits it.
- **The employee** (Salary → IT Declaration): chooses the regime (with a side-by-side "tax under each regime" from the engine on their own
  figures), declares amounts by section from the catalogue, rent per month (with periods, city, landlord name and landlord PAN when the
  annual rent passes the rule's threshold), home-loan interest (lender name and PAN), and, if they joined this FY, previous employment income
  and TDS. Saving makes a new version (append-only); the latest submitted version counts. Submit is explicit (preview: "your monthly TDS becomes
  ₹X from November").
- **Regime choice** is per FY; changing it after the first TDS-bearing run of the FY is allowed or refused by rule (D4).
- **What HR sees:** a list per FY: who has declared, regime, totals per section; drill-in needs `tax.declarations.view`. Landlord and lender
  PANs are encrypted, last-4 shown, Reveal audited.
- **Home Declaration and POI cards** (Employee Home, already placeholders) show the window state.

## 5. Proof of investment (P7-2)

- **Window** opened by HR per FY (typically January–February).
- **The employee** (Salary → Proof Of Investment) attaches proofs per declared line (`prepareDocumentUpload`: type, size, magic bytes, image
  re-encode). Proof documents are filed under a new document category of sensitivity **TAX**.
- **Verification** (`tax.proofs.verify`): a queue per FY; per line: accept (amount, may be lower than claimed), reject with a reason, ask for more.
  Nobody verifies their own. Each decision audited; the employee is notified and sees the reason.
- **Effect on TDS** (rule, D5): before the POI cut-off the projection uses declared amounts; after it, **verified amounts only**; an unverified line
  counts as nothing. The variance report tags "declaration changed" and "proofs verified".

## 6. TDS in payroll, IT statement, YTD (P7-3)

- `TDS_MODE` gains `PROJECTED`. In a run, each person's TDS line = (annual tax projected now − TDS already deducted this FY − TDS in the
  opening) ÷ remaining pay months in the FY, rounded by rule, floored at the rule's minimum (never a refund through payroll). Projection = YTD
  actual + this month + future months at `salaryOn(today's structure)` + declared one-offs; one-offs taxed per the spreading rule.
- The TDS line carries the whole computation in `basis` ("Why?" drawer). Pins include the FY's tax rules and the declaration version used, so a
  changed declaration voids an approval like any input (it is in the item hash).
- **IT Statement** (employee, and HR view): the FY projection month by month, both regimes, exemptions and deductions applied, TDS so far and to
  come. **YTD Reports** (employee): component by component, from finalised runs. **Payslips** gain a YTD column **from the first payslip
  published after this commit**; published payslips are immutable and stay as they were (stated on screen).
- **Salary Revision** (employee): their own applied revisions (dates, old and new CTC, breakup). Their own pay is theirs to see.
- **Revision letters** (spec §12): the letters catalogue gains `revision.*` placeholders (effective date, old/new CTC, breakup) filled from the
  applied revision, never typed; and the offer letter draws CTC and breakup from `salaryOn(joining date)` (spec §12 Phase 6, deferred in P6-2 to
  P6-6 and **not built**; carried here). Pay category, HR-only, as letters already are.

## 7. Form 16 data and quarterly return data (P7-7)

- **Challan register** (`tds_challans`): the company deposits TDS itself; the owners (or the payroll preparer) record each deposit: month,
  BSR code, challan serial, date, amount (sealed like the identifiers; checker confirms by retyping). Nothing talks to a bank or the tax portal.
- **Quarterly return data:** per quarter, deductee-wise rows (PAN, amount paid, TDS, date, challan) as our own workbook; a governed
  `OUTPUT_TEMPLATE` for the government utility's input format, **empty until the format is confirmed** (as PF ECR was), so the button is disabled.
- **Form 16:** after the FY closes (all March runs final): **Part B** (the salary computation) generated per employee from finalised runs,
  openings and verified proofs, as a PDF in our own layout, watermarked TEST while any rule is a Placeholder; published by **FORM16_PUBLISH**
  (maker-checker), filed under the employee's documents (the Document Center "Form 16" tab placeholder). **Part A** is issued by the tax
  department's portal; we do not generate it (D8): HR uploads each Part A PDF and it is paired with Part B.

## 8. Loans and advances (P7-4)

- **Loan types** (admin-editable): name, maximum amount, maximum EMIs, interest rate (0 by default), whether employees may request one.
- **Request** (employee, Salary → Loans and Advances) or **HR creates** one. **Sanction** is maker-checker (`LOAN_SANCTION`) bound to principal,
  EMI schedule and start cycle; the employee cannot be the maker or checker of their own.
- **The loan ledger** (`loan_ledger`, append-only, like the leave ledger): DISBURSED, EMI_RECOVERED, PREPAID, WAIVED, ADJUSTED; balance = sum.
  Nothing is a mutable balance.
- **Disbursement** (D9): through the next payroll run as an earning line, or through an off-cycle run with its own bank file. Never "paid
  outside" without a run, so the bank file remains the only money path.
- **Recovery:** each regular run reads the schedule through a provider seam and adds a deduction line (`LOAN_EMI`, sourceRef = schedule row).
  Finalising writes EMI_RECOVERED. If net pay cannot cover the EMI the rule decides (skip and extend, or partial); never a negative net.
- **Changes** (defer, reschedule, waive) are previewed and maker-checker (`LOAN_SCHEDULE_CHANGE`). Prepayment is recorded with a reference.
- **Perquisite** on an interest-free/concessional loan is computed by rule and added to taxable income (CA rule; Placeholder).
- **Statement** (employee: own; HR: `payroll.loans.view`), the "Loan Statement" Quick Access link on Home.

## 9. Reimbursements (P7-5)

- **Claim types** (admin-editable): name, monthly/annual cap, bills required, taxable or not, which component the payment lands in.
- **Employee** (Salary → Reimbursement): a claim with lines, dates, amounts and bills (uploads). Draft, submit, withdraw.
- **Approval: payroll alone** (`reimbursement.process`; decision 10): approve, reject with a reason, or approve a lower amount. Never the
  claimant. The manager-grantable list is not widened; a manager step is a post-go-live question.
- **Payment:** an approved claim becomes a pending line of the next regular run (`REIMBURSEMENT`, sourceRef = claim), consumed once at finalise,
  taxable or not by its type. A **reimbursement statement** per run (UI_REFERENCE §1.3's "Reimb. Payslip" tab) lists what was paid.
- Request Hub and Tasks inbox gain the source; the claim is visible live to the claimant and the approvers.

## 10. Off-cycle runs and full and final settlement (P7-6)

**Off-cycle runs.** `payroll_runs.kind` = `REGULAR | OFF_CYCLE`, an off-cycle run names its people and a payment date. It uses the same road
(calculate, preview, submit, approve, finalise, publish, bank file) and approvals; it **does not lock the attendance cycle** and does not
count as the cycle's regular run. A partial unique index keeps one non-void regular run per cycle as now.

**Releasing held pay** (found in P7-0): today nothing carries a HELD person's pay into a later run; the preparer adds it by hand as an
adjustment. P7-6 adds "pay what this run held": an off-cycle run that takes a HELD item of a final run as its input, consumed exactly once
(sourceRef = the item), for whoever's cause has been fixed.

**Full and final settlement** (`fnf_settlements`), per completed or scheduled separation:
- **Inputs, each with its source:** the held last-month item (P6 `HOLD_FOR_FNF`), consumed exactly once; days up to the last working day not yet
  paid (from finalised attendance); leave encashment of the balance at exit (ledger, rule formula; writes an ENCASHMENT ledger entry with
  reference to the settlement, days only, as now); notice-period pay or recovery (rule + separation data, D11); gratuity (rule; eligibility on
  years of service); outstanding loan balance (recovered, ledger RECOVERED_AT_EXIT); approved unpaid reimbursements; pending adjustments; final
  TDS for the FY.
- **Preview** shows every line with its basis; HR can add manual lines with a reason; **FNF_SETTLEMENT** maker-checker bound to the figures;
  the settlement then becomes an off-cycle run for that one person and follows the normal road to a payslip-like **F&F statement** and the bank
  file. A negative settlement (recovery exceeds dues) is never paid and is listed for HR to recover outside payroll.
- Separation screen shows F&F state; the leaver's account stays active for reading their statement until a rule-set number of days after
  payment (D12).

---

## 11. Permissions and the sensitive-data registry

New keys (none manager-grantable; tax rules reuse `payroll.rules.*`):
`tax.windows.manage`, `tax.declarations.view`, `tax.proofs.verify`, `payroll.loans.view`, `payroll.loans.manage`, `reimbursement.process`,
`payroll.fnf.prepare`, `payroll.tax.challans.manage` / `.confirm`. Checkers use `payroll.approve`.
New sensitive class **"Tax declarations and proofs"**; loans, reimbursements and F&F join "Salaries and payroll figures". The registry test, the
developer ceiling, `SENSITIVE_DATA.md` (generated) and the route inventory cover all of them.

## 12. Tables (one migration per commit that needs it; cleanup classification, route inventory, triggers as usual)

`tax_rules` are governed items (no new table); `tax_sections` (catalogue, governed); `tax_openings`; `tax_declaration_windows`;
`tax_declarations` + `tax_declaration_lines` (versioned, append-only); `tax_proofs` + `tax_proof_decisions` (append-only);
`loan_types`, `loans`, `loan_schedule_rows`, `loan_ledger` (append-only); `reimbursement_types`, `reimbursement_claims`,
`reimbursement_claim_lines`, `reimbursement_decisions` (append-only); `payroll_runs.kind` + off-cycle people; `fnf_settlements` + lines;
`tds_challans` (sealed fields); `form16_documents`. Run line sources gain `TDS`, `LOAN_EMI`, `LOAN_DISBURSAL`, `REIMBURSEMENT`, `FNF`.

## 13. The commit split (each green, verified, pushed, CI read, pause)

| Commit | Contents |
|---|---|
| **P7-0 (small, before anything)** | The weekly Clock audit builds its own environment and has one real passing run; ESI numbers encrypted; company PAN/TAN sealed and the plaintext columns dropped; FIRST_REAL_PAYROLL_RUN.md stops promising off-cycle runs; the real order of remaining work in the docs; stale status rows, menu markers and comments; PROGRESS open questions closed with the answers |
| **P7-1 Tax foundations** | FY model, FY-scoped tax rules and the section catalogue, the tax engine + independent model, YTD reader, opening figures with TAX_OPENING maker-checker and the import shape, permissions/registry, demo company tax rules |
| **P7-2 Declarations and POI** | windows, regime choice with comparison, declarations, proofs and verification, employee screens (IT Declaration, Proof Of Investment, Home cards), HR queues |
| **P7-3 TDS in the run** | `TDS_MODE=PROJECTED`, the TDS line and its explanation, IT Statement, YTD Reports, payslip YTD, Salary Revision page, revision letters and offer-letter figures |
| **P7-4 Loans and advances** | types, request, sanction, ledger, schedule, disbursement, EMI recovery, perquisite, statements |
| **P7-5 Reimbursements** | types, claims with bills, payroll approval (one step), payment through the run, reimbursement statement, Request Hub/Tasks |
| **P7-6 Off-cycle runs and F&F** | run kind, off-cycle road, settlement computation, maker-checker, F&F statement, separation integration |
| **P7-7 Form 16 and close-out** | challan register, quarterly return data and layout, Form 16 Part B + Part A pairing, publish; Phase 7 review, first-real-year-end procedure, sensitive scans re-run, LOCAL_ASSUMPTIONS review, 500-person measurement of TDS |

## 14. Decisions

Answered; see §0A.

## 15. What needs the CA (also in PROGRESS "Open questions")

Tax slabs, standard deduction, rebate and marginal relief, surcharge and cess for FY 2026-27 under the new Act; section names and caps (HRA metro
list and percentages included); the no-PAN rate; TDS rounding; taxing one-offs; previous-employer income; leave encashment's tax treatment;
the loan perquisite rate and small-loan limit; gratuity (formula, eligibility, cap); notice-period recovery; F&F tax at exit; whether CONSULTANT
employment falls under salary TDS; the quarterly return format; the content of Form 16 Part B; and (from Phase 6) the ESI half-year rule.

## 16. Rules decided by me (accepted 2026-10-22), numbered after Phase 6's

98. An employee edits only their own declaration, and only while its window is open.
99. HR reopens a declaration (with a reason, audited, employee notified) but never edits it.
100. Landlord and lender PANs are encrypted like employee PANs (last four shown, Reveal audited).
101. TDS is never refunded through payroll (the monthly TDS is floored at the rule's minimum).
102. Published payslips stay without a YTD column; only payslips published after P7-3 carry one.
103. A loan EMI never makes net pay negative.
104. Off-cycle runs do not lock the attendance cycle.
105. A negative F&F settlement is never paid; it is listed for HR to recover.
106. Draft runs never count towards YTD.
107. Section, form and certificate names are editable labels, never code.

## 17. Unproven locally

Tax correctness against law (the CA's figures); the government utility's acceptance of a quarterly return file; that the tax portal's Part A
pairs with our Part B; real proof documents (scans, phone photos) at volume; payslip/F&F PDFs at the real task size (LA rows to be added).
