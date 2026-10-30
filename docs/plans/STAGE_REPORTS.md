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

**Unverified.** Live browser walkthrough as director/HR/employee for the marker change beyond the automated scan (no sensitive data
involved; the marker is a label). The latency harness end to end. Flow-level same-person assertions under mutation (above).

**Waiting.** The WAITING ON list in `MASTER_CHECKLIST.md`, plus: whether a director may approve a run they prepared; whether a third Super Admin may
approve payroll; the missing `docs/samples/` files.

---

## Stage 1.1 — REPORT ONLY (no code): what HR holds in attendance, regularization, muster, leave, and where it is exposed

Read from `backend/src/lib/systemRoles.ts` (defaults), route files, services, `realtime/`, `modules/tasks`, `modules/admin/tasks.ts`,
`modules/reports`, the admin menu config. Not read in full: every email template and the search box (see "Not checked").

**A. What the two HR roles hold today (system-role defaults; a Super Admin can edit roles and per-user overrides)**

| Area | HR Executive | HR Admin only (adds to the above) |
|---|---|---|
| Attendance | `attendance.view`, `attendance.manual.enter`, `attendance.process`, `attendance.regularization.view`, `…approve`, `attendance.swipes.view` | `attendance.regularization.bulk`, `attendance.override.manage` (manual + shift override), `attendance.finalise`, `attendance.config.manage` (settings, shift roster), `attendance.devices.manage` |
| Leave | `leave.view`, `leave.approve`, `leave.grant`, `leave.apply.onBehalf` | `leave.policy.manage` (types, policies, holidays), `leave.recalculate`, `leave.yearend.manage` |
| Reports | `reports.view` | `reports.liability.view` |
| Not held | `attendance.unlock` (Super Admin only) | |

