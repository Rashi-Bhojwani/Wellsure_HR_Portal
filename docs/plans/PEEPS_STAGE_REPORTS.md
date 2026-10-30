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
