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
