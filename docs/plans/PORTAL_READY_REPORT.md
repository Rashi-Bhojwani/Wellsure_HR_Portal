# Portal readiness report

Branch `feat/hr-payroll-separation`, written 2026-11-10 by the session continuing Session A. Public repository: no real data, no real person's name.
**The portal is not yet complete:** one buildable item (P7-6b, off-cycle runs) is open, eight A-items are undefined in every plan file, and Stages 6, 8
and 9 are blocked on files that are not on this branch. Everything else in the owner's list is built and verified as described below.

## 1. Every planned item and its status

| Item | Status | Commits |
|---|---|---|
| Step 0.2 (DEMO bank rehearsal, split sensitive-ui scan with a planted-leak check, D-31 input head choices, D-34 manual bank payments, owner review sheet, CI per job, 390 px dark walk) | DONE (verified against the code and CI run 254) | Stage 5b A1–A8 commits; table `07ef544` |
| A-10 Workforce parity G1–G7 | DONE | `bbd14e6`, `f0c32c5`, `ad5ece4`, `540fb58`, `15b676d`, `4d77d02`, `78394c0`, fix `123181a` |
| A-3 Opening figures (+ letter figures hook) | DONE | `0280f85`, `7ec1d5a` |
| A-1, A-4, A-6, A-7, A-8 | **UNDEFINED** — no plan file on any branch defines them | — |
| A-2 (HR import rules), A-5 (regularization rules module) | **UNDEFINED in detail** — named only | — |
| P7-2 Declarations and proofs | DONE (earlier session) | Stage 7 commits |
| P7-3 TDS projection, IT Statement, YTD reports, payslip YTD, Salary Revision page, revision/offer letter figures | DONE; checkpoint report `0e3a1bf` | earlier + `7ec1d5a` |
| P7-4 Loans and advances | DONE (core; change screens and type screen are API-only) | `7ec1d5a` |
| P7-5 Reimbursements | DONE | `7f90f94` |
| P7-6 Full and final settlement | PARTIAL: prepared and confirmed | `cb8de84` |
| **P7-6b Off-cycle runs (paying settlements and held pay)** | **OPEN** — a core-engine change, planned in `P7_6_SETTLEMENTS.md` | — |
| P7-7 Challans, reconciliation, quarterly data, Form 16 Part B data (DRAFT) | DONE (no PDF, no official format, quarterly is API-only) | `5b36109` |
| Stage 6 internal reports and query builder | **BLOCKED**: `docs/plans/PARITY_COVERAGE.md` does not exist on any branch | — |
| Stage 8 file readers and parallel-run kit | **BLOCKED in part**: `docs/samples/` exists only on `peeps/foundation` (not touched); the Phase 6 compare tool exists | — |
| Stage 9 Tier 1 parity | **BLOCKED** (same file missing) | — |

Plans written before code: `GREYTHR_PARITY_WORKFORCE.md`, `A3_OPENING_FIGURES.md`, `P7_4_LOANS.md`, `P7_5_REIMBURSEMENTS.md`, `P7_6_SETTLEMENTS.md`, `P7_7_FORM16.md`.

## 2. Owner setup checklist (every setting left Not set)

Directors are the only Super Admins. "Confirm" always means the **other** director.

**First (the company and the year)**
1. Director authority: choose, per payroll step, whether a different director decides (System Settings → Director authority). No default.
2. Tax year for the financial year (Payroll → Tax Years): slabs, standard deduction, rebate, surcharge, cess, default regime, rounding, minimum monthly TDS,
   how one-offs are taxed, the section catalogue — each with a source note and effective-from date; the other director confirms.
3. Every earning pay head: whether it is taxable. Every Monthly Inputs head: direction and whether negatives are allowed (D-31).
4. Opening figures (Payroll → Opening Figures): enter or import, or confirm there are none; the other director confirms. Until then income tax in a run does nothing.
5. Declaration and proof windows (Tax Declarations).
6. Switch `TDS_MODE` to PROJECTED when ready.

