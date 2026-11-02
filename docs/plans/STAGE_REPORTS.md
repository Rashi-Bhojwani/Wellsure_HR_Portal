# Stage reports

One report per stage, appended as each stage finishes. Plain and short. No real data. See `MASTER_CHECKLIST.md`.

---

## Stage 0 — D1 close-out (commits `f23ff7b` … `ceb2468`)

**Built**
- 0.1 `f23ff7b` Latency harness: the first wait looked for the removed antd `.ant-statistic`; now waits for the home screen's own text.
- 0.2 `e3f2980` `check:sensitive-ui` is its own CI job (it used to be the last step of `latency`, so a red latency hid it). The scan now also
  visits as an HR Admin and a director (admin and own portal), retries aborted navigations.
- 0.3 `7df6020` Same-person tests (below).
- 0.4 `723381b` Docs note on a third Super Admin.
- 0.6 `ca52b9d` `docs/CONTINUITY_AND_RECOVERY.md`.
- 0.7 `ceb2468` Role screens show a purple "Director only" marker on Payroll Admin / Payroll Approver; `docs/plans/D_PHASES.md`.

**0.1 — the latency job (still red; not fixed in full).** Exact cause: the UI pass replaced antd Statistic/Card/List with StatCard/DataTable, and
the simulator (`biometric-agent/src/simulator/latency/run.ts`) still waits for those. I fixed the first wait. Two more are stale: the
"who is in" watcher (looks for `.ant-card` titles "Arrived (" / "Away" and `.ant-list-item`) and the employee-panel watcher
(`.ant-list-item` with the device name). Rewriting them means re-deriving what the new tables render, so it is **not small**: I did not do it. CI run
on `ceb2468`: the job fails at "Measure punch-to-screen latency" after 5 s; everything else is green.

**0.2 — what the scan found, locally.** Scratch DB `wellsure_hr_d1`, demo company seeded, visits as developer, ordinary employee, HR Admin
(admin and own portal) and director (admin and own portal): **314 pages, no secret on any page, and the DEMO COMPANY banner on every one.** In CI
the new `sensitive-ui` job passed on `ceb2468` (about 9 minutes).

**0.3 — same person never maker and checker.**
Tests added: `approvals.test.ts` — one case per approval subject (6) with a person holding Super Admin + `PAYROLL_ADMIN` + `PAYROLL_APPROVER`; refuses
APPROVE and REJECT with `CHECKER_IS_MAKER`, the database CHECK also refuses, a different director still can.
Changed assertions (all made stricter, none weakened):

| File | Test | Old | New | Why still meaningful |
|---|---|---|---|---|
| approvals.test.ts | "the checker is never the maker…" | one case, RUN_APPROVAL only, maker = a normal Super Admin | `describe.each` over all 6 subjects, person holds both marker roles | covers every subject and the two-role case |
| runClosing.test.ts (run approve by maker, finalise decision by maker, publish REJECT by maker, unlock decision by requester) | 4 asserts | status 403 | status 403 **and** code `CHECKER_IS_MAKER` | a 403 for a different reason (missing permission) can no longer pass |
| salary.test.ts | revision decided by its maker | 403 | 403 + `CHECKER_IS_MAKER` | same |
| releases.test.ts | bank file | (none for the requester approving their own request) | requester's APPROVE → 403 `CHECKER_IS_MAKER` | new |

Rule confirmation, component confirmation and the four independent layers were already covered (`rules.test.ts`, `selfConfirmLayers.test.ts`).
**Mutation:** disabling the check in `approvals.decide` fails all 6 new core cases (restored, re-run green). Not mutation-run: the four flow-level
assertions individually (they would fail under the same mutation by construction, but I did not run it), and the database CHECK alone (covered by
`selfConfirmLayers`). Bank/statutory-change confirmation by a second person is not built yet (D2).

**0.5 — what the code does today when a director approves a run they prepared.** `approvals.decide()` refuses it with 403 `CHECKER_IS_MAKER`
("You prepared this, so you cannot be the one who approves it"), and the database CHECK `payroll_approvals_checker_not_maker` refuses it too.
The only path where one director both prepares and decides is `approvals.authorise()` (director authority), which exists but **no payroll flow calls
yet** — D2 wires it. After D2, with a step's switch at its default (second director not required) one director may do both; with the switch ON,
`authorise` refuses (`SECOND_DIRECTOR_REQUIRED`). Nobody can ever approve a change to their own pay. I changed nothing. **Open: WAITING ON the
owners (whether a director approves a run they prepared).**

