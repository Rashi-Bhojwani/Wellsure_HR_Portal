# Peeps stage reports

This session's reports only (the other session's are in `STAGE_REPORTS.md`). No real data.

---

## P0 — Planning (2026-10-30)

**Git.** Working tree clean at start. `git fetch --all`. Base `origin/feat/hr-payroll-separation` tip `8979072`
("CI: a time limit on every job…"); latest base commits read: `8979072`, `1d3d899`, `c5448d5`, `171aab5`,
`dd236f5`, `4180402`, `828a06b`, `69b4bfb`, `c179e7c`, `829e5dd`. `origin/peeps/foundation` already existed,
equal to `main` (`c787e92`) with no commits of its own; resetting it would need a force-push, so the base was
**merged** into it (`2a4fad1`, clean). Extra content vs the base: `main`'s synthetic `docs/samples/*` and an
encoding-only `frontend/package.json` description line (PEEPS_PLAN §0.2, Q-F3).

**Built.** Nothing in the application. Docs only: `PEEPS_PLAN.md`, `PEEPS_CHECKLIST.md`, this file.

**Found.**
1. The integration guide is not in the repo or attached → section A is per topic, chapter numbers pending (Q0).
2. Super Admins hold every permission key in code → confidentiality "even from directors" must be relationship-gated (PEEPS_PLAN §0.3).
3. 2FA is mandatory for Super Admins in code and in payroll readiness; decision says optional for now → flagged, not mine (Q-X2).
4. Helpdesk queues (H3) designed but not built; split with the other session needed (Q-T1).
5. Placeholder/Confirmed exists only inside payroll → Peeps gets its own small store.
6. `peeps_` migration folders sort after every timestamped one (PEEPS_PLAN §0.8, §C.3).

**Checkpoint run (after merging the base).** Full backend suite run alone on `2a4fad1` against a local Postgres 16 /
Redis 7: **172 files, 1,651 tests, all passed** (about 17 minutes). Frontend checks were not run: this stage changes only
docs, and the merge brought no frontend change except the encoding-only `package.json` description line. Note for later
sessions: start `redis-server` outside the repo root, because the repo tracks a `dump.rdb` that a local Redis overwrites.

**Decided by me.** Merge instead of reset (no force-push); `frontend/src/features/<name>/` created as the
prompt says although existing screens use `pages/`; readings of "leave extension", "Unmute" and "insights"
(listed as questions Q-L1, Q-U1, Q-I1).

**Waiting.** PEEPS_PLAN §F. STOP here until you review.

---

## P0b — Owner's answers applied (2026-10-30)

**Git.** `git fetch --all`: the base moved `8979072 → 0fade2e` (`2bdaaf2` narrower HR keys: `letters.issue.nopay`,
`invitations.send`, `import.details.manage`; `74c1496` layout author cannot confirm; `0fade2e` bank files
.xlsx/.csv only). Merged into `peeps/foundation` at `0621f82` (clean).

**Integration guide.** The owner said it is in `docs/integration/`. It is **not** on any remote branch: I fetched
all of them and searched every branch's history for `docs/integration/` and for guide-like file names. Most likely
it was committed locally but not pushed. The chapter mapping (plan commit 2) stays blocked; nothing else waits on it.

**Plan changes (docs only).** An answers table at the top of `PEEPS_PLAN.md`; §B.3 rewritten (general desk,
visibility by category, Payroll category is Session A's); §B.4 rewritten (four new leave types, HR prepares /
director approves, HR-only supporting documents checked as HR role plus key because Super Admins hold every key,
Annual Leave = PL, new types left out of year-end until their rule is approved); §B.9 rewritten (Unmute: scheduling
and completion only, participants only, no notes or topic); §B.10 rewritten (four metrics, definitions Not set,
small-group minimum); §B.0.4 (switch keys in a PEEPS block only); HR enters bank/identity details at joining through
the existing writers; relieving/experience letters through `letters.issue.nopay` when pay-free; remote attendance
added to Session A's list; §A, §C, §D, §F, §G updated to match.

**Checkpoint run.** Full backend suite run alone on `0621f82`: **175 files, 1,691 tests, all passed** (about 16 minutes). Docs-only change otherwise; frontend checks not run.

**Decided by me.** (1) Existing helpdesk categories get no visibility row on migration, so today's behaviour holds
until an owner sets one (no preset). (2) The team-calendar label for the new types defaults to a generic "Leave"
until set. (3) Extending an approved leave is dropped (not in the answer).

**Waiting.** The guide push; the first build prompt.

---

## Module 1 — Assets (2026-10-30)

Plan: `PEEPS_PLAN.md` §B.2 plus the answers table; guide chapter 14 / §12. Built exactly the owner's brief for this stage; no other module started.

### Commits
| Commit | What |
|---|---|
| `51de81a` | Backend: schema, migration `peeps_20261031090000_assets`, settings (Placeholder/Confirmed), register, assignment history, tests |
| `3423856` | Merge of `origin/peeps/foundation` (the owner pushed the integration guide there, `ca6e485`) |
| `d7fa323` | Docs only: the guide's 19 chapters mapped in `PEEPS_PLAN.md` §A.1 (the guide arrived on this branch mid-module) |
| `1a244e2` | Screens, `GET /api/assets/lists`, DEMO data, `check:sensitive-ui` / `check:popovers` extended; enum value `TRANSFERRED` → `REASSIGNED` (migration `peeps_20261031100000_assets_reassigned`) |
| `0020130` | Merge of the latest `feat/hr-payroll-separation` (`093de72`), clean |
| (this commit) | This report and the checklist |

### What was built
- **Register.** Stable asset ID `AST-000123` (a sequence number, never reused), name, category, status, serial, model, notes. Edits are allowed and
  logged; a register entry is never deleted (trigger).
- **Settings, Not set until chosen.** Categories, statuses (each says whether an asset in it can be issued) and conditions are append-only versions:
  HR Admin (`assets.settings.manage`) enters a list, a **director who did not enter it** confirms it (service check + database trigger refusing the
  enterer and any non-director). Only confirmed lists are used; until all three are confirmed every write refuses with `ASSETS_NOT_SET_UP` and the
  screens say what is missing. A new version cannot drop a code an asset still uses. Nothing is preloaded; the demo company carries DEMO lists.
- **Actions.** Issue, return, transfer (one transaction: close + open), report lost (ends the assignment, needs a status that cannot be issued),
  record damage (holder keeps it), acknowledge receipt (holder only, once). Each writes an append-only `asset_events` row **and** an `audit_logs` row
  in the same transaction and notifies the holder (bell + `user:{id}` socket; both holders on a transfer). Register screens refresh on a signal-only
  `assets.changed` event to `perm:assets.view`.
- **One open assignment per asset.** Partial unique index `asset_assignments_one_open` + `SELECT … FOR UPDATE` on the asset row. Assignment rows are
  append-only except closing once and acknowledging once (trigger); `asset_assignments` joins `UPDATABLE_APPEND_ONLY_TABLES` in the database-roles step.
- **Who sees what.** Employee: own assets only (`/api/assets/mine`), acknowledges receipt. HR Executive: register read/manage (`assets.view`,
  `assets.manage`). HR Admin: also prepares settings. Directors: everything, and confirm settings. Managers, plain employees, Developer: 403 on every
  register/settings route. A viewer whose data scope is not ALL sees only assets held by people in scope; others are absent (404) and never named.
- **Lost/damaged: event only.** No amount column anywhere, no deduction, no payroll hook (a request carrying `amount` is refused by the strict schema).
- **Screens** (`frontend/src/features/assets/`, all `lazyPage`): Employee → My Assets; Assets Management → Asset Register (filters, detail drawer
  with assignments and history timeline, action drawers) and Asset Settings (enter/confirm). Design-system components only; checked in light, dark,
  1280 and 390 (screenshots taken locally, not committed). Board: no asset frames → styled by system.

### Tests (all new files in `backend/src/modules/assets/__tests__/`)
- `assets.test.ts` (22): settings gate and maker-checker (service and database), every route × employee / manager / Developer (403) and HR
  Executive / HR Admin / director, unauthenticated 401, employee cannot read or acknowledge another's asset (403/404) and `/mine` never lists it,
  issue/acknowledge/return/transfer/lost/damaged, **twenty concurrent issues → exactly one 200 and nineteen 409**, the index alone refusing a second
  open row with the service bypassed, concurrent transfer + return, **idempotent return** (sequential and two concurrent repeats: one event, no new
  audit row), **audit completeness** (every event kind has exactly one matching audit row with an actor, for a nine-action history), append-only
  triggers, TEAM-scope viewer.
- `assetsDbRoles.test.ts` (4): the app role's privileges on the five asset tables.
- **Mutation checks** (one guard broken at a time, asset tests re-run, files restored from backups):
  M1 index removed → "the database alone refuses a second open assignment" fails; M2 row lock removed → all pass (the index alone holds: by design);
  M3 both removed → also "twenty concurrent issues" fails; M4 idempotent-return branch removed → "return is idempotent" fails; M5 audit write
  removed → "audit log, one for one" fails; M6 scope filter removed → TEAM-scope test fails; M7a same-person check (service) removed → confirm test
  fails; M7b same-person trigger removed → database test fails; M8 director check (service) removed → confirm test fails (after adding a case where
  a non-director who did not enter the version tries; the first run of M8 passed for the wrong reason, which is why that case exists); M9 readiness
  gate removed → "refuses to take an asset" fails; M10 holder notification removed → three action tests fail; M11 assignment trigger removed →
  append-only test fails.
- **Full backend suite, run alone**, after merging the latest base (`093de72`): **178 files, 1,737 tests, all passed** (about 18 minutes).
- Frontend after the merge: lint + design tokens, typecheck, 56 tests, build, `check:bundle` (login 231.8 KB, shell + employee home 331.2 KB,
  shell + admin home 352.3 KB) — all pass.
- Browser checks, locally against the dev stack + demo company (before the final merge): `check:popovers` passes (light/dark × 390/1280, including
  the new asset checks); `check:sensitive-ui` passes — **476 pages, no secret, DEMO banner on every one**, including the new asset assertions.

### CI
- `d7fa323` (backend commit included): every job green except `install-lint-typecheck-test`, which failed one test:
  `payroll/__tests__/payrollGuards.test.ts` — the payroll guard forbids the word `TRANSFERRED` anywhere in `schema.prisma` (it would read as
  "money was sent"); my two asset enums used it. Fixed in `1a244e2` by renaming the stored value to `REASSIGNED` through a follow-up migration
  (no edit to an already-pushed migration; the screens still say "Transferred"). The guard test is Session A's and was not touched.
- `1a244e2`: run cancelled by the next push (same tree plus the merge and docs). `e929962` (everything in this module, merged with the latest base): **CI run 206 green on every job**, including tests, demo company tests, schema drift, sensitive-ui, popovers/latency, docker build, attendance replay and Windows agent.

### Shared files touched (all inside `PEEPS-BEGIN assets … PEEPS-END`)
`backend/prisma/schema.prisma` (back-relation as the last field of `Employee`; models/enums at the end of the file — `prisma format` re-aligned
five lines of `PayrollSetupSignoff`, which I put back by hand), `shared/constants/permissions.ts` (three keys, catalog entries, group "Assets"),
`shared/constants/sensitiveData.ts` (`REVIEWED_NOT_SENSITIVE`), `backend/src/lib/systemRoles.ts` (HR Executive: view+manage; HR Admin: + settings),
`backend/src/lib/dbRoles.ts` (`UPDATABLE_APPEND_ONLY_TABLES` — the one-line array had to be opened into lines to add the block),
`backend/src/lib/__tests__/dbRoles.test.ts` (its pinned list of updatable append-only tables now includes `asset_assignments`),
`backend/src/lib/__tests__/cleanup.ts` (standalone roots, purge-guarded models), `backend/src/app.ts` (import + mount),
`backend/src/modules/managers/__tests__/routeInventory.ts` (17 routes), `backend/scripts/demo/seedDemoCompany.ts` (one call),
`frontend/src/routes/employeeMenu.config.tsx` (My Assets), `frontend/src/routes/adminMenu.config.tsx` (the Phase 8 "Assets Management" placeholder
is filled in by a block at the end of the file, so its original lines stay untouched), `frontend/e2e/sensitive-ui.mjs`, `frontend/e2e/popovers.mjs`.
Migrations: `peeps_20261031090000_assets`, `peeps_20261031100000_assets_reassigned` (new tables only; no table of Session A altered).