**B. Contradiction with the master prompt's HR hard-lock (found, not yet changed).** The prompt (A5) says salary, bank, PAN, UAN, Aadhaar,
ESI, statutory data, payroll and pay letters are never grantable to HR. In the repo today, **HR Admin still holds**: `payroll.rules.view`,
`payroll.salary.view`, `payroll.salary.edit`, `employee.bank.view/edit`, `employee.statutory.view/edit`, `documents.pay.view`,
`reports.liability.view`, `letters.generate`, `settings.manage`, `audit.view`, `role.view`, `delegation.manage`, `user.security.manage`,
`leave.yearend.manage`; HR Executive holds `letters.generate`, `role.view`. The approved plan `HR_PAYROLL_SEPARATION.md` (phases H1–H8) removes
most of these, but **none of H1–H8 is built** (only D1 is). So today the hard-lock is **not true in the code**. Stage 1.2 requires it to be
enforced in the permission resolver, so Stage 1.2 will build the resolver ceiling (H1's `HR_FORBIDDEN_KEYS`) and the matching system-role
defaults. I will **not** run a data-altering migration on existing role rows without asking (stop condition); the resolver strips the keys
whatever the rows say, so no data change is needed to be safe. One real tension for you to settle: the prompt lists bank/PAN/UAN/Aadhaar/ESI
as locked, while the approved plan (decision b, and your D1 answer Q-DA-2) lets HR **enter** a bank/statutory change as a masked, audited
request that a director confirms. I will follow the approved plan (HR enters, never confirms, never sees an unmasked value without the audited
reveal) and flag it as WAITING ON; say if you want HR to have no bank/statutory access at all.

**C. Where each is exposed, and what enforces it** (P = checks the permission key; R = role name only; none = nothing)

| Place | Enforcement today |
|---|---|
| Attendance API (`/api/attendance/*`: config, process, finalisation, muster, manual entry/upload, employee month/day, who-is-in, regularizations list/approve/reject/bulk, overrides, roster, shift overrides, exceptions, swipes + export) | **P**, every route has `requirePermission`; reads also narrowed by data scope (SELF/TEAM/ALL) in the service |
| Muster export (`GET /muster/export`), swipes export | P (same key as the view); swipes export audited |
| Leave API: types, holidays, grants, year-end, recalculate, dashboard | **P** at route (`leave.policy.manage`, `leave.grant`, `leave.yearend.manage`, `leave.recalculate`, `leave.view`) |
| Leave requests list/get/approve/reject/bulk/cancel, balances, ledger, calendar | **P in the service** (no route guard): `leave.view` / `leave.approve` / `leave.apply.onBehalf` checked per call, plus scope; a delegate is checked at each use |
| Reports API (`/api/reports`) | **P but too coarse:** one key `reports.view` for every report. The **attendance reports (late coming, excess hours, exceptions, attendance summary) are not checked against `attendance.view`**, and leave reports not against `leave.view`: switching those off would not hide them. Leave liability also needs `reports.liability.view` (checked in the service) |
| Dashboard counts / Tasks inbox (`admin/tasks.ts`, `tasks/service.ts`) | P: leave counts need `leave.approve`/`leave.view`; regularization counts need `attendance.regularization.approve` and non-SELF scope |
| Workforce Overview dashboard | P (`leave.view`, route) |
| Realtime | Rooms are **permission rooms** (`perm:<key>`) joined at connect and re-synced when a role or override changes (`emitPermissionsChanged` → `socketsLeave`/`socketsJoin`). **Finding:** `punch.received.batch` and `attendance.updated` go to everyone in `perm:attendance.view` regardless of data scope (employee id, time, device, location; no names) so a TEAM-scoped holder hears about other teams' punches. Existing, not caused by this work |
| Emails / notifications | Approver notifications re-check `leave.approve` / `attendance.regularization.approve` at send time (`requests.ts`, `regularization/service.ts`) |
| Access resolution | **No cache:** `resolveAccess` reads roles and overrides from the database on every request, so a change is effective on the next request |
| Admin menu / routes / page titles (frontend) | **R:** the whole admin portal is shown to anyone with an admin-tier role name (`ADMIN_TIER_ROLES`); **admin menu items carry no permission** (the employee menu has a `permission` field, the admin one does not; H7 in the plan). A page without permission loads and shows a 403 error state. Pages hide some buttons by key (`hasPermission`) |
| Employee profile tabs | Not found to be gated for attendance/leave; Attendance Info admin page relies on the API's 403 |
| Role-name checks in code (`HR_ADMIN` strings) | Only: login routing, 2FA role list, reporting-hierarchy top level, delegation message. **None grants or denies attendance/leave** |

**D. What Stage 1 will therefore need (stated, not yet built).** (1) Capability switch layer that turns specific keys on/off per role and per
named person with effective dating, evaluated inside `resolveAccess` (so every route, service check, socket room and task count follows with no per-place
change), with the hard-locked set stripped last. (2) Admin menu entries get a `permission` so switched-off items disappear, and the reports gallery/API
gets a per-report required key (attendance reports need `attendance.view`; leave reports `leave.view`). (3) The scope leak above is a separate finding; I will
fix it only if you want (it changes who hears about punches). (4) Re-routing of pending work when a switch goes off.

**Not checked / unverified.** Every email template; the global search box (it is built from the menu config, so it will follow the menu fix);
push/mobile channels (none seen); whether any non-attendance screen embeds attendance numbers (e.g. the employee profile header).

---

## Stage 1 — HR capability switches (commits `8142bdd` … `e3a40c3`)

Plan: `HR_CAPABILITIES.md`. 1.1 is the report above (no code).

**Built**
- 1.2a `bdda0c3` **The hard lock.** `HR_FORBIDDEN_KEYS` (every `payroll.*` key, `reports.salary.view`, `reports.liability.view`, `documents.pay.view`). Four layers, each proven alone: the resolver strips them from any HR holder who is not also a Super Admin; the Roles screen/service refuses them in words; database triggers refuse the rows; the HR defaults no longer hold them. A migration removed what existing HR roles held, copying each row first into the append-only `role_permission_removals`.
- 1.2b/c `279d54e` **Switches.** Eleven duties, per HR role or named person, reason required, optionally from a later time, append-only history (`hr_capability_switches`; database refuses a writer who is not a Super Admin, and any update/delete). Applied inside `resolveAccess` (no cache). Named person beats role; OFF beats ON between two roles; the hard-locked set is stripped last. Five keys split from older ones (muster upload, shift roster, exceptions queue, attendance reports, leave reports); roles and per-user grants were copied so nothing changed on the day. Screen: Admin Tools → What HR Can Do.
- 1.3 `3c9bf82` **Immediate everywhere.** Admin menu items carry `needs`; the sidebar, search and phone menu leave out what is off, a direct URL shows "This is not switched on for you". Task counts, inbox, `/me`, live Socket.IO rooms tested per place, both directions, for HR role, named person, employee, manager, director.
- 1.4 `5f60826` **Pending work.** When no HR person holds Approve leave / Approve regularizations, directors see a note and count (Admin Home, Tasks). Nothing is decided, moved or re-created; it returns to HR when the duty is back on.
- 1.5/1.6 `ba554e9` **Reports and the matrix.** Each report names its duty; the gallery lists only what may be opened and run/export refuse the rest on the server. The hard lock grew by `role.view`, `audit.view`, `settings.manage`, `delegation.manage` (second migration, rows copied first). Year-end encashment amounts: HR gets days only (screens, download, audit viewer). Shortcuts to pages a person can no longer open are hidden. Persona matrix test (15 doors × HR default, each duty off, named person, employee, manager, director) and a crawl of every GET route as HR with every duty on/off/as it is: no payroll or payslip route (except your own payslips) ever answers HR. `check:sensitive-ui` also scans the HR Admin with every duty on and off.
- `e3a40c3` fix: the first Stage 1.4 CI run failed the **bundle budget** (shell + home 410 and 428 KB against 400); `RequireAccess` was pulling the whole `ui` barrel into the first download. Now 320 and 342 KB.

**Tests / numbers.** Full backend suite run alone after the last backend change: **166 files, 1,611 tests, all passed**. New tests: `approvals` (6 subjects), `hrHardLock` (9), `hrCapabilities` (18), `immediacy` (8), `hrMatrix` (15), `reportsPermissions` (5), `yearEndMoney` (3), frontend `adminNav` (7). Frontend 53 tests, lint, typecheck, design tokens, bundle budget (after the fix) all pass. `check:sensitive-ui` locally: **451 pages, no secret, DEMO banner on every one**. `db:drift` clean. **Mutation checks, all caught by a named test:** resolver strip off; service refusal off; each of four hard-lock layers; switch precedence (person over role, OFF over ON); future-dated rows; hard-lock strip after switches; roster, upload and exceptions routes; director check; database director-only trigger; notify-on-change (the socket tests); reports permission, year-end money (three places); menu filter; Admin Tools keys in the resolver.

**Changed tests (old → new, why still meaningful).** HR Admin used to read rules, salary, the Payroll audit trail, leave liability, PAY documents, settings, the audit log, the roles list and workflow delegates; those assertions now expect 403 for HR and a director (or, for the audit viewer, a developer or plain employee given the audit viewer) does the work, so each test still proves the same rule for the people who may do it. Files: `payroll/access.test.ts`, `access/access.test.ts`, `directorAuthority.test.ts` (HR gets the HR ceiling message first; a plain employee still proves the payroll one), `documents/sensitivity.test.ts`, `letters.test.ts`, `reports.test.ts`, `regularization.test.ts`, `agentDevices.test.ts`, `health.test.ts`, `helpdesk.test.ts`, `delegations.test.ts`. Split keys: `exceptions.test.ts` and `manual.test.ts` grant the new key too; `config.test.ts` expects `attendance.exceptions.view` on Payroll Admin; `routeInventory.ts` lists the new routes.

**CI.** `bdda0c3` run: green except `latency`. The `5f60826` run: bundle budget failed (fixed by `e3a40c3`) and `latency` (known); `sensitive-ui`, attendance-replay, agent-windows, docker-build green. The `279d54e` and `3c9bf82` runs were cancelled by the next push (same tree as `5f60826`). The runs for `ba554e9` and `e3a40c3`: read at the Stage 2 close.

**Decided by me.**
1. HR keeps *entering* a masked bank/statutory change (the approved plan); the prompt's list says HR is locked from bank/statutory. Followed the plan; flagged.
2. The hard lock covers payroll, pay reports and documents, and four Admin Tools keys. **Not locked, listed as open:** `letters.generate` (HR can still issue letters, including ones with pay figures, until per-type grants exist), `user.security.manage`, `import.manage`, `leave.yearend.manage` (days only for HR now).
3. A switch for a person who is also a manager removes the key entirely (no provenance in the permission set).
4. Uploading the muster also needs Edit muster; the exceptions queue also needs View attendance.
5. "View leave" is not one of the eleven duties, so HR keeps seeing leave counts when Approve leave is off (WAITING ON: whether that should be switchable).
6. The payroll-month selector shows only to people with payroll permissions; the hand-typed branch names in the top-bar filter were removed (branches are data).
7. Delayed (future-dated) switches update sockets/menus by a delayed job; access itself is right at the moment (resolved on every request).
8. The admin menu's per-item `needs` was added for the Admin Tools items too (it was H7).

**Found and not changed.** (a) `punch.received.batch` / `attendance.updated` go to everyone in `perm:attendance.view` regardless of data scope (ids, times, device and branch; no names). (b) The real company's branch names appear in `backend/prisma/seed.ts`, several docs and the product spec (public repo): listed for the owner, no values repeated here, history not rewritten. (c) `GET /api/payroll/setup/access` was open to HR through `role.view`; now closed by the lock.

**Unverified.** The Stage 1.4 banner on Admin Home / Tasks was not exercised in a browser. Phone layout of What HR Can Do checked in dark mode only (no horizontal scroll). No live walkthrough as a *manager*. The frontend of favourites filtering has a unit test but was not clicked.

**Waiting.** Everything in `MASTER_CHECKLIST.md`, plus: whether HR may see leave/attendance counts when a duty is off; the four "not locked yet" keys above; whether a manager-and-HR person should keep manager-granted keys when an HR duty is off.


## Stage 2 — D2: payroll flows on director authority (+ D3 docs)

**Built**
- Every payroll step now follows the step's switch (`payroll.secondDirector`, default: the director acts alone and the other director is told; switched on: a different director decides, exactly as before): run approval/finalise/publish/bank file/unlock (`run/closing.ts`, `finaliser.ts`, `release.ts`), salary revisions, confirmation of rules/components/structures/layouts (`items.ts`, `approvals.ts`), and the setup sign-offs (`setup/signoffs.ts`; new `authority` column on `payroll_setup_signoffs`, migration `20261027090000`).
- The Ready-for-first-run rows now say "At least two active directors" and "Every director uses two-step sign-in" (no development exemption once 2FA is enforced); a self-confirmed value or sign-off recorded under director authority is not flagged.
- Every System Settings change made by a director tells the other director (area only, never a value); a non-director with `settings.manage` produces no notice.
- Screen copy no longer says "a different person" where a director may act alone; the run step toast says when it was done on the director's own authority. FIRST_REAL_PAYROLL_RUN.md and GETTING_STARTED.md state two-step sign-in for every director as a go-live condition with the steps.

**Tests.** Full backend suite run alone: 170 files, 1,632 tests, all passed. New: `runAuthority`, `confirmAuthority`, `revisionAuthority`, the sign-off authority case in `setupChecklist`, `settingsNotice`. Old tests that assumed the second-person rule now run with `useSecondDirectorChecks()` (the old behaviour is kept and still tested) and the authority behaviour is tested beside it. Frontend 53 tests, lint, typecheck, build and `check:bundle` (login 231.5 KB, shell+employee home 320.4 KB, shell+admin home 341.6 KB) pass. `check:sensitive-ui` (451 pages, no secret, DEMO banner on all) and `check:popovers` pass. `db:drift` clean on the dev database and on the freshly built test database.
**Mutation checks (each caught by a test).** Sign-off: entrant barred even on authority; switch ignored. Settings: no notice at all; notice for non-directors. (Run steps, confirmations and revisions were mutation-checked while built, in the same way.)

**Live check.** Against the running stack: the director sees the setup checklist with the new safety rows; HR and a plain employee get 403 on it. The sensitive-ui scan signs in as developer and employee.

**Decided by me.** (1) Settings notices go from the service layer after the audit entry, not inside one transaction with the change (the settings writers are not transactional). (2) The notice is raised only when the actor is a director. (3) Screen copy says "a director" rather than reading the switch per screen.

**Unverified.** No full browser walkthrough of authority mode as both directors this round (only API and scans). The demo seed still leaves the two directors off the demo payroll; putting them on it was not done. IDENTITY_DIRECTOR_ENTRY is not built (needs H2). CI for the earlier Stage 1 commits and this one is read after the push (see below).

**Commit.** `c179e7c`. CI: `829e5dd` (Stage 1 close) green except `latency` (the known failing job; every other job incl. sensitive-ui, tests, bundle budget, drift, docker, Windows agent passed). CI for `c179e7c` was still running when this was written.

**Waiting.** Whether a third Super Admin may approve payroll (until then, create none).


## Stage 3 — payroll model, capabilities only (commits `1ac7998` … 3.5)

**What was built, in order.** 3.0 the plan (`PAYROLL_MODEL_PLAN.md`). 3.1a pay-head options (kind, one-time, carry-forward, reimbursement, CTC group, YTD, bank transfer, payslip visibility, active dates, arrears and reversal links; taxable can be Not set; a head with a choice Not set cannot be used). 3.1b table-lookup lines, derived calculation order, input-item heads, heads retired not deleted. 3.2 no rule ships a value (the eleven PF/ESI figures are gone), new rules arrear-on-arrear, loss-of-pay look-back and override, per-head rounding. 3.3a arrear-on-arrear. 3.3b loss-of-pay reversal. 3.3c hold and release. 3.3d payslip "Why?". 3.4 rule hierarchy (company, department, person). 3.5 property, boundary and mutation tests.

**Verification, every step.** Full backend suite alone; lint; typecheck; frontend tests, build and bundle budgets; schema drift on a fresh database; mutation checks (each new rule broken in the source, the tests had to fail; every survivor was either closed with a new test or is named below as equivalent).

**Decided by me.** See "As built" in `PAYROLL_MODEL_PLAN.md`. In short: overrides are governed items of their own kind; judged on the cycle's last day; counters not built as names; monthly input is a head flag; holds pay the held net on release; the loss-of-pay correction is entered by a director.

**Equivalent mutants (no test can tell the difference).** `if (arrearOnArrear === null) continue;` in the revision plan (the blocker already stops it); the second condition of the release check in `holds.ts` (the status check catches the same cases).

**Found while testing.** The property tests found a real rounding defect in the reversal arithmetic (fixed in 3.5). CI failed twice for reasons outside this work: a Windows port range (`bind EACCES` on fixed test ports 55437–55452 in the agent driver test) and a timing guard on attendance recompute (46.9 s against a 46.1 s limit); both passed on the next run.

**Unverified.** Held pay in full-and-final (no settlement module). Statutory files split by registration (Stage 6). Counters and salary-master names as formula inputs (not built). The payslip "Why?" for a department/person override is tested at the rule level and in the run, not end to end through a published payslip.
