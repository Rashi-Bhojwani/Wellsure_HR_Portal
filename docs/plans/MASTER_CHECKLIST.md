# Master build checklist (Stages 0–8 + close-out)

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
- [x] P7-0, P7-1 — `docs/plans/PHASE_7.md`, `docs/PROGRESS.md`
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
- [ ] 1.2 capability switches (role + named person, effective-dated, audited, history)
- [ ] 1.3 switching off is immediate everywhere (cache, sockets, counts, search, emails, direct URLs)
- [ ] 1.4 pending work re-routed to directors' queue on switch-off
- [ ] 1.5 Reports Gallery permission-driven; every report endpoint enforces server-side
- [ ] 1.6 `check:sensitive-ui` extended + test matrix

## Stage 2 — D2 (as in DIRECTOR_AUTHORITY.md) → CHECKPOINT 1
- [ ] D2 built and verified
- [ ] CHECKPOINT 1: report Stages 0–2, wait for go-ahead

## Stage 3 — payroll model (capabilities only, no values)
- [ ] 3.0 report + `PAYROLL_MODEL_PLAN.md`
- [ ] 3.1 pay heads
- [ ] 3.2 salary rules (all Not set)
- [ ] 3.3 arrears, LOP reversal, hold salary
- [ ] 3.4 statutory parameter rule hierarchy
- [ ] 3.5 property/boundary/mutation tests

## Stage 4 — Monthly inputs
- [ ] grid, history, Excel import (needs the sample template — not in repo, see WAITING)
- [ ] no money field writable via muster/attendance finalisation, tested

## Stage 5
- [ ] 5.1 payslip delivery · [ ] 5.2 not-on-payroll flag · [ ] 5.3 WFH check-in/out · [ ] 5.4 bank layouts (.xls question) · [ ] 5.5 repayment batch · [ ] 5.6 loans (if missing)

## Stage 6 — internal payroll reports (director-only)
- [ ] reports per master prompt; no official-format files

## Stage 7 — Phase 7 P7-2..P7-7
- [ ] P7-2 · [ ] P7-3 → CHECKPOINT 2 · [ ] P7-4 · [ ] P7-5 · [ ] P7-6 · [ ] P7-7

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