**Before the first run**
7. All statutory rules (PF, ESI, PT, LWF) and company rules, each confirmed (the Ready for First Run screen lists what is missing).
8. Bank layout (from the bank's own specification), payslip link lifetime, and whether the password-protected PDF is approved (stays "Needs owner approval").
9. Loan types (Payroll → Loans): limits, rate (0 is a choice), and the three pay heads (create "Principal Part" and "Interest Part" deduction heads); decide the shortfall rule (D-66).
10. Claim types (via the API in this release): who may claim, bills, monthly and yearly caps or no cap, the earning head.

**Attendance and leave (directors / HR with switches)**
11. Status labels and Manual Override's allowed statuses (Workforce Settings); attendance locks as needed; leave reviewers; holiday locations; weekend overrides.
12. The leaving-month accrual rule (D-57), PL eligibility boundary, encashment formula (spec §14).

**Go-live conditions**
13. Two-step sign-in for directors (optional now, a go-live condition). AWS and deployment are outside this work.

## 3. What is not verified

- Tax correctness against any law (every figure is the owners'); real bank files, real devices (agent sync tested with the fake device), real mail.
- Full backend suite on `5b36109`: 214 files, 2,016 tests, all passed (run alone).
- Browser walks: A-10 screens, Opening Figures and the swipes fix were walked (desktop light, 390 px dark) as director, HR, Developer and employee. **Not
  walked:** YTD Reports, Salary Revision, Loans (both), Reimbursements (both), Settlements, TDS and Form 16, the employee Form 16 page — built after the
  last walk; typecheck, lint, route tests and bundle budgets pass. A manager was not walked (the demo company has none; covered by tests).
- A TEAM-scope viewer of the roster grid; the five non-leave attendance-lock writers over their routes (wired; only leave apply exercised).
- 500-person timing of the new readers (reviewer reach, Form 16 year hash, settlements list).
- `check:sensitive-ui` and `check:popovers` run in CI only (green on run 271).

## 4. What I decided myself

Decisions 49–67 in `DECISIONS_FOR_OWNERS.md`, in plain words in `OWNER_REVIEW_SHEET.md`. The ones that need an answer: the leaving-month accrual (57)
and the loan shortfall rule (66). Also: claim caps are per month spent and per financial year (P7-5 plan); a challan is confirmed by retyping amount and
serial (P7-7); Form 16 stays DRAFT while either the year's Form 16 data or the tax year is unconfirmed.

## 5. Updated documents

`GETTING_STARTED.md` (cloud-shell pitfalls: an exported remote `DATABASE_URL` and `PORT`; seeding without `migrate reset`; the new screens) and
`FIRST_REAL_PAYROLL_RUN.md` (opening figures and income tax, loans). Changed test assertions: `CHANGED_TESTS.md` (none weakened).

## 6. What the independent audit should focus on

1. Money paths: loans (`loans/service.ts` sanction transaction, `run/gather.ts` due-month filter), reimbursements (`reimbursements/service.ts` caps and
   the adjustment), settlements (`settlements/service.ts` automatic lines), YTD on payslips (`run/ytd.ts`, `run/payslip.ts`).
2. Tax gates: the opening-figures gate in `tax/gather.ts`, `tax/openings.ts` hash binding, `tax/form16.ts` DRAFT rules.
3. Access: every new route refuses HR, managers (except their own/team where stated), employees on others' data and the Developer role; the
   Developer still reaches Employee Swipes (pre-existing; no selection now) — confirm that is intended.
4. Append-only and immutability triggers in the new migrations (`2026110*`), and the test-only purge exception.
5. Sealed challan numbers registered in `lib/fieldKeyRotation.ts`.
6. The attendance engine changes: rejected swipes, location-limited holidays and weekend overrides in `attendance/compute.ts`.
7. Whether P7-6b should be built next, and the A-items' definitions.
