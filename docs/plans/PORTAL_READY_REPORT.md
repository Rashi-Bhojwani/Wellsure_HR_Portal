# Portal readiness report

Branch `feat/hr-payroll-separation`, written 2026-11-10 and updated 2026-11-11 by the session continuing Session A. Public repository: no real data, no real
person's name. **Every buildable item is now built**, including P7-6b off-cycle runs and the three D-37 defaults. Still open: eight A-items undefined in every plan
file, and Stages 6, 8 and 9 blocked on files that are not on this branch (`PARITY_COVERAGE.md` exists on no branch; `docs/samples/` exists on `origin/main` and
`origin/peeps/foundation` but not here, and this work may not touch those branches).

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
| P7-4 Loans and advances | DONE (type screen `742cb4a`; shortfall rule `df8306f`; change screens API-only) | `7ec1d5a` |
| P7-5 Reimbursements | DONE | `7f90f94` |
| P7-6 Full and final settlement | DONE (prepared, confirmed, paid by an off-cycle run) | `cb8de84` |
| P7-6b Off-cycle runs (paying settlements and held pay) | DONE (8 mutants caught) | `64b6e16` |
| P7-7 Challans, reconciliation, quarterly data, Form 16 Part B data (DRAFT) | DONE (no PDF, no official format; quarterly screen `742cb4a`) | `5b36109` |
| Screen walk of the never-opened screens (5 roles, desktop light and 390 dark, 120 visits) | DONE | `28a4e25` |
| Loan and claim type settings, quarterly TDS screen | DONE (all values Not set) | `742cb4a` |
| D-37 default 1: loan shortfall per type (+ max deduction %, Not set) | DONE (9 mutants caught) | `df8306f` |
| D-37 default 2: leave in the month of leaving (+ pro-rata rounding, Not set) | DONE (7 caught, 1 equivalent removed) | `534aa71` |
| D-37 default 3: Developer does not see Employee Swipes by default | DONE (3 mutants caught) | `9ec926e` |
| Stage 6 internal reports and query builder | **BLOCKED**: `docs/plans/PARITY_COVERAGE.md` does not exist on any branch | — |
| Stage 8 file readers and parallel-run kit | **BLOCKED in part**: `docs/samples/` exists only on `peeps/foundation` (not touched); the Phase 6 compare tool exists | — |
| Stage 9 Tier 1 parity | **BLOCKED** (same file missing) | — |

Plans written before code: `GREYTHR_PARITY_WORKFORCE.md`, `A3_OPENING_FIGURES.md`, `P7_4_LOANS.md`, `P7_5_REIMBURSEMENTS.md`, `P7_6_SETTLEMENTS.md` (with the
P7-6b section), `P7_7_FORM16.md`, `D37_DEFAULTS.md`.

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
9. Loan types (Payroll → Loan and claim types): limits, rate (0 is a choice), and the three pay heads (create "Principal Part" and "Interest Part" deduction heads).
10. Claim types (Payroll → Loan and claim types): who may claim, bills, monthly and yearly caps or no cap, the earning head.
10a. System Settings → Default behaviours: review the three D-37 defaults (loan shortfall: skip and carry; leaving month: pro-rata; Developer: no Employee
     Swipes) and set the two Not-set values (max total deduction %, pro-rata leave rounding). Every change is confirmed by the other director.

**Attendance and leave (directors / HR with switches)**
11. Status labels and Manual Override's allowed statuses (Workforce Settings); attendance locks as needed; leave reviewers; holiday locations; weekend overrides.
12. PL eligibility boundary, encashment formula (spec §14). (The leaving-month accrual is now the D-37 default, item 10a.)

**Go-live conditions**
13. Two-step sign-in for directors (optional now, a go-live condition). AWS and deployment are outside this work.

## 3. What is not verified

- Tax correctness against any law (every figure is the owners'); real bank files, real devices (agent sync tested with the fake device), real mail.
- Test gates: full backend suite run alone after each item (P7-6b 2,026; item 4 2,034; item 5 2,038); final run on `9ec926e`: 218 files, 2,041 tests, all
  passed. CI run 287 on `9ec926e`: all seven jobs green (per job in STAGE_REPORTS).
- Browser walk (2026-11-11): the 12 never-opened screens, 5 roles, desktop light and 390 px dark, all in **empty states** (the demo company has no loans, claims,
  settlements, off-cycle runs or closed-year runs). **Not walked:** filled-in states, tablet width, keyboard-only paths on these screens; the Default behaviours screen
  and the D-37 rows on Ready for First Run (built after the walk; typecheck, lint, bundle budgets and the backend tests cover them).
- Off-cycle runs end to end in the demo company in a browser (covered by the route test with the demo switch; no demo seed of a settlement).
- Loan exit recovery through a settlement (the code path is exercised only by review and the loan balance reader; the off-cycle test uses held pay and a
  settlement without a loan line).
- A TEAM-scope viewer of the roster grid; the five non-leave attendance-lock writers over their routes (wired; only leave apply exercised).
- 500-person timing of the new readers (reviewer reach, Form 16 year hash, settlements list, off-cycle candidates, the behaviour reads in runs and access resolution).
- `check:sensitive-ui` and `check:popovers` run in CI only (they open every menu page, so the new pages are included).

## 4. What I decided myself

Decisions 49–67 in `DECISIONS_FOR_OWNERS.md`, in plain words in `OWNER_REVIEW_SHEET.md` (rows 57 and 66 are now answered by the D-37 defaults; rows 68–74
added 2026-11-11). Self-decided on 2026-11-11: off-cycle runs as a separate pipeline (the regular engine untouched); a held item is payable off-cycle only when held
by a director, for final settlement or for a missing bank account, with a positive net; partial loan recovery is rounded down to the paisa and split into a paid and a
carried instalment at finalise; the carried part is due from the next run; the max-deduction percentage and the pro-rata rounding live in the behaviour store (Not
set) rather than as payroll rules; an exact pro-rata leave figure needs no rounding; the leave correction for the month of leaving is a separate entry (reversal or
grant), never an edit. Also: claim caps are per month spent and per financial year (P7-5 plan); a challan is confirmed by retyping amount and
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
7. P7-6b (`offcycle/service.ts`, `offcycle/held.ts`, the migration `20261111090000`): the once-only keys, the adjustment consumer CHECK, the hold-release and
   unlock refusals. The D-37 store (`behaviours/service.ts`, migration `20261111120000`), the loan shortfall in `run/person.ts` and `run/finaliser.ts`, the leaving
   month in `leave/recalculator.ts`, the Developer switch in `lib/permissions.ts`.
8. The A-items' definitions.