**0.7 — departments.** Departments are data (a master table edited in Organisation Setup; every screen reads them from the API). No department
name is hardcoded in backend/frontend/shared code or in tests. The development seed (`backend/prisma/seed.ts`) creates five fake departments by
name (Engineering, Human Resources, Sales & Marketing, Operations and one more); that is development-only fake data, not the real company's. The
demo company's own data is separate.

**Tests / numbers.** Full backend suite run alone (no other test process; stack stopped): **160 files, 1,553 tests, all passed**
(`cd backend && npx vitest run`). Backend and frontend `npm run lint` and `typecheck` clean; frontend tests 46 passed; design-token check OK.
`db:drift` not re-run (no schema change since D1). Not re-run this stage: check:popovers.

**CI** (`ceb2468`): green — install-lint-typecheck-test, sensitive-ui, attendance-replay, agent-windows, docker-build. Red — `latency` only
(0.1, pre-existing, understood). Runs on the earlier commits of this stage were still going when I read the last one; they build the same tree.

**Decided by me.** Proceeded with Stages 0–2 although `docs/samples/` is missing (it blocks only Stages 4, 5.4, 6, 8.1); kept the partial latency fix and
reported the rest; `sensitive-ui` job timeout 40 min; retry for aborted navigations; HR and director visits added to the scan; marker role
`directorOnly` flag added to the roles listing; the D-phase list says the master prompt's order (Stage 1 before D2) overrides Q-DA-9.

**Browser walkthrough (desktop, light, scratch DB with the demo company).** Employee home shows the Remote work card with server time and no horizontal scroll; the payslip page offers Raise a query and the employee lands on their ticket; a director marks a person not on payroll and the entry shows "Waiting for a different director"; the other director confirms (toast "Confirmed", row turns Confirmed); the Payslip links page shows Not set and the password-protected PDF as "Needs owner approval", and saving 7 days works; HR sees neither page nor menu entry. The first attempt failed because I had not applied the B6 migration to that scratch database (the page showed the error), not because of a defect.
**Unverified.** The phone-width (390, dark) walkthrough of the new screens did not run: the scripted sign-in timed out and I stopped rather than spend more time. The bank return layout is untested against a real bank file (none exists in the repository). `check:sensitive-ui` and `check:popovers` run in CI only.


## Closing the Stage 5b gaps (A1 to A8)

