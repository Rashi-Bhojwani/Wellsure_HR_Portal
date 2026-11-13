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

## A-9: function parity for the Employee and Admin areas (commits `e7d095f` … this one)

**Audit first:** `docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md` (status, evidence, who, group for each of items 1–17 and section I), committed before any code.

**Built, one commit per group:** G1 `d81f0ba` saved filters and segments (resolved inside each viewer's scope; owner-only change and archive), masked contact numbers with an
audited reveal, the directors' Pay tab (each opening audited), current / past / all, official-email search, remembered columns · G2 `c9bc156` position history, a card
per attribute, changed only through `updateJob` / `changeAssignment` with a reason · G3 `0829a3a` 11 starter letters (original wording, loaded by a director, arrive
switched off), per-template prepare / issue grants, batches, two signatories, serial (Not set), void, all through the existing `issueLetter` · G4 `6397ad1` bulk
documents and photos by employee number through the single-file paths · G5 `6ee5f12` mass email (server-side audience, confirmed count = sent count, no pay or identity
data) · G6 `7aa4520` search chips, scoped employee results, favourite star · G7 `8fa2777` separation modes (company data, none seeded) and portal access off / on.
Already built (marked so, nothing added): My Favourites, My Tasks, celebrations (Engage auto-posts), bulletin board (announcements), password reset, unlock, 2FA reset.

**Tests.** Full backend suite run alone: **201 files, 1,961 tests, all passed** (stack stopped, no other test process). New: `parity/__tests__/` segments 8, position 4, bulk 5,
massEmail 6, accountAndSeparation 3; `letters/__tests__/letterWorkflow.test.ts` 7; frontend `paletteCategory.test.ts` 2 (frontend 14 files, 72 tests). Every new route:
Developer 403, employee 403, unsigned 401, an access-scan entry (`routeInventory.ts`), Zod validation, scope in the service. Backend and frontend lint and typecheck clean;
design tokens OK; `db:drift` no difference; build and bundle: login 231.9 KB, shell + employee home 336.7 KB, shell + admin home 356.4 KB (gzip, within budget).

**Mutation checks (25 run).** Caught: segment scope (list and filter), Developer refusal, pay-opening audit, reveal scope, owner-only change, out-of-scope list member;
position shift key, position change scope (survived at first: the trailing read returned 404 after the write had happened; the test now checks nothing was written,
then caught), reason required; letters figure-letter lock, grant check, signatures before issue, HR voiding an issued letter, prepare scope; bulk scope, duplicates,
re-upload; mass email sender scope, count comparison, send-time private-data check (survived at first; test added, then caught); portal access guard, sign-out
everywhere (survived at first; test added, then caught), inactive mode. **Survived as equivalent (two layers, each covers the other):** the letters service's own
`letters.issue.nopay` check (the route gate checks it first); mass email "send twice" early return (the DRAFT→SENDING claim also stops it).

**Browser walkthrough** (scratch database `wellsure_hr_a9` with the demo company; desktop light and phone 390 dark). Director: Filters & Segments, All Employees (Who
filter, Save as segment), profile with Pay (salary history), Position (cards) and Personal (Show contact numbers), Letter Settings (starters, serial Not set), Letters,
Bulk Upload (both tabs), Mass Email, Separations (Modes of leaving), search dialog (chips, people found). HR Admin: profile tabs without Pay; Letter Settings refused;
Letters reachable; with the letters switch OFF the menu entry disappears and the page shows "This is not switched on for you"; switch back. Employee: A-9 pages refused.
Phone dark: every A-9 page, no horizontal scroll, dark background. **One defect found and fixed:** the mass-email message counter overlapped its help text at 390 px
(counter removed; the limit stays). The fixed drawer was not walked again. A manager was not walked (the demo company has none); manager reach is covered by the tests
(every A-9 route is gated on keys a manager can never hold).

**Shared-file edits** (additive, inside `A-9 — begin/end` markers; line numbers at this commit): `backend/prisma/schema.prisma` 119–122, 527–532, 770–773, 1660–1663,
1713–1715, 3551–end · `backend/src/app.ts` 45–47, 95–100 · `backend/src/lib/systemRoles.ts` 64–67 · `backend/src/lib/__tests__/cleanup.ts` 65–67, 103–104 ·
`backend/src/modules/managers/__tests__/routeInventory.ts` 620–674 · `shared/constants/permissions.ts` 101–105, 248–252 · `shared/constants/sensitiveData.ts` 168–172 ·
`frontend/src/routes/adminMenu.config.tsx` 28, 122–128, 223–227, 342–344, 406–408 · `backend/src/modules/letters/{routes 7–10, 56–77; service 388–407; validators 63–93}` ·
`backend/src/modules/access/{service 21, 426–442; routes 7–8, 49–51; controller 52–56; validators 26}` · employee module additions: `grid.ts`, `service.ts` 1 and 510,
`validators.ts` 228, `EmployeeProfilePage.tsx`, `AllEmployeesPage.tsx`, `SeparationsPage.tsx`, `api/employee.ts` · `CommandPalette.tsx`, `EmployeeAccessTab.tsx`.
New migrations: `20261103100000_a9_segments`, `…110000_a9_letter_workflow`, `…120000_a9_mass_email`, `…130000_a9_separation_modes`.

**Settings left Not set:** letter serial; separation modes (none seeded); every letter grant; mass-email categories (free text). **New keys:** `employee.segments.manage`,
`employee.contact.reveal` (HR roles by default), `communication.mass.send` (directors only until granted).

**Decided by me:** see "Decided by me" in the plan file (mass email by Roles & Permissions, not an HR switch; starters loaded switched off; voiding an issued letter is the
directors'; one company serial; file-name rule; contact keys for both HR roles).

**PEEPS-OWNED, left alone:** asset tracker, avatars and photo rules (bulk photos use this branch's existing photo path), badges, nudges, Unmute, helpdesk, exits,
recruitment. **Hooks:** A-3 `letterFigureFields()` (`letters/starters.ts`); A-2: no importer added, who may import unchanged (item 14 audit only).

**CI, read per job (run 251, on `8fa2777`):** install-lint-typecheck-test success (backend tests, demo tests, drift, bundle budgets); sensitive-ui admin portal
success; sensitive-ui employee portal success; docker-build success; attendance-replay success; **latency failed** at "Popovers and dropdowns": on a 390 px phone
the search dialog no longer fitted the screen (858 px tall in an 844 px screen), **caused by A-9 G6** (the chips row added height; the results list's cap was not
reduced). Fixed in the last commit (the list's cap is 60 px lower on the admin portal on a phone); `check:popovers` then passed locally against the scratch
stack (every popover inside the screen, opaque, closes on Escape). **agent-windows failed** at "Install the release and exercise the service": the Windows runner
refused event-log registration ("Access is denied"); nothing in A-9 touches `biometric-agent/`, so not caused by this work, and not changed.

**Not built:** division (does not exist in the system; open question); NOT SHOWN YET items (policies with acknowledgment, identity verification, contract details,
document drive). **Unverified:** the mass email against a real mail server (console driver and a replaced `mailService` only); 500-person performance of segments and
mass email; the letter void on a letter still rendering (refused by design, not exercised in the browser); a manager in the browser; `check:sensitive-ui` was not run locally
(it passed in CI).

## A-10: function parity for Workforce Management, G2 to G7 (commits `f0c32c5` … `123181a`)

Plan: `docs/plans/GREYTHR_PARITY_WORKFORCE.md` (G1 `bbd14e6` was done by the earlier session).

**Built, one commit per group:**
* **G2** `f0c32c5` the roster as a read-only month grid (shift per day, week-offs, holidays, Shift Overrides marked `*`) and its download, from the same sources as the engine.
* **G3** `ad5ece4` attendance activity locks: a director locks leave apply, corrections, muster entries, Manual Override, Shift Override or the roster for a range of days, from an effective date, for everyone or a segment's people (taken when made). One guard in the six writers; directors not stopped; voided once, never edited or deleted (database).
* **G4** `540fb58` holidays for some locations only; weekend overrides for chosen people; leave type reviewers (directors name an extra decider for one leave type). One calendar loader feeds the engine, the roster grid and leave day counting.
* **G5** `15b676d` reject / reinstate swipes with a reason (the engine ignores a rejected one), the day's shift on each swipe, bulk; device sync requests carried to the agent on its heartbeat (server, protocol and agent).
* **G6** `4d77d02` leavers and leave recalculated to the last working day (no accrual for a month that starts after it; the leaving month untouched; days only).
* **G7** `78394c0` one Workflow screen (waiting on me / decided by me / waiting on others) with bulk decisions through the existing functions, and `displayLeaveForViewer`.
* `123181a` a defect found in the browser: the Developer role was offered swipe selection (it holds the device key; the server refuses it). Fixed.

**Tests.** New: `workforce/__tests__/` rosterGrid 6, locks 6, calendar 4, swipesSync 3, leavers 2, workflow 3; agent `sync/__tests__/agent.test.ts` +1; manager reach +1. Every new route:
Zod, a permission, scope or a director check in the service, Developer and employee refused, an access-scan entry. Area suites run on each commit (attendance + leave 412;
+ tasks, delegations, managers, workforce 525; attendance, biometric, workforce, ingestion 406; leave, workforce, employee 199). Changed assertions: one exact-match
heartbeat assertion gained the new `resync: null` field (`CHANGED_TESTS.md`).

**Mutation checks (20 run, all caught):** override wins in the grid; lock: leave guard, director exemption, person, effective date; calendar: weekend override, holiday
location, reviewer decide, reviewer location; swipes: engine ignores rejection, sync done, own-swipe guard (caught after a test was added), agent range end; leavers:
leaving date ignored, leaving month reversed; workflow: own request in Review, Monitor for team scope, reject without reason.

**Browser walkthrough** (local stack, demo company; desktop light and phone 390 dark; director DEMO001, HR Admin DEMO004, Developer DEMO005, employee DEMO010).
Director: all nine A-10 pages shown, no sideways scroll, dark background on the phone. HR: the director pages refused (Workforce Settings, Locks, Leave Reviewers);
Calendar Adjustments, Device Sync, Leavers, Workflow, Roster, Swipes shown. Developer: every A-10 page refused except Employee Swipes (which it reached before A-10);
after the fix it gets no selection there. Employee: all refused. **Not walked:** a manager (the demo company has none; manager reach is covered by tests).

**CI (run 264 on `78394c0`), per job:** install-lint-typecheck-test success (tests, demo, drift, bundle), sensitive-ui admin success, sensitive-ui employee success,
latency success (popovers included), attendance-replay success, docker-build success, agent-windows success.

**Decided by me:** decisions 49 to 59 in `DECISIONS_FOR_OWNERS.md` (and the owner review sheet). The one needing an answer: what accrues in the leaving month (57).

**Not verified:** a TEAM-scope viewer of the roster grid; the five non-leave lock writers over their routes (wired, mutation-checked only for leave); weekend overrides
in leave day counting (not built, decision 53); a real device for the sync request (fake device and fake API only); 500-person timing of the reviewer reach.

**Environment notes for the next session:** the shell exports `DATABASE_URL` (a remote database) and `PORT=3000`; every command here unsets both. `npm run db:seed`
runs `prisma migrate reset` and is refused by Prisma's AI guard; on an empty local database use `npm run prisma:migrate:deploy` and `npx tsx prisma/seed.ts` instead.
`pkill -f vite` also kills a running `vitest`: stop the dev stack by its exact process names.

## CHECKPOINT 2 (the TDS checkpoint), written 2026-11-06, then continued as the owners asked

**Where income tax stands.** The tax year is owner-entered (every value with a source note and an effective-from date, confirmed by a different director); the
engine is exact and proved against an independent fraction model; declarations, proofs and directors' verification work; a run with `TDS_MODE = PROJECTED` works out
each person's TDS with its full working and pins the year (a Placeholder year keeps the run a test). **New since the Stage 7 report (A-3, `0280f85`):** opening
figures (pay and tax before this system, and from a previous employer) are entered or imported by a director and confirmed by a different director; the
year-to-date reader adds them; and **a PROJECTED run now names the gap and works out no TDS until the year's opening figures are confirmed** (a company that starts on
the first day of the year confirms an empty year on purpose).

**What blocks real income tax today (all owner actions, nothing for the build):** the tax year's values (slabs, standard deduction, rebate, surcharge, cess, default
regime, rounding, minimum monthly TDS, how one-offs are taxed, the section catalogue) entered and confirmed; each earning head's "taxable" answer; the opening figures
confirmed; the declaration and proof windows set; `TDS_MODE` switched to PROJECTED by a director. Form 16 and the quarterly return are not built (P7-7, DRAFT only).

**Still open from P7-3, built next in this order:** YTD Reports, the payslip YTD column (new payslips only), the employee's Salary Revision page, revision letters and
offer-letter figures (issued by directors only). **Not modelled (owners' answer needed):** marginal relief (decision 45), HRA, LTA and perquisites.

## A-3 (opening figures), the rest of P7-3, and P7-4 (loans) — commits `0280f85`, `7ec1d5a`

**A-3** (plan `docs/plans/A3_OPENING_FIGURES.md`, `0280f85`): opening figures (before this system; previous employer this year) entered or imported by a director,
append-only, confirmed as a whole per year by a different director (`TAX_OPENING`, bound to a hash); the year-to-date reader adds confirmed figures only; a PROJECTED
run names the gap and works out no TDS until confirmed. Screen: Payroll → Opening Figures (directors). 5 mutants caught (one after a test was added for the hash binding).

**P7-3 rest** (`7ec1d5a`): payslips published from now carry year to date per line; employee YTD Reports and Salary Revision pages (own only; Developer refused);
revision and offer letters print the salary's own figures (directors only; the pay-free check refuses them for anyone else).

**P7-4** (plan `docs/plans/P7_4_LOANS.md`, `7ec1d5a`): loan types (Not set until every value is chosen), a person's own request or a director's entry, a two-director
sanction (never one's own), an exact schedule, money only through payroll runs (disbursement next run, instalments due in their month), immutable records, statements
read from what happened, maker-checker changes (API). Screens: employee Loans and Advances; directors' Payroll → Loans.

**Tests:** `taxOpenings` 5, `loans` 5 (schedule vs an independent BigInt model over 300 loans; a loan through a real run and finalise), `letterPayFigures` 4, publish test
extended (YTD line by line), `taxDeclarations` extended (the opening-figures gate). Mutants: 5 (A-3) + 4 (loans) + 1 (letters) + area checks, all caught.
Changed assertions: `CHANGED_TESTS.md` (none weakened).

**Not built:** loan perquisite (needs the owners' rule), the loan shortfall rule (decision 66), screens for loan changes and loan types (API only; the directors' page
lists what each type lacks), line-by-line opening figures (needs greytHR's layout). **Not walked in a browser:** the YTD Reports, Salary Revision and the two Loans
pages (built after the last walk; typecheck, lint, route tests and bundle passed). **Process note:** one full-suite run was spoiled by regenerating the Prisma client
while it ran; it was run again with no edits (see the next entry).

**Gate after `7ec1d5a` (written 2026-11-10).** Full backend suite run alone, no edits during it: **211 files, 2,003 tests, all passed.** CI per job: run 267 on the A-3
commit `0e3a1bf` failed in install-lint-typecheck-test → Test (the payroll literal guard flagged form-length constants in `tax/openings.ts`; every other job green);
fixed in `7ec1d5a` (allowlist with reasons). Run 271 on `00ac198` (all code through `7ec1d5a`): success on all seven jobs.

**Gate after P7-5, P7-6 (settlement side) and P7-7 (written 2026-11-10).** Full backend suite run alone on `5b36109`, no edits during it: **214 files, 2,016 tests, all passed.**
Commits: `7f90f94` (P7-5), `cb8de84` (P7-6 settlements), `5b36109` (P7-7). Not walked in a browser: the screens of these three items. Final status: `PORTAL_READY_REPORT.md`.

## P7-6b off-cycle runs (written 2026-11-11)

Plan: `P7_6_SETTLEMENTS.md` § P7-6b (written before the code). A separate, immutable pipeline (`backend/src/modules/payroll/offcycle/`) pays a confirmed settlement
or held pay; the regular run engine (`engine`, `gather`, `person`, the finaliser's calculation) is not changed. Road: a director prepares (never their own pay;
the real company refused while the Ready-for-first-run list has a blocker; the demo may rehearse) → `OFF_CYCLE_RUN` approval under the owners' `RUN_APPROVAL` choice
→ finalised by someone other than the approver, in one transaction (approval consumed; finalisation unique per source; held-item release unique per item; the
settlement's pending adjustments marked paid by the off-cycle run, a new `consumed_by_off_cycle_run_id` with exactly one consumer per CHECK; loan exit recoveries
recorded and read by the loan balance; statement stored) → `OFF_CYCLE_BANK` approval under the `BANK_FILE` choice, written by a non-approver from the confirmed
layout, account checked by blind index, DEMO name/watermark only for the demo and only from a layout that says DEMO → download → marked sent once.

**Found and fixed on the way (a double-pay gap):** a director's hold release points its adjustment at the hold, not the run item, so the settlement's "already
released" check never matched; a held month released by a director could also appear on the settlement. One reader (`offcycle/held.ts`) now decides unpaid held
pay for the settlement, the off-cycle run and the release; a hold release and a period unlock are refused once an off-cycle run paid the item.

Screen: Payroll → Off-cycle runs (directors). Settlements show PAID and refuse a new settlement once paid.

**Tests** (`offCycle.test.ts`, 10): exact-fraction property test (400 cases) for the settlement total and the off-cycle net; HR, Developer and employee refused on all
11 routes; real company refused while readiness red; unchosen step refuses; maker cannot decide, approver cannot finalise; a twin run for the same source cannot be
finalised; hold release and unlock refused after; unique keys refuse a duplicate and a rolled-back mutant that drops them lets it in; the regular run's figures are
unchanged; bank file rules; the settlement road with DEMO; own pay refused at prepare, ask and decide. **Mutants (8, all caught):** held reader ignoring off-cycle
releases; approver executing; zero total payable; DEMO layout check dropped; readiness ignored; net dropping a line; adjustments not marked paid; demo file not DEMO.

**Gate after P7-6b (`64b6e16`).** Full backend suite run alone, no edits during it: **215 files, 2,026 tests, all passed.**

## Item 3: loan and claim type settings, quarterly TDS data screen (written 2026-11-11)

Frontend only (the API, its director-only gates and its tests existed from P7-4, P7-5 and P7-7). Payroll → **Loan and claim types** (directors): every value of
a new type starts Not set (tri-state choices "Not set / Yes / No"; caps "Not set / No cap (chosen) / A cap"); each save needs a reason and is a new version; the
"Complete" column shows how many values are still Not set. Payroll → **Quarterly TDS data** (directors): per person per month paid and TDS from finished runs, PAN
by its last four, confirmed challans by their last digits; says the official format is not built. Typecheck, lint (tokens), build and bundle budgets pass.

## Item 2: the never-opened screens, walked (written 2026-11-11)

Local stack on the demo company. 12 screens (directors': Loans, Reimbursements, Settlements, Off-cycle runs, TDS and Form 16, Loan and claim types, Quarterly
TDS data; employee: YTD Reports, Salary Revision, Loans and Advances, Reimbursement, Form 16) × 5 people (director DEMO001, HR Admin DEMO004, a manager — DEMO003
given the MANAGER role for the walk and returned afterwards —, an employee DEMO002, the Developer DEMO005) × desktop 1280 light and 390 px dark = **120 visits**.
Result: no crash, no server error, no horizontal scroll at 390, no demo bank account or PAN text on any page. HR, the manager, the employee and the Developer see
"This is not switched on for you" on every directors' screen; the Developer's own-pay pages show the refusal ("The Developer role cannot use this"); employees see
only their own figures (Form 16 marked DRAFT).

**Fixed:** a stale "Loans & Advances — Phase 7" placeholder menu entry duplicated the Loans path (removed); the Quarterly TDS banner repeated its own title.
**Not walked:** keyboard-only paths and tablet width on these screens (the shared SideDrawer/DataTable components carry Esc and focus); filled-in states (the demo
company has no loans, claims, settlements or finished runs in a closed year), so tables were seen in their empty states only.

## Item 4 (D-37): loan instalment when net pay is too low; max deduction percentage (written 2026-11-11)

Plan: `D37_DEFAULTS.md` (written before the code). A shared **behaviour settings** store (`backend/src/modules/behaviours/`, tables `behaviour_proposals` and
`behaviour_confirmations`, both append-only; the database refuses a proposer confirming their own proposal); routes `/api/behaviours` (settings.manage, which HR
never holds, plus a director check; Developer refused). Screen: System Settings → **Default behaviours** (directors). The Ready for first real run screen lists the
behaviours as an informational block ("Default, change in settings" / "Not set" / "Changed and confirmed"), never blocking.

**Loan shortfall** (`loan.shortfall`, per loan type; default `SKIP_AND_CARRY`): applied in the person calculation after every other line (`run/loanShortfall.ts`, pure).
`STOP_RUN` → BLOCKING `LOAN_SHORTFALL` exception naming the loan; `SKIP_AND_CARRY` → no line, the instalment stays pending, WARNING naming the loan; `PARTIAL_AND_CARRY`
→ the line is what is left (whole paise, rounded down), WARNING; the finaliser cancels the original instalment and writes a consumed part and a pending carried part
due from the next run (the loan balance reads them). A loan never pushes net pay below zero. **Max total deduction percentage** (`loan.maxTotalDeductionPercent`):
Not set (no limit); when set (owner-entered with a source note, confirmed by a different director) the room for instalments is at most that share of gross less every
other deduction. Ordinary runs are unchanged when instalments fit (existing run and loan suites pass unchanged); the decisions are in the run's inputs fingerprint.

**Tests** (`loanShortfall.test.ts`, 8): property test (500 cases) against an exact-fraction model (order, each rule, zero floor, percentage, paise rounding); per-option
and zero-floor examples; routes refuse HR, Developer, employee; defaults labelled and informational on Ready; two real runs (August pays the loan out; September:
default skip with a warning naming the loan; STOP blocks submission; PARTIAL within a 90% limit recovers exactly the independent figure and finalising splits the
instalment, carry due 1 October, balance = principal − recovered); self-confirmation refused by the service and the database; history append-only.
**Mutants (9, all caught):** partial as skip; skip as partial; zero floor dropped; percentage ignored; room rounded up; STOP not blocking; wrong default; finaliser
consuming shortfall instalments whole; proposer confirming.

**Gate after item 4 (`df8306f`).** Full backend suite alone: **216 files, 2,034 tests, all passed.** CI run 285: all seven jobs green.

## Item 5 (D-37): leave accrual in the month of leaving (written 2026-11-11)

`leave.leavingMonthAccrual` (default `PRO_RATA_DAYS_WORKED`, "Default, change in settings"): NONE / FULL_MONTH / PRO_RATA_DAYS_WORKED / FULL_IF_MIN_DAYS with N (no
default N; a proposal without N is refused). Applied by the leave recalculation for the month containing the last working day (Workforce → Leavers): the monthly job
has usually credited the month in full on the 1st, so a correction entry (`LEAVING_MONTH`, a reversal or a grant referencing the accrual) brings it to the target; the
accrual row is never edited; earlier corrections are counted, so applying again changes nothing. Pure rule in `leave/leavingMonth.ts`.
**Found and left Not set:** the leave policy has no rounding, so "the policy's rounding" cannot be read. Added `leave.proRataRounding` (Not set, a different director
confirms): an exact pro-rata (e.g. 15 of 30 days = 0.5) is applied; one that needs rounding (20 of 30) is listed as WAITING and nothing changes for that month.
The Leavers screen shows both new kinds of line.

**Tests** (`leave/__tests__/leavingMonth.test.ts`, 4): property test (600 cases) against exact fractions for every option and any days worked (incl. zero); zero
days, rounding when set, days worked from the 1st or the joining date, leap February; through the real leaver route: the default takes September from 1 to 0.5 with a
correction entry and is idempotent; NONE, FULL_MONTH, FULL_IF_MIN_DAYS under and exactly at N each move it to its own figure, each change confirmed by a different
director. A-10's leavers test updated (`CHANGED_TESTS.md`). **Mutants (8):** 7 caught (NONE giving full, N boundary, never waiting for rounding, days off by one,
joining date ignored, wrong default, earlier corrections ignored); 1 equivalent (the zero-days guard: zero is already exact), so the redundant line was removed.

**Gate after item 5 (`534aa71`).** Full backend suite alone: **217 files, 2,038 tests, all passed.**

## Item 6 (D-37): the Developer role and Employee Swipes (written 2026-11-11)

`access.developerSeesSwipes` (default off, "Default, change in settings"). Applied where access is resolved (`lib/permissions.ts`, the one place): a Developer's
`attendance.swipes.view` is removed unless the latest **confirmed** value of the switch is on; the menu, routes (list, options, export) and socket rooms follow.
Previously the Developer reached Employee Swipes (flagged in the last report). **Tests** (`behaviours/__tests__/developerSwipes.test.ts`, 3): Developer-403 by default
on the list and the export, resolved access without the key, HR unaffected; the Developer and HR cannot propose; a proposal alone changes nothing; on after a
different director confirms (200), off again (403). Developer-ceiling test updated (`CHANGED_TESTS.md`). **Mutants (3, all caught):** never stripped; an unconfirmed
proposal counting; any confirmed value turning it on.

**Final gate (`9ec926e`, 2026-11-11).** Full backend suite alone: **218 files, 2,041 tests, all passed.** CI per job — run 282 (`64b6e16`): six green, Test cancelled by
the next push; run 285 (`df8306f`): all seven green; run 286 (`534aa71`): success; run 287 (`9ec926e`): install-lint-typecheck-test (incl. Demo company tests),
docker-build, sensitive-ui admin, sensitive-ui employee, latency (incl. popovers), attendance-replay, agent-windows — **all green**.
Items 7: not started (A-1, A-2, A-4–A-8, Stages 6, 8, 9). `PARITY_COVERAGE.md` exists on no branch; `docs/samples/` exists on `origin/main` and
`origin/peeps/foundation`, not on this branch. STOPPED here as instructed.

## Demo pay history and the walk with real content (written 2026-11-11, session continuing Session A)

**Samples (step 1):** skipped on the owner's instruction — the files on `origin/main` look like real exports; nothing was brought to this branch, and the scratch
copies made while checking were deleted. Stage 8 stays blocked until the owner replaces them with synthetic files on `main`.

**Demo pay history (`64d3246`):** see `DEMO_PAY_ACTIVITY.md`. Demo tests: 7 passed (incl. the demo's own run, unchanged counts).

**Walk with content:** a scratch local database (`wellsure_walk`, created new; nothing reset) seeded with the dev seed, the demo company and its pay history.
15 screens (the 12 from the first walk plus Default behaviours, Leavers and Ready for First Run) × 5 people (director DEMO001, HR Admin DEMO004, manager DEMO003 — given
the role in the scratch database only —, employee DEMO006 with a loan and a claim, Developer DEMO005) × desktop 1280 light, phone 390 dark, tablet 768 light =
**225 visits**, each with a fresh sign-in. Filled tables seen: loans 6, off-cycle 5 (candidates and the finished run), settlements 2, challans/reconciliation 12, loan and
claim types 3, quarterly data 41, leavers 2; the employee's YTD 8, salary revision 3, loans 6. No crash, no server error, no page-level sideways scroll, no bank, PAN,
UAN or debit-account text on any page. HR, the manager, the employee and the Developer see "not switched on" on every directors' screen (HR's Leavers and the
Developer's Ready for First Run are by design).

**Keyboard only:** 10 primary actions at 1280 and 390, plus the phone menu: each reached by Tab, focus ring visible, Enter opens the dialog, Tab and Shift+Tab stay
inside it, Escape closes it, focus returns to the button — **21 of 21**.

**Fixed (changed tests, none weakened):**
1. Focus left an open drawer, modal or the phone menu after its last control (reached the skip link and logo behind the overlay): `ui/focusTrap.ts` (Tab wraps
   inside), used by SideDrawer, ConfirmModal and the phone menu; the menu returns focus to its button on close. Unit tests added (and a mutant that disables the trap
   fails two of them).
2. A long claim description widened the table and pushed Approve / Reject off-screen: free-text columns get a width and wrap (`ui/textStyles.ts`); action columns
   (Reimbursements, Off-cycle runs, Loan and claim types, the employee's Withdraw) are pinned to the right edge; Quarterly data pins the employee column.
3. A long state chip pushed a phone card sideways: chips wrap on phones (`theme/global.css`).
4. The employee's Reimbursement table hid the state behind the description at tablet width: State moved before "What for".
5. Quarterly TDS data opened on last year's first quarter (always empty): it opens on the last quarter that has ended (`lib/quarter.ts`, unit-tested).
6. Every sanctioned loan read "SANCTIONED": loans now show where recovery stands — recovering, recovery stopped, fully recovered, recovered at exit, or paid with the
   next run (`recoveryOf` in `loans/service.ts`, unit-tested; asserted on the demo loans).

**Still seen, accepted:** at 768 the Reimbursements queue's state chip sits under the pinned action column and is reached by scrolling inside the table.

## Step 4: end to end — a settlement recovers a loan through an off-cycle run (written 2026-11-11)

`offCycleLoanE2E.test.ts` (4 tests), real API and database: a loan of 30,000 (three instalments) paid out and its first instalment recovered by the August run;
recovery stopped by a two-director change (balance 20,000, state "Recovery stopped"); a settlement lists `LOAN_OWED −20,000` from the loan (plus a 30,000 notice line);
a second director's double click on the confirmation decides once (200 + 409); a double click on Prepare makes one run (201 + 409 `ALREADY_PREPARED`); approval asked twice
→ 409; a double click on Approve and on Finalise each act once; a later retry → 409; exactly one finalisation and one exit recovery of 20,000; the loan reads balance 0,
"Recovered at exit", payroll-recovered 10,000; the instalment ledger is one CONSUMED and two CANCELLED, nothing pending; preparing the same settlement again →
`ALREADY_PAID`; the bank file is written once on a double click (201 + 409) for 10,000, downloaded, and marked sent once on a double click (200 + 409); the September run
recalculated afterwards gives the other employee **exactly** the same gross, deductions, net, status and every line, and the leaver no loan line.

**Found and fixed:** (1) two simultaneous "Mark sent to the bank" clicks gave a 500 (the database kept one mark, the second error was not caught) — now 409 for every
kind of bank file; (2) a double click on Prepare made two off-cycle runs for the same source (only one could ever be paid, but the other stayed as a stray draft) —
prepare now refuses while a run for that source is open, serialised by an advisory lock. The P7-6b test that prepared a twin through the API now proves the guard and
writes its twin straight into the database to keep proving that the finalisation keys refuse a second payment. **Mutants (3, all caught):** open-run guard dropped; lock
dropped (race); sent-mark race not caught.

**Browser check** (walk database, every button double-clicked, as DEMO001 and DEMO013): held pay for DEMO009 and for DEMO012 each prepared, approved, finalised, bank
file approved, written, downloaded and marked sent through the Off-cycle runs screen; read back: one run (after the fix), one finalisation, one release, one bank batch,
one sent mark each; DEMO008's loan shows "Recovered at exit" ₹0 and its settlement PAID.

## Step 5: the new readers and the off-cycle road at 500 people (written 2026-11-11)

A fresh scratch database (`wellsure_scale`: migrations, dev seed, demo company with its pay history), then `npm run measure:payroll -- 500` and the new
`npm run measure:new-readers` (adds, all made up: 150 loans sanctioned by two directors, 200 claims with 100 approved, 30 leavers with confirmed settlements; then
the 500-person run recalculated and finalised through the API so the quarterly reader reads a real quarter).

**Budgets.** The project's recorded figures at 500 (`PHASE_6_REVIEW.md` §6) are 0.8 s for one full screen read and 0.7 s for the approval re-check, and its only stated
rule is "inside 2× the committed baseline" (Phase 2 Gate 2). So a reader's budget is **1.6 s** and each off-cycle step's **1.4 s**.

| Measured (development machine) | Time | Budget |
|---|---|---|
| Payroll: calculation job, 500 people (existing measure, today) | 3.6 s | (recorded 6.5 s) |
| Payroll: approval re-check / one full screen read | 0.4 s / 0.4 s | (recorded 0.7 / 0.8 s) |
| Full calculation in memory with 150 loan instalments due (D-37 shortfall rule per person) | 0.58 s | 1.6 s |
| Loans: directors' list (155 loans) | 0.30 s | 1.6 s |
| Reimbursements queue (206 claims) / Settlements list / Off-cycle candidates / Off-cycle runs | 0.02 / 0.04 / 0.05 / 0.02 s | 1.6 s |
| Quarterly TDS data (a finalised quarter, 498 people) / challan register | 0.04 / 0.01 s | 1.6 s |
| Leavers (HR) / Default behaviours / Ready for First Run (with behaviour rows) | 0.01 / 0.01 / 0.36 s | 1.6 s |
| Access resolution for the Developer (with the swipes switch), 100 calls | 0.33 s | 1.6 s |
| Off-cycle road for one settlement: prepare, ask, approve, finalise, ask bank, approve bank, write file | 0.02–0.05 s each | 1.4 s each |

**Nothing over budget; nothing changed for speed.** The loans list is the slowest reader (it reads each loan's state, a few queries per loan); at about 0.002 s a loan
it would reach its budget near 800 loans — noted, not changed. **Found:** `measure-new-readers` (like the demo seed before it) did not exit after printing, because
notices leave queue connections open; it now exits. The existing `measure:payroll` hung at its final payslip-PDF step in this container (no Chromium process started);
its timings above were printed before that step. That step was not investigated (outside this work).

**Final gate of the second pass (2026-11-12).** Full backend suite run alone on `31472a0` (all of this pass's code, with the M session's commits up to LC-14):
**221 files, 2,061 tests, all passed.** CI per job: my own runs 292, 293, 299 and 300 were cancelled by later pushes (two sessions pushed to this branch at once);
run 295 (`e31819d`, containing this pass's code to `c6af1ce`) succeeded; **run 307 on the branch head `b432395` (all of this pass's code and the M session's):
install-lint-typecheck-test (incl. Demo company tests), docker-build, sensitive-ui admin, sensitive-ui employee, latency (incl. popovers), attendance-replay,
agent-windows — all green.** Earlier run 288 (`7fbe89c`, docs only, same code as green run 287) failed only because its Test step hit the job's **18-minute limit**
(no test failed). **Risk:** in run 307 the Test step took 17 minutes against that 18-minute limit; as the suite grows, CI will start timing out. Not changed here
(a CI setting for the owners or the next session: raise the step limit or split the suite).

## Session A block, 2026-11-12 — CI shards, Stage 6 payroll reports, payroll rows of the parity audit

**CI time limit.** The backend suite now runs as four parallel shards (`backend-tests`, matrix 1–4, same 18-minute step limit — not raised); `backend-tests-complete`
fails if any shard failed, or if the shards' files and test counts do not add up to `vitest list` (`backend/scripts/check-test-shards.mjs`; checked locally that a missing
shard fails). Wall time: shard test steps 3:37, 4:16, 4:17 and 6:25 (run 309), 3:49–6:35 (run 326), against 17 minutes for the single step before; all shards done about
8 minutes after the run starts; the count check about 5 minutes more (listing the suite takes about 4).

**Stage 6 payroll reports** (`STAGE_6_PAYROLL_REPORTS.md`): ten reports for directors, finalised runs only, exact decimals; column choice; company layouts saved with
a reason (append-only, audited) and shown as "Default, change in settings" until then; .xlsx and .csv exports audited with format, filters, columns and row count only.
Tests: refusals for HR, manager, employee, Developer and no sign-in on every route; totals against independent sums in paise; variance % against exact fractions (500
runs); CSV formula guard; layout append-only. Mutants: cost, held people, department filter, variance base, CSV guard, export audit, chosen columns — caught; the
service's director check — equivalent (the database refuses payroll grants to non-directors).

**Parity rows** (`A_PARITY_ROWS.md`): ST-24/SS-05, PY-27/28/29 guide, ST-21, ST-03/ST-06, LC-07, PY-37, PY-24 (`9bbcc05`) and IE-09 (`c62a451`). Already covered:
LC-09, ST-23. Mutants: service length (+1 day), bank code grouping, unconfirmed deposits counted, maker confirming, employer share, unpaid person's Form 16, draft mark,
statement scoped to the person, export audit — 9 of 9 caught; import duplicate person, file with problems, grouping key — caught; the import's up-front group check —
survives (equivalent under the current ordering: the blocked group sorts first and fails before anything is written; the all-or-nothing test stays).

**Verification.** Changed tests, lint and typecheck on each commit; migrations applied to a fresh scratch database and matching the schema ("No difference detected").
Full backend suite run alone on `c62a451`: 239 files, 2,139 tests — 3 failed: (1) the current-row guard (Stage 6 read two history tables directly — fixed in `247096d`,
re-run green); (2) `customFields.test.ts` (the other session's) — passes run alone, order-dependent in the full run, not in my files; (3) `yearEndMoney.test.ts` "the audit
viewer" — fails alone too; it began after the other session's "Developer audit view" change (`ad5b3ca`) to the audit viewer; not in my files and not touched (sharing
rules). Browser walk on a scratch copy of the demo company: the eight changed admin payroll screens and two employee screens as director, HR, manager, employee and
Developer at 1280 light and 390 dark — 100 visits, no crash, no server error, no sideways scroll, no secret text; every directors' screen refused to the other four roles
(the Developer sees the existing Salary revisions frame with "You don't have access" and no data). Keyboard only: 10 of 10 primary actions (Columns, Enter a challan,
Import from a file, loan Changes, Prepare) reached by Tab with visible focus, opened by Enter, Tab kept inside, Escape closes, focus returns.

**CI per job (final).** The other session pushed about every ten minutes, so most runs were cancelled by the next push. Run 333 (`cbaee81`, which contains all of
this block's code, the `247096d` fix and the other session's `yearEndMoney` fix): backend-tests 1–4 green (test steps 4:40–7:00), backend-tests-complete green (the shards
add up to the suite, each test once), install-lint-typecheck-test, docker-build, latency, attendance-replay, agent-windows and sensitive-ui (employee) green;
sensitive-ui (admin) was cancelled by the next push at 15 minutes — it was green on run 326 (`c62a451`, every new screen; the one later code change, `247096d`, is a
backend read). Run 326 itself failed only on the two tests named above (one mine, fixed; one the other session's, fixed by them in `c536707`).

## Session A part 2, 2026-11-13 — mechanisms with every value Not set (ST-08, ST-30, ST-29, ST-25, PY-41)

Built under the new speed rule (commit as I go; checks once per group). Plan: `A_PARITY_ROWS.md` part 2. Commits `bd192ee`, `af76eb0`, `26d2f88`, `debd4ae`, `f6ea21c`,
group fixes `9c49d57`, `cdcba37`.

**Group check** (one script, stops at the first failed step): backend and frontend typecheck, lint and design tokens, migrations on a fresh database matching the
schema, the changed backend tests (9 files, 121 tests) and the frontend tests — all passed after fixing what the first pass found (guard allowlist entries for form
limits, the Part A file key in the cleanup storage list, three index names, one test's types). Frontend build within budget.
**Mutation checks:** day clamp, reminder window, reminder once a month, future rate ignored, below-minimum comparison, employer liability, Part A PDF check — caught;
the rounding sign survived at first and exposed a real gap: a negative net pay posted as a negative credit. Fixed (`cdcba37`: it posts as a debit) and the property
test now requires every side to be non-negative.
**Full backend suite alone** (once, end of stage): 246 files, 2,178 tests, 3 failed — all because I pulled the other session's AD-07/AD-08 commits (new migrations)
while the suite ran; the two files re-run on the current code: 66 of 66 passed.
**CI** (run 349, `2b084c6`, all of part 2's code): every job green except backend shard 3, which failed on the other session's `customFields.test.ts` ("mgr: expected
404 to be 403"), order-dependent (passes alone; also failed on its own commit's run 320); `backend-tests-complete` fails because of that shard.
**Requests from the other session:** 3 done (`PORTAL_READY_REPORT.md` §6); 4 (payslips showing the ID in force on their date), 5 (overtime pay), 6 (encashment during
the year) need owner values (rates, the formula, whether to store dated ciphertext); 7 (payroll per company) and 8 (statutory registers in official formats) are not
started.

## Session A part 3, 2026-11-13 — dated statutory IDs, overtime and encashment pay, payroll per company, statutory registers

Plan `A_PART3.md`. Commits: golden baseline (goldenRun.test.ts), A1 `edaf4f6`, A2/A3 `b2f0b32`, fixes `163bdfc`, `ff5bd98`; B1 `7f885c0`, B2 `6ebb4db`, B3 `0d6eb71`, `19ea770`;
walk fixes `bf9429b`.

**Golden regression.** A finalised run's figures and payslips were captured from the code before part 3 (`fixtures/golden-run.json`) and compared after every phase:
identical with the settings Not set, with approved overtime and an approved encashment request present, and with one company.
**Phase checks** (one script each, stopping at the first failure). Phase A found: an identifier missing on a date must be taken from the first later value (otherwise a
UAN entered late stops an older month's PF file — `releases.test.ts` caught it; no test changed); an exact-fraction test found overtime cut a recurring fraction before
rounding (now one division, last). Phase B found two guard allowlist entries (form limits). **Mutation checks:** dated copy choice, flat rate, divisor, exit leave types
(survived first: a test added), overtime switch, main-company filter, report company filter, register head prefix — all caught in the end.
**Full backend suite alone** (once, after the last pull, no pull while it ran): **251 files, 2,196 tests, all passed** (the other session's `customFields` fix included).
**CI** run 359 (`19ea770`, all part-3 backend code): all 12 jobs green, including `backend-tests-complete`. The walk fixes (`bf9429b`, frontend only) are read below.
**Browser walk** (scratch copy of the demo company): ten changed admin screens and Form 16 as director, HR, manager, employee and Developer at 1280 light and 390 dark —
110 visits, no crash, no server error, no secret text, every directors' screen refused to the other four. Found and fixed: phone cards did not carry their row actions on six
screens (the buttons could not be reached on a phone), and Company settings' buttons sat past the edge at 1280. Keyboard: 10 of 10 primary actions reached, opened, trapped,
closed by Escape, focus returned.
**Not built (next steps for payroll per company):** each company's own bank file and statutory files (refused for now), a period lock per company (finalising one company's
run locks the month's attendance for all, as before).
