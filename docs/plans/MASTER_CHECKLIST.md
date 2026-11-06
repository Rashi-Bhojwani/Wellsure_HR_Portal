# Master build checklist (Stages 0–8 + close-out)

## REMAINING WORK (written 2026-11-06 by the session continuing Session A, before any further code)

Read first. Status: DONE / OPEN / PARTIAL / **UNDEFINED** (no plan file on any branch defines it: it is not guessed, see note).
"Deps" = what must exist first. Order of work = the owner's message of 2026-11-06.

| Item | What it is | Status | Deps |
|---|---|---|---|
| Step 0.2 checks | DEMO bank rehearsal, sensitive-ui split + planted leak, D-31, D-34, owner review sheet, CI per job, 390 dark walkthrough | DONE as "Closing the Stage 5b gaps A1–A8" below (`1647597`…`d883a13` and the A1–A8 commits); re-verified in this session, see the Step 0.2 note | — |
| A-10 G1 | status catalogue, override allowed statuses, muster totals | DONE `bbd14e6` | — |
| A-10 G2 | roster month grid + export | DONE `f0c32c5` (6 tests, override mutant caught; not verified: a TEAM-scope viewer, browser walk pending at A-10 end) | G1 |
| A-10 G3 | attendance activity locks (directors) | DONE `ad5ece4` (4 mutants caught; the six writers wired, only leave apply exercised over a route) | G1 |
| A-10 G4 | weekend overrides, location-limited holidays, leave type reviewers | DONE `540fb58` (4 mutants caught; leave day counting does not read weekend overrides) | engine `compute.ts` |
| A-10 G5 | swipe reject/reinstate, shift column, bulk; agent sync requests | OPEN | — |
| A-10 G6 | leavers list, leave recalculated to the leaving date | OPEN | — |
| A-10 G7 | workflow Review / Monitor, bulk decisions, `displayLeaveForViewer` | OPEN | — |
| A-1 | **UNDEFINED** in every plan file and on every branch | not started | owners to define |
| A-2 | HR's import rules (named in `GREYTHR_PARITY_EMPLOYEE_ADMIN.md`; no plan text beyond the name) | **UNDEFINED in detail** | owners to define |
| A-3 | opening figures (owner's message: screens + director-entered import of opening balances and tax already deducted this year, nothing preloaded) + letter figures from the structure (`letterFigureFields()` hook) | OPEN | P7-2/P7-3 (built), tax year |
| A-4 | **UNDEFINED** | not started | owners to define |
| A-5 | regularization rules and module (named in `GREYTHR_PARITY_WORKFORCE.md`; no plan text) | **UNDEFINED in detail** | owners to define |
| A-6 | **UNDEFINED** | not started | owners to define |
| A-7 | **UNDEFINED** | not started | owners to define |
| A-8 | **UNDEFINED** (the Stage 5b "A8 bank payments are manual" is DONE; it is not this item) | not started | owners to define |
| P7-2 | declarations with proofs | DONE (Stage 7 report) | — |
| P7-3 | TDS projection, regimes side by side | PARTIAL: TDS in the run + IT Statement done; YTD reports, payslip YTD column, Salary Revision page, revision letters, offer-letter figures open | P7-2 |
| P7-4 | loans and advances (incl. Principal / Interest parts) | OPEN | input heads D-31 |
| P7-5 | reimbursements | OPEN | — |
| P7-6 | off-cycle runs, full and final settlement (incl. held pay) | OPEN | P7-4, P7-5 |
| P7-7 | Form 16 data (DRAFT), quarterly return data | OPEN | P7-3, A-3 |
| Stage 5.6 | loans if missing | = P7-4 | — |
| Stage 6 | internal reports + directors-only query builder "using the layouts in `docs/plans/PARITY_COVERAGE.md`" | **BLOCKED: `PARITY_COVERAGE.md` does not exist on any branch** | owners / a session that wrote it |
| Stage 8 | attendance and salary file readers from `docs/samples`, layout setup, parallel-run kit | **BLOCKED in part: `docs/samples/` is not on this branch** (only on `peeps/foundation`, which this work may not touch) | samples on this branch |
| Stage 9 parity | Tier 1 MISSING items of `PARITY_COVERAGE.md` | **BLOCKED (file missing)** | as Stage 6 |
| Close-out | `PORTAL_READY_REPORT.md`, `GETTING_STARTED.md`, `FIRST_REAL_PAYROLL_RUN.md` | OPEN | everything above |

**Note on the undefined items.** The owner's message says "A-4, then A-7, then A-2, then A-3 …, then A-1, A-5, A-6 and A-8, each exactly as your plan
files define them". Searched: every file under `docs/` on this branch and on every remote branch (`git grep`). Only A-2, A-3 and A-5 are named, and only by name.
Defining them here would be guessing an owner decision, so they are left UNDEFINED and the work carries on with the next defined item.


Branch `feat/hr-payroll-separation`. Tick an item only when it is **done and verified**, with the commit hash. A new
session reads this file and `STAGE_REPORTS.md`, then continues at the first unticked item. No real data in this file.

Standing rules (summary; the full text is the owner's master prompt of 2026-10-29): repo is PUBLIC, no real data anywhere;
no preset values in the real company (everything "Not set" until the two directors set it and a different person confirms
it); directors = the two Super Admins; HR never sees pay data; design rules A6; verification A7 each commit (full backend
suite alone, lint, typecheck, db:drift, frontend tests, sensitive-ui, mutation checks, independent-model money tests);
pause only at CHECKPOINT 1 (after Stage 2), CHECKPOINT 2 (after P7-3) and stop conditions.

## ALREADY EXISTS (verify, do not rebuild)
- [x] UI pass (design system, `frontend/src/ui/`) — `docs/DESIGN_SYSTEM.md`
- [x] Phase 6: engine, registers, payslips, bank/statutory file engines, compare tool, setup checklist — `docs/plans/PHASE_6.md`, `PHASE_6_REVIEW.md`
- [x] P7-0 — `docs/plans/PHASE_7.md`, `docs/PROGRESS.md`
- [~] P7-1 — **was ticked here but is not fully built**: only the part P7-2/P7-3 stand on is (financial year, tax year as a governed item, tax engine, year-to-date reader); opening figures are not. See `docs/plans/STAGE_7_PLAN.md`
- [x] D1 director authority core — `77cc7a7`

## Stage 0 — D1 close-out
- [x] 0.1 latency job: cause found; one stale wait fixed, two watchers still stale (not small) — `f23ff7b`; job stays red
- [x] 0.2 `check:sensitive-ui` its own CI job, scans developer/employee/HR/director — `e3f2980`
- [x] 0.3 same person never maker and checker, all controls, mutation-checked — `7df6020`
- [x] 0.4 third Super Admin note — `723381b`
- [x] 0.5 report: what code does when a director approves a run they prepared (report only) — STAGE_REPORTS.md
- [x] 0.6 `docs/CONTINUITY_AND_RECOVERY.md` — `ca52b9d`
- [x] 0.7 departments are data (report), director-only markers, D-phase list — `ceb2468`

## Stage 1 — HR capability switches
- [x] 1.1 REPORT FIRST (no code): HR attendance/leave permissions and where each is exposed/enforced — STAGE_REPORTS.md (commit below)
- [x] 1.2 capability switches (role + named person, effective-dated, audited, history) — `bdda0c3`, `279d54e`
- [x] 1.3 switching off is immediate everywhere — `3c9bf82`
- [x] 1.4 pending work waits for the directors with a note — `5f60826`
- [x] 1.5 Reports Gallery permission-driven; every report endpoint enforces server-side — `ba554e9`
- [x] 1.6 `check:sensitive-ui` extended + test matrix — `ba554e9`, bundle fix `e3a40c3`

## Stage 2 — D2 (as in DIRECTOR_AUTHORITY.md) → CHECKPOINT 1
- [x] D2 built and verified — `c179e7c`
- [ ] CHECKPOINT 1: report Stages 0–2, wait for go-ahead

## Stage 3 — payroll model (capabilities only, no values)
- [x] 3.0 report + `PAYROLL_MODEL_PLAN.md`
- [x] 3.1 pay heads — `093de72` (options, links), `76b4da2` (table lookup, order, retire-not-delete)
- [x] 3.2 salary rules (all Not set; shipped statutory placeholders removed) — `d875811`
- [x] 3.3 arrears, LOP reversal, hold salary, payslip "Why?" — `5c938f0`, `4ad8958`, `662674f`, `94eebd9`
- [x] 3.4 statutory parameter rule hierarchy — `0c2e346`
- [x] 3.5 property/boundary/mutation tests — this commit
- [x] Stage 3 walkthrough (both directors, HR, employee; phone width and dark theme) — see STAGE_REPORTS.md

## Fix-ups after the Stage 3 review
- [x] 0.1 dump.rdb untracked and ignored · [x] 0.2 .env checked, prisma guard · [x] 0.3 CI read · [x] 0.4 flaky tests · [x] 0.5 owner decisions applied · [x] 0.6 samples read · [x] 0.7 decisions table

## Stage 4 — Monthly inputs
- [x] grid, history, Excel and CSV import (layout read from the Bulk Salary Overrides sample on origin/main; "Override From/Till" read as an inclusive month range, flagged for the owners)
- [x] maker-checker bound to the hash of the figures; any change voids it; the run refuses naming each missing figure
- [x] no money field writable via muster/attendance finalisation, tested (`attendance/__tests__/noMoney.test.ts`)

## Stage 5
- [x] 5.1 payslip delivery (links) · [x] 5.2 not-on-payroll flag · [x] 5.3 remote check-in/out and director decisions (Stage 5a, docs/plans/STAGE_5A_PLAN.md) · [x] 5.4 bank layouts (.xlsx and .csv only; the .xls question stays open) · [x] 5.5 repayment batch · [ ] 5.6 loans (if missing)

## Stage 6 — internal payroll reports (director-only)
- [ ] reports per master prompt; no official-format files

## Stage 7 — Phase 7 P7-2..P7-7
- [x] P7-2 (windows, declarations, proofs, directors' verification, regime comparison, screens) · [x] P7-3 as far as TDS in the run and the IT Statement (the TDS line, its explanation, pins, stale on a changed declaration); **not built from P7-3's list:** YTD Reports, payslip YTD column, Salary Revision page, revision letters, offer-letter figures → **STOPPED AT THE TDS CHECKPOINT (CHECKPOINT 2)** · [ ] P7-4 · [ ] P7-5 · [ ] P7-6 · [ ] P7-7

## Stage 8 — parity tools
- [ ] 8.1 statement parser/compare · [ ] 8.2 payslip layout · [ ] 8.3 statutory layout editor · [ ] 8.4 parallel-run kit

## Close-out
- [ ] `PHASE_7_REVIEW.md`, `PROGRESS.md`, `FIRST_REAL_PAYROLL_RUN.md`, then STOP

## WAITING ON (never guessed)
Bank name/file spec and the .xls question; payment-mode codes; a PF-covered employee's payslip and statement; ESI rules and
rates; PT/LWF applicability and slabs; TDS slabs and rules for the year; employer-PF treatment; official formats for PF ECR/challan/12A,
ESI upload, PT statement, TDS challan, quarterly return; meaning of "override from/till"; whether a director may approve a run
they prepared; payslip protected-PDF decision; WFH eligibility and approval; whether HR may see leave/attendance counts when a
switch is off; whether Ops shares statutory registrations; purpose of Slab Salary Bonus, Training Exp, Old Month Discrepancy;
who enters payroll data month to month; whether a third Super Admin may approve payroll.
**Found while starting:** `docs/samples/` and the three template files named in the prompt (`Bulk_Salary_Overrides_template.xlsx`,
`Salary_Statement_template.xls`, `Bank_Transfer_template.xls`) are not in the repo. They block Stage 4 import, 5.4, 6 (statement) and 8.1 only.

## Closing the Stage 5b gaps (A1 to A8)
- [x] A1 demo file named and marked DEMO · [x] A2 phone-width walkthrough (one defect fixed) · [x] A3 samples checked (only on `peeps/foundation`) · [x] A4 input heads' direction and negative choice · [x] A5 sensitive-ui split in two jobs · [x] A6 run 223 read · [x] A7 owner review sheet · [x] A8 bank payments manual, sent-to-bank note

## A-9 — function parity, Employee and Admin areas (`docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md`)
- [x] Audit — `e7d095f` · [x] G1 filters, segments, directory, Pay tab — `d81f0ba` · [x] G2 position history — `c9bc156` · [x] G3 letters — `0829a3a`
- [x] G4 bulk documents and photos (importers audit only) — `6397ad1` · [x] G5 mass email — `6ee5f12` · [x] G6 search — `7aa4520` · [x] G7 separation modes, portal access — `8fa2777`
- [x] Full backend suite alone 201 files / 1,961 tests green; walkthrough director / HR (switch on, off) / employee, light, dark, phone; report in STAGE_REPORTS.md
- [ ] Open: division (owners); A-3 letter figures (hook left); A-2 import rules (not on this branch)