* **A1 demo rehearsal.** The demo company's bank file is named `DEMO-bank-file-…` and its first line says it is fictional; it is made only from a layout that says DEMO (`DEMO_LAYOUT_NOT_LABELLED` otherwise). The real company's file is never marked or named DEMO and is released only from a final run whose rules are confirmed and unchanged. Tests in `releases.test.ts`, `bankRepayment.test.ts` (a rule changed after finalising refuses the file) and the demo suite; three mutants caught (the real company treated as the demo; the label check removed; the mark removed) and a fourth that survived until the last test was added, then caught.
* **A2 phone-width walkthrough** (390 px, dark theme, a sign-in script that now retries on a fresh page and reuses one session per person: the earlier failure was the login rate limit, not the script's selectors). Seen: the remote work card with server time (once a director marks the person remote; nobody is by default); the payslip page and the "Raise a query" dialog, and the person lands on their ticket; the payslip links page (Not set, "Needs owner approval"); not on payroll (form, "waiting" chip, the second director's confirm); bank and statutory layouts; the run page's "Rows the bank rejected" with "Enter a rejection", the repayment planner and "Note that it was sent to the bank". No horizontal scroll anywhere and the dark background on every page. **One defect found and fixed:** the Confirm button on Not on payroll carried a sentence that spilled out of the button at 390 px; it now says Confirm with the explanation underneath. The fixed page was not walked again.
* **A3 samples.** `docs/samples/Bank_Transfer_template.xls` and `docs/samples/README.md` are **not on this branch** (the folder does not exist here) and not on `origin/main` (main has the other synthetic samples). Both are on `origin/peeps/foundation` (commit `4f71f90`). Not recreated, not copied.
* **A4 input terms (D-31).** Each Monthly Inputs head has a direction and a negative-figures choice, both Not set until a director chooses; a head with either Not set takes no figure and blocks the run, naming it. 6 new tests; mutants on the per-head negative choice, the Not-set gate, the sign flip, the direction rule and the parser all caught; one (the second gate in the run's refusal) is equivalent because the blank cells already stop the run.
* **A5 CI scan.** `sensitive-ui` is split by a matrix into an admin-portal job (365 pages) and an employee-portal job (108 pages), each page opened once by each person as before, every check kept, 35-minute job and 28-minute step limits (the single job had used 14 of 16 minutes). Measured locally on the scratch stack: employee 265 s, admin 1,042 s. A planted leak (a made-up bank account in the page shell) failed the employee scan, 108 pages, with a problem named on each page.
* **A6 run 223** (B1 to B3): all six jobs success: agent-windows, latency, sensitive-ui, docker-build, attendance-replay, install-lint-typecheck-test.
* **A7** `docs/plans/OWNER_REVIEW_SHEET.md` written in plain language, one line per decision with a recommendation.
* **A8 bank payments are manual (D-34).** The return-file layout, the return-file import and the stored bank response file are gone; a rejected payment is entered by hand by a director with a reason; "sent to bank" can be noted once per downloaded file by a director (append-only, held by the database). Tests and three mutants caught.

## Stage 7: P7-2 and P7-3, stopped at the TDS checkpoint

**Plan:** `docs/plans/STAGE_7_PLAN.md`, written before the code. **A finding first:** `MASTER_CHECKLIST.md` had P7-1 ticked as done; it was not built (no financial-year helper, tax rules, engine or year-to-date reader). The smallest part of it that P7-2 and P7-3 stand on was built and labelled as such; opening figures were not.

* **The tax year** is a new governed item kind (`TAX_YEAR`): every value Not set until a director enters it with a required source note and an effective-from date, saved as a Placeholder and confirmed by a different director; the section catalogue (labels, caps, shared caps, proof required) is inside it, with no section number or form name in the code. Directors only; HR, the Developer role and employees are refused on every route.
* **The engine** (`tax/engine.ts`, pure and exact): standard deduction, section deductions by regime with own and shared caps, slabs, rebate, surcharge, cess, rounding by the year's rule, and a month's TDS (remaining tax over months left, at least the minimum, never more than what is left, never negative). It knows no figure of its own. Tests: hand-worked cases on made-up figures; property tests against an independent exact-fraction (BigInt) model, 400 random years for the annual tax and 500 for the month's TDS, all agreeing; 14 engine mutants: the surviving ones (the surcharge's two edges, and an equivalent zero edge) led to two more tests and are caught.
* **P7-2:** windows (a director sets them; Not set means closed), the person's own declaration (versions, append-only, only while the window is open, only under confirmed sections), proofs (uploaded through the same checked path as other documents), directors' verification (accept with the amount verified, never more than declared, or reject with a reason; never your own, in the service and in the database), after the proof window only verified amounts count. Screens: employee IT Declaration, Proof Of Investment, IT Statement; directors' Tax Years and Tax Declarations; the regime comparison is side by side and never chosen for the person.
* **P7-3:** `TDS_MODE` gained `PROJECTED`; each person's TDS line carries its whole working; the tax year is pinned (a Placeholder year makes the run a test) and the declaration version, regime and year-to-date figures are in the run's fingerprint (a changed declaration makes it stale); a missing tax value, an unanswered "taxable", or no regime blocks the run and names the gap.
* **Tests:** `taxEngine.test.ts` (20), `taxDeclarations.test.ts` (7, over the real routes and a run), a frontend test for the comparison (3), the demo suite proves the demo has a made-up confirmed year and that HR sees none of it. 9 mutants on declarations and the run, all caught.
* **Walkthrough** (desktop light and phone 390 dark, scratch database with the demo company): declaration (regime not chosen until clicked, saved as a version), proof upload, directors' decision, the person sees "verified", IT Statement, Tax Years with each value's source note, HR sees neither page nor menu entry. Two defects found on the phone and fixed: the amount boxes and the actions were missing from the phone cards (a person could not type an amount or a director decide), and the window row overflowed sideways. **Not fixed:** on a phone the two-regime table scrolls sideways inside its own box.
* **Not verified:** tax correctness against any law (every figure is the owners'); real proof documents; behaviour with 500 people (not measured); Form 16 (not started).
* **Not built:** YTD Reports, payslip YTD, Salary Revision page, revision letters, offer-letter figures, HRA/LTA/perquisites, opening figures, marginal relief, Form 16 and the quarterly return, loans, reimbursements, off-cycle runs.
