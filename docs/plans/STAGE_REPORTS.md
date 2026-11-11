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
