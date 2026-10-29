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
