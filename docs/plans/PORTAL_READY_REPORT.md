# Portal readiness report

Branch `feat/hr-payroll-separation`, written 2026-11-10 and updated 2026-11-11 by the session continuing Session A. Public repository: no real data, no real
person's name. **Every buildable item is now built**, including P7-6b off-cycle runs and the three D-37 defaults. Still open: eight A-items undefined in every plan
file; Stage 8 blocked until the owner replaces the files on `origin/main` (they look like real exports; not brought here); Stages 6 and 9 not started on the
owner's instruction (`PARITY_COVERAGE.md` was brought onto this branch by the parallel M session on 2026-11-11).

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
| Stage 6 internal payroll reports | DONE (ten reports, layouts, audited exports; 7 mutants caught, 1 equivalent) | `e90c471`, `247096d` |
| CI backend shards with a count check | DONE (longest shard 6.5 min vs 17 min before; limit unchanged) | `f915ba3` |
| Payroll rows of the parity audit (ST-24/SS-05, PY-27/28/29 guide, ST-21, ST-03/06, LC-07, PY-37, PY-24, IE-09) | DONE; LC-09 and ST-23 were already covered; the rest skipped (owner values) — see `A_PARITY_ROWS.md` | `9bbcc05`, `c62a451` |
| Stage 8 file readers and parallel-run kit | **BLOCKED in part**: `docs/samples/` exists only on `peeps/foundation` (not touched); the Phase 6 compare tool exists | — |
| Part 2: ST-08, ST-30, ST-29, ST-25, PY-41 (mechanisms, every value Not set) | DONE | `bd192ee`…`cdcba37` |
| Stage 9 Tier 1 parity (payroll rows) | DONE where no owner value is needed (above); owner-value rows listed as skipped | — |

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

## 3. What is verified, and what is not

**Verified on 2026-11-11 (second pass):** the demo company has a made-up pay history (two finished runs, loans in four real states, claims of two types in five
states, a director hold and a missing bank account, two settlements, a finished off-cycle run), and every new screen was opened with that content as director, HR,
manager, employee and Developer at 1280 light, 390 dark and 768 — 225 visits: no crash, no server error, no sideways page scroll, no bank, PAN, UAN or debit-account
text, every directors' screen refused to the others. Keyboard only: 21 of 21 primary actions reached by Tab with a visible focus ring, opened by Enter, Tab kept inside
the dialog, Escape closes, focus returns. End to end: a settlement recovers a loan through an off-cycle run (balance, ledger, paid once, bank file and sent mark once,
double clicks and retries with no double effect, the regular run identical for everyone else), as a test and through the screens. At 500 people every new reader
and off-cycle step is inside its budget (largest: 0.58 s against 1.6 s).

**Not verified:**
- Tax correctness against any law (every figure is the owners'); real bank files, real devices (agent sync tested with the fake device), real mail.
- Test gates: final full suite alone 221 files, 2,061 tests, all passed; CI run 307 on the branch head green on all seven jobs. Risk: the CI Test step now takes
  about 17 of its 18 allowed minutes (run 288 timed out with no failing test).
- Real screen readers (only keyboard paths and focus were checked); colour contrast was not measured; a real phone and a real tablet (emulated widths only).
- Payslip PDF timing at 500 in this container (the existing measure's PDF step hung here; earlier figure 0.25 s each stands unverified today).
- A loaded database, RDS Proxy and two people on different machines at once (the double-click checks are from one browser and one test process).
- The loan "pause" the owners may want: there is no such feature (row 75).
- A TEAM-scope viewer of the roster grid; the five non-leave attendance-lock writers over their routes (wired; only leave apply exercised).
- Stage 8 readers (no synthetic samples on this branch yet).

**Verified on 2026-11-12 (Session A block):** see STAGE_REPORTS.md "Session A block". Full suite alone 239 files / 2,139 tests with 3 failures: one mine (fixed in
`247096d`), two in the other session's files (`customFields` passes alone; `yearEndMoney` audit-viewer test broken since `ad5b3ca`). Not verified: the Form 16 PDF and
the bank summary against any official or bank format (both are our own layouts); a real upload of the salary import by a director and its decision by the other
director through the screens (tested over the API only).

## 4. What I decided myself

Decisions 49–67 in `DECISIONS_FOR_OWNERS.md`, in plain words in `OWNER_REVIEW_SHEET.md` (rows 57 and 66 are now answered by the D-37 defaults; rows 68–74
added 2026-11-11). Self-decided on 2026-11-11: off-cycle runs as a separate pipeline (the regular engine untouched); a held item is payable off-cycle only when held
by a director, for final settlement or for a missing bank account, with a positive net; partial loan recovery is rounded down to the paisa and split into a paid and a
carried instalment at finalise; the carried part is due from the next run; the max-deduction percentage and the pro-rata rounding live in the behaviour store (Not
set) rather than as payroll rules; an exact pro-rata leave figure needs no rounding; the leave correction for the month of leaving is a separate entry (reversal or
grant), never an edit. Also: claim caps are per month spent and per financial year (P7-5 plan); a challan is confirmed by retyping amount and
serial (P7-7); Form 16 stays DRAFT while either the year's Form 16 data or the tax year is unconfirmed. Second pass (rows 75–78): no loan pause is invented
(the seeded "stopped" loan is a cancel-pending one); one open off-cycle run per source; Quarterly TDS opens on the last ended quarter; the demo writes its loan
requests dated in its past; free-text columns wrap at a set width and action columns are pinned right; status chips wrap on phones; Tab is kept inside every
dialog by a shared trap; the scale budgets are the project's recorded 500-person figures doubled (1.6 s per screen read, 1.4 s per off-cycle step).

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