### Decided by me
1. Statuses carry an "issuable" flag (the guide's available/assigned/repair/lost/retired are examples, not presets); "assigned" is derived from the
   open assignment, not a status.
2. Lost ends the open assignment; damaged does not (the holder still has it until it is returned).
3. Confirming a setting needs no key: the confirmer must be an active Super Admin and not the enterer (service + trigger). HR Admin prepares.
4. Self routes (`/mine`, acknowledge) are gated by sign-in and SELF scope, not a key, like every other self route; so the Developer gets 200 with
   **their own** (empty) list there, not 403. Every register and settings route is 403 for the Developer.
5. No HR switch for assets yet: the switches table's CHECK constraint lists the allowed capability names, so adding one means altering Session A's
   table — left for Session A (see interface notes).
6. Serial numbers are plain text (not field-encrypted): equipment identifiers, not personal data.

### Interface notes for Session A (payroll) — recovery of lost or damaged assets (not built)
The guide (§12) says: HR proposes a recovery, a director approves, authorised payroll staff process it; approval binds incident, amount and reason;
exactly one payroll/F&F adjustment per recovery; approval is not settlement. Under the owners' decisions HR never enters an amount. Proposed split:
- **What Peeps provides (read-only, no money):** the incident = an `asset_events` row of kind `LOST` or `DAMAGED`: `id` (stable, append-only),
  `assetId`, `assignmentId`, `employeeId` (the holder at the time), `conditionCode`, `statusCode`, `note`, `actorUserId`, `at`. I can add a read
  function `listAssetIncidents({ employeeId?, since? })` in `backend/src/modules/assets/` for Session A to import, plus "does this person hold any
  open assignment" for F&F/exit clearance.
- **What Session A would own (money):** a table such as `payroll_asset_recoveries` with a **unique** foreign key to `asset_events.id` (one recovery
  per incident), amount (exact decimal), reason, proposer, director approval (second-director per the owners' choice), and the reference of the one
  adjustment that consumed it — so a retry can never deduct twice. Changing amount/reason after approval voids it.
- **What Peeps would show back:** for the HR exit checklist only "recovery: none / proposed / approved / settled" — never the amount.
- **HR switch:** if Session A wants "Manage assets" as a director-controlled HR duty, it needs `MANAGE_ASSETS` added to the switches table's
  capability CHECK constraint (Session A's migration) and to `HR_CAPABILITIES` (I can add the list entry in a PEEPS block once the constraint allows it).

### Not done / follow-ups (guide items outside this brief)
A missing or disputed acknowledgement creating an HR task (needs a source in the shared tasks inbox); IMEI/SIM identifiers beyond the serial;
spreadsheet import of assets and current allocations; an Assets tab on the employee profile (`GET /api/assets/employees/:employeeId` exists for it);
the recovery workflow above.

---

## Scope change D-28 / D-29 and Pair 1 — STOPPED at the framework check (2026-10-30)

**Why I stopped.** The prompt says: add the Founder's Office role and its switches only inside PEEPS blocks, do not change the switch framework,
and "if the framework cannot take them additively, STOP and report". It cannot. Nothing in Pair 1 was built, and Step 0's Assets changes were not
made either, because they depend on the new role (the Founder's Office manages the register). No application code changed in this stage.

### Step 0, part 1: the Assets results (done before this prompt, re-checked)
- Full backend suite run alone after merging `093de72`: **178 files, 1,737 tests, all passed** (recorded in `923a0de`).
- CI run 206 on `e929962`: green on every job (recorded in `923a0de`). `923a0de` itself is docs only.
- The base has moved since (`76b4da2`, `d875811`: Session A's Stage 3.1b/3.2). Not merged in this stage, because nothing was built; the next build stage
  merges it first.

### What the switch framework can and cannot take (facts from the code at `923a0de`, identical to the base)
| Place | What it does | Why a Founder's Office switch does not fit additively |
|---|---|---|
| `backend/src/lib/permissions.ts` `resolveAccess` | Calls `applyCapabilities(…)` **only inside the branch for people holding `HR_ADMIN`/`HR_EXECUTIVE`** | A Founder's Office holder who is not HR never reaches the call, so no switch would ever apply to them. Making it apply means editing the resolver. |
| `backend/src/lib/hrCapabilities.ts` `switchRowsFor` | Returns `[]` (no query) for anyone without an HR role | Same: Founder's Office rows would never be read. |
| `backend/src/lib/hrCapabilities.ts` `capabilityState` / `applyCapabilities` | Role-level rows only count for HR roles; **every** entry of `HR_CAPABILITIES` is applied to **every** HR holder | Adding Founder's Office entries to `HR_CAPABILITIES` (the only additive spot) would make them HR duties too: they would appear on "What HR Can Do" and switching them ON would give HR the Founder's Office keys. |
| `hr_capability_switches` table (Session A's migrations) | CHECK constraints: `subject_key IN ('HR_ADMIN','HR_EXECUTIVE')` for role rows, and a fixed list of capability names | A Founder's Office capability or role row is refused by the database. Changing the constraints alters a table Session A owns. |
| `modules/hrCapabilities/validators.ts`, `service.ts` | `roleCode: z.enum(["HR_ADMIN","HR_EXECUTIVE"])`; holders listed are HR role holders | The API and screen cannot address the Founder's Office. |

### Options for the owners (my recommendation first; nothing chosen)
1. **(Recommended) A Peeps-owned switch store for the Founder's Office, applied through per-person permission overrides.** New append-only
   table `founders_office_switches` in my module (capability, state, effective-from, reason, director, confirming director), a "What the Founder's
   Office can do" screen for directors, and an applier that writes/removes ordinary `user_permission_overrides` (GRANT/REVOKE) for the appointed
   person — which `resolveAccess` already honours. No change to the resolver, the HR framework, its table or its screen. Costs: a future-dated
   switch or appointment needs a small scheduled job to apply it at its time; the overrides are visible on the Roles & Permissions screen (I would
   mark their reason "set by Founder's Office switch" and a test would detect drift); re-appointment moves the overrides from the old person to
   the new one in one transaction.
2. **Session A generalises their framework** (role rows for `FOUNDERS_OFFICE`, a second capability list applied to Founder's Office holders,
   the CHECK constraints and validators widened). Cleanest single mechanism; the work and the files are Session A's.
3. **One additive hook in `resolveAccess`** (a PEEPS block calling a Peeps applier for Founder's Office holders). Small, but it edits the one
   place access is computed, which I listed as "not mine by caution"; needs your explicit permission.
4. **Service-level checks only** (the role holds the Peeps keys; each Peeps service reads the switch table before acting). No shared change, but
   menus, sockets and search would not follow a switch automatically the way they do for HR.

### Proposed Assets changes for D-28 / D-29 (Step 0, to build once the role exists)
| Today (built) | Proposed |
|---|---|
| HR Executive and HR Admin hold `assets.view` + `assets.manage` (role defaults + migration) | Register managed by the **Founder's Office and the directors**: the keys move to the `FOUNDERS_OFFICE` role (switchable per the chosen option); a forward `peeps_` migration removes them from the HR roles (directors keep everything as Super Admins). |
| HR issues to anyone in scope | HR may **only issue to new joiners during onboarding**, behind a director switch (Q-14): new key `assets.onboarding.issue`, accepted only for an employee who is "in onboarding". That state does not exist until the onboarding module; until then "new joiner" is a setting (for example: joined on or after a date window) that is **Not set**, so HR issuing refuses. HR never sees the register. |
| HR Admin prepares setting lists; a director confirms | The Founder's Office (or a director) prepares; a director who did not prepare confirms. |
| Employees see their own assets | Unchanged. |
| Directors see everything (Super Admin holds every key, ALL scope) | Unchanged in code; **add an explicit test**: a director sees every asset, its full history and any employee's assignments, including ones held by HR people and by the Founder's Office person. |
| Audience fixed in code | `peeps.audience.assets` becomes a director-controlled setting (who manages, who may issue at onboarding), per D-29. |

### Owner questions recorded (to build as recommended, each a setting)
Q-14 asset register (Founder's Office + directors manage; HR issues to new joiners at onboarding only, director switch) · Q-15 new leave types not
this round · Q-16 badge/nudge givers: managers, Founder's Office, directors; not HR · Q-17 Founder's Office appointed by the directors, no pay access.

### What I need to continue
A choice among options 1–4 (or another). With option 1, I can build Step 0 and Pair 1 without touching any file outside PEEPS blocks.
With option 2, Pair 1 waits for Session A's framework change.

---

## Stage: Wellsure Office workspace + Unmute, then badges + private nudges (D-28, D-29, D-30) — 2026-10-31

Built as the prompt asked, using option 1 (a Peeps-owned membership table applied as per-person grants). No change to Session A's HR switch framework,
access resolver, HR switch table or HR screens. No other module started.

### Commits
| Commit | What |
|---|---|
| `9686c8e`, `75fb655` | Step 0.1: merged the latest `feat/hr-payroll-separation` (schema conflict at the end of the file: both sides' models kept, Session A's first, my PEEPS blocks last) and the owner's `docs/samples` commit on `peeps/foundation` |
| `45626da` | Backend: workspace membership, Peeps settings, access gates, scheduled job; Unmute; Assets under D-29/Q-14 (Step 0.2); migrations `peeps_20261031120000_office_unmute`, `peeps_20261031121000_assets_office` |
| `2c94b6f` | Module 1 screens (Unmute, Members, Peeps settings, Unmute hosting, Unmute bookings), HR's Issue to a New Joiner screen, DEMO workspace data, popovers check |
| `6de8b08` | Module 2: badges and private nudges (backend, migration `peeps_20261031130000_badges_nudges`, screens, DEMO data, sensitive-ui check); every workspace screen gated; Unmute times in IST |
| `1dc28af` | Merge of the latest `feat/hr-payroll-separation` (`1647597`), same schema resolution |
| (this commit) | Report, checklist, plan |

Step 0.2 (Assets) shipped in the same backend commit as Module 1, because the register's new gate *is* the workspace membership; one commit group per
module otherwise. Shared files carrying both modules' blocks (menus, sensitive-ui, demo seed, app.ts, cleanup, route inventory, schema) went in with Module 2.

### What was built
**Peeps settings (D-29).** Append-only versions in `peeps_setting_versions`; a value is used only after a director who did not enter it confirms it
(service + trigger `peeps_setting_confirmations_checker`). Audiences, the workspace name and revocation rules are entered by directors; working values
(Unmute times, badge catalogue and limits) may also be prepared by a member with "Prepare Peeps settings". Typed and validated per key (inverted windows,
negative limits, unknown givers refused). Screen: Wellsure Office → Peeps settings.

**Wellsure Office workspace (D-30).** Membership is a series of append-only changes (APPOINT, UPDATE, REMOVE, REPLACE) in `office_membership_changes`:
proposed by a director, confirmed by a different director (service + triggers), applied at once if due or by the scheduled job `peeps-office-apply`
(every minute, registered from `modes/scheduler.ts`, worked from `modes/worker.ts`). Applying writes or removes ordinary per-person grants labelled
"Wellsure Office membership (managed on the Office members screen; do not change here)" — that label is what the Roles & Permissions screen shows on each
grant — and REPLACE moves a member's capabilities and grants to another person in one transaction. `officeGrantDrift()` reports grants that no longer match
(removed by hand, revoked by hand, or an office key granted to a non-member); the Members screen shows a banner when there is drift. Capabilities a director
toggles per member: Manage the asset register, Prepare Peeps settings, Give badges, Send private nudges. Every office route checks the membership itself on
each request (`requireOffice` / `requireDirector`, tagged with their key for the route inventory), so a grant made by hand opens nothing. Every workspace
screen shows only "You don't have access" to anyone else. Employees see the host or giver as "Wellsure Office" (the setting `office.name` may rename it);
the named person is in the audit log only.

**Unmute.** Hosts are members a director authorises (`unmute_host_authorisations`, append-only); nobody is a host by default. Hosts offer times inside
the availability window; employees (HR included) book a free time; stored: booker, host, slot, the booker's timezone, booked/cancelled/rescheduled/
completed timestamps and the status — no topic, notes, summary, transcript or recording (a schema test pins the columns). No double booking: one open slot
per host and start time and one live booking per slot (partial unique indexes) plus a slot row lock. Cancel and reschedule are explicit (reschedule marks
the old booking RESCHEDULED and books the new time in one transaction). Removing a host (or the host leaving the workspace) stops new bookings at once,
withdraws their free times and lists their booked conversations under "Bookings to handle" for the directors to reassign to another host's free time or
cancel. Visible to the booker, the host and the directors; each booking a director opens that is not theirs writes an audit entry. Notifications say only
"Something is waiting for you"; no emails are sent; nothing in HR lists, manager tasks, counts, search, exports or socket rooms. Refuses to activate until
session length, availability window, booking window, booking notice, cancellation notice and the audience are confirmed.

**Assets (Step 0.2, Q-14).** Managed by the directors and members with "Manage the asset register" while `audience.assets.officeManages` is on; a forward
migration removed `assets.view`, `assets.manage` and `assets.settings.manage` from the HR roles; HR keeps only `assets.onboarding.issue`: list free issuable
assets (no holders, no history) and issue to a new joiner, refused until `audience.assets.hrOnboardingIssue` is on and `assets.newJoinerWindowDays` is
set. Settings lists are prepared by a member or a director and confirmed by a different director. Employees see only their own assets. A test proves a
director sees every asset, its history and every employee's assignments.

**Badges.** `badge_awards` (append-only) with revocations as rows; catalogue, givers (Q-16), monthly limit, duration, revocation and display are settings.
Givers: the directors; members with "Give badges" while the setting lists the Wellsure Office; managers, to their own team, while it lists managers; never
HR. Idempotent on the giver's key (also under a race). Shown to the recipient; on the directory profile only while `badges.display.profile` is on.

**Private nudges.** `private_nudges` with field-encrypted text (registered in `ENCRYPTED_COLUMNS`), reads and withdrawals as rows. Senders follow the
same rules as badge givers (their own setting). Readable by the sender, the recipient and the directors (each director open audited). The audit row holds
ids only; the notification is the generic one; nothing in feed, search, task lists, counts, dashboards, exports or socket rooms (tested, including a
captured socket emitter).

### Tests
New or rewritten Peeps test files: `peeps/__tests__/office.test.ts` (9), `unmute/__tests__/unmute.test.ts` (16), `assets/__tests__/assets.test.ts` (26,
rewritten for the new audiences), `recognition/__tests__/recognition.test.ts` (14), plus `assetsDbRoles.test.ts` (4, unchanged). Covered as asked:
double-booking race (10 bookers, one wins) and the database alone refusing a second live booking; permission matrix for employee, HR, manager, non-member,
member, host and director on every office route; host removal path; director-open audit entries; employee cannot see or act on others' bookings or nudges;
Developer refused on every office route; badges/nudges matrix by sender, recipient, manager, HR (including an HR person with a team), member and director;
leak tests across feed, directory search, tasks, counts, dashboard, notifications, request hub, employee export, audit rows and socket events; idempotent
issue; a member holds no sensitive key and every route gated by a pay/bank/statutory key refuses them, as do the bank and statutory reveal routes.

**Full backend suite run alone after the final merge** (`162f03f`, Session A's `832947f` merged; schema conflict at the end of the file resolved by
keeping both: Session A's `PayslipLink`, then the Peeps blocks; migrations applied, `db:drift` clean): **195 files, 1,951 tests, all passed** (about
20 minutes). Before that merge, on `1dc28af`: 194 files, 1,946 tests, all passed (about 21 minutes).

Frontend after the merge: lint + design tokens, typecheck (all four projects), 67 tests, build, `check:bundle` (login 231.8 KB, shell + employee
home 335.4 KB, shell + admin home 355.1 KB) — all pass.

Browser checks (local dev stack + demo company, before the final merge): `check:popovers` passes (light/dark × 390/1280, now including the Members appoint
drawer); `check:sensitive-ui` passes — **570 page loads (845 before the change below), no secret, DEMO banner on every one**, including: DEMO006 sees the Unmute host only as the Wellsure
Office; another employee, HR and the developer never see DEMO006's booking on any Unmute or workspace page; the workspace menu is offered to nobody but
members and directors; the demo private nudge's text never appears on any page of either portal for another employee, HR or the developer; the director
sees both. Screens were checked by screenshots in light, dark and at 390 px (Unmute, Recognition, Members, Peeps settings, Unmute hosting, Unmute bookings,
Recognition (all), Asset Register in the workspace, HR's onboarding screen, a non-member opening a workspace address).

### Mutation checks (each guard broken alone, the tests re-run, the files restored)
| # | Guard removed | Caught by |
|---|---|---|
| U1 | one-live-booking index (slot lock kept) | "the database alone refuses a second live booking…" |
| U2 | that index **and** the slot lock | also "10 employees booking the same slot at once" |
| M1 | membership refusal in `requireOffice` | refusal matrix, removed-member and drift tests |
| M2 | director-open audit | "a director sees every booking, and each one opened is audited" |
| M3 | host check | 11 Unmute tests |
| M4 / M5 | same-director check in the service / in the trigger | membership tests / the database test |
| M6 | Unmute settings gate | "with no settings Unmute is inactive…" |
| M7 | grant removal on leaving | re-appointment, drift and removed-member tests |
| R1 | manager team check | giver matrix |
| R2 | HR refusal | giver matrix (first run survived because the HR person had no team; an HR person with a report was added, then caught) |
| R3 | nudge reader check | "the sender and the recipient read it; …do not" |
| R4 | director-open audit (nudges) | director-open test |
| R5 | generic notification replaced by the text | leak test and socket test |
| R6 / R6b | badge idempotency lookup alone (survives: the unique constraint still holds, by design) / lookup **and** the unique constraint | idempotent-issue test |
| R7 | badges/nudges settings gate | 11 tests |

### Shared files touched this stage (all inside PEEPS-BEGIN/END blocks)
`backend/prisma/schema.prisma` (back-relations at the end of `Employee`; models at the end of the file), `shared/constants/permissions.ts` (7 keys,
catalog entries, group "Wellsure Office"), `shared/constants/sensitiveData.ts` (`REVIEWED_NOT_SENSITIVE`), `backend/src/lib/systemRoles.ts` (my own block:
HR now holds `assets.onboarding.issue` only), `backend/src/lib/fieldKeyRotation.ts` (`ENCRYPTED_COLUMNS`), `backend/src/app.ts` (imports + mounts),
`backend/src/modes/worker.ts` and `backend/src/modes/scheduler.ts` (one line each), `backend/src/lib/__tests__/cleanup.ts`,
`backend/src/modules/managers/__tests__/routeInventory.ts`, `backend/scripts/demo/seedDemoCompany.ts`, `frontend/src/routes/employeeMenu.config.tsx`,
`frontend/src/routes/adminMenu.config.tsx` (my own block), `frontend/src/pages/employee/people/PersonDrawer.tsx` (badges on the profile),
`frontend/e2e/sensitive-ui.mjs`, `frontend/e2e/popovers.mjs`. New migrations only; no table of Session A altered.

### Interface notes for Session A
None needed. For information: the membership writes ordinary `user_permission_overrides` rows labelled as above; a person who holds the MANAGER role has
those grants stripped by the resolver's manager ceiling, which is why the Peeps routes read the membership directly (see deviations). If Session A ever
wants the office capabilities on the "What HR Can Do" screen instead, that is their framework's change, not mine.

### Every setting left Not set (real company)
All 18 Peeps settings: `office.name` (display defaults to "Wellsure Office", the owners' chosen name), `audience.assets`, `assets.newJoinerWindowDays`,
`audience.unmute`, `unmute.sessionMinutes`, `unmute.availability`, `unmute.bookingWindowDays`, `unmute.minNoticeHours`, `unmute.cancellationNoticeHours`,
`audience.badges` (Q-16), `badges.catalogue`, `badges.limits` (Not set = no limit), `badges.durationDays` (Not set = no expiry), `badges.revocation`
(Not set = nobody may revoke), `badges.display` (Not set = only the recipient sees), `audience.nudges` (Q-16), `nudges.limits` (Not set = no limit),
`nudges.revocation` (Not set = nobody may withdraw). Also: the asset category/status/condition lists, Wellsure Office members (nobody; Q-17), Unmute hosts
(nobody). The demo company carries DEMO values for all of these.

### Owner questions (built as recommended, each a setting)
Q-14 assets: members + directors manage (`audience.assets.officeManages`), HR issues to new joiners at onboarding only (`audience.assets.hrOnboardingIssue`
+ `assets.newJoinerWindowDays`). Q-15 new leave types: not this round. Q-16 givers/senders: `audience.badges` / `audience.nudges` (managers, Wellsure
Office; never HR), Not set. Q-17 the Founder's Office person: a director appoints them as a member; nobody preselected.

### Deviations from the prompt
1. **Manager ceiling.** A member who also holds the MANAGER role has the office grants stripped by the resolver (not mine to change). The Peeps routes
   check the membership directly, so such a member can still work (tested in assets), but the workspace menu entries (which follow grants) do not appear
   for them; they reach the pages by address. A fix would be Session A's (an exemption in the resolver) or the owners' choice not to make managers members.
2. **The workspace switcher** is the "Wellsure Office" group in the employee portal's menu (members and directors only), not a separate control: the admin
   portal is role-gated and members are ordinary employees.
3. **Route gates.** Office routes use the membership gates (tagged with their key) rather than `requirePermission`; self routes (booking, my badges,
   my nudges) and give/send (decided by the directors' settings, not a key a role could hold) use sign-in plus the service rules. The Developer is refused
   on every office route and sees only their own (empty) data on self routes.
4. **Directors on host routes** get 403 (they are host actions on a host's own slots); directors see every slot and booking through the admin routes.
5. **Badges in the directory list:** the counts endpoint exists (`GET /api/badges/directory`), but only the profile drawer shows badges; the list rows do not
   yet (that would edit the People page further).
6. **Unmute sends no emails**, only the generic in-app notification.
7. A pending (unconfirmed) membership proposal or setting version cannot be withdrawn; a newer one supersedes it. Follow-up if wanted.
8. Asset demo data is still entered through the services as the demo HR Admin (the demo seed predates D-29); the register itself is now refused to HR.

### CI (read per job)
- Runs 222, 224 and 225 (`45626da`, `6de8b08`, `2580a4f`) failed on two jobs:
  - **install-lint-typecheck-test** — one Session A test, `payroll/__tests__/bankRepayment.test.ts:168`, asserted `not.toMatch(/\d{9,}/)` on a
    body that carries a hex SHA-256 hash; run 225's hash happened to contain `6194722185552`. A flake in Session A's file, not a product bug;
    Session A had already replaced the assertion in `832947f`. Fixed here by merging that commit, not by touching their test.
  - **sensitive-ui** — the scan step hit its 16-minute limit. My nudge check re-crawled every page for the developer and the HR Admin, which the
    main passes already visit. `7d761a0`: the asset, Unmute/workspace and nudge checks now run in one per-page hook inside `visit()`, with no page
    loads of their own (so they now also cover HR with every duty on and off). One more employee (DEMO009) goes through `visit()`, and five pages
    confirm the right people do see the demo data. 845 page loads → 570. Mutation check: the director removed from the nudge's allowed set →
    caught on `/app/office/recognition`. Clean local run: 570 pages, pass, 19 minutes on this container.
- **Run 228 on `7d761a0` (the final code commit):** install-lint-typecheck-test (including tests and demo company tests), latency + popovers,
  docker-build, attendance-replay and agent-windows **green**. **sensitive-ui still red: the step ran 16:12 against its 16-minute limit.**
  The base scan alone was sized at "about 12 minutes" for 74 admin + 29 employee pages × 4–5 passes (486 loads). The Peeps menu entries add 8 admin
  + 10 employee pages, which the design visits 4–5 times each (about 80 loads), and CI now takes at least 1.7 s per page. **Open, for the owner:** the
  scan's runner, its per-page waits and the step and job limits in `.github/workflows/ci.yml` are shared, not Peeps files, so I did not change them.
  Options: (a) raise the step limit (and the job's 20-minute limit) to fit about 20 minutes; (b) run the passes in parallel browser contexts
  inside `sensitive-ui.mjs`, about 3× faster; (c) split the scan into two CI jobs (admin passes and employee passes). Locally the full scan passes.


## Stage: Step 0 (asset audience, badge changes) and Pair 2 (avatars + directory, new leave types) — 2026-11-01

Owner decisions in force: D-28, D-29, D-30, and Q-14 to Q-17 **decided** (the asset register is HR's and the directors'; the four new leave
types are wanted; only the directors give badges and send nudges, badges show company-wide; any employee can be made a member by a director).
The plan for this stage is in `PEEPS_PLAN.md` ("Final instructions (2026-11-01)"), committed before Module 2 was built.

### Commits
| Commit | What |
|---|---|
| `f5f0506` | Merge of `feat/hr-payroll-separation` (`435da5c`, `d883a13`). One conflict at the end of `schema.prisma`, resolved by keeping both (Session A's `PayrollExclusion`, then the Peeps blocks); migrations applied; drift clean |
| `b9f0a90` | Step 0.2 — assets back to HR and the directors |
| `e0cf2d3` | Step 0.3 — badges and nudges: directors only; badges company-wide |
| `1743d6f` | Module 1 — avatars and directory |
| `fdb69bf` | Plan: final instructions, the leave-types design, the autofill note (docs only) |
| `00d9a2d` | Module 2 — the four new leave types |
| `b6c3561` | Module 2 screen fixes found in the browser checks |
| `03e96fa` | Workspace asset entries need membership (found by `check:sensitive-ui`: HR, holding the asset keys again, was offered the Wellsure Office) |

### Step 0.2 — assets (Q-14)
- Forward migration `peeps_20261101090000_assets_hr`: HR Executive and HR Admin get `assets.view` and `assets.manage` back, HR Admin also
  `assets.settings.manage` (as the original module had), and the narrow `assets.onboarding.issue` grant is removed. Earlier migrations untouched.
- Routes use `requireRoleOrOffice`: a director; a role that holds the key (as the access resolver sees it); or an active member with "Manage
  the asset register" **only while** the directors' `audience.assets` lets the Wellsure Office manage it. Not set = HR and the directors.
  A key given by hand still opens nothing.
- A member's asset grants are written only while that setting allows (`grantKeysFor`); confirming the setting re-applies every member's grants
  (audited `office.grants.resynced`); the drift check expects the same. The workspace menu offers the register only to such members (it needs
  `office.workspace`), never to HR or the directors, who use the admin portal's register.
- The HR onboarding-only issue path (two routes, its screen and menu entry, `assets.newJoinerWindowDays` and the onboarding required group)
  is **retired**: HR issues from the register. The key stays in the catalogue, held by nobody (forward-only).
- Tests: HR issues, returns and transfers; HR reaches no office route; HR Executive is refused the settings routes; members lose and regain
  the grants with the setting; the register shows HR no pay, bank or statutory data; the director test (every asset, history, assignment) kept.

### Step 0.3 — badges and nudges (Q-16)
- Givers and senders: the directors only, to any employee. `audience.badges`/`audience.nudges` remain as a widening that is **Not set**
  (members with the capability; managers to their own team; never HR) and are no longer required: badges need only the catalogue, nudges
  nothing. The demo's director gives the badge and sends the nudge.
- Badges show to signed-in staff on the profile and in the directory (active badges, never the message); `badges.display` is retired;
  the Developer is refused colleagues' badges.
- Tests: HR, a manager (even to their own report), a non-director employee, a member with the capability and the Developer cannot give or
  send; the widening works only when set; signed-out 401s; a badge reaches only the recipient's room; nudges stay out of lists, counts,
  dashboards, search, task previews, notification bodies, exports, **logs** (new: every log line of a send, read and director open captured)
  and socket rooms.

### Module 1 — avatars and directory
- Photos reuse the People photo code (decoded, re-encoded WebP, metadata dropped, size from System Settings). **Only the owner** adds,
  changes or removes their photo (`/api/employees/me/photo`). The by-id upload and reason-less removal now refuse anyone else's
  (`ownPhotoOnly`, a PEEPS guard in `employee/routes.ts`). HR and the directors **remove** an inappropriate photo at
  `POST /api/avatars/:employeeId/remove` (new key `avatars.moderate`, migration `peeps_20261101100000_avatars`) with a reason kept in the
  audit log; the person gets a general notice. No photo → initials avatar (existing).
- Directory: new director setting `directory.contactFields` (Not set = none) narrows the System Settings toggles for work email, phone and
  birthday; personal email never shows (field policy); search also matches the department name. `GET /api/badges/counts` feeds a badge chip
  on directory cards and org-chart nodes. Department is never a team scope (tested).
- Admin profile: your own photo as before; someone else's shows **Remove photo** (reason required) to `avatars.moderate` holders only.

### Module 2 — the four new leave types (Q-15)
- Rows in `leave_types` with stable codes `MENSTRUAL`, `MEDICAL`, `WEDDING`, `BEREAVEMENT` (migration `peeps_20261101120000_leave_types`),
  inactive until approved; the display name is a label; ledger and requests key on the type id. PL is untouched.
- Rules: append-only `leave_rule_versions`, a version complete or refused (paid; cap per request / calendar year / employment, or a balance
  HR grants; eligibility; units; working or calendar days; supporting document and threshold; who decides; optional year-end choice).
  HR (or a director) prepares; a **different director** approves with a start date not in the past (service + trigger
  `LEAVE_RULES_SAME_PERSON` / `LEAVE_RULES_DIRECTORS_ONLY`); approval switches the type on and sets its paid/half-day flags and policy row;
  **any new version switches it off** until approved. The existing tool cannot switch a new type on, change those flags or edit its policy.
- Applying/deciding (PEEPS hooks in `leave/requests.ts`): rules in force for the dates, eligibility, caps (pending + approved counted),
  counting; a raw attachment key refused; approval re-checks, refuses a manager on an HR-only route and waits for a required document.
- Confidentiality: a new type's reason is shown only to the employee, HR and the directors (manager lists, detail and decide responses
  redact it). Supporting documents: own table `leave_request_documents` and storage prefix, no original file name, opened only by HR (new
  sensitive key `leave.documents.view`, class `LEAVE_DOCUMENTS` in the registry, so the Developer can never hold it) and the directors,
  **every open audited**; the employee sees a count. Calendars show "Leave" until `leave.calendarShowsType`. Year end handles PL only.
- Screens: New leave types panel (prepare, approve, history) on Leave Types & Policies, whose cards for the new types point to it; Supporting
  documents on Apply for Leave; a Documents column on HR's Employee Leave queue. Demo: DEMO medical rules and one request with a document.

### Tests
New: `avatars/__tests__/avatars.test.ts` (12), `leaveRules/__tests__/leaveTypes.test.ts` (18), frontend `officeMenu.test.ts` (3) and
`rulesText.test.ts` (1). Rewritten: `assets.test.ts` (Q-14), `recognition.test.ts` (16, Q-16). Base tests that assumed the old rules gained
PEEPS blocks: `people/photos.test.ts` (HR can no longer set someone's photo), `people/fieldPolicy.test.ts` and
`settings/peopleDocuments.test.ts` (open the contact-field setting through two throwaway directors), `office.test.ts`.

**Full backend suite run alone at the end** (on `03e96fa`, dev stack stopped): **199 files, 1,994 tests, all passed** (about 24 minutes).
Frontend: lint + design tokens, typecheck (all four projects), 71 tests, build, `check:bundle` (login 231.8 KB, shell + employee home 335.9 KB,
shell + admin home 355.6 KB, measured before the last two small screen fixes; CI re-checked the budgets on `03e96fa`) — all pass. Per commit: the changed tests, lint and typecheck. `npm run test:demo` (demo company tests) passes.

### Mutation checks (each guard broken alone, the tests re-run, the files restored)
| # | Guard removed | Caught by |
|---|---|---|
| Q1 | managers allowed to give without the widening setting | "a director gives and sends…; HR, a manager… cannot", widening test |
| Q2 | the Developer refusal on colleagues' badges | company-wide visibility test |
| A1 | owner-only photo guard (`ownPhotoOnly` lets anyone through) | 3 avatar tests and 2 base photo tests |
| A2 | the directory contact-field gate | 3 directory tests |
| L1 | preparer cannot approve (service; the trigger remains) | 4 tests (the trigger turns it into a 500, not a 403) |
| L2a / L2b | the unset-rule refusal before the lock / both refusal points at apply | "rules approved for a later date… refused" |
| L3 | a change voids the approval | "a rule change voids the approval…" (and a later test) |
| L4 | HR-only route | 4 tests |
| L5 | document required before approval | 2 tests |

### Browser checks (local, on a freshly migrated and seeded scratch database with the demo company)
- `check:popovers` passes, including the new **Remove photo** dialog and the **Prepare rules** drawer (light/dark × 390/1280).
- `check:sensitive-ui`: **577 pages; no secret, DEMO banner everywhere**; the new checks (nobody but DEMO006, HR and the directors sees the
  demo leave reason; no document storage key on any page; team calendars never name a new type; the directory shows no personal email or
  phone; HR's register and HR's Employee Leave queue show the demo data). It found **one real problem**, fixed in `03e96fa` (HR was offered
  the Wellsure Office workspace menu because it holds the asset keys again); after the fix a targeted check confirmed HR no longer sees it and
  a director still does; the full 20-minute run was not repeated for that menu-only change.
- Screens checked by screenshots in light, dark and at 390 px: directory with badge chips, org chart, admin profile with Remove photo and its
  dialog, Leave Types & Policies with the new panel and the prepare drawer, HR's queue with the Documents drawer, Apply for Leave with
  Supporting documents, the team calendar. Two fixes came out of this (`b6c3561`).

### Shared files touched (all inside PEEPS-BEGIN/END blocks)
`schema.prisma` (new models; back-relations on `LeaveType`, `LeaveRequest`), `permissions.ts`, `sensitiveData.ts` (class `LEAVE_DOCUMENTS`),
`systemRoles.ts`, `app.ts`, `employee/routes.ts` (photo guard), `people/directory.ts`, `people/fieldPolicy.ts` (personal email never),
`leave/requests.ts`, `leave/leaveTypes.ts`, `leave/calendar.ts`, `leave/controller.ts`, `cleanup.ts`, `routeInventory.ts`,
`scripts/demo/seedDemoCompany.ts`, frontend `employeeMenu.config.tsx`, `adminMenu.config.tsx`, `PeoplePage.tsx`, `OrgChart.tsx`,
`EmployeeProfilePage.tsx`, `LeaveTypesPoliciesPage.tsx`, `EmployeeLeavePage.tsx`, `LeaveApplyPage.tsx`, `e2e/sensitive-ui.mjs`,
`e2e/popovers.mjs`, and the base tests listed above. `docs/SENSITIVE_DATA.md`: its **generated** block regenerated
(`npm run docs:sensitive`) for the new class — a mechanical change, outside any PEEPS block because the block is generated.
Not touched: `ci.yml`, payroll, the attendance engine, remote attendance, two-step sign-in, the HR switch framework and HR switch screens.

### Interface notes for Session A (payroll)
- **Paid/unpaid** of a new leave type is on `leave_types.is_paid`, set from the approved rules; approved leave reaches attendance through the
  existing sink with the type code, as for PL/LOP, so unpaid days flow as they do today.
- **Year end / encashment (not built):** an approved rule version may carry `yearEnd: { carryForward: "LAPSE" | "CARRY_FORWARD",
  encashment: "NONE" | "ENCASH_UNUSED" }` (read `rulesInForce(leaveTypeId, date)` in `backend/src/modules/leaveRules/service.ts`, or the
  `GET /api/leave-rules` listing). The year-end process handles PL only; to include a new type, Session A would read that rule, compute the
  closing balance from `leave_ledger` (only a `GRANTED_BALANCE` type has one) and own every amount. Nothing here computes money.
- **Granted balances** are credited only through the existing Leave Granter (`leave.grant`); no automatic credit exists.

### Every setting left Not set (real company)
`audience.assets` (Not set = HR and the directors), `audience.badges`, `audience.nudges` (Not set = the directors only), `badges.catalogue`,
`badges.limits`, `badges.durationDays`, `badges.revocation`, `nudges.limits`, `nudges.revocation`, `directory.contactFields` (Not set = no
contact fields), `leave.calendarShowsType` (Not set = "Leave"), the Unmute settings, `office.name`, and **every rule of all four new leave
types** (none can be applied for). Photo limits reuse the existing System Settings values; no new limit was added.

### Decided by me (please confirm or overrule)
1. HR Admin also prepares the asset lists again (as originally); HR Executive views and manages only.
2. Retired the HR onboarding-only issue path (HR now issues from the register).
3. The Developer is refused colleagues' badges, the badge counts and the leave-rules routes (it holds `leave.policy.manage` to run the
   system, but the rules are an owner decision).
4. The directory's contact fields need the new director setting *and* the existing System Settings toggle; personal email never shows,
   even if toggled on (the toggle in System Settings is now inert for personal email).
5. Leave rules: no automatic quota or accrual (a cap, or a balance HR grants); overlap with another leave request stays refused (the
   "overlap rule" is how holidays and week-offs inside the dates count); no gender-based eligibility (sensitive; not built unless asked).
6. The free-text reason of a new-type request is hidden from managers (they see type and dates, as asked).
7. The employee sees only that a supporting document is attached (they cannot open it again); HR and directors open it, each open audited
   (HR's opens are audited too, not only the directors').
8. Supporting documents keep no original file name (it can reveal a diagnosis).

### Deviations
- Base tests changed (PEEPS blocks) where the owners changed the rule they tested: HR setting someone's photo; contact fields shown from
  the System Settings toggle alone.
- `docs/SENSITIVE_DATA.md` generated block regenerated (see above).
- The full sensitive-ui run was not repeated after the menu-only fix (targeted check instead).

### CI (read per job on the final code commit `03e96fa`, run 235)
- **Green:** install-lint-typecheck-test (lint, typecheck, tokens and bundle budgets, schema matches migrations, the full test suite, demo
  company tests), latency (including **check:popovers** with the two new layers), docker-build, attendance-replay, agent-windows.
- **Red: sensitive-ui — the step timed out at its 16-minute limit** (`##[error] … has timed out after 16 minutes`; no problem was reported
  before the limit). Per the final instructions this time limit is Session A's to handle; `ci.yml` was not edited. Locally the full scan
  covers 577 pages (see Browser checks).
- Run 233 (`00d9a2d`) had the same picture; run 234 was cancelled by the next push. The docs-only commit after this one was not read.

**Stopped here as instructed.** Recruitment, exits, insights and autofill code were not started.

## Stage B-1: sync, reporting-line cheers and badges (D-36/D-37), avatar dialog and My profile (D-35) — 2026-11-02/03

### Commits (branch `peeps/foundation`)
| Commit | What |
|---|---|
| `179533d` | Merge of `origin/feat/hr-payroll-separation` (split sensitive-data scan, remote attendance, Stage 5b, tax module). Conflicts: `schema.prisma` (Session A bank models taken from theirs; end-of-file keeps both), `e2e/sensitive-ui.mjs` (Peeps block runs each half under `doAdmin` / `doEmployee`). |
| `a89b750` | Owner answers on leave: recorded-gender criterion, sensitive types masked for managers, own document open. |
| `376e900` | D-36/D-37 badges and cheers by reporting line; corrective notes private and off. |
| `eb1154a` | D-35 avatar choices, shared avatar component, My profile. |
| `2fa8886` | Race fix: idempotent give/note under serializable isolation (P2034 handled like P2002). |

### Tests
- `leaveTypes.test.ts` 21; `recognition.test.ts` 18; `avatars.test.ts` 18; frontend `EmployeeAvatar.test.tsx` 3.
- CI run 239 (`a89b750`): all jobs green. CI run 240 (`376e900`): everything green except one backend test, the same-key race in
  `recognition.test.ts` (`[201, 500]`; the loser hit a serialization conflict). Fixed in `2fa8886`.
- **Not done, owner's instruction ("skip the test for now, just complete the work"):** the full backend suite alone, and CI per job
  on the final commit. CI run 241 (`eb1154a`) was still in progress when this report was written; `2fa8886` has not been checked.

### Sensitive-data scan (Step 0.1)
Session A's split works: `sensitive-ui (admin portal)` and `sensitive-ui (employee portal)` both passed on runs 239 and 240.
On run 238 the admin half had been cancelled by a later push. The local run on the scratch stack was stopped when the tests were
skipped.

### Mutation checks (all caught)
- Leave: G1 gender check removed; D1 list masking removed; D2 notification masking removed.
- Badges: R1 downward rule; R2 upward rule; R3 no-manager fallback; L1 monthly limit; N1 a corrective note injected into the home feed.
- Avatars: A1 own-avatar rule.

### Screens
My profile, the Change avatar dialog, Home (Recent cheers) and Recognition (all): light and dark, at 390 and 1280. Popovers checked,
including a new "avatars: change avatar dialog" layer.

### Shared-file touches
- Inside PEEPS blocks: `schema.prisma`, `app.ts` (`/api/profile` mount), route inventory, `employeeMenu.config.tsx` (My profile),
  `HomePage.tsx` (Recent cheers), `leave/requests.ts`, `leave/controller.ts`, `leave/calendar.ts`, `tasks/service.ts`,
  `cleanup.ts` (PURGE_GUARDED), `e2e/sensitive-ui.mjs`, `e2e/popovers`.
- **Deviation:** the avatar swap (`InitialsAvatar` → `EmployeeAvatar`) is a one-line change in base screens: OrgChart, HomePage,
  PersonDrawer, Delegations, ReviewPage, LeaveApplyPage, EmployeeLeavePage, HelpdeskBits, TasksInbox, HostCalendarPage. Those lines
  are not wrapped in PEEPS blocks (a block per JSX attribute would be noise). `components/common/EmployeeAvatar.tsx` was rewritten to
  read choices from the map, and its props stayed backward compatible.

### Settings left Not set
`badges.catalogue`, `badges.limits`, `badges.repeat`, `badges.noManagerFallback`, `badges.publicDetails`,
`audience.badges.officeGivesToAnyone`, `nudges.enabled`, `nudges.limits`, `leave.showSensitiveTypes`, `leave.calendarShowsType`.
Every leave-type rule (gender criterion included) is also Not set until HR prepares it and a different director approves it. The demo
company carries values labelled DEMO.

### Decisions made by me
1. A person whose manager chain reaches a manager or HR Admin counts as reaching the directors, because those roles report to the directors by design.
2. Expiry uses the IST Monday–Sunday week and the IST calendar month.
3. The starter catalogue is six items labelled STARTER_*. Loading it enters a version that a different director must confirm.
4. The recipient always sees the giver and the message. The public sees them only per `badges.publicDetails`.
5. The avatar map (`GET /api/avatars/map`) shows only the choice and the photo version, both already visible to signed-in staff. Photo bytes still need the photo token.
6. "Surprise me" picks from the 24 characters only, not the fun picks.
7. A character whose art leaves the catalogue falls back to initials.
8. Where a type is masked, managers see the code "LEAVE" and the name "Leave", and the type id is blanked.

### Artwork source
No files were in `docs/design/avatars/`. An ORIGINAL placeholder set was generated by `frontend/scripts/generate-placeholder-avatars.mjs`:
24 simple people and 26 simple icons. It is marked placeholder in the catalogue, in each SVG and in the dialog banner, and copies nothing.

### For Session A
Attendance surfaces (Who's In, muster, day panel) still show the leave code to managers. That is the attendance module, which Peeps does not touch.

## C-1 — verify B-1 and close the attendance leave-label gap (2026-11-03)

### Scope and commits
- Started with a clean working tree. The environment checkout was on `work` at `c787e92`; fetched only
  `peeps/foundation` and switched to its published tip `3e6e4ce`. All work stays on that branch, one agent.
- `cb361fc`: root `AGENTS.md`, the requested one-page agent rules and document links. `AGENTS.md` and
  `docs/plans/WORKING_RULES.md` were absent at the start; the latter remains an optional reference.
- `082bcc0`: reuse the existing leave privacy rule in attendance display responses and exports; verify badge
  and corrective-note idempotency under both Prisma conflict codes. No new module, route or setting.
- `e5826d2`: fix the audit-hash substring flake in the exact test file named by the failed suite, under
  C-1 step 2.4's exception. Payroll application code is unchanged.
- This report/checklist commit records the final results below. No force-push, PR, database reset/drop,
  staging/production action or environment publication.

### What was verified and changed
- `2fa8886` already handles **P2002 and P2034** in both `recognition/badges.ts` and `recognition/nudges.ts`;
  no further handler change was needed. The recognition file now has **23 tests**: unmocked simultaneous
  identical badge and note requests, plus deterministic two-request races for each error code on each handler.
  They prove exactly one record, one audit row in the deterministic cases, and the same resource payload
  (the existing 201/200 status and `repeated` flag distinguish first creation from replay).
- Attendance previously returned the sensitive leave code in the board explanation, calendar/status fields,
  day panel, muster cell/tooltip and released-leave export text. A Peeps-owned presentation adapter calls
  **`leaveTypeNamer` from `leaveRules/hooks.ts`**; it does not copy the HR/director/setting decision. It also
  handles split statuses and released leave. Stored attendance and the totals computed from it are untouched.
- **11 privacy tests** cover menstrual and medical labels on all three displays, HR Admin/HR Executive/director
  visibility, the connected month response, full/half/split codes, own data, existing PL, scope refusals,
  the confirmed director setting, the muster workbook and its Corrected days sheet, and stored rows unchanged.
- **Existing access restrictions preserved:** MANAGER holders cannot receive `attendance.view`, so Who's In
  and another person's day/month endpoints still return 403 to them. Manager display projections are tested
  directly; the HTTP tests use a permitted TEAM-scoped role and a real manager branch marker for the muster.
  Existing Developer attendance reads remain permitted and have the same masked labels; changing that access
  policy is outside the one authorized edit. Existing Peeps Developer refusals are exercised by the full suite.
- The four new leave types were verified **inactive on the scratch database**, without activating any rules.
  No director/HR settings were changed outside test fixtures. This change does not activate the types even after checks pass.

### Local checks and setup failures
- Native **PostgreSQL 16.15 / Redis 7.4.11**, loopback only, with new scratch databases. The repository service
  check passed. With no native packages or sudo available, extracted binaries from the environment's existing
  images and ran them directly under `/tmp`; no service containers were needed (the owner also permitted them).
- Each backend invocation uses a fresh database name. An untracked harness under `backend/node_modules/.c1`
  retains the normal setup/lock/migrations/seed and omits its `DROP DATABASE` statement. No tracked test setup,
  test selection, assertion, timeout or application configuration was changed for this adaptation.
- First baseline attempt was interrupted after Chromium's unusable sandbox helper prevented PDF rendering.
  A local launcher outside the repo supplies writable XDG directories and container-compatible launch flags;
  PDF rendering keeps the application's no-JavaScript/no-network controls. No TLS/checksum verification disabled.
- The completed baseline on the previous code: **202 files; 201 passed, 1 failed; 2,040 tests passed,
  1 failed (2,041 total)**. The failure was `dbRoles.test.ts` →
  `is idempotent, and a new password takes effect while the old one stops working`: initial local trust
  authentication accepted the old password. Corrected local authentication for the test-created roles;
  that file then passed **10/10**. No repository change was needed for either environment problem.
- New privacy test fixtures were corrected before final validation (branch-assignment actor, manual-capture
  membership, binary workbook parsing). The focused privacy rerun passed **11/11**, including released leave.
- `npm run lint` (backend, frontend/tokens, agent): **passed** on restored code. One overlapping lint run saw
  a deliberately removed export guard's unused variable; rerun after restoration passed.
- `npm run typecheck` (backend, frontend, agent, infra): **passed**.
- Frontend: **16 files / 77 tests passed**; production build **passed**; bundle budget **passed**:
  login **231.3 KB**, shell + employee home **336.1 KB**, shell + admin home **355.6 KB** gzip.
- Full backend suite alone on `082bcc0`: **203 files; 202 passed, 1 failed; 2,056 tests passed,
  1 failed (2,057 total)**. The failure was `payroll/__tests__/monthlyInputsImport.test.ts` →
  `confirming writes the figures once, for each month of an inclusive range, void any confirmation, and the same file is never applied twice`.
  It searched the entire audit JSON for `700`; the file hash happened to contain those digits even though
  `amounts` was `redacted`. Replaced it with an exact assertion of the allowed metadata fields, counts,
  content hash and redacted amount marker. The fixture now deliberately produces a harmless hash containing
  `700`, so the regression is deterministic. That file passed **9/9**; reinstating the old assertion fails
  the named test. No pay calculation, write path or access change.
- Final full backend suite alone on `e5826d2`: **203 files / 2,057 tests, all passed**, zero skipped/todo
  (483.11 seconds). JSON runner report confirms success and zero failed/pending tests. Read-only SQL after
  the run confirms all four new leave types are still inactive.

### Mutation checks (each run alone on a fresh scratch database; all files restored)
| Mutation | Named test that failed |
|---|---|
| Badge P2002 handling removed | `badge same-key race returns the winner for P2002` |
| Badge P2034 handling removed | `badge same-key race returns the winner for P2034` |
| Corrective-note P2002 handling removed | `corrective-note same-key race returns the winner for P2002` |
| Corrective-note P2034 handling removed | `corrective-note same-key race returns the winner for P2034` |
| Board adapter bypassed | `HTTP: masks the board, month and day for a permitted TEAM viewer and the muster for a manager branch marker` |
| Day adapter bypassed | Same HTTP masking test |
| Month adapter bypassed | Same HTTP masking test |
| Muster adapter bypassed | Same HTTP masking test; muster export test |
| Shared namer result bypassed | Both `manager sees Leave for ...` cases; HTTP masking and export tests |
| Corrected-days export masking bypassed | `muster export uses the same labels; employee, outside-team and Developer access stays as before` |
| Old whole-JSON audit substring assertion reinstated | The monthly-input import confirmation test named above |

**11/11 caught.** The real races remain unmocked; deterministic cases coordinate arrival at the transaction
and inject the selected native Prisma error only into the losing call after the winning real transaction commits.
The final full-suite run uses restored production code without those mutations.

### Exact shared-file handoff to the attendance/payroll session
Only these two attendance files changed, in marked `PEEPS-BEGIN/END attendance leave privacy` blocks:
- `backend/src/modules/attendance/info/controller.ts`: lines **7–9** (adapter imports), **25–27** (month
  projection), **31–33** (day projection), **36–38** (Who's In projection). Existing auth/permission/scope calls stay intact.
- `backend/src/modules/attendance/manual/muster.ts`: lines **19–22** (read-only role resolver + adapter imports),
  **290–292** (projection after totals), **299–301** (returned display rows), **483–485** (export labeller),
  **526–528** (released leave in Corrected days). No attendance engine, write path, payroll application or access resolver edit.
Peeps files: `leaveRules/attendancePrivacy.ts` lines **1–70** (new),
`leaveRules/__tests__/attendancePrivacy.test.ts` lines **1–166** (new),
`recognition/__tests__/recognition.test.ts` (new race helper and assertions). Root `AGENTS.md` is documentation only.
The failing-test-file exception adds one separate handoff: `backend/src/modules/payroll/__tests__/monthlyInputsImport.test.ts`,
lines **2** (hash import), **91–99** (collision fixture), **113–114** (exact audit metadata assertion).
This is the only payroll file touched; it contains tests only.

### CI read per job
Latest pre-C-1 published commit `3e6e4ce`, run **41584320248**: every job completed **success**:
`install-lint-typecheck-test`, `latency` (including popovers), `attendance-replay`, `docker-build`,
`agent-windows`, **`sensitive-ui (admin portal)`**, **`sensitive-ui (employee portal)`**. No red job.
C-1 final code/test commit `e5826d2`, run **41607364573**: all seven jobs completed **success**:
| Job | Result |
|---|---|
| `install-lint-typecheck-test` (including demo-company tests and schema drift) | success |
| `latency` (including popovers) | success |
| `attendance-replay` | success |
| `docker-build` | success |
| `agent-windows` | success |
| `sensitive-ui (admin portal)` | success |
| `sensitive-ui (employee portal)` | success |

No red job on the final code/test revision. The earlier `082bcc0` run was superseded by the test-only fix;
the final report/checklist follow-up contains documentation only.

### Unverified
- No new local browser crawl, sensitive-ui/popover scan, replay, demo-company suite or Windows run; the
  final-code CI results above are remote evidence for those checks. The privacy tests verify actual response/workbook
  contents and manager presentation projections, not browser screenshots.

**C-1 complete. Stop here.** No general ticket desk, exits, recruitment, insights, autofill or payroll application work started.

## C-2 — General ticket desk and checkpoint B (2026-11-03)

### Scope and commits
Started on `peeps/foundation` at `9f8a2cf`, with a clean working tree. One coding agent throughout.
The owner explicitly authorized B.3 despite its historical withdrawal header, and then authorized
small marked hooks at each boundary, superseding the original single-call-site limit.

| Build step | Commit | Result |
|---|---|---|
| 1 — schema and cleanup | `0845d17` | New-category Not set marker, current visibility, immutable history, Payroll CHECKs |
| 2 — director controls | `5a00bff` | `helpdesk.visibility.manage`, HR hard lock, validated director-only read/write routes |
| 3 — confidentiality | `54b30ab` | Queue/counts, detail, attachments, Tasks, stored notifications and scoped delivery |
| 4 — moves | `34b9e5c` | Actor/key idempotency, row lock, immutable receipt, atomic audit/system note/notifications |
| 5 — existing screens | `cc18d0d` | Audience drawer, Move drawer, neutral notes, protected downloads, DEMO scan fixtures |
| 6 — regression/checkpoint tests | `40f0390` | Role/sensitive intersection, handover regression, browser walkthrough and mutation evidence |

Latest `origin/feat/hr-payroll-separation` was fetched at the start and checkpoint: still `f613992`,
already an ancestor of `9f8a2cf` and this branch. No merge was needed. No payroll or attendance file,
access resolver, CI workflow, PR, staging or production changed. No environment publication.

### What shipped
- Existing general categories receive no migration backfill and retain their prior permission rules.
  Later general categories get an unconfigured marker automatically, including when inserted outside
  the category API. Raising or moving into an unconfigured category refuses with exactly
  `This category is not set up yet`.
- A director chooses HR roles and/or named active handlers, with a reason and expected version.
  Existing helpdesk/sensitive/directors-only gates still apply. D-28 directors retain access;
  opening a general ticket outside their own/assigned work is audited.
- The shared policy is in `modules/helpdesk/categoryVisibility.ts`. Queries filter before pagination,
  totals and Tasks limits. Attachment metadata and bytes, notification lists/unread counts/read actions,
  queue results and thread writes use the current policy. Configured and moved tickets emit to current
  handlers' user rooms, never the helpdesk permission room. Former handlers get only an empty
  `helpdesk.access.changed` signal, so clients discard stale caches without receiving a ticket ID/content.
- A move requires a reason and a UUID idempotency key. The same actor/key/request returns the same
  neutral receipt even after access is lost; reuse for different input conflicts. It clears assignment,
  preserves status, records one immutable receipt/audit/system note and commits notifications atomically.
  New handlers receive the ticket; the raiser gets only `Your ticket was moved to another team.`
  in the move notification and public system note. The private reason stays in the audit/receipt.
- Payroll exclusion uses the stable `PAYROLL_SALARY` code. SQL derives checked codes from actual
  category FKs, so a forged general code cannot bypass either visibility-table CHECK or the move CHECK.
  Source and target are guarded; a protected category cannot be renamed into Payroll. The existing
  Session A Payroll paths remain responsible for Payroll tickets.
- The queue already had a category filter; it is reused. Existing category/ticket pages gain drawers;
  no employee screen, menu or navigation route was added. Shared conversation rendering labels the
  neutral move note as a system note. All four new API routes are in the access inventory.
- Search is the menu-only command palette (`CommandPalette.tsx`); it has no ticket-payload search.
  Request Hub reads the raiser's own tickets only and continues to retain that thread.

### Verification actually run
Each build commit had its changed tests, root lint and root typecheck run and passed before commit.

| Check | Observed result |
|---|---|
| Step 1 schema + cleanup | 2 files / 6 tests passed |
| Step 2 director routes + access inventory | 2 files / 9 tests passed |
| Step 3 helpdesk/notification/access regression | 7 files / 50 tests passed |
| Step 4 moves/schema/access regression | 7 files / 47 tests passed |
| Step 5 frontend | 17 files / 80 tests passed |
| Step 5 backend after cache refresh changes | 1 file / 9 tests passed |
| Final focused restored regression, including Tasks, notifications, cleanup and route inventory | 9 files / 65 tests passed |
| Final root lint | Passed (backend, frontend + design tokens, biometric agent) |
| Final root typecheck | Passed (backend, frontend, agent, infra) |
| Final frontend suite | 17 files / 80 tests passed |
| Biometric-agent suite after full backend completion | 17 files / 166 tests passed |
| Production frontend build | Passed |
| Bundle budget | Passed: login 231.3 KB, shell + employee home 336.1 KB, shell + admin home 355.7 KB gzip |
| Full backend suite alone | **205 files / 2,072 tests passed**, zero failed/pending/todo; 832.28 seconds; JSON report confirms success |
| Four new leave types after full suite | SQL: MENSTRUAL, MEDICAL, WEDDING and BEREAVEMENT all `is_active = false` in the full-run scratch database |

Scratch services follow C-1: PostgreSQL 16 and Redis 7 binaries extracted from isolated local Docker
images, running only on loopback, with fresh task-owned data. Every backend run used a unique newly
created database, Redis test db 15 and unique storage/mail folders. An untracked copy of the existing
Vitest setup removes its DROP, retaining migrations, seed, tests and locking. No local database reset/drop
command was run. The separate DEMO stack was stopped for the full backend run. Chromium uses the same local
launcher adaptation as C-1; application PDF network/JavaScript restrictions remain intact.

### Failures found and fixed
- A new regression proved that a move into a legacy sensitive category hid detail but left the former
  handler's stored notification visible. The restored final regression now also checks its counts,
  subsequent socket delivery and attachments: moved tickets keep guarded delivery/downloads even in a
  legacy target, and the raiser can still download. Untouched legacy tickets keep their original path.
- The strengthened frontend forbidden-state test exposed its own invalid mock error: the shared UI
  recognizes Axios errors, while the fixture was a plain object. The fixture now represents an Axios
  403 and waits for the actual forbidden state; the rerun passed. No production error guard weakened.
- The first browser matrix hit the existing ten-login rate limit. The walkthrough now reuses each
  authenticated role session across themes/widths; only its scratch login counters were cleared before
  rerunning. Application limits were unchanged. One initial lint unused import was removed.

### Mutation checks (fresh scratch databases, each restored)
| Deliberately broken guard | Named test observed failing |
|---|---|
| Queue audience WHERE removed | `named audience controls queue, totals, Tasks, detail, attachments, persisted notifications and socket rooms` |
| Director-only service guard removed | `the service guard rejects HR even if passed a forged director permission` |
| Visibility Payroll CHECKs disabled | `both tables derive the actual Payroll code and reject a forged general code` |
| Move Payroll CHECK disabled | `Payroll exclusion blocks moving in or out in service and database, even with forged general codes` |

**4/4 caught**, with nonzero exits and the named assertions failing. All code mutations were restored;
the isolated mutant databases were not reused. The full run
uses restored production code, not filtered mutation selections.

### Browser walkthrough
`frontend/e2e/helpdesk.mjs` passed **16 role/theme/width cases**: director, HR with an allowed category
and a denied category, raiser and another employee; light/dark at 1280 and 390 px. It opens both new
drawers, checks forbidden/empty detail, raiser retention, absence of the private ticket/panel for HR,
Escape closing and horizontal overflow. Twenty screenshots plus results are in
`/tmp/c2-helpdesk-walkthrough`; phone/dark visibility and desktop/light Move screenshots were inspected.
The existing `check:sensitive-ui` now checks DEMO audience isolation, a director opening the new panel,
and secret patterns in that panel. DEMO fixtures make the positive/negative checks substantive.

### Shared-file handoff (all changes inside PEEPS blocks)
Line numbers refer to implementation commit `40f0390`; new module/test/migration files are Peeps-owned.
- `backend/prisma/schema.prisma`: blocks at 1591, 1620, 1642, 4014, 4049 (relations, system-note flag, tables).
- `backend/src/lib/__tests__/cleanup.ts`: 385 (new guarded descendants of existing category/ticket roots).
- `shared/constants/permissions.ts`: 101, 263; `shared/constants/sensitiveData.ts`: 154, 210 (catalogue/classification/hard lock).
- `backend/src/modules/helpdesk/service.ts`: 1, 110, 117, 232, 263, 304, 334, 343, 365, 429,
  456, 495, 501, 523, 535, 541, 545, 553, 572, 587, 594 (small policy/delivery/projection hooks).
- `backend/src/modules/helpdesk/controller.ts`: 17, 55 (viewer/actor forwarding);
  `routes.ts`: 1, 52, 61, 70 (four validated routes); `__tests__/helpdeskTestHelpers.ts`: 11 (legacy fixtures).
- `backend/src/modules/tasks/service.ts`: 1, 112; `backend/src/modules/notifications/service.ts`:
  1, 16, 61, 65, 68, 72, 84, 87, 96, 100, 111, 114 (policy WHERE and transactional notification writer).
- `backend/src/modules/managers/__tests__/routeInventory.ts`: 38;
  `backend/scripts/demo/seedDemoCompany.ts`: 319 (inventory and DEMO-only seed hook).
- `frontend/src/api/helpdesk.ts`: 21, 60, 137, 145;
  `frontend/src/components/helpdesk/HelpdeskBits.tsx`: 103, 141 (protected download and system-note rendering).
- `frontend/src/pages/admin/helpdesk/HelpdeskCategoriesPage.tsx`: 1, 26, 117, 129, 141;
  `AdminHelpdeskTicketPage.tsx`: 1, 26, 82, 96 (drawers in existing screens).
- `frontend/src/sockets/useHelpdeskRealtime.ts`: 37, 49;
  `frontend/e2e/sensitive-ui.mjs`: 78, 224 (cache refresh and scan coverage).

### Settings left Not set / Decided by me / deviations
- No real-company audience, category, HR-concerns category, quota, workflow duration or leave rule was
  preloaded or activated. Every new general category needs its director's explicit audience choice.
  Only the fictional DEMO seed makes its two labelled demo visibility choices.
- **Decided by me, owner-directed clarification:** migration-time existing categories keep no-row legacy
  behaviour; later general categories get Not set markers. No preset grievance category.
- **Implementation choices:** actor-scoped UUID keys persist with immutable receipts; moves clear the old
  assignee and preserve status; note/notification text is neutral and the reason is private; reuse the
  existing category filter and design-system drawers rather than add a screen.
- **Approved deviation:** several narrow PEEPS hooks replace the original one-call-site limit, explicitly
  approved in chat. Policy logic stays in the new module. Moved legacy tickets retain protected download
  and delivery paths to close the handover regression; untouched legacy tickets retain their old behaviour.
- **Existing capability limit:** legacy bearer URLs issued before a category/ticket transitions retain
  their original 60-second expiry. Configured and moved tickets issue authenticated content descriptors
  instead; current access is checked on every byte request. This does not revoke files already downloaded.

### CI read per job
Implementation commit `40f0390`, run **41621430072**:

| Job | Result |
|---|---|
| `install-lint-typecheck-test` (including demo-company tests and schema drift) | success |
| `latency` (including popovers) | success |
| `attendance-replay` | success |
| `docker-build` | success |
| `agent-windows` | success |
| `sensitive-ui (admin portal)` | success |
| `sensitive-ui (employee portal)` | success |

All seven completed successfully, with no red job. This report/checklist follow-up changes documentation
only; its own push's CI is read separately before the final reply.

### Unverified
- No separate local full sensitive-ui/popover crawl, Windows run, replay or demo-company suite;
  the seven completed CI jobs above provide remote evidence for those checks.
- No staging/production walkthrough or migration; none was requested or performed.
- No retroactive revocation test of pre-transition legacy bearer URLs (existing expiry described above).

**Checkpoint B complete. Stop here.** No exits, recruitment, insights or autofill code started.


## C-3 — Exits and checkpoint C (2026-11-04)

Started clean on `peeps/foundation` at `1c18350`, one coding agent. The owner's C-3
prompt overrides the older B.5/AS1 audience and second-director text. C-2 and the
newer payroll-branch work were preserved. No PR, force-push, database reset/drop,
staging, production or environment publication.

### Commits and delivered behavior

| Commit | Build step |
|---|---|
| `d232308` | Schema, append-only settings/history, encryption registry, default-off HR capability |
| `e729aed` | Scoped resignation submission/decisions, notice snapshots, idempotent core separation link |
| `e8480bf` | Explicit clearance owners, live asset gate, reasoned director override, Tasks sources |
| `0cecf4e` | Encrypted, relationship-scoped interviews; user-room events; notification/audit filters; retention |
| `6001b6c` | Director-only exact day-count hand-off, internal completion callback, letter requests only |
| `b0c98bb` | Employee/admin screens, structured director forms, DEMO setup, browser scan coverage |
| `d149341` | Route/role/race regressions, HR-plus-Office switch bypass closed, retention after deactivation, DEMO leave types off |
| `85bba5d` | Merge `9dff126` from the payroll branch, retaining both branches' additive registry entries |
| `bc22a1a` | Merge the newer `bbd14e6` A-10 checkpoint found during final verification |
| `bb27005` | Audited DEMO appointment, catalog regressions, actor-scoped private UI caches/forms |

Resignations keep one active record per employee, snapshot only confirmed notice
rules and show **Not set** without a matching rule. Acceptance calls the original
`initiateSeparation` unchanged. Two simultaneous accepts return one linked case;
a stable neutral marker recovers a core write interrupted before the Peeps link.
Cancellation releases the active slot; moved last days are observed once with
history and recompute the day count. Missing-manager requests wait with directors.
The core separation receives a neutral reason, never the private resignation text.

Clearance snapshots the selected template and real active asset assignments. Both
the service and database transition guard use one live-blocker query, including
assets issued after checklist creation. A new assignment reopens readiness and
clears an earlier waiver. Directors override with a reason and audit, without a
second director. Item owners get only their tasks. The approved last day still
ends access with clearance open; interview retention runs after core deactivation
so a retention error cannot postpone it.

Interview answers are encrypted and registered for key rotation. Employee,
interviewer of record and directors are the only readers; director opens outside
their relationship are audited. Managers and Office membership never grant
interview access. Named HR interviewers can participate while general HR exit
management is off. Lists/counts, notifications, audit lists, Tasks and events
respect the current relationship. Events use user rooms; former interviewers get
an empty access refresh to discard cached screens. No answer text enters audit,
notifications or socket payloads. Directory `Employee.exitReason` remains `never`.

The hand-off reuses the leave ledger's exact balances across years as of the
agreed last day. It contains identifiers and day counts, no amounts. The recovery
intent provider does not exist, so its ID list is empty. `onSettlementCompleted`
is tested and internal, with no HTTP route and no payroll wiring. Director closure
requires ready clearance and a note. Letter buttons create idempotent requests
and notify directors; they do not issue a letter.

### Verification

All commands ran locally on isolated PostgreSQL 16 and Redis 7, using fresh test
databases. Each backend invocation used a new database; no reset/drop was used.
Only one backend suite ran at a time. The full run was alone, after stopping the
demo API/worker/frontend and browsers.

| Check | Observed result |
|---|---|
| Step 1 focused checks | 6 files / 48 tests passed; root lint/typecheck passed |
| Step 2 | 3 files / 19 tests passed; root lint/typecheck passed |
| Step 3 | 3 files / 19 tests passed; root lint/typecheck passed |
| Step 4 | 4 files / 26 tests passed; root lint/typecheck passed |
| Step 5 | 2 files / 9 tests passed; root lint/typecheck passed |
| Step 6 | Backend 5 files / 31 tests; frontend 2 files / 7 tests; root lint/typecheck passed |
| Step 7 | Restored guard suite: 6 files / 44 tests; additional DEMO regression: 9-test edge file passed; root lint/typecheck passed |
| A-9 merge | 4 files / 27 tests passed; root lint/typecheck passed |
| A-10 merge | 4 files / 22 tests passed, including attendance leave privacy; root lint/typecheck passed |
| Final lint/typecheck | Root lint/typecheck passed; latest frontend lint and build typecheck also passed after the cache change |
| Final frontend | 20 files / 89 tests passed, one worker; build passed |
| Final bundle budgets | Login 231.4 KB; employee shell/home 338.8 KB; admin shell/home 358.3 KB gzip, all within budgets |
| Biometric agent | 17 files / 166 tests passed; unchanged by A-10 |
| Full backend alone | **218 files / 2,154 tests passed**, zero failures/skips, 867.98 s; `bb27005`, fresh `c3_test_1793775663_10223` |
| Admin sensitive UI | 433 pages passed at A-9 checkpoint |
| Employee sensitive UI | 212 pages passed at A-9 checkpoint |
| Browser role matrix | 76 post-A-9 visits: director, HR off/on, manager, raiser, other employee; light/dark, 1280/390; no overflow or privacy failures |
| Browser writes | Nine actions completed through phone forms: submit, accept, complete item, ready, schedule, answer, named-HR complete while management off, letter request, director closure |
| A-10 production frontend delta | 120 visits passed over changed workforce settings/muster/manual-override and exit case/interview routes; six personas, light/dark, 1280/390 |
| Browser account switching | Two switches in the same production SPA document passed: no previous answer during pending authorization, unrelated reader denied, participant still authorized, no page errors |
| Final targeted regressions | 9 backend files / 83 tests passed |
| Fresh DEMO seed | Passed on `c3_demo_20261104_c`; manager appointment and permission exception use audited services |
| Four new leave types | All four inactive on the final scratch demo; audited deactivation regression passed; all four also inactive after the final full backend run |

Commands: root `npm run lint` and `npm run typecheck`; frontend `npm run test --
--maxWorkers=1`, `npm run build`, `npm run check:bundle`; biometric-agent `npm test`.
Full backend: `/tmp/c3-backend-tests.sh --reporter=verbose`, invoking Vitest with
`node_modules/.c3/config.ts`. This ignored local harness extends the normal config
and replaces destructive database setup with CREATE-only fresh scratch setup;
repository test selection and tests are retained. It ran alone, 07:01:03–07:15:32 UTC.
The test-time `docs/SENSITIVE_DATA.md` generated-table check also passed.

The standard full backend configuration excludes the separately configured
attendance-replay and demo suites, as it does in the repository's normal `test`
command. CI results remain unverified until the owner supplies them.

### Failures found and fixed

- The first schema/settings pass caught capability ordering and an older test
  assuming every HR capability is on by default. Existing defaults stayed the same;
  the new exits capability is explicitly tested off.
- The HR capability's database allow-list needed its additive migration. The
  director/ALL scope query needed an explicit unrestricted branch rather than an
  empty relation inside Prisma's OR. Focused tests then passed.
- Interview writes initially used a status outside the migration's allowed set;
  they now consistently use `SUBMITTED`. Fixture field/enum names and the expected
  deactivated-user status were corrected to the actual schema.
- The new overlap regression observed HR with Office membership reading a case
  while its exit switch was off (200 instead of 404). HR's switch now narrows both
  Office and manager paths. ON/OFF and membership/team changes are checked on the
  next request.
- A full frontend attempt under concurrent load timed out in the existing C-2
  visibility test (5 seconds). The full suite passed with one worker; timeouts were
  not increased and no tests were skipped.
- Setup initially rejected `MAIL_DRIVER=dev`; console mail was used. A seed invoked
  from the root missed the backend alias configuration and was rerun from backend.
  The demo manager's attempted reporting manager was refused by the existing
  hierarchy; the demo was corrected and seeded on a fresh database. No core rule
  changed. The account-switch browser initially expected a 403 message; the unrelated-record
  API correctly returns 404, so the assertion was corrected and rerun on the final
  production build. Browser automation selectors/loading waits were corrected for Ant
  Design 6 and the development toolbar; the production delta passed.
- The older medical DEMO fixture left its type active. The exits demo hand-off now
  uses the existing audited leave-type service to leave all four prepared types
  off. It preserves the historical fixture and makes no attendance/payroll edit.
- The first complete backend run finished **218 files / 2,154 tests: 215 files and
  2,151 tests passed, three failed** (881.25 seconds). The HR persona matrix omitted
  the new capability; it now explicitly tests the default-off exits door. A payroll
  test hardcoded eleven director steps; its marked test-only assertion now preserves
  the original eleven and verifies the optional exit step. The DEMO module directly
  assigned a role; it now reuses the audited manager appointment and access-exception
  services. The seed security fence and its allow-list were left unchanged. The
  targeted rerun passed **9 files / 83 tests**, and the fresh DEMO seed succeeded.
- Two new account-switch regressions failed on the original frontend: cached private
  answers and an unfinished resignation form survived a viewer change. All exit
  queries now include the employee identity, private responses are never used as
  placeholder pages, previous exit caches are cancelled/removed at sign-out or
  account change, and an actor boundary remounts forms. The tests now pass, including
  cancellation of a late private response while preserving unrelated queries. Private
  exit caches are also collected when their last screen closes; reopening after a
  relationship revocation waits for a fresh authorized response.
  The first generic placeholder wrapper failed typecheck; it was simplified before
  the final passing checks. No global authentication or access resolver was changed.

### Mutation checks

Each guard was broken on a fresh scratch run, its named test was observed to fail,
then the exact original file was restored. All five were killed; the restored exit
suite passed. No mutant remains in the branch.

| Guard broken | Named failure observed |
|---|---|
| Interview relationship filter | `manager sees team resignation but no interview, counts, audit, Tasks or general-case fields` |
| HR exit switch | `HR is off by default even with an explicit grant; ON and OFF take effect on the next request` |
| Live asset query (shared service/DB gate) | `an asset issued after every required item was completed still blocks readiness` |
| Partial unique-active index | `unique active resignation is a database rule even for concurrent direct writers; status history is append-only` |
| Director-only hand-off | `hand-off is directors-only even when HR's switch is on; unrelated employee is absent from letter requests` |

### Shared-file hand-off

The following are the C-3 edits in shared files, each inside a marked PEEPS block.
Line numbers refer to the final merged source. New `modules/exits` and
`features/exits` files are Peeps-owned. Incoming A-9/A-10 changes are separate,
retained upstream work; their attendance edits were not rewritten by C-3.

| Shared file | Final line(s) where the C-3 PEEPS blocks begin |
|---|---|
| `backend/prisma/schema.prisma` | 465, 781, 4098 |
| `backend/src/app.ts` | 1, 117 |
| `backend/src/lib/__tests__/cleanup.ts` | 102, 396 |
| `backend/src/lib/fieldKeyRotation.ts` | 14 |
| `shared/constants/permissions.ts` | 118, 163, 170 |
| `shared/constants/hrCapabilities.ts` | 24, 54 |
| `shared/constants/peeps.ts` | 13, 26 |
| `shared/constants/sensitiveData.ts` | 20, 41, 138, 225 |
| `shared/constants/directorAuthority.ts` | 18, 42 |
| `shared/constants/peepsPayrollContract.ts` | 1 |
| `shared/types/inbox.ts` | 35, 41 |
| `backend/src/modules/hrCapabilities/__tests__/hrCapabilities.test.ts` | 114 |
| `backend/src/modules/managers/__tests__/routeInventory.ts` | 38 |
| `backend/src/modules/tasks/service.ts` | 1, 179 |
| `frontend/src/components/inbox/TasksInbox.tsx` | 21 |
| `backend/src/modules/notifications/service.ts` | 1, 65, 90, 104, 121 |
| `backend/src/modules/auditLog/service.ts` | 1, 39, 42 |
| `backend/src/modules/auditLog/controller.ts` | 5 |
| `backend/src/jobs/worker.ts` | 1, 91 |
| `backend/scripts/demo/seedDemoCompany.ts` | 322 |
| `frontend/src/routes/employeeMenu.config.tsx` | 32, 383 |
| `frontend/src/routes/adminMenu.config.tsx` | 447 |
| `frontend/src/routes/PortalRoutes.tsx` | 5, 91, 110 |
| `frontend/e2e/sensitive-ui.mjs` | 78, 151, 247 |
| `docs/SENSITIVE_DATA.md` | 14 |
| `docs/GETTING_STARTED.md` | 983 |
| `docs/UI_SCREEN_MAP.md` | 215 |
| `backend/src/modules/hrCapabilities/__tests__/hrMatrix.test.ts` | 25, 31, 99 |
| `backend/src/modules/payroll/__tests__/runAuthority.test.ts` | 210 |
| `frontend/src/App.tsx` | 9, 26 |
| `docs/PROGRESS.md` | 5235 |

The six A-9 registry conflicts were additive: schema, app mounts, system roles,
route inventory, permissions and sensitive-data catalog. Both sides were retained;
no competing business rule was selected. A-10 merged automatically and kept the
existing leave privacy hooks. Core `employee/separations.ts`, the access resolver,
payroll application code and `.github/workflows/ci.yml` were not edited by C-3.
The only authored payroll-file edit is the marked catalogue assertion in the named
failing `runAuthority.test.ts`; it preserves all existing authority behavior checks.
The root App hook only expires exits caches; global authentication was not edited.
Three upstream A-9 files contained trailing blank EOF lines, flagged by the merge
diff check; those incoming lines were preserved. Final working-tree diff checks
passed at delivery (working-tree and staged changes).

### Settings left Not set / Decided by me

Outside labelled DEMO fixtures, no exit value is seeded: notice rules (including
counting basis and source), rejection, reason categories, checklist/owners,
questions, retention, overdue thresholds and Office audience remain Not set.
`MANAGE_EXITS` is off by default. `EXIT_APPROVAL` stays optional/Not set, without
being added to the required payroll-director choices. The four new leave types
stay off. No legal notice minimum, recovery rule or pay calculation was guessed.

Owner overrides applied: directors read interviews with audit; HR management is a
switch; interview relationships are independent; no mandatory second director;
letter requests only. Implementation choices: a director appoints interviewers,
preventing a handler from naming themselves to widen access; notice rules snapshot
at submission with exact-grade then employment-type fallback and an explicit
submission-day/next-day basis; clearance overrides are tied to their blocker
snapshot; existing separation dates/status remain authoritative; HR's switch
wins over an overlapping Office/manager capability; private frontend caches and forms
follow the current signed-in employee; retention removal keeps
metadata and append-only history.

### Deviations / Unverified

- Recovery-intent IDs are empty because that model is not built; no recovery or
  payroll adapter was invented. The internal completion hook is deliberately not
  wired to payroll. Issuing letters remains the existing flow.
- All business example values are labelled DEMO only. Native service binaries
  extracted from the approved isolated images ran in scratch directories/ports.
- CI for the delivery commit is **Unverified**. Per the C-3 prompt, the run ID and
  exact `gh run view` command are supplied in the reply; the owner will paste jobs.
  No CI job is claimed passed, including Docker, Windows, attendance replay,
  latency and either sensitive-ui half. Local browser results above are separate.
- No staging/production run or live legal/business value validation was requested
  or performed. Recruitment, insights and document autofill remain unstarted.

CI jobs for the delivery commit remain individually **Unverified**, awaiting the owner's paste:

| CI job | Result |
|---|---|
| `install-lint-typecheck-test` | Unverified |
| `docker-build` | Unverified |
| `agent-windows` | Unverified |
| `attendance-replay` | Unverified |
| `latency` | Unverified |
| `sensitive-ui (admin portal)` | Unverified |
| `sensitive-ui (employee portal)` | Unverified |

STOP at checkpoint C. Await the owner's CI results or next prompt.

## C-4A — Recruitment, checkpoint D1 (2026-11-05)

Scope: recruitment only. Clean start `e2b6e04`, one agent on
`peeps/foundation`. C-4B remains unstarted until D1 acceptance. No PR, force push,
production/staging change, database reset/drop or CI workflow edit. Local scratch
PostgreSQL 16 / Redis 7 binaries came from the previously approved isolated images;
every backend invocation created its own new database. Scratch databases retained.

### Commits and delivered behavior

| Build step | Commit | Result |
|---|---|---|
| 1 schema/settings | `d6b91c3` | Encrypted identity/feedback, blind indexes, append-only settings/pipelines/history, encryption/cleanup catalogs |
| 2 requisitions/jobs | `620937a` | Scoped manager requests, chosen approval route, direct or requisition jobs; no money |
| 3 candidates/applications/CV | `a092e25` | Consent/retention gates, neutral duplicates, stage races, private validated CV bytes and open audit |
| 4 interviews/feedback | `0a13016` | Active panel and own-submission rules, director read audit, encrypted immutable answers, notification/audit/socket predicates |
| 5 candidate email | `2f8c082` | Director-written templates, private transport logging, idempotent receipts without body/recipient; console honestly PREPARED |
| 6 retention/erase | `31d7807` | Director confirmed-request erasure, scheduled anonymization, storage-failure retry and immediate expiry redaction |
| 7 screens/DEMO | `fad242e` | Jobs stepper, stage board/table, candidate drawer/activity/CV/email, scheduling/evaluation, settings, private caches and fictional DEMO |
| 8 regressions/mutations | `7d54727` | Every-route access tests, late-response lifetime guards, test-only authority-card teardown fix |

Latest `origin/feat/hr-payroll-separation` fetched: `bbd14e6`. Merge reports
**Already up to date**: payroll has not moved beyond the C-3 merge. No competing
rule or conflict was chosen. Eight build commits are followed only by verification
and report updates. `.github/workflows/ci.yml`, access resolver, employee separation
writer, attendance and payroll application code remain unchanged by C-4A.

### Verification and observed failures

Changed tests, root lint and root typecheck ran before each build commit.

- Step 1: initial permission-catalog insertion used the wrong array shape; corrected.
  First selected run 66/67 passed: HR catalog order assertion needed its new key in
  catalog order. Corrected file 18 passed; other six files 49 passed. Documented
  rotation-test filename was stale; actual `fieldEncryption.test.ts` ran, 16 passed.
- Step 2: 16/17 passed initially. Empty nested OR was ignored by Prisma, allowing
  HR OFF to see a job. Explicit impossible-id scope fixed it; jobs 6 passed, other
  two files 11 passed.
- Step 3: three CV tests failed because option names did not match the shared upload
  helper. Corrected mapping. New contact-search regression exposed a private-email
  confirmation oracle for summary users; summary search now uses name only. Final
  three files / 17 passed.
- Step 4: first privacy run three files / 22 passed. Genuine feedback key rotation
  then exposed immutable-row rejection. Added only an InterviewFeedback maintenance
  branch after shared plaintext equality verification, transaction-local flag and
  cipher-only row guard; old model writers preserved. Extended run 48/49 passed;
  marked DB-role catalog/privilege test updated, its 10 tests passed. Other four
  files / 39 passed, including rotation/back-rotation and normal-edit refusal.
- Step 5: three files / 12 passed. One typecheck overlapped Prisma generation and
  saw the old client; sequential rerun after generation passed.
- Step 6: five files / 30 passed. Retention three-test rerun also passed after making
  expired-awaiting-cleanup versus physically anonymized states explicit.
- Step 7: UI component API/import mistakes and metadata signal `userId` typo caught
  by lint/typecheck and corrected. Initial board fixture omitted required nullable
  phone: two board assertions failed, fixed fixture and both passed; other two
  files / 11 passed. Frontend two files / 6 passed. Build/budgets passed.
- Step 8: restored recruitment suite **9 files / 46 tests passed**. Its source-derived
  inventory covers all **36 routes**: anonymous 401, Developer 403, unrelated employee
  denials or empty scoped lists. Frontend private guard suite **3 files / 8 passed**.
  Late CV responses cannot start a download after the actor view unmounts.
- First full frontend run had 97 assertions pass but exit 1: React work from the
  static Ant toast outlived jsdom in `DirectorAuthorityCard.test.tsx`. Marked test-only
  toast stub and awaited mutation completion fixed it. Full rerun **23 files / 97
  tests passed, exit 0**. No production payroll component changed.

Final checks passed (all exit 0): root lint and typecheck; full frontend **23
files / 97 tests**; frontend build and bundle budgets (login 231.5/250 KB gzip,
employee shell/home 339.4/400, admin shell/home 358.9/400); biometric agent **17
files / 166 tests**; **FULL backend 227 files / 2,201 tests**, alone, fresh database
`c4a_test_1793867257_13035`, 1,022.36 seconds. API, worker and preview were stopped
before the run. No test failure or unhandled error in that final backend run.
The standard suite excludes replay/demo files per its existing config; fresh DEMO
seeding and the browser scans ran separately. CI-only jobs remain Unverified.
Final added whitespace outside shared PEEPS blocks was removed; lint passed again.
Latest payroll was fetched again at delivery and remains `bbd14e6`, already included.

Browser: **76** role/theme/width screen visits passed: director, HR recruitment OFF
and ON, requesting manager, submitted interviewer, unrelated employee and Developer;
light/dark at 1280/390 px. Checked list/board/interview/settings as applicable, no page
overflow or page errors. Same-SPA account switch test: two switches, zero old-answer
leaks during pending authorization, unrelated denied, returning panel authorized.
Extra action walkthrough on 390 px passed across successive runs: create/open a
job through the stepper, create a consented candidate, upload a private CV, apply
and move stages with activity, schedule a panel (SCHEDULED row verified by SQL),
and send a chosen invitation with a PREPARED-local receipt. Automation retries
corrected closing-dropdown, phone tab-overflow and ambiguous nested-drawer
selectors; no application page errors were observed. Final mail run exit 0.

Fresh database `c4a_demo_20261105`: migrate, `tsx prisma/seed.ts`, then guarded
`seed:demo-company` passed. The destructive convenience reset script was never run.
Only labelled DEMO choices/candidate/contact/PDF/panel answers added. Normal seed
chooses no recruitment rules. All four prepared leave types remain off: all four rows have `is_active=false`, verified by SQL.

Sensitive scan attempts run alongside other browser logins hit the scratch API's
shared login rate limit (director API sign-in / employee navigation timeout). Those
attempts are failed, not claimed passed. Reran the two halves sequentially with
scratch authentication counters cleared between halves: admin **454 pages passed**, employee **228 pages passed**, both exit 0.

### Mutation checks

Each mutation used a fresh database; each guard was restored in `finally`, followed
by the complete 9-file / 46-test recruitment rerun passing. The runner initially
missed the own-submission source string, stopped after restoring the first mutation;
corrected target and completed the remaining four. No mutant remains.

| Broken guard | Named failing test observed |
|---|---|
| Feedback director filter broadened to management | `HR management ON exposes scheduling metadata but never feedback; OFF takes effect next request` (also Office/former-panel checks) |
| Own submission condition removed | `an interviewer sees only own feedback until submitting, then the rest of the current panel; before-submission audit counts also hide others` |
| HR explicit-ON condition bypassed | `HR is off even with a grant, ON opens only recruiting duties and OFF takes effect on the next request` |
| CV access widened to all retained records | `requesting manager cannot read a CV; assigned interviewer can and every outside-team open is audited` |
| Stable duplicate HMAC randomized | `racing duplicate identities create one encrypted candidate; warnings reveal no other candidate data` (201/201 versus required 201/409) |

### Shared-file hand-off

All authored shared edits are marked PEEPS blocks; new recruitment module/feature
files and migrations are Peeps-owned. Final line spans follow (nested parent spans
are included where an existing Peeps block was extended).

| Shared file | Final marked line span(s) |
|---|---|
| `backend/prisma/schema.prisma` | 398–401, 426–429, 566–570, 4476–4688 |
| `backend/scripts/demo/seedDemoCompany.ts` | 325–327 |
| `backend/src/app.ts` | 1–3, 120–122 |
| `backend/src/integrations/mail/ConsoleMailService.ts` | 29–33, 38–40 |
| `backend/src/integrations/mail/MailService.ts` | 2–4 |
| `backend/src/integrations/mail/SmtpMailService.ts` | 46–49, 51–53 |
| `backend/src/jobs/worker.ts` | 1–3, 94–100, 97–99 |
| `backend/src/lib/__tests__/cleanup.ts` | 32–35, 106–111, 185–187, 510–512 |
| `backend/src/lib/__tests__/dbRoles.test.ts` | 87–89, 103–105 |
| `backend/src/lib/dbRoles.ts` | 32–34 |
| `backend/src/lib/fieldKeyRotation.ts` | 14–17, 163–175 |
| `backend/src/modules/auditLog/service.ts` | 1–3, 45–49, 46–48 |
| `backend/src/modules/hrCapabilities/__tests__/hrCapabilities.test.ts` | 114–119, 115–118 |
| `backend/src/modules/hrCapabilities/__tests__/hrMatrix.test.ts` | 31–33 |
| `backend/src/modules/managers/__tests__/routeInventory.ts` | 38–75 |
| `backend/src/modules/notifications/service.ts` | 1–3, 67–73, 68–72, 69–71, 94–100, 95–99, 96–98, 110–116, 111–115, 112–114, 129–135, 130–134, 131–133 |
| `backend/src/modules/payroll/__tests__/runAuthority.test.ts` | 211–214 |
| `docs/GETTING_STARTED.md` | 1002–1007 |
| `docs/PROGRESS.md` | 5257–5280 |
| `docs/SENSITIVE_DATA.md` | 14–52, 15–51 |
| `docs/UI_SCREEN_MAP.md` | 227–235 |
| `frontend/e2e/sensitive-ui.mjs` | 68–117, 78–81, 155–161, 157–159, 278–293 |
| `frontend/src/App.tsx` | 1–3, 33–36 |
| `frontend/src/components/payroll/__tests__/DirectorAuthorityCard.test.tsx` | 12–16, 127–129 |
| `frontend/src/routes/PortalRoutes.tsx` | 1–4, 95–98, 118–121 |
| `frontend/src/routes/adminMenu.config.tsx` | 455–462 |
| `frontend/src/routes/employeeMenu.config.tsx` | 32–35, 387–390 |
| `shared/constants/directorAuthority.ts` | 7–9, 45–47 |
| `shared/constants/hrCapabilities.ts` | 27–29, 60–62 |
| `shared/constants/peeps.ts` | 13–19, 15–17, 30–32 |
| `shared/constants/permissions.ts` | 118–125, 178–185 |
| `shared/constants/sensitiveData.ts` | 20–23, 45–48, 146–148, 236–238 |


The payroll test edits are test-only: `runAuthority.test.ts` includes the new
optional step in its catalog assertion without weakening authority checks;
`DirectorAuthorityCard.test.tsx` stubs only toast side effects and awaits success.
HR matrix/catalog and DB-role test changes describe the additional key/column
maintenance permission. Generic Tasks was deliberately not extended with feedback.
Notification list/count/mark-read and audit predicates filter before counts, using
one recruitment policy module; socket data is empty and user-room-only.

### Settings left Not set / Decided by me

Outside labelled DEMO, pipelines/stages, scorecard questions/recommendations,
sources, rejection categories, requisition route, retention, email templates, CV
size/type choices and Office audience remain **Not set**. HR recruitment management
requires explicit ON; DEFAULT/OFF refuses even with a raw grant. Required missing
choices block only their affected step with a clear message. No quota/window,
retention duration, rubric, approval route or file policy was silently preset.

Owner overrides applied: director access with outside-panel read audit; HR duties
controlled separately from named-panel relationships; Office needs capability and
audience; managers get own-request summaries only; no mandatory second director;
no public form or job money. Approval route Not set means no approval, per the
owner's explicit exception. Optional RECRUITMENT_REQUISITION is Not set/OFF.

Implementation choices: immutable pipeline and scorecard snapshots; optimistic
application versions plus row locks; normalized HMAC duplicate indexes; management
contact search and summary name-only search; no provider errors/private content in
mail receipts; PREPARED for console; retention hides expired values immediately
and keeps storage references on failure for retry. Explicit confirmed candidate
request is the erase reason; free text containing candidate data is not retained.
Private queries/forms and delayed callbacks follow actor/access lifetime. No
recruitment data is placed in generic Tasks.

### Deviations, hooks for later, Unverified

- D1 frames reuse existing design components; offer/compensation/joining/referral
  portions are deliberately partial until C-4B. No public application or link exists.
- Non-personal application/job/candidate identifiers and history, immutable pipeline
  versions and mail interface are hooks for C-4B. No offer/conversion/letters writer
  or compensation hook was prematurely implemented. Onboarding's separate default-ON
  switch remains C-4B scope. Insights and document autofill remain unstarted.
- Actual SMTP/SES delivery is **Unverified**; local/fake providers exercise private
  logging, template/state validation, idempotency and unknown delivery status.
- No staging/production or real legal/business values were used or verified.
- CI for delivery HEAD is **Unverified**, awaiting the owner's pasted per-job
  result. Local passing checks are separate. Run ID and exact `gh run view` command
  are supplied in the delivery reply. No CI job is claimed green.

| CI job | Result |
|---|---|
| `install-lint-typecheck-test` | Unverified |
| `docker-build` | Unverified |
| `agent-windows` | Unverified |
| `attendance-replay` | Unverified |
| `latency` | Unverified |
| `sensitive-ui (admin portal)` | Unverified |
| `sensitive-ui (employee portal)` | Unverified |

STOP at checkpoint D1. Await the owner's CI paste/acceptance. C-4B is not started.

## C-4B — Stage 1 of 4: sync, clean-up, recruitment part B (2026-11-11/12)

One agent on `peeps/foundation`, clean start at `1a1ef46`. No PR, force-push, staging/production change, database drop
or CI workflow edit. Commands ran with `DATABASE_URL`/`PORT` unset (the shell exported a remote database); local
PostgreSQL 16 / Redis 7, every scratch database new. The real-data folder was never opened.

### Commits

| Step | Commit | Result |
|---|---|---|
| 0.1 | `63dc34e` | `docs/samples/` removed unread ("remove sample folder pending clean synthetic files"); history untouched. No code, test or doc depended on it; only older plan notes name the folder, so nothing was skipped. |
| 0.2 | `c6dda07` | Merged `feat/hr-payroll-separation` `64d3246` (35 commits). Two schema conflicts, both sides kept (Session A first, PEEPS blocks after); no `prisma format` churn. Payroll catalogue test's PEEPS block (eleven original steps + optional exit/requisition) unchanged; Session A's tests intact. |
| 0.4 | — | Guide mapping already in PEEPS_PLAN §A.1 (`d7fa323`); nothing to add. |
| C-4B backend | `c1bcae4` | Offers, director-only pay, expected pay, joiner links/documents/exceptions, conversion, referrals; migration `peeps_20261111090000_recruitment_offers`; registries; 9 tests. |
| C-4B screens | `eeb7b8e` | Offers and joining page, candidate Offer tab, settings editors, public upload page, Referrals page, DEMO offer, scans, docs. |

### What shipped

- **Offers** (`offers.ts`, `offerAccess.ts`): non-pay terms (role, department, manager, joining date, location, type) for
  Wellsure Office members (recruitment capability + Office audience) and directors; HR onboarding reads accepted offers
  only. States DRAFT → PROPOSED → APPROVED (only if `offerApproval` is on; Default off) → ISSUED → ACCEPTED / DECLINED /
  EXPIRED, and WITHDRAWN (reason required). Approve and issue are director-only; issue needs pay and the confirmation that
  the letter went through Letters (optional reference code). Peeps never builds the letter. One live offer per
  application (partial unique index). Optimistic version + row locks; retries idempotent. `recruitment_offer_events` is
  append-only (trigger + app role loses UPDATE/DELETE). Free text refuses pay-like content.
- **Pay**: `recruitment_offer_compensation` (encrypted exact decimal as text, INR, annual/monthly) is written only by a
  director (service + DB trigger), editable in DRAFT/PROPOSED, every open audited, audit rows carry a version not the
  figure. Candidate expected pay (did not exist in C-4A; added) is an encrypted candidate column behind director-only
  routes. Both registered in `ENCRYPTED_COLUMNS`; new sensitive classes RECRUITMENT_PAY (`recruitment.pay.view`,
  HR- and Developer-forbidden) and JOINING_DOCUMENTS. Erasure clears expected pay, offer pay and joining documents.
- **Payroll interface (Session A)**: `readAcceptedOfferForPayroll(directorUserId, employeeId)` — director-only, audited,
  read-only, no route; returns offer id, joining date, type and pay of the accepted offer behind a converted employee.
  No payroll, deduction or salary-setting code.
- **Joiner links** (`joining.ts`): 32 random bytes (base64url), SHA-256 at rest, token shown once; lifetime from
  `joinerLinkLifetime` (Not set → refuse); only `joinerDocumentTypes` (Not set → refuse) with per-type MIME/size and the
  platform's `prepareDocumentUpload` (extension, magic bytes, image re-encode); new link revokes the old; link spent when
  every type is uploaded; one upload per type per link; rate limits per address (60) and per link (20) per 10 min
  (technical abuse limits, not business values); public page returns only document types and expiry. Documents in a
  private storage prefix; HR onboarding and directors download (audited). Exceptions only by the director-chosen
  `joiningExceptionApprover` (Not set → refuse); append-only.
- **Conversion** (`conversion.ts`): existing `createEmployeeInTx` unchanged; HR enters the employee code and the Add
  Employee personal fields; non-pay data copied from the candidate (name) and offer; offer row lock + unique conversion
  (candidate, offer, application, employee) → retries, double clicks and simultaneous requests return one employee;
  application → HIRED; links revoked. No bank, identity or pay copied (HR adds bank/identity later via existing writers).
- **HR onboarding switch**: `RUN_ONBOARDING` over new key `recruitment.onboarding`, held by both HR roles by default
  (migration + role default); a director switch OFF removes it on the next request.
- **Referrals** (`referrals.ts`): `referrals` setting Default off; employees refer to open jobs with recorded consent;
  recruiting team accepts (creates the candidate, identity moves) or closes; referrer sees SUBMITTED / IN_REVIEW /
  CLOSED only; unaccepted referral identity purged at retention.

### Verification actually run

- Full backend suite alone on merge `c6dda07`: **243 files / 2,278 tests passed** (1,095 s).
- Final full backend suite alone on `eeb7b8e`: **244 files / 2,288 tests passed** (1,164 s), exit 0.
- Changed tests before each commit: C-4B 9 tests, route inventory, HR capability matrix/catalog, recruitment folder,
  `src/lib`, access, sensitive-docs — all passed after the fixes below.
- Frontend: 24 files / 99 tests (new `offerPrivacy.test.tsx`); lint + `check:tokens`; typecheck; build; bundle budgets
  login 232.0/250 KB, employee shell 340.7/400, admin shell 360.2/400.
- `test:demo` 1 file / 7 tests passed.
- Migration: fresh database migrates with `db:drift`-style diff "No difference detected"; a copy at the pre-C-4B
  migrations holding an existing candidate row migrated cleanly, row unchanged, new columns null.
- `check:sensitive-ui` on a fresh normal + DEMO seed, halves run sequentially: **admin 532 pages, employee 238 pages
  passed**. New rules: DEMO offer pay 7777123.45 / expected pay 6666123.45 never on a non-director page; no joining
  storage key; director and HR onboarding see the accepted DEMO offer, the Developer does not.
- `check:popovers` on a fresh normal seed: passed, incl. the new offer state filter at 390/1280, light/dark.
- Browser walkthrough (Playwright): director, HR, Office member (capability + audience set on the scratch DB only),
  employee (portal and admin URL) × 1280/390 × light/dark = 20 visits; public page 4 visits + invalid-token state;
  loading, error and empty states. No pay before "Show pay", director sees pay after it, Office/HR never see pay UI,
  no horizontal overflow, no page errors. Screenshots kept in the session scratchpad only (none committed).
- Four prepared leave types remain inactive (SQL).

### Failures found and fixed

- Prisma `migrate diff` output carried a CLI warning line into the migration; first scratch apply failed; stripped.
- Public route returned 401: the bare `/api` router's `authenticate` ran first; mount moved into `BASE_MOUNTS`.
- HR capability tests required every capability key to be a role default and a matrix door: switched onboarding to a
  real default key (`recruitment.onboarding`) and added the door.
- Route inventory listed 25 unclassified routes; classified. `SENSITIVE_DATA.md` generated tables regenerated.
- Lint: synchronous setState in an effect on the public page; rewritten with React Query.
- Walkthrough script bugs (session reuse with rotating refresh tokens, "Open the menu" matched "Open"); fixed in the
  script, not the app. A broad `kill` pattern once matched its own shell (nothing was running; no effect).

### Mutation checks (each restored; C-4B test file rerun)

| Broken rule | Named failing tests |
|---|---|
| Pay visible to Office (`payDirector` widened) | route matrix; "offer pay and expected pay reach directors only…"; states test |
| Idempotent conversion replay | "conversion: two simultaneous requests and a retry create exactly one employee…" |
| Link expiry ignored | "joiner links refuse until lifetime and document types are chosen; then reuse, expiry…" |

### Tests added (backend `offers.test.ts`)

Every C-4B route anonymous 401 and Developer 403 with a source-derived enumeration; matrix for employee, manager, HR
(onboarding on and switched off), Office member, non-member and director; pay never in lists/detail/search/counts/audit
rows/notifications for anyone but a director, ciphertext at rest, pay-like free text refused; states, approval
optional, append-only events (DB), director-only pay trigger; links (Not set refusals, hash only at rest, reveals
nothing, wrong type, content mismatch, oversize, unlisted type, duplicate, spent/reuse, revocation, new link revokes,
expiry, audited HR download, others refused); per-link rate limit; exceptions approver Not set/wrong person/right
person, append-only; conversion race + retry → one employee, HIRED, no bank/statutory/salary rows, payroll interface;
referrals off then basic status only.

### Settings left Not set (refuse their step until a director chooses)

`joinerLinkLifetime`, `joinerDocumentTypes`, `joiningExceptionApprover`. Shipped **Default: off, change in settings**:
`offerApproval`, `referrals`. HR onboarding Default on (`RUN_ONBOARDING`). Unchanged from C-4A: sources, retention,
pipelines, scorecard, rejection reasons, email templates, CV rules, Office audience, requisition route. The DEMO company
chooses fictional link lifetime and document types only.

### C-4A review against this prompt's rules

- Pay: no job pay bands, offers or expected pay existed in C-4A; nothing visible to non-directors. OK.
- HR recruitment explicit ON, Office capability + audience, panel-only feedback, no second director, no public form,
  key-rotation exception limited to InterviewFeedback (not widened here). OK.
- **Finding (not changed):** the DEFAULTS RULE says hiring stages and interview rounds ship with conventional values
  marked "Default, change in settings". C-4A leaves pipelines/stages Not set and the interview round is free text.
  Fixing it changes C-4A's pinned Not-set behaviour and its tests, so I left it for an owner decision (proposal: a
  default pipeline row and a default round list, both director-changeable and audited). Badge list, nudge list,
  notice period (30 days) and exit checklist defaults belong to earlier modules and are not touched in this stage.

### Decided by me

Expected pay added as a new director-only field (none existed); offer pay as a mutable encrypted side table with an
append-only event ledger (keeps key rotation/erasure without a new trigger exception); non-pay terms fixed at creation;
joining documents stay in Peeps (not copied to employee documents); conversion does not auto-send the invitation; HR
enters the employee code (no code series exists in the employee service); exception approver chosen as an employee;
technical rate limits 60/20 per 10 min; a new link revokes the previous one; link spent when complete; Office member
reads offers only under C-4A's Office audience; HR with MANAGE_RECRUITMENT gets no offer access.

### Shared-file hand-off (all inside `PEEPS-BEGIN/END recruitment-offers` blocks unless noted)

`backend/prisma/schema.prisma` (new models; Candidate/Application/Job back-relations), `backend/src/app.ts`,
`backend/src/lib/fieldKeyRotation.ts`, `backend/src/lib/systemRoles.ts`, `backend/src/lib/__tests__/cleanup.ts`,
`backend/src/modules/managers/__tests__/routeInventory.ts`, `backend/src/modules/hrCapabilities/__tests__/hrMatrix.test.ts`,
`backend/scripts/demo/seedDemoCompany.ts`, `shared/constants/{permissions,hrCapabilities,sensitiveData}.ts`,
`docs/SENSITIVE_DATA.md` (generated section regenerated), `docs/{GETTING_STARTED,PROGRESS,UI_SCREEN_MAP}.md`,
`frontend/src/routes/{router,adminMenu.config,employeeMenu.config}.tsx`, `frontend/e2e/{sensitive-ui,popovers}.mjs`.
No payroll application code, HR switch framework code, access resolver, attendance or CI workflow changed.

### CI read per job

| Job | Run 290 (`c6dda07` merge) | Run 301 (`eeb7b8e`, final code) |
|---|---|---|
| install-lint-typecheck-test | success | **failure (attempts 1 and 2): Test step hit its fixed 18-minute limit**; no failing assertion, no hang (attempt 2: 173 of 244 backend files done, tests still completing at the timeout) |
| docker-build | success | success |
| agent-windows | success | success |
| attendance-replay | success | success |
| latency (incl. popovers) | success | success |
| sensitive-ui (admin portal) | success | success |
| sensitive-ui (employee portal) | success | success |

C-3 run 255 and C-4A run 256: all seven jobs success.

**Why the test job is red.** `npm run test` (backend + frontend + agent) has `timeout-minutes: 18`. The merge run did it in
13.7 min. On run 301 both attempts' runners were ~40–60% slower in every step (install 71/59 s vs 43 s, lint 43/55 s vs
33 s, typecheck 64/72 s vs 44 s); the suite itself grew ~6% locally (1,095 → 1,164 s, 10 new tests). One fix attempt
(re-running the failed job, no empty commit) timed out the same way. The limit is in `.github/workflows/ci.yml`, which
this stage may not edit. **Owner/Session A decision:** raise that step's limit (e.g. to 25 min, like the job's own
limit) or split the backend suite. Every other job and the local full suite are green.

### Unverified

- **CI `install-lint-typecheck-test` on `eeb7b8e`: red by step timeout (above); the backend/frontend/agent tests did
  not complete in CI.** Local full suite alone passed.
- Real SMTP/SES delivery of anything; no email carries offer content in C-4B.
- `check:sensitive-ui` was not mutation-tested for the new pay rule (a 20-minute crawl); the backend pay tests were.
- No dedicated log-capture test for pay; request logs are a no-body allowlist and C-4B code logs no values.
- HR switch toggle for `RUN_ONBOARDING` is not added to the scan's CAPABILITIES loop (scan time limit).
- Office member offer screens checked in the browser only with a scratch-DB capability change, not in the DEMO seed.

## Stage 2 of 4 — sync, carry-overs, Insights, document autofill (2026-11-12)

One agent on `peeps/foundation`, same session as stage 1 (checklist current). No PR, force-push, staging/production change,
database drop or CI-file change; `DATABASE_URL`/`PORT` unset on every command (the shell exports a remote database);
scratch databases only. `docs/samples/` stays removed and unread.

### Commits

| Step | Commit | Result |
|---|---|---|
| 0 | `92d28d6` | Merged `feat/hr-payroll-separation` `f915ba3` (Session A's CI sharding and the HR bank/statutory confirmation work, unchanged). Conflicts kept both sides: schema (Session A first), the Tasks sources and task types (their claim/identity sources + Peeps exit sources), `SENSITIVE_DATA.md` regenerated inside the Peeps markers. Payroll test edit kept. |
| 1 | `5d1f4ec` | Default stages and rounds; joining-document copy at conversion; employee-code refusal; DEMO Office member capabilities; log-capture test; scan toggles `RUN_ONBOARDING`. |
| 2 | `44c3aef` | Insights. |
| 3 | `c4872ca` | Document autofill. |
| fix | `4861610` | CI run 323 findings (see below) + docs. |
| docs | `63c20e5`, this commit | Checklist and this report. |

### Step 1 carry-overs

- **1.1** Hiring stages ship as pipeline version 0 "Default hiring stages" (Screening, Interview, Offer, Hired, Not moving forward),
  inserted by migration with the director-only insert trigger paused for that one statement; interview rounds ship as
  `SETTING_DEFAULTS.interviewRounds` (Screening call, Technical interview, Hiring manager interview, Final interview). Both show
  "Default, change in settings"; a director's choice replaces them (audited). A job opened with no pipeline uses the default.
  **Changed tests (none weakened):** `schemaSettings.test.ts` "start Not set" now expects exactly those two defaults (state
  DEFAULT, the default stages as version 0) and still requires every other setting to start Not set and refuse; plus a new test
  that a director's choice replaces the default and HR cannot. `jobs.test.ts` "cannot open without a pipeline" now opens on the
  default (asserting version 0), then reopens on a director's pipeline, and still checks the four history rows.
- **1.2** Conversion copies each uploaded joining document into the first active employee category with STATUTORY sensitivity
  (restricted: HR identity/bank view; employees cannot see them; pay categories never used), via the append-only
  `recruitment_conversion_documents` ledger, unique per joining document. Copies are made before the transaction (storage cannot
  roll back) and discarded if the request does not create the employee. Test: two simultaneous conversions + a retry → exactly
  two employee documents, STATUTORY, hidden from the employee, no pay figure.
- **1.3** HR still types the employee code; an existing code is refused (409 `EMPLOYEE_CODE_TAKEN`, "already in use") before any
  write, and a race for one code is decided by the database unique index and mapped to the same refusal. Test: two different
  offers racing for one new code → one employee, one 409.
- **1.4** DEMO008 (DEMO Office member) gains MANAGE_RECRUITMENT and VIEW_INSIGHTS and the DEMO Office audience opens; checked in
  the browser as that member (offers visible, no pay UI). Log-capture test: no offer-pay or expected-pay figure in any log line
  during director and non-director pay requests. The scan switches `RUN_ONBOARDING` with the other HR duties. The deliberate
  break of the scan's pay rule: see "Scan pay-rule proof" below.

### Step 2 Insights

See PEEPS_PLAN §B.10 stage 2 record. Tests (`insights.test.ts`, `suppression.test.ts`): route enumeration with anonymous 401
and Developer 403; matrix (director and Office member allowed; employee, manager, HR, non-member refused; only a director sets;
the database refuses a non-director setting); Not-set refusal naming every missing setting for each metric and export; on real
output for k = 3, 5 and 1000, no visible cell below k and the people recoverable by subtraction are 0 or ≥ k; audit of views and
exports; leak test over responses, exports and log lines (no free-text reason, no person's name, no salary/interview/employeeId,
and the module source reads no exit interview or pay table). Property test: 5,000 random populations (k 2–10, 1–8 cells, zero
cells included) checked by an independent attacker that only reads the published table; also the classic one-small-cell attack
and the whole-table-below-k case. **Mutations:** k rule disabled → property test, classic attack and real-output test fail;
Not-set refusal removed → the refusal test fails.

### Step 3 document autofill

See PEEPS_PLAN §E stage 2 record. Synthetic documents are generated by `__tests__/synthetic.ts` (pdf-lib text PDFs, an SVG-text
image rendered by sharp, random noise, a drawn-only PDF, and a hand-built password-protected PDF using the standard security
handler R2); every value is DEMO or a reserved pattern. Tests (`autofill.test.ts`, 10): route enumeration, anonymous 401,
Developer 403 (before validation); uploads refuse while retention is Not set, defaults shown for file types/size; matrix
(employee/manager/non-member refused; Office: resumes only; HR: employee documents only while HR recruitment is off; director
all; wrong subject kind 400); extraction suggests correct values and saves nothing (no held change, bank rows unchanged);
per-field authority (HR with statutory edit revoked can open an identity document and confirm the name, but sees no PAN/Aadhaar
values and is refused 403 on both, even sent directly); re-run never overwrites an accepted correction and is idempotent by key;
two simultaneous extractions → one claim, one result row; apply needs every bank field (never a guessed value), HR's bank entry
is held for a director (no bank row written), a second apply is a no-op, reviews lock after saving, a resume updates the
candidate; no extracted value in log lines, queue payloads (id only), notifications, audit rows or candidate search, and
ciphertext only at rest; password-protected → PASSWORD_PROTECTED, noise and no-text PDF → POOR_QUALITY, oversize, wrong type
and mislabelled → 400, with manual entry still working; a clear image is read by the local OCR. **Mutations:** extraction writes
the bank account → the never-auto-save test fails; review-level authority removed → the per-field test fails;
document-level authority removed → matrix and authority tests fail. The first review-level mutation survived because every
document kind had a single authority; the identity document's comparison-only name field was added so the rule is testable.

### Verification actually run

- Full backend suite alone on the merge `92d28d6`: **254 files / 2,332 tests passed**. CI run 313: all 12 jobs green to the end.
- Full backend suite alone on `c4872ca`: 257 files, 2,354 passed, **1 failed** (`developerCeiling` registry, fixed in `4861610`).
- Final full backend suite alone on `4861610`: see "Final checks" below.
- Frontend: 25 files / 102 tests; lint, typecheck, build; budgets login 232.0/250, employee shell 342.4/400, admin 361.4/400.
- Migrations: each new migration applied on a fresh scratch database with `migrate diff` "no difference"; see "Final checks".
- Changed tests, lint and typecheck before every code commit.

### Failures found and fixed

- Container restarts twice stopped Postgres/Redis (restarted; nothing lost).
- `businessToday()` returns a Date, not a string (Insights 500s in the first run); fixed.
- Zero totals are published as 0 (reveal nobody); two test assertions were too strict and were corrected, not the rule.
- A schema model first landed inside another model's PEEPS block; moved.
- Lockfile: an `npm install` bumped unrelated transitive packages; the lockfile was rebuilt from HEAD so only the new packages
  (tesseract.js 7.0.0, @tesseract.js-data/eng 1.0.0) are added and `pdfjs-dist` (same 6.3.289) moves to runtime dependencies.
- Validation ran before the Developer refusal on autofill routes (400 instead of 403); both new routers now refuse the
  Developer first.
- CI run 323 (`44c3aef`): `developerCeiling` (insights.view in two classes via `meta: true`) and `check:popovers` at 390 px
  (settings rows are cards on phones). Both fixed in `4861610`.

### Final checks

- **Final full backend suite alone on `4861610`: 257 files / 2,355 tests passed** (1,454 s), exit 0.
- Fresh database `wellsure_s2scan`: all migrations applied, `migrate diff` against the schema: no difference; normal seed +
  guarded DEMO seed passed; all four prepared leave types inactive (SQL).
- **Scan pay-rule proof (1.4d):** with a deliberate temporary break (the offer view appended the DEMO pay figure to the role
  title for everyone), the admin half of `check:sensitive-ui` failed exactly three times — "an HR Admin", "an HR Admin (every
  duty on)" and the dedicated offers visit, all "offer pay or expected pay outside the directors" — and reported nothing else.
  HR with every duty off (onboarding switched off) did not reach the page. Source restored with `git checkout` (clean).
- Browser walkthrough (Playwright, 56 visits + 4 states): director, HR, Wellsure Office member (DEMO008, from the DEMO seed)
  and employee × 1280/390 × light/dark over Insights, Document autofill (list and review of a synthetic bank PDF uploaded by
  HR and read by the worker), and Offers. Director and Office member see Insights figures with no person codes; HR and the
  employee are refused by the shell ("This is not switched on for you"); the employee is refused Document autofill; HR's review
  page shows the bank suggestions; the Office member sees the accepted DEMO offer and no pay UI; no horizontal overflow, no
  page errors. Loading, error and empty states checked on Insights and autofill (phone, dark). Screenshots kept in the session
  scratchpad only; none committed.
- `check:popovers` (incl. the Insights and autofill dropdowns at 390/1280, light/dark) and both `check:sensitive-ui` halves
  (incl. the Insights, autofill and onboarding-toggle rules) passed in CI run 330.

### CI read per job (to the end of each job, including cleanup)

| Job | Run 313 (`92d28d6` merge) | Run 323 (`44c3aef`) | Run 327 (`c4872ca`) | Run 330 (`4861610`, final code) |
|---|---|---|---|---|
| install-lint-typecheck-test | success | success | success | success |
| backend-tests (1) | success | failure (developerCeiling) | failure (same) | success |
| backend-tests (2)/(3)/(4) | success | success | success | success |
| backend-tests-complete | success | failure (shard 1) | failure (shard 1) | success |
| docker-build | success | success | success | success |
| agent-windows | success | success | success | success |
| attendance-replay | success | success | success | success |
| latency (incl. popovers) | success | failure (390 px locator) | failure (same) | success |
| sensitive-ui (admin portal) | success | success | success | success |
| sensitive-ui (employee portal) | success | success | success | success |

Runs 321/322 were cancelled by the next push. Both red runs had the two causes fixed in `4861610` (one fix attempt each).

### Settings left Not set (refuse until a director chooses)

Insights: `window`, `minimumGroupSize`, `earlyAttrition`, `turnover`, `tenure`, `exitReasons`, `hiringFunnel` (the DEMO company
chooses fictional values). Autofill: `retention`. Still Not set from stage 1: joiner link lifetime, required joining documents,
exception approver; and C-4A's sources, retention, scorecard, rejection reasons, email templates, CV rules, requisition route.
**Default, change in settings:** hiring stages (pipeline v0), interview rounds, autofill file types and size (PDF, PNG, JPEG;
10 MB); from stage 1, offer approval and referrals (off). HR onboarding stays on by default.

### Changed tests (none weakened)

`recruitment/__tests__/schemaSettings.test.ts` (start-Not-set test now expects the two defaults; every other key still Not set
and refusing; new director-replaces-default test) and `recruitment/__tests__/jobs.test.ts` (opens on the default pipeline,
then on a director's, same history assertion). Additive edits only to `hrCapabilities` matrix earlier; no other existing test
changed.

### Decided by me

Default stage codes/labels and the four default round names; a job with no pipeline uses the default (not the latest version);
the restricted category for copied joining documents = first active STATUTORY employee category (none → nothing copied);
Insights audience via a new Office capability VIEW_INSIGHTS; one grouping per metric (department; reasons; furthest stage) to
avoid overlapping groups; zero cells and zero totals are shown (reveal nobody); median for tenure; exit reasons only from the
separation mode or resignation reason category; the Insights DEMO choices; autofill scope fields as listed in the plan record;
identity name is comparison-only and never saved; technical controls (60 s timeout, 5 reads/document, 30 requests/person/10
min, OCR confidence floor 60); raw text never stored; one review per field (changeable until saved); apply needs every bank
field; `pdfjs-dist` moved to runtime dependencies at the same version; tesseract.js 7.0.0 with the bundled English model.

### Unverified

- The source-document PDF preview inside the review page: headless Chromium has no PDF viewer, so the frame rendered blank in
  the walkthrough (the file loads; images render). Check in a desktop browser.
- OCR accuracy on real photographs and scans (only synthetic documents were used, as instructed); OCR of images depends on the
  system fonts used to render the synthetic image in tests.
- A cloud provider (not built; needs owner approval). Real email delivery (none added).
- `check:sensitive-ui` full local re-run after restoring the break (CI run 330 ran both halves on the restored code and passed).

## Stage 2 prompt received again (2026-11-13): re-sync only

The Stage 2 prompt arrived a second time. Steps 1–3 and the finish were already done and ticked (commits `c1bcae4`…`556b0f3`), so
nothing was redone. Step 0 was repeated because `feat/hr-payroll-separation` had moved on 22 commits (to `1aedbb0`: IE-07/08,
LV-19/20/23, AT-19/22/36, ER-18/26/27/28, OE-04, SS-13, Stage 6 reports, payroll parity rows, the Developer audit value-hiding, and
Session A's CI sharding docs).

**Merge `caf368b`.** Conflicts resolved keeping both sides, with no change to Session A's code:
- `schema.prisma`: Session A's new models (M block 2) and the Peeps recruitment/insights/autofill models, both kept as they were.
- `lib/__tests__/cleanup.ts`, `lib/fieldKeyRotation.ts`: both sessions' registry entries kept.
- `auditLog/controller.ts` and `service.ts`: Session A's `AuditViewer` (Developer `valuesHidden`) kept; the Peeps `userId` field and the
  exit/recruitment audience filter (`where.AND`) added inside PEEPS blocks. Session A's `where.NOT` / payroll-only filters sit alongside it.
- `leave/requests.ts`: the Peeps leave-type hook now gets LV-20's `leaveDaysFor(...)` count (the sandwich rule, which equals
  `computeTotalLeaveDays` while it's off) in place of the plain count. The hook changes nothing for other leave types.

**Verified.** `prisma validate`; migrations applied to the local database; `db:drift`: no difference; `npm run typecheck` and
`npm run lint` clean; frontend tests 25 files / 102 tests passed. CI run 341 on `caf368b`: all 12 jobs green to the end of each job,
including the four backend shards (sharding is on the branch) and `backend-tests-complete` ("each test exactly once").

**Full backend suite alone on `caf368b`: 274 files / 2,436 tests, 1 failed.** The failure is a test-order interaction between two
of Session A's files, not caused by the merge:
- `employee/__tests__/profileAndReveal.test.ts` grants `employee.view` to the shared `MANAGER` role in `beforeAll` and (by its own
  comment) never removes it.
- `customFields/__tests__/customFields.test.ts` (new, ER-28) expects a fresh MANAGER holder to get 403 and gets 404 when
  `profileAndReveal` ran earlier in the same process.
- Reproduced with only those two files: `--sequence.shuffle.files --sequence.seed=3` (profileAndReveal first) fails the same way.
  Seeds 1 and 2 (customFields first) pass, and the file passes alone.
- Both files, the test helper and `lib/permissions.ts` are byte-identical to `origin/feat/hr-payroll-separation`. In CI the two
  files land in different shards, so CI stays green.
- Not changed (Session A's tests). Proposed fix for Session A: remove the grant in `profileAndReveal`'s `afterAll`, or use a per-user
  manager grant in place of the role row. This is a fixture leak in tests only: no route or resolver change gives managers this key.

**Earlier CI run 340** (`0fb4868`, the check-script commit): `backend-tests (2)` failed in Session A's
`hrCapabilities/__tests__/immediacy.test.ts` ("an HR person's open screen stops hearing punches…", expected false to be true), a
realtime timing test. The code was unchanged from `4861610` (run 330 green) and it passes in run 341, so I read it as a flake.

**Note on the speed rule.** The re-sent prompt's speed rule (checks on each commit) is older than the owner's 2026-11-12 message
(checks once per phase). I followed the newer one (recorded in `PEEPS_PLAN.md`). This sync was one phase, checked once.

### Follow-up (2026-11-13, owner-requested): two Session A tests fixed (test-only)

The owner asked for both fixes directly, so the "don't change Session A's tests" rule was set aside for these two files only.
Changed tests (none weakened; every assertion kept):
1. `backend/src/modules/employee/__tests__/profileAndReveal.test.ts`: `beforeAll` now records which of the keys it grants each shared
   role (MANAGER, HR_ADMIN, HR_EXECUTIVE) already held; `afterAll` removes only the keys it added (`revokePermissions`), so the shared
   roles end as they started. This was the cause of `customFields.test.ts` getting 404 for 403. Proof: the two files alone with
   `--sequence.shuffle.files`, seed 1 (customFields first) and seed 3 (profileAndReveal first): 21/21 both ways. Seed 3 failed before
   the fix.
2. `backend/src/modules/hrCapabilities/__tests__/immediacy.test.ts` ("the live rooms"). Cause of the run-340 failure: with the Redis
   adapter, `socketsLeave`/`socketsJoin` take effect only when the request comes back from Redis, but `permissions.changed` is sent at
   once. So the test could punch before HR's socket had left `perm:attendance.view`. New helper `roomSettled(key, member)` waits for the
   adapter's own `leave-room` / `join-room` event for this socket (resolving at once if it's already settled), with a 4 s timeout that
   fails the test. It's used after each switch in the punch test, and replaces both 300 ms sleeps in the regularization test, which also
   now waits for `permissions.changed`. The silence windows and every expectation are unchanged. Proof: 5 runs in a row 8/8. Mutation:
   waiting for "joined" after the switch goes OFF times out ("socket did not join perm:attendance.view within 1500 ms"), so the wait
   follows the real room state; file restored.
   Product note (no code change): the same window exists in production. A browser told "permissions changed" may still get one event
   for a room it is leaving, for the length of a Redis round trip.


## Stage 3 of 4 — badges, nudges, follow-ups, notifications, demo data and setup guide (2026-11-13)

**Commits:** `07c7b6c` (backend), `e78b3e3` (recognition screens, settings defaults and withdraw, nudge-trigger fix), `4588f02`
(asset request screens, membership withdraw), `497b527` (notifications review), `06a47a0` (scan rules, popovers, DEMO asset
requests), `ce36041` (setup guide, screen map, checklist corrections), `058b221` (check script keeps the environment's NODE_OPTIONS),
`43f31f3` (report), `68b8b93` (avatars test), `8f27f83` and `df88a79` (popover check fixes).
No sync this stage (not asked). Speed rule followed: no per-commit checks; one phase-end check; full suite once at the end.

### Phase 1: badges
- Reporting line (unchanged rule, now with no exceptions): down to anyone below the giver, up the giver's chain to the directors,
  directors to anyone; never sideways, never another line, never oneself; the Developer never gives. The Wellsure Office
  "Give badges" widening is **retired** (setting `audience.badges` removed; the capability now adds no reach).
- A reason is required (3–280 characters). Shown to the recipient always; publicly by default (`badges.publicDetails`).
- Defaults ("Default, change in settings"): 12-badge catalogue, limits 5 a month per giver and 1 a month per giver-receiver pair,
  repeats allowed, no-manager fallback "up to the directors", public details shown. Settings now have a `DEFAULT` state
  (`PEEPS_SETTING_DEFAULTS`); a director replaces a default through the normal two-director setting.
- Directors add, rename and retire badges; a retired badge cannot be given and keeps its name on past awards; a badge that was
  ever given cannot be deleted (RETIRE_INSTEAD). Each added, renamed, retired or restored badge gets its own audit entry.
- Recipients see who gave each badge by name (directors included) and why. Directory cards show badge and nudge counts.
- Limits hold under concurrency (serializable transaction): two simultaneous gives against the pair cap → exactly one wins;
  four simultaneous gives against the monthly cap → exactly one wins.
- The starter-catalogue route is removed (the defaults replace it).

### Phase 2: nudges, and what existed of the private corrective notes
**What existed (inspected before any change):** the D-37 private corrective notes: tables `private_nudges` (text field-encrypted),
`nudge_reads`, `nudge_revocations`, all append-only; senders were the directors only, behind `nudges.enabled`; readable by sender,
recipient and directors (audited). Data: the real company has none that we can see; the local development database held **1** note,
the DEMO company's (`DEMO-NUDGE-PRIVATE` to DEMO006). **What I did:** deleted nothing. The notes are now **read-only**: no route writes
one (send, revoke and the read mark are gone; reading records nothing); a database trigger refuses inserts into all three tables
(`PEEPS_NOTES_READ_ONLY`), except in a development/test database inside a transaction that sets `app.legacy_note_fixture` (the
DEMO note and the tests). Existing notes stay visible to the person they concern and the directors (each director open audited);
the sender label is unchanged (the workspace name). The settings `nudges.enabled`, `nudges.limits`, `nudges.revocation` were retired.
- **Nudge tags (new):** public light-hearted tags, given by a director only (service + database trigger), 7 days each, visible to
  everyone signed in on profiles, the directory and home, with the giver named; the receiver always sees who gave it. No free text
  (the request carries only the tag code, the person and an idempotency key). Default tags: Chai Break Champ, Scroll Master, Snooze
  Mode, Meeting Marathoner, Coffee Refill Crew, Playlist DJ, Emoji Enthusiast, Desk Plant Parent. Default off-limits words: 35
  (attendance, time, leave, missed work, performance, discipline). Safeguards: a director removes a tag at once with a reason; the
  receiver asks for a review → a directors' task ("Nudge review", names nobody) until a director keeps or removes it; tag names with
  an off-limits word are refused, and a tag that later matches a new word can no longer be given. All append-only and audited.
- Never created by a system job: the database refuses any giver who is not a director, and a test pins that the only writer is the
  director's give, reached only from the route and the demo seed.

### Phase 3: follow-ups
- Withdraw a pending proposal: a Peeps setting version (its author or a director) and an Office membership change (a director),
  with a reason, audited; refused once confirmed, and a withdrawn one cannot be confirmed (service + triggers).
- Employees' asset requests: an employee asks for an asset type (the confirmed asset categories; Not set → refused and explained),
  sees only their own requests and status, cancels while waiting; HR and the directors (and Office members while the asset audience
  allows) approve, decline, mark fulfilled; task "Asset request"; the employee is told generically.
- Stale checklist boxes corrected (13 lines, marked "Stage 3 correction").

### Phase 4: notifications and tasks review
Inventory (pinned by a test that fails on any new unreviewed file): badges, nudge tags and reviews, asset requests, setting and
membership "waiting for your confirmation" (new), asset issue/return, avatars, exits (resignation, clearance, interviews, letters),
Unmute (PRIVATE_NOTICE), recruitment (interview assignment to the panel; candidate e-mail; empty-payload refresh signals), helpdesk.
Offers, joining links, conversions, joining documents and Insights send no notification (signals with empty payloads only);
autofill queues the extraction id only. New helper `peepsNotify`: durable (Notification row first), deduplicated by key, retried
(3 attempts), final failure logged with the type only, payload ids only (refused otherwise), generic words, links to screens whose
APIs recheck access. Tests cover each new event (one notification even when repeated; recipient's room only; no reason, note or tag
in any notification, socket event, log or task preview; the link's API refuses someone else) and the helper (dedupe, retries,
refusal of a non-id payload, no text in the failure log).

### Phase 5: demo data, setup guide, screen map
DEMO: badges (TEAM_PLAYER to DEMO006, MENTOR to DEMO007), a nudge tag to DEMO006, the read-only DEMO note, asset requests (DEMO007
approved, DEMO006 waiting). `docs/PEEPS_SETUP_GUIDE.md` lists every Not-set setting (who, what, order) and every default.
`docs/UI_SCREEN_MAP.md` updated. GETTING_STARTED unchanged (no setup, env or account change).

### Tests and verification
- New test files: `recognitionLine.test.ts` (reference model over 3 random org charts, every ordered pair), `nudgeTags.test.ts`,
  `assetRequests.test.ts`, `peeps/withdraw.test.ts`, `peeps/notifications.test.ts`; `recognition.test.ts` rewritten (see changed tests).
- Permission matrices: unauthenticated, employee, the employee's manager, an unrelated manager, HR (Admin and Executive), Office member,
  non-member, director, Developer, former employee (deactivated account → 401) on the asset-request, nudge, note and withdraw routes.
- Expiry with a fake clock across the week reset, the month reset and the India-time boundary (Sunday 20:00 UTC = Monday IST;
  31 Jan 19:00 UTC = 1 Feb IST). Nudge tags end after 7 days (fake clock).
- **Mutation checks** (break, see named tests fail, restore): reporting line (allow peers) → 3 random-chart tests + 2 line tests
  failed; pair limit off by one → "default limits" and "pair limit under two simultaneous gives" failed; receiver-sees-giver (hide
  the giver) → "the recipient sees a director's badge with the director's name" and "the receiver always sees who gave it" failed.
- Phase-end check `scripts/peeps-check.sh --since faa9487`: lint, typecheck, 6 changed backend test files (55 tests) passed. The first
  two runs stopped at typecheck (out of memory: the environment's own NODE_OPTIONS hid the script's heap default); fixed in `058b221`.
- Neighbouring suites (peeps, recognition, assets, tasks, notifications, unmute, cleanup, route inventory): 16 files / 140 tests passed.
  Demo company test (`npm run test:demo`): 7 passed.
- Browser walk (local scratch database seeded with the demo company): director, HR, employee, Office member and a second employee,
  desktop and 390 phone, light and dark: 84 page visits, no crash, no horizontal scroll, dark backgrounds correct. States: empty
  (an employee with nothing), loading (skeleton while badges load), error (failed asset requests → retry), forbidden (an employee on
  the directors' pages sees none of their content).
- **Full backend suite alone** (final code): 279 files / **2,468 tests passed**. (The first full run found 1 failure, the avatars badge
  test below; fixed in `68b8b93`, then the whole suite was run again.)
- **CI run 364 on `df88a79` (final code): all 12 jobs green to the end of each job, cleanup included**: install-lint-typecheck-test
  (lint, typecheck, tokens and bundle budgets, migrate, schema matches migrations, seed, frontend and agent tests, demo company tests),
  the four backend shards and backend-tests-complete (each test exactly once), both sensitive-ui halves (admin and employee portals,
  with the Stage 3 rules), latency (popovers, with the Stage 3 checks, then punch-to-screen latency), attendance-replay,
  docker-build, agent-windows.
- CI on the way there: run 360 failed in three jobs: backend shard 2 (Session A's `letters.test.ts` timed out starting its PDF
  browser, an infrastructure flake that passed locally and in later runs), the shard-completeness job that depends on it, and my new
  popover check. Run 361: my popover check failed again (the drawer covered the button it reopens after Escape); fixed in `df88a79`.

### Changed tests (none weakened)
- `recognition/__tests__/recognition.test.ts`: rewritten for the Stage 3 rules. The Not-set catalogue test became the defaults test;
  the monthly-limit test sets its own cap (defaults now apply); "Office member gives to anyone" became "no extra reach"; the
  no-manager test now starts from the default (up to the directors) and checks Nobody; the visibility test now expects giver and
  reason shown by default and checks the directors can hide them; every give carries a reason. The corrective-note tests moved to
  `nudgeTags.test.ts` as read-only tests (send, race and revoke tests removed with the routes they tested). New: reason required,
  catalogue rename/retire/delete-refused, pair limit, two concurrency tests, IST boundary expiry, director named to the recipient,
  reason never in audit or logs.
- `managers/__tests__/routeInventory.ts`: starter route removed; nudge routes replaced; asset-request and withdraw routes added.
- `lib/__tests__/cleanup.ts`: the 8 new append-only models registered.
- `avatars/__tests__/avatars.test.ts` ("badges show company-wide"): gives a default badge (MENTOR) with a reason instead of replacing
  the catalogue with a DEMO-only one (a reason is now required, and a catalogue cannot drop a badge already given elsewhere in the run).
  Same assertions (counts for colleague, manager, HR; Developer 403; signed out 401). Found by the full suite.

### Settings left Not set
Unchanged from earlier stages and now listed in `docs/PEEPS_SETUP_GUIDE.md`: asset lists; asset and Unmute audiences and Unmute
times and hosts; directory contact fields; the two leave-naming settings and every new-leave-type rule; recruitment sources,
retention, scorecard, rejection reasons, e-mail templates, CV rules, requisition route, Office audience, joiner link lifetime,
joiner document types, exception approver; offer pay and all pay/bank/statutory/tax values; exits' notice rules, reasons,
checklist, questions, retention, thresholds, audience and approval; Insights' window, minimum group size, early-attrition threshold
and definitions; autofill retention; helpdesk category audiences. No new Not-set setting this stage.

### Defaults shipped this stage
Badge catalogue (12), badge limits (5/month per giver, 1/month per pair), repeats allowed, no-manager fallback up to the directors,
public giver and reason shown, nudge tags (8), off-limits words (35). Nudge lifetime 7 days is fixed, not a setting.

### Decided by me (please confirm or overrule)
1. A nudge lasts **7 days from when it is given** (badges reset with the calendar week; "lasts a week" read as seven days).
2. The giver of a nudge is named **publicly** too, not only to the receiver.
3. Badge recipients see the giver by **name, directors included**; public surfaces keep showing a director's badge as from the
   workspace name (as before). Old notes keep the workspace name as sender (unchanged).
4. Public giver and reason default to **shown** (conventional for kudos); directors can hide them.
5. No-manager fallback defaults to **up to the directors** (the owner's "up their own line to the director").
6. The Office "Give badges" widening is retired outright, since the brief says nobody gives sideways or across lines.
7. Removing a tag that has an open review also decides that review as "removed".
8. Asset requests: one optional note (300 characters) from the employee, one optional note from the decider; states
   waiting → approved → fulfilled, or declined, or cancelled by the employee; "fulfilled" can be set straight from waiting.
9. "Waiting for your confirmation" notifications go to the other directors when a setting or membership change is entered.
10. Asset categories and the other earlier Not-set lists were not given defaults (not asked this stage); flagged in the guide.

### Not verified
- Real documents or data for any of this (all fixtures are synthetic).
- The scans (`check:sensitive-ui`, `check:popovers`) ran in CI only (green in run 364); a local popover run is not comparable
  (the local demo database has more notifications).
- E-mail delivery: Peeps Stage 3 events send no e-mail.

## Stage 4 of 4 (2026-11-14): testing program — phase 6 mutation table

Each mutation breaks one guard by an exact text replacement, runs the named test file, records the result and restores the file
byte for byte (`git diff --quiet` checked after each). Run in this stage: 16 rules that had never been mutation-checked.

| # | Rule | First run | Caught by |
|---|---|---|---|
| N1 | Nudge tag: only a director gives/removes | caught | "a director removes any nudge…", "the receiver asks for a review…" |
| N2 | Nudge tag: off-limits words refused | caught | "off-limits words block tag names…" |
| N3 | Nudge tag: shows for 7 days | caught | "…a week each", "disappears after a week (fake clock)" |
| N4 | Nudge review: only the recipient asks | caught | "the receiver asks for a review…; nobody else may ask" |
| S1 | Setting: the person who entered it cannot confirm it | **survived** → test added → caught | "confirming a setting: only a director who did not enter it…" (withdraw.test.ts) |
| S2 | Setting: only its author or a director withdraws | caught | "a setting version: its author or a director withdraws it…" |
| S3 | Setting: only a director confirms (service layer; the route guard and the database also refuse) | **survived** → test added → caught | same new test (calls the service directly behind the route guard) |
| AR1 | Asset request: your own is decided by someone else | caught | "states: approve then fulfil, or decline…; never your own" |
| AR2 | Asset request: a decider's own request is never their task | **survived** → test added → caught | "a decider's own request is never a task for them…" (assetRequests.test.ts) |
| AR3 | Asset request: deciding needs the register's managers | caught | "permission matrix: the list and decisions are for the register's managers only" |
| B1 | Badge: a reason of 3+ characters is required | caught | "a reason is required" |
| B2 | Badge: a retired badge cannot be given | caught | "directors change the catalogue…" |
| B3 | Badge: weekly/monthly end at the India-time period end | caught | "weekly and monthly items expire when their period ends in India time" |
| J1 | Joining exception: only the director-chosen approver grants | caught | "exceptions need the director-chosen approver…" |
| RF1 | Referral: the referrer sees a basic status only | caught | "referrals: off by default, then the referrer sees basic status only" |
| H1 | Helpdesk move: the Developer refused (Stage 4 fix) | caught | permission matrix "every route answers each actor exactly as reviewed" |

**16/16 caught** after the three missing tests were added (the three survivors were untested refusals that a second layer — the
route guard or a database trigger — still enforced). Rules mutation-checked in earlier stages, with their tables above: assets M1–M11;
Office/Unmute U1–U2, M1–M7; badges/nudges R1–R5, Q1–Q2; avatars A1–A2; leave types L1–L5, G1, D1–D2; badge line R1–R3, L1, N1, A1;
C-1 races and attendance labels (11); ticket desk (4); exits (5); recruitment (5); C-4B offers (3); Insights (2); autofill (3);
Stage 3 reporting line, pair limit, receiver sees giver (3). Property tests kept: Insights small-group (5,000 populations),
badge reporting line (random charts). Nothing is left un-mutation-checked among the access, confidentiality and limit rules listed
in PEEPS_PLAN; display-only rules (labels, sort orders) were not mutated.
