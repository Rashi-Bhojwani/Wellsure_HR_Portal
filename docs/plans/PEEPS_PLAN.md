# Peeps — plan for the second build session

**Status: PLAN ONLY. Nothing in this document has been built.** Branch `peeps/foundation`, which holds
`feat/hr-payroll-separation` up to `0fade2e` (merged in at `0621f82`; first merge `8979072`, see §0). The other session owns payroll and the files
listed in §C.1. This document, `PEEPS_CHECKLIST.md` and `PEEPS_STAGE_REPORTS.md` are this session's only
reporting files.

The repo is public. This plan names no real person, salary, bank/PAN/UAN/Aadhaar number, device serial, IP,
legal name or greytHR URL. Every quota, duration, threshold, category, stage, scorecard, notice rule, badge,
limit, host roster, retention period and approval route below is **Not set** until the owners choose it;
a feature whose required settings are missing refuses to switch on. The demo company may carry made-up
values, each labelled DEMO.

---

## Owner's answers (2026-10-30, after the first review) — these win over anything below that disagrees

| Item | Answer | Where applied |
|---|---|---|
| Q0 guide | Said to be in `docs/integration/`. **Not found on any remote branch on 2026-10-30** (fetched all; searched every branch's history for `docs/integration/`). Chapter mapping still pending. | §0.1, §A |
| Q-L1 leave extension | New leave types **menstrual, medical, wedding, bereavement**; configurable rules and approval routes, every value Not set; **HR prepares, a director approves**; supporting documents **HR-only**. "Annual Leave" is the existing Privilege Leave balance (no new balance). | §B.4 (rewritten) |
| Q-U1 Unmute | Authorised hosts from any department; scheduling and completion status only; visible to the participants only; **no notes, no topic field**. | §B.9 (rewritten) |
| Q-I1 insights | Turnover, tenure, exit reasons, hiring funnel; data-scoped; small-group privacy; every metric definition Not set. | §B.10 (rewritten) |
| AS1 | Confirmed: confidential even from directors; relationship-based design stays. | §1, §B.0.3 |
| AS2–AS4 | Stay settings, Not set. | §1 |
| Q-X2 two-step | Session A is making two-step sign-in optional. **Not touched by me.** | §0.4, §A |
| Q-T1 helpdesk | Session A owns the Payroll ticket category and its director-only routing. I own the general desk. **Visibility is by category** (no queue enum). | §B.3 (rewritten), §C |
| Q-F2 HR switches | I add switch entries only inside a `PEEPS-BEGIN/END` block; no framework changes. | §B.0.4, §C.2 |
| Q-F3 | Keep `peeps/foundation` as it is. | §0.2 |
| Earlier decision | HR may **enter** bank and identity details (masked; the existing pending-until-confirmed flow). | §B.6 joining, §A |
| Earlier decision | Remote attendance (WFH check-in/out) belongs to Session A. | §C.1, §B.4 |

Also from the base since the first plan (merged at `0621f82`): HR now has narrower non-pay keys —
`letters.issue.nopay` (letters the engine proves carry no pay figure), `invitations.send`,
`import.details.manage` (`2bdaaf2`). Used in §B.5 (relieving/experience letters) and §B.6 (invitations).

## 0. Ground facts found while starting (read these first)

1. **The integration guide is not in the repo.** First check: no copy anywhere. Second check (2026-10-30,
   after the owner said it is in `docs/integration/`): `git fetch --all`, then every remote branch and the
   history of all branches searched for `docs/integration/` and for guide-like files — **still absent**
   (it was probably committed locally but not pushed). Section A stays per topic; the chapter column is
   commit 2 in §G and waits for the push. The owner's answers (table above) have replaced my earlier guesses
   about leave extension, Unmute and insights.
2. **Branch.** `origin/peeps/foundation` already existed, equal to `main` (`c787e92`), with no commits of
   its own. Resetting it to the base would need a force-push (forbidden), so I **merged**
   `origin/feat/hr-payroll-separation` (`8979072`) into it (`2a4fad1`). Clean merge. The only things on
   this branch that are not on the base are `main`'s three commits: `docs/samples/*` (synthetic sample files
   labelled fake values) and an encoding-only change to the `description` line of `frontend/package.json`.
   Both will reach the base anyway when `main` is merged; neither touches code. If you would rather
   `peeps/foundation` contain nothing from `main`, tell me and I will start a new branch name from the base
   instead (still no force-push).
3. **Directors and confidentiality, in code.** `lib/permissions.ts` gives every `SUPER_ADMIN` holder
   *every* key in `PERMISSION_KEYS`, computed in code. So a permission key **cannot** keep anything from a
   director. The owners have confirmed that Unmute bookings, exit interviews, medical documents and private
   nudges are hidden even from directors (AS1), so those are gated by **relationship**
   (booker/host, interviewer of record, sender/recipient, the employee themself) or, for leave supporting
   documents, by **HR role plus key** (§B.4), never by a key alone. The plan is
   designed that way from the start, so the answer changes configuration, not schema.
4. **Two-step sign-in.** `backend/src/lib/authDefaults.ts` enforces 2FA for every Super Admin outside
   development, and payroll's Ready-for-first-run checklist requires it (Stage 2). **Answered:** Session A
   is making it optional; I do not touch it, and no Peeps feature depends on 2FA being on or off.
5. **Frontend layout.** Existing screens live in `frontend/src/pages/{employee,admin}/…`; there is no
   `frontend/src/features/` folder. Your prompt names `frontend/src/features/<name>/`, so I will create it
   (one folder per module: `pages/`, `api.ts`, `components/`), lazy-loaded from the menu configs. Nothing
   existing moves.
6. **Placeholder / Confirmed today lives inside payroll** (`payroll_item_versions`,
   `payroll_item_confirmations`, `modules/payroll/items.ts`) — owned by the other session. Peeps needs the
   same rule for its own settings (§B.0), so I will build a small, separate `peeps_setting_versions` store
   rather than import or extend payroll's.
7. **Helpdesk queues (H3) were designed but not built.** **Answered:** no queue enum. Visibility is by
   category; Session A owns the Payroll category and its director-only routing, and I own the general desk
   (§B.3).
8. **Migration folder ordering.** Prisma applies migration folders in lexicographic order. `peeps_…`
   sorts after every `2026…` folder, so on a fresh database all of the other session's migrations always
   run before all of mine, whatever their dates. That is safe **only if a Peeps migration never depends on
   a table or column the other session adds later**; I will hold to that and a test-free check
   (`db:drift` on a freshly built database after each merge) proves it. Names:
   `peeps_<yyyymmddhhmmss>_<module>_<what>` so mine order among themselves.

---

## 1. Decisions this plan stands on (from your prompt §2; they win over the guide)

- Directors = the two Super Admins = the entire payroll team. Director approvals are explicit capabilities
  they hold; the "second director" rule is a per-step owner choice, Not set until chosen (same pattern as
  `payroll.secondDirector`, but Peeps steps get their own setting so the other session's file is untouched).
- HR has **no pay data**: no salary, offer compensation, recovery amounts or F&F figures. Anything that
  carries money is director-only. HR may prepare the non-pay parts of offers and exits.
- HR attendance/regularization/leave-approval/muster/finalisation duties are director-controlled switches
  (`HR_CAPABILITIES`), default as today. Peeps adds new switches only through the same framework, and the
  framework itself is the other session's (§C.1): see §B.0.4.
- No CA: statutory and legal values are entered by an owner with a source note and confirmed by a different
  director. Peeps has very few of these (notice-period legal minimums, if any; gratuity is F&F = payroll).
- greytHR stays until one company-wide cutover. Peeps ships with the core in one launch. No AWS work.

### Assumptions to confirm with the owners (I do not decide these)

| # | Assumption | Default in the build until answered |
|---|---|---|
| AS1 | Unmute bookings, exit interviews, medical documents and private nudges are confidential **even from directors**, exactly as the guide says. | **Confirmed by the owners.** Relationship-gated; directors get **no** reader. Leave supporting documents (including medical) are HR-only (§B.4). |
| AS2 | Who may issue **corrective** private nudges (manager of the person? HR? directors only?). | Not set → corrective nudges refuse to send; appreciative nudges follow AS2b. |
| AS2b | Who may send **appreciative** private nudges. | Not set → refuses. |
| AS3 | Who approves a **joining-document exception** (a joiner without a required document by day one). | Not set → an exception cannot be granted; conversion waits until documents are complete. |
| AS4 | **Missing-manager fallback**: who decides when a person has no manager (or the manager has left) for requests of the new leave types, exit acceptance, asset requests. | Not set → the item waits in the directors' queue with a "no manager" note (same mechanism as `noTeamApprover.ts`). |

---

## A. What already exists, what is missing, what conflicts

Chapter numbers of the guide: **pending the guide** (§0.1). Rows are by topic.

| Topic | Exists today (paths) | Missing for Peeps | Conflicts with a §1 decision |
|---|---|---|---|
| **Roles, permissions, scope** | `shared/constants/permissions.ts` (catalog), `shared/constants/roles.ts`, `backend/src/lib/systemRoles.ts`, `lib/permissions.ts` (`resolveAccess`), `lib/dataScope.ts`, `middleware/rbac.ts` (`requireAuth`, `requirePermission`), `shared/constants/sensitiveData.ts` (sensitive classes, Developer ceiling, `HR_FORBIDDEN_KEYS`) | Peeps keys (§B per module), new sensitive classes, relationship-based readers for confidential classes | Super Admin gets every key (§0.3): confidentiality "even from directors" must be relationship-gated |
| **HR switch framework** | `shared/constants/hrCapabilities.ts`, `lib/hrCapabilities.ts`, `modules/hrCapabilities/*`, `pages/admin/adminTools/HrCapabilitiesPage.tsx` | Switches for the Peeps duties HR may lose (e.g. approve leave extensions, accept resignations, run exit clearance) | **Owned by the other session.** I need additive entries in `HR_CAPABILITY_IDS`/`HR_CAPABILITIES`; see §C.2 |
| **Director authority** | `shared/constants/directorAuthority.ts`, `lib/directorAuthority.ts`, `lib/directorNotices.ts` (notice to the other director) | Peeps "second director" steps (offer approval, exit approval, asset write-off) | The setting `payroll.secondDirector` is payroll's; Peeps uses its own `peeps.secondDirector` setting, reusing `lib/directorNotices.ts` read-only |
| **Two-step sign-in** | `lib/authDefaults.ts` (mandatory for Super Admins outside development), payroll readiness row | — | Session A is making it optional (answered). Not touched by me |
| **Audit, append-only, DB roles** | `lib/audit.ts`, append-only triggers, `lib/dbRoles.ts` (`appendOnlyTables` reads the triggers; `UPDATABLE_APPEND_ONLY_TABLES`), `lib/__tests__/dbRoles.test.ts` | Every new append-only Peeps table gets a truncate-blocking trigger (picked up automatically); any that must keep UPDATE needs an additive entry in `UPDATABLE_APPEND_ONLY_TABLES` | None |
| **Field encryption** | `lib/encryption.ts`, `lib/fieldKeys.ts`, `lib/fieldKeyRotation.ts` (`ENCRYPTED_COLUMNS`; a test fails on an unlisted `Bytes` column), `lib/fieldHash.ts` (blind index) | Candidate phone/email/ID numbers, nudge bodies, exit-interview answers, interview feedback (Unmute stores no free text; leave supporting documents are files in a separate storage prefix) | None |
| **Employees, onboarding** | `modules/employee/service.ts` (`createEmployee`, `createEmployeeInTx`), Add Employee wizard, invitations (`invitations.send`, HR switch since `2bdaaf2`), `modules/import/*` (`import.details.manage` for non-pay sheets), bank/statutory writers and the pending-until-confirmed change flow (`modules/employee/changeRequests.ts`) | Candidate → employee conversion (idempotent), joining documents checklist, pre-joining portal | `import.manage` is hard-locked to directors; bulk candidate import does not reuse the Import Center. HR **may enter** bank and identity details at joining (decision), through the existing writers, masked, pending until confirmed — no separate Peeps store for them |
| **Separation / exits** | `modules/employee/separations.ts` (initiate, cancel, complete → `markSeparatedInTx`), `separations` table (INITIATED/COMPLETED/CANCELLED), `pages/admin/employee/SeparationsPage.tsx`, Leavers report | Employee resignation request, notice rules, acceptance flow, clearance checklist, exit interview (confidential), asset return gate, F&F hand-off, relieving letter request | F&F and recoveries are money → director-only and payroll's; relieving/experience letters: HR may issue them through `letters.issue.nopay` when the template is proven pay-free (`2bdaaf2`), otherwise a director (`letters.generate`) |
| **Assets** | Spec §12 Phase 8 "Assets management"; route placeholder `/admin/assets` (`UI_SCREEN_MAP.md`); spec §7.2 profile tab "Assets" | Everything: catalogue, items, assignment, return, condition, requests, recovery intent | Recovery amounts are money → director-only, payroll implements deduction |
| **Recruitment** | Nothing (UI_SCREEN_MAP: "No recruitment module in the spec's phases"); board frames `recruitment-01..19` | Everything: requisitions, jobs, candidates, pipeline, interviews, feedback, offers (non-pay), joining | Offer compensation is money → director-only; spec Phase 6 note "offer letter figures from salary assignment" is payroll's |
| **Leave** | `modules/leave/*` (5 fixed types `PL/LOP/COF/WFH/RH`, one-row-per-type `leave_policies`, append-only `leave_ledger`, requests, year-end, recalculator, `noTeamApprover.ts`) | Leave extension (answered): four new types — menstrual, medical, wedding, bereavement — with configurable rules and routes (all Not set), HR prepares / a director approves, HR-only supporting documents. "Annual Leave" = the PL balance (label only) | HR leave approval is a switch (`APPROVE_LEAVE`) — requests for new types obey it. Year-end/encashment is money: new types are kept out of year-end until a director confirms their carry-forward/encashment rule. WFH and remote attendance are Session A's (§C.1) |
| **Lateness waiver** | No lateness model in the schema; attendance engine computes late-in | Nothing in Peeps | **Attendance engine is Session A's.** Not built by me; interface only if Session A asks (§B.4) |
| **Engage, kudos** | `modules/engage/*` (posts, kudos, polls, auto-posts), `PostKind` enum, `emitEngage*` | Badges (catalogue, awards, limits) shown on the feed and profile; private nudges (never on the feed) | None |
| **Helpdesk** | `modules/helpdesk/*`, `helpdesk_categories.is_sensitive`, `helpdesk.sensitive.view`, no queues | General desk with **visibility by category** (answered); no queue enum | The Payroll category and its director-only routing are Session A's |
| **People directory, avatars** | `modules/people/directory.ts`, `fieldPolicy.ts` (every Employee column classified), `photos.ts` (sharp re-encode, signed photo token), org chart, company-wide toggles in `peopleDocumentsSettings.ts` | Initials avatars everywhere a person is named, per-person privacy choices (if the guide wants them), photo change review (if wanted), directory search/filters by skills/badges | None |
| **Documents** | `modules/documents/*`, `DocumentSensitivity GENERAL/PAY/STATUTORY`, `lib/sensitiveDocs.ts`, `lib/uploads.ts` (magic bytes, sharp re-encode) | Leave supporting documents (HR-only) — not a new enum value on the shared table but a separate store (§B.4), since confidential classes never appear in shared lists | Adding `MEDICAL` to `DocumentSensitivity` would surface medical files in Document Center lists/counts — rejected |
| **Tasks, notifications, realtime** | `modules/tasks/service.ts` (`TaskSource` registry, no task table), `modules/notifications/*` (`type` is a free string), `realtime/emit.ts`, rooms `user:/manager:/dept:/location:/role:/perm:/org` | Task sources per module; a real checklist task table (exits, joining) | Confidential classes must never emit to `perm:*`, `role:*`, `dept:*`, `org` rooms; only `user:{id}` of the people in the relationship |
| **Reports / insights** | `modules/reports/*` (definitions, gallery, permission per report; the Leavers report reads `Employee.exitReason`), Admin Dashboard widgets | Insights (answered): turnover, tenure, exit reasons, hiring funnel; scoped; small-group privacy; definitions Not set | Report gallery code is the other session's; Insights is a **separate** module with its own endpoints and screens, not new gallery entries |
| **Settings** | `system_settings` + `lib/settings.ts` (free JSON), `pages/admin/settings/SystemSettingsPage.tsx`, director settings screens (other session) | Peeps settings with Placeholder/Confirmed and Not set | Director settings screens are the other session's; Peeps gets its own Admin Tools page "Peeps settings" |
| **Design system** | `docs/DESIGN_SYSTEM.md` (§13 checklist), `frontend/src/ui/*`, `theme/tokens.ts`, `check:tokens`, `check:bundle`, `check:sensitive-ui`, `check:popovers`, board slices `docs/design/slices/` | Screens per module | None |
| **Document autofill** | Nothing | Provider choice and questions only (§E) | — |
| **Payroll hooks** | `modules/payroll/**` | Interfaces only (§B per module, collected in §B.11) | Mine never write payroll tables |

---

## B. Modules, build order and design

### Build order and why

0. **Peeps foundation** (settings store, confidential-access helper, module switch, sensitive classes) — every module needs it.
1. **Directory and avatars** — small, low risk, gives the shared `PersonAvatar` every later screen uses.
2. **Assets** — self-contained; exits and joining depend on it (return gate, issue on day one).
3. **General ticket desk** — small; category visibility is used by exits (concerns raised during exit).
4. **Leave extension** — four new leave types with prepared/approved rules and HR-only supporting documents; extends the existing leave flow.
5. **Exits** — depends on assets (return gate), ticket desk (concerns), separations.
6. **Recruitment and joining** — largest; depends on assets (day-one issue) and directory.
7. **Badges and private nudges**.
8. **Unmute**.
9. **Insights** — last, because it reads every other module's aggregates and must exclude confidential ones.
10. **Document autofill** — nothing until a provider is chosen (§E).

Every module: `backend/src/modules/<name>/` (routes, controller, service, validators, `__tests__/`),
`frontend/src/features/<name>/`, `shared/constants/<name>.ts`, one or more `peeps_…` migrations.

### B.0 Peeps foundation (shared by every module)

**B.0.1 Settings with Placeholder / Confirmed.** Table `peeps_setting_versions` (append-only): key, version,
JSON value, source note (required for legal/statutory keys), entered by, entered at. Table
`peeps_setting_confirmations` (append-only): key, version, value hash, confirmed by (must differ from the
enterer; database trigger + service + test), note. A setting's state is **Not set** (no version),
**Placeholder** (latest version unconfirmed) or **Confirmed**. Only Confirmed values are used. Each module
declares the keys it requires; `assertModuleReady(module)` refuses with a list of what is missing, and the
module's screens show a "Not set up yet — these settings are missing" EmptyState with a link for the
people who can set them. Demo values carry `demo: true` and only exist in the demo company seed.

**B.0.2 Module switches.** `peeps.modules.<name>.enabled` is itself a confirmed setting; off = routes 404
(not 403, so the module's existence leaks nothing), menu entries hidden.

**B.0.3 Confidential-access helper.** `lib/confidential.ts` (new file in my module space:
`backend/src/modules/peepsCore/confidential.ts`): `assertRelationship(kind, subjectId, viewerEmployeeId)`
with one resolver per class (booker/host, interviewer of record, sender/recipient, the employee
themself; leave supporting documents use HR role plus key, §B.4). It **ignores roles and keys entirely**, so a Super Admin is not a reader unless named. A test
crawls every Peeps route as a director, HR Admin, HR Executive, manager, Developer and unrelated employee
and proves no confidential row comes back. Confidential tables are excluded from: Tasks sources, the
notification body (title is generic: "You have a new private message"), e-mail body, Socket.IO rooms
other than `user:{id}` of the related people, logs (`lib/redact.ts` allowlist), exports, search, Insights,
the audit log's `before/after` (audit rows store ids and the action only, never content).

**B.0.4 HR switches for Peeps duties (answered).** The framework is Session A's. I add entries to
`HR_CAPABILITY_IDS`/`HR_CAPABILITIES` (and `SPLIT_KEYS` if a key is split) **only** inside a
`// PEEPS-BEGIN hr-capabilities` … `// PEEPS-END` block at the end of each list, and change nothing else:
no edit to `lib/hrCapabilities.ts`, the service, the routes or the screen. The screen lists my switches
because it reads the list. Planned switches (defaults decided per module, listed in each commit):
accept resignations, run exit clearance, prepare leave-type rules, manage assets, manage recruitment.
A test in my module pins that every Peeps switch key is outside `HR_FORBIDDEN_KEYS`.

**B.0.5 Second-director steps for Peeps.** `peeps.secondDirector` (confirmed setting) with steps
`OFFER_APPROVAL`, `EXIT_APPROVAL`, `ASSET_WRITE_OFF`, `RECRUITMENT_REQUISITION`, each Not set; a step whose
choice is Not set refuses. Acting alone tells the other director through `lib/directorNotices.ts` (read
only; I do not edit it).

**B.0.6 Sensitive registry.** New permission keys go into `REVIEWED_NOT_SENSITIVE` or a new class in
`shared/constants/sensitiveData.ts`, inside a PEEPS block at the end of each array. New classes:
`CANDIDATE_PERSONAL_DATA`, `ASSET_RECOVERY_AMOUNTS` (director-only, view/edit keys also added to
`HR_FORBIDDEN_KEYS` in a PEEPS block), `OFFER_COMPENSATION` (same). Confidential classes have **no key**
(relationship-gated), so they are not in the registry; instead a new test lists every confidential table
and proves no route reads it without `assertRelationship`.

### B.1 Directory and avatars

- **Data.** No new table for avatars: `PersonAvatar` renders the existing photo thumbnail via the signed
  photo token, falling back to initials on a token colour (deterministic from employee id, chart slot
  tokens, light + dark). Optional (guide-dependent): `peeps_directory_preferences` (per person: which of the
  already-toggleable fields they hide; can only narrow the company setting, never widen it).
- **States.** None. Photo upload stays as built (`people/photos.ts`).
- **Who sees what.** Same as today's directory (`fieldPolicy.ts` stays the gate; any new column is
  classified there — that test is the guard). Separated employees never appear.
- **Confidentiality.** None. Badges count is public only if the badge setting says so (B.8).
- **Notifications.** None.
- **Screens.** `/app/people` already MAPPED (`employees-12`, `-13`): avatar component swap, filters. Avatars
  in Tasks, Review, Helpdesk, Engage, org chart: styled by system.
- **Settings Not set.** Whether people may hide fields themselves; whether photo changes need review.
- **Payroll hooks.** None.
- **Risks.** Touching many existing screens to swap avatars → many small diffs in files the other session
  also edits. Mitigation: the swap is done only in screens of my modules and the directory; elsewhere it is
  offered as a follow-up the other session can adopt.

### B.2 Assets

- **Data.**
  - `asset_categories` (owner-defined; Not set → module refuses): name, whether serial-tracked, whether
    returnable, required condition checklist (list of strings).
  - `assets`: category, tag (unique), serial (encrypted + blind index; device serials never in seed/demo
    beyond `DEMO-SN-…`), model, purchase date, status, location, notes. **No cost column**: purchase value
    is money → director-only table `asset_valuations` (effective-dated: value, source note, entered by,
    confirmed by a different director).
  - `asset_assignments` (append-only history + one active row): asset, employee, issued at/by, condition at
    issue, expected return, returned at/by, condition at return. **Single active assignment per asset**:
    partial unique index `UNIQUE (asset_id) WHERE returned_at IS NULL`, plus `SELECT … FOR UPDATE` on the
    asset row in the service.
  - `asset_requests`: employee asks for a category; manager/HR decides.
  - `asset_incidents` (append-only): LOST / DAMAGED report, description, photos (through `lib/uploads.ts`).
  - `asset_recovery_intents` (append-only, director-only): incident → "recover from F&F / from salary /
    waive", **amount** (exact decimal), decided by director, second-director per `ASSET_WRITE_OFF`. This is
    the hand-off to payroll (§B.11).
- **State machines.** Asset: `IN_STOCK → ASSIGNED → IN_STOCK | UNDER_REPAIR | LOST | RETIRED`;
  `UNDER_REPAIR → IN_STOCK | RETIRED`; `LOST → IN_STOCK` (found). Request: `PENDING → APPROVED → FULFILLED |
  REJECTED | CANCELLED`. Recovery intent: `PROPOSED → DECIDED (RECOVER | WAIVE) → HANDED_TO_PAYROLL`.
- **Permissions.** `assets.view` (ALL scope inventory), `assets.manage` (catalogue, items, issue/return),
  `assets.request.approve` (manager-grantable, TEAM), `assets.recovery.manage` (director-only, hard-locked
  from HR). Employee: own assignments + own requests (SELF, no key). Manager: team's assignments
  (read-only) and team requests if granted. HR: inventory, issue/return, incidents; **never** valuation or
  recovery amounts. Directors: all. Developer: inventory read only (no valuation).
- **Confidentiality.** Normal (asset ≠ personal), except incident photos may show people → visible to the
  reporter, `assets.manage`, directors.
- **Notifications.** Issue/return acknowledgement to the employee (bell + `user:{id}`); request decided;
  overdue return (job; threshold Not set); exit clearance pending items (to exits).
- **Screens.** Admin: inventory list, asset detail with history timeline, issue/return drawers, categories
  settings, requests queue; employee: "My assets" (and a profile tab "Assets", spec §7.2). Board: no asset
  frames → **styled by system** (DataTable, SideDrawer, Timeline like `recruitment-08`).
- **Settings Not set.** Categories, return-overdue threshold, whether employees may request, approval
  route for requests, condition checklists.
- **Payroll hooks (not implemented by me).** `AssetRecoveryIntent` read API for payroll / F&F (§B.11).
- **Risks.** Concurrent issue of the same asset (index + lock + race test); returning an asset during an
  exit after the separation completed (allowed; clearance records it late).

### B.3 General ticket desk (answered: visibility by category)

- **Split (answered).** Session A owns the **Payroll** ticket category and its director-only routing. I own
  the general desk: every other category. No queue enum. Who can see a ticket follows from its category.
- **Data.** `helpdesk_category_visibility` (new table, one row per category): who may work that category's
  tickets, as a list of HR roles and/or named people. **Not set** for a category → raising a ticket in it
  is refused ("This category is not set up yet"), and the screen says who can set it up. Existing
  categories get no row from the migration: today's behaviour (`helpdesk.manage` +
  `helpdesk.sensitive.view` for sensitive ones) holds until an owner sets one. That keeps day-one
  behaviour and avoids a preset. Append-only `helpdesk_category_visibility_history` (who changed it, why).
  The Payroll category is **excluded** from this table by a check constraint/test; Session A's routing
  decides it, and my code never reads or changes it.
- **Grievances that concern HR.** These need no queue. They are a category whose visibility an owner sets to
  named directors only. Whether such a category exists, and what it is called, is Not set (owners). After
  it is raised, an HR handler can **move** a ticket to another general category (reason required, audited,
  system note). If the new category is outside the handler's visibility, the handler loses access (404).
  The raiser keeps the thread.
- **Permissions.** `helpdesk.visibility.manage` (directors; added to `HR_FORBIDDEN_KEYS` in a PEEPS block, so
  HR cannot widen its own reach). `helpdesk.manage` / `helpdesk.sensitive.view` stay as the "may work the
  desk at all" gate, intersected with category visibility once a row exists.
- **Confidentiality.** A ticket in a category the viewer cannot see is absent everywhere: queue, counts,
  Tasks, search, attachments, notifications and sockets (emit to the named people's `user:{id}` rooms,
  not `perm:helpdesk.manage`, once a category has a visibility row).
- **Notifications.** New ticket → the category's visible handlers. Move → the new handlers. The raiser gets
  a neutral "your ticket was moved to another team".
- **Screens.** Existing `/admin/employee/helpdesk` (MAPPED-PARTIAL `help-01`) gains a category filter and a
  Move action. The Helpdesk Categories page gains a "Who can see this" panel (directors only). Styled by
  system.
- **Settings Not set.** Visibility per category, and whether a "concerns HR" category exists.
- **Coordination.** Before either session starts on helpdesk, check whether Session A's payroll routing
  adds a mechanism I should reuse. Whoever lands second merges the other's work before touching
  `modules/helpdesk/*` (§C.3).
- **Risks.** Both sessions edit `modules/helpdesk/service.ts` → keep my changes in a separate
  `categoryVisibility.ts` with one call site in a marked block.

### B.4 Leave extension (answered)

- **What (answered).** Four new leave types: **menstrual, medical, wedding, bereavement**. Each has
  configurable rules and an approval route, every value **Not set**. **HR prepares** a type's rules and a
  **director approves** them before the type can be used. Supporting documents are **HR-only**. "Annual
  Leave" is the existing **Privilege Leave (PL)** balance: a display label wherever the guide says Annual
  Leave, with no new type, ledger or balance.
- **Data.**
  - The four types are rows in `leave_types` (new codes, `isActive = false` until approved). Today
    `leave_policies` is one typed row per fixed type, so the new types get their own rule table rather
    than new columns on it: `leave_type_rule_versions` (append-only). Each row holds a type, version and
    rule JSON: quota and period, eligibility (DOJ boundary, gender or other criteria only if an owner sets
    them), paid or unpaid, half-day allowed, notice/backdating, max days per request, document requirement
    (when and which), carry-forward and encashment (encashment is money: a director-only part of the rule),
    approval route. It also records prepared by, prepared at and a source note where a value is legal.
    Rule confirmations (append-only) record a director who is not the preparer; the per-step
    second-director choice applies if the owners set one.
  - Balances stay on the append-only `leave_ledger` (accrual/grant entries for the new types, written by
    the existing ledger writer; never a mutable number).
  - `leave_supporting_documents` (separate store, **not** `employee_documents`, own storage prefix): the
    employee, leave request, file key, uploaded at, retention until (Not set → upload refuses), and an
    append-only `leave_supporting_document_access_log`.
- **States.** Type rules: `NOT_SET → PREPARED (Placeholder) → APPROVED (Confirmed) → superseded by a new
  version`. The type activates on its first approved version and can be deactivated (history kept).
  Requests use the existing leave request states and service (balance check, attendance integration,
  `leave/concurrency.ts` lock) with the route from the approved rule.
- **Permissions.**
  - `leave.types.prepare` (HR; behind a Peeps HR switch, "Prepare leave-type rules").
  - `leave.types.approve` (directors; hard-locked from HR in a PEEPS block of `HR_FORBIDDEN_KEYS`).
  - Deciding a request = `leave.approve` in scope, obeying the `APPROVE_LEAVE` switch and the type's route.
    No self-approval. Missing manager → AS4 (Not set → directors' queue with a note).
  - **Supporting documents, HR-only (answered):** readable by the employee who uploaded them and by holders
    of an HR role (`HR_ADMIN`/`HR_EXECUTIVE`) with `leave.documents.view`. This is checked as **role plus
    key**, because Super Admins hold every key in code (§0.3). Directors, managers and approvers who are not
    HR see only "supporting document on file: yes/no". Every read is logged.
- **Confidentiality.** Supporting documents form a confidential class (never in shared lists, counts,
  search, exports, emails, logs or socket rooms). The leave request itself shows the type name to the
  approver as usual. Whether the type name (e.g. menstrual) is shown on team calendars instead of a
  generic "Leave" is a Not set setting per type; the default until set is the generic label.
- **Year-end.** New types are left out of the Year End Process until a director has approved their
  carry-forward/encashment rule. Year-end then lists them as "not processed: rule Not set". PL year-end is
  unchanged. Year-end itself stays the directors' (`leave.yearend.manage`).
- **Notifications.** Rule prepared → directors (`perm:leave.types.approve`). Rule approved → the preparer.
  Requests use the existing `emitLeaveApplied`/`emitLeaveDecided`. A document upload notifies HR with a
  generic title.
- **Screens.** Employee apply/balances (`time-off-01`, `-03/04`, MAPPED) show the new types once active and
  label PL as Annual Leave if the owners want that wording (Not set). Admin: a "Leave types (new)" page
  with prepare/approve states, styled by system next to the existing Leave Types & Policies page (which I
  do not restructure).
- **Settings Not set.** Every rule value of every type, routes, document thresholds, retention, calendar
  label, the Annual Leave label.
- **Not built.** Extending an approved leave (not in the answer). The lateness waiver and remote attendance
  belong to Session A.
- **Payroll hooks.** Paid/unpaid flows to payroll through attendance as today (unpaid → LOP). Encashment of
  a new type, if a director ever enables it, is payroll's computation; I expose the confirmed rule only.
- **Risks.** The fixed-type assumption in existing leave code (`leave_policies` one row per type, places
  that switch on type codes). The first commit audits every such place and lists it before any change.
  Gender-based eligibility is sensitive: only if owners set it, and never inferred.

### B.5 Exits

- **Data.**
  - `resignations`: employee, submitted at, requested last day, reason (free text + category; categories
    Not set), status, accepted by, agreed last day, notice shortfall days (computed from the confirmed
    notice rule; never a money figure), withdrawal.
  - On acceptance the module calls the existing `initiateSeparation` (employee module, unchanged) so
    `separations` stays the one record; exits keep a 1:1 link `exit_cases.separation_id`.
  - `exit_checklist_templates` / `exit_checklist_items` (owner-defined; Not set → exits can be accepted but
    the checklist step refuses to start): item, owner team (IT, Admin, manager, HR), required, done by/at.
    Asset returns are generated items (from B.2 active assignments).
  - `exit_interviews` (confidential): interviewer of record, scheduled at, answers (encrypted), status.
    Questions are owner-defined (Not set).
  - F&F: **no table here.** Exits produces an `ExitSettlementInputs` hand-off (§B.11): last working day,
    leave balance days (from the ledger), notice shortfall days, open asset recovery intents (ids), and
    whether the clearance is complete. Figures are computed by payroll.
- **State machines.** Resignation: `SUBMITTED → ACCEPTED | REJECTED(only if the rules allow) | WITHDRAWN`.
  Exit case: `OPEN → CLEARANCE → READY_FOR_SETTLEMENT → CLOSED` (CLOSED when payroll reports F&F done, or a
  director closes it with a note); separation completes on its last working day through the existing code.
- **Permissions.** `exits.view`, `exits.manage` (HR, TEAM/ALL; non-pay), `exits.accept` (manager-grantable
  for own team; HR behind a switch), `exits.approve` (director step `EXIT_APPROVAL`, Not set),
  `exits.checklist.complete` for item owners. Employee: own resignation. Exit interview: interviewer of
  record + the employee (AS1).
- **Confidentiality.** Exit interviews: confidential class. Resignation reason: HR + directors + manager
  (not the directory: `Employee.exitReason` stays "never" in `fieldPolicy.ts`).
- **Notifications.** Resignation submitted → manager (`manager:{id}`) and HR (`perm:exits.manage`);
  accepted → employee; checklist item assigned → owner; overdue items (threshold Not set).
- **Screens.** Checklist board frames `checklist-01..10` (offboarding to-dos, templates) → **MAPPED**;
  resignation form and status: styled by system; exit interview: styled by system.
- **Settings Not set.** Notice rules per employment type/grade (and their source note, confirmed by a
  different director if legal), whether a manager may reject, checklist templates, interview questions,
  overdue thresholds, retention of interview answers.
- **Payroll hooks.** `ExitSettlementInputs` (read), `onSettlementCompleted(exitCaseId)` (they call me).
  Relieving/experience letters: requested from exits; HR issues them through `letters.issue.nopay` when the
  template is proven pay-free, otherwise a director issues them (`letters.generate`).
- **Risks.** Two resignations at once (unique active per employee); separation cancelled after
  acceptance; last day moved after assets are returned.

### B.6 Recruitment and joining

- **Data.**
  - `job_requisitions` (headcount ask; approval route Not set; second-director step
    `RECRUITMENT_REQUISITION`), `jobs` (title, department, location, employment type, description; **no
    pay band** — pay band is director-only `job_compensation_bands`, read by directors only).
  - `pipelines` / `pipeline_stages` (owner-defined, Not set → a job cannot be opened).
  - `candidates`: name, e-mail, phone (encrypted + blind index for duplicate detection), source (sources
    Not set), CV file (separate storage prefix), consent at, retention until (Not set → candidate creation
    refuses).
  - `applications`: candidate × job, current stage, status; append-only `application_stage_moves`.
  - `interviews`: application, round, scheduled at, panel (assigned interviewers).
  - `interview_feedback` (confidential to the panel and the hiring decision makers): scorecard answers
    (scorecards Not set), recommendation, submitted at. An interviewer sees **only their own** feedback
    until they submit (no anchoring), then the rest of the panel's.
  - `offers` (non-pay part: designation, joining date, location, manager) and `offer_compensation`
    (director-only; money; exact decimals). An offer letter carrying compensation needs `letters.generate` (directors); a pay-free letter (e.g. an
    interview invitation, if templated) can go through `letters.issue.nopay`.
  - `joining_document_requirements` (Not set), `candidate_documents` (uploaded through an **expiring
    private link**: random token, hashed at rest, single candidate, expiry Not set → links refuse to be
    created, revocable, rate-limited, no auth cookie), `joining_document_exceptions` (approver per AS3).
  - `candidate_conversions`: candidate → employee, **unique on candidate id and on application id**,
    employee id, converted by/at.
- **State machines.** Requisition `DRAFT → PENDING → APPROVED | REJECTED → CLOSED`. Job `DRAFT → OPEN →
  ON_HOLD → CLOSED`. Application `ACTIVE (stage n) → HIRED | REJECTED | WITHDRAWN`. Offer `DRAFT →
  PENDING_APPROVAL → APPROVED → SENT → ACCEPTED | DECLINED | EXPIRED | REVOKED`. Joining `DOCS_PENDING →
  DOCS_COMPLETE | EXCEPTION_GRANTED → CONVERTED`.
- **Conversion.** One transaction: lock the conversion row by candidate id (`INSERT … ON CONFLICT DO
  NOTHING` then select), call `createEmployeeInTx` (employee module, unchanged), copy documents into
  `employee_documents` via the documents service, write the conversion row. Repeating it returns the same
  employee. The sign-in invitation goes through the existing flow (`invitations.send`, an HR switch). Bank
  and identity details collected at joining are **entered by HR** through the existing writers (masked,
  pending until confirmed, as decided), never stored in a Peeps table. Assets for day one: B.2 requests.
- **Permissions.** `recruitment.view`, `recruitment.manage` (HR: jobs, candidates, stages, scheduling, non-pay
  offer), `recruitment.requisition.raise` (manager-grantable), `recruitment.offer.approve` (director),
  `recruitment.compensation.view/edit` (director-only, hard-locked from HR), `recruitment.convert` (HR).
  Assigned interviewer: no key; relationship gives the candidate summary, CV and their interview only.
- **Confidentiality.** Interview feedback: confidential class. Candidate PII: sensitive class
  `CANDIDATE_PERSONAL_DATA` (Developer locked out).
- **Notifications.** Interview assigned → interviewer (bell, e-mail with no candidate detail beyond name);
  feedback due; offer approved → HR; documents uploaded → HR. Candidates get e-mail only (templates in
  `letters`' email templates? → §F) through `MailService`.
- **Screens.** Board `recruitment-01..19` → **MAPPED**: jobs list (01/02), candidate table (03, 13),
  kanban (04), schedule modal (05), candidate drawer with evaluation/activity (06, 08), email (07), create
  job stepper (09–11), success (12), new candidate + CV upload (14, 15), settings: workflow/tags/templates
  (16–19). Phone variants from `light-phone/recruitment`. Offer compensation panel: styled by system,
  director-only.
- **Settings Not set.** Pipelines and stages, scorecards, sources, requisition approval route, offer
  approval route, retention, document requirements, link expiry, exception approver.
- **Payroll hooks.** `OfferCompensation` → on conversion, payroll may read it as the starting point of a
  salary assignment (their decision; I expose `getOfferCompensation(conversionId)` director-only).
- **Risks.** PII of non-employees (DPDP), public upload endpoint (abuse, malware: reuse `lib/uploads.ts`
  magic-byte checks and sharp re-encode, size caps), duplicate candidates, double conversion.

### B.7 → see B.3 (ticket desk) — kept in build order position 3.

### B.8 Badges and private nudges

- **Data.** `badge_definitions` (catalogue Not set: name, icon from a fixed safe icon set, description,
  who may award, monthly limit per giver Not set, public or private), `badge_awards` (append-only: badge,
  to, from, message, awarded at; revocation is a new row). Public awards appear on Engage as a new
  `PostKind` value `BADGE` (additive enum value) through the engage post service; private awards never.
  `private_nudges` (confidential): kind `APPRECIATIVE | CORRECTIVE`, sender, recipient, body (encrypted),
  sent at, read at, acknowledged at.
- **States.** Award: `AWARDED → REVOKED`. Nudge: `SENT → READ → ACKNOWLEDGED`; corrective nudges cannot be
  edited or deleted by the sender (append-only).
- **Permissions.** Award: per badge definition (Not set). Nudges: per AS2/AS2b. Recipient and sender only
  read a nudge.
- **Confidentiality.** Private nudges: confidential class.
- **Notifications.** Badge: recipient + feed (`org` room via existing engage emit). Nudge: recipient only,
  generic title.
- **Screens.** Badge on Engage (`news-01` cards, NOT IN BOARD for badges) and profile; nudges inbox:
  styled by system.
- **Settings Not set.** Catalogue, limits, who awards, who nudges.
- **Payroll hooks.** None (no monetary rewards; if the guide has them → payroll).
- **Risks.** Using nudges for discipline (records policy — owners); limit counting under concurrency.

### B.9 Unmute (answered)

- **What (answered).** Booked conversations with **authorised hosts from any department**. The system holds
  **scheduling and completion status only**. A booking is visible to its **two participants only**. There is
  **no notes field and no topic field**, anywhere (schema, API, e-mail, notification).
- **Data.** `unmute_hosts` (employee, authorised by, authorised at, active; roster Not set → booking
  refuses), `unmute_host_history` (append-only), `unmute_availability` (host's slots), `unmute_bookings`
  (booker, host, slot start/end, status, status changed at). No free-text columns on bookings: a test pins
  the column list.
- **Double booking.** Partial unique index `UNIQUE (host_id, slot_start) WHERE status = 'BOOKED'`, a per-host
  advisory lock in the service, and a test with parallel bookings. A booker has at most one open booking
  per host (also an index).
- **States.** `BOOKED → COMPLETED | CANCELLED | NOT_HELD`. Either participant may cancel. The host records
  COMPLETED or NOT_HELD after the slot.
- **Permissions.** No key opens a booking: booker and host only (relationship, B.0.3). Directors, HR and
  managers see nothing about bookings, not even counts. `unmute.hosts.manage` maintains the roster; who
  holds it is Not set (owners). The roster page shows host names only. Whether a person may book their
  own manager or someone in their own reporting line is Not set.
- **Notifications.** Booker and host only, generic titles ("Your Unmute booking is confirmed"),
  `user:{id}` rooms only. E-mails carry the time and nothing else.
- **Screens.** Host list and slot picker (calendar like `attendance-01`), my bookings, host's schedule.
  Styled by system.
- **Settings Not set.** Roster and who maintains it, slot length, booking window, cancellation cut-off,
  how long completed bookings are kept.
- **Insights.** Unmute is never a source.
- **Risks.** People may expect counselling records: the UI states plainly that nothing about the
  conversation is stored.

### B.10 Insights (answered)

- **Metrics (answered).** **Turnover, tenure, exit reasons, hiring funnel.** Nothing else.
- **Definitions Not set.** Each metric has a definition setting (Placeholder → Confirmed, B.0.1), e.g. how
  turnover is computed (leavers ÷ average headcount over which period, voluntary vs all), tenure buckets,
  exit-reason categories (from exits), and funnel stages (from recruitment pipelines). A metric whose
  definition is not Confirmed shows "Not set up yet" and its endpoint refuses.
- **Sources.** Turnover/tenure: employees and separations (`Employee.dateOfJoining`, `lastWorkingDate`,
  `exitReason`). Exit reasons: exit cases. Funnel: application stage moves. Never: exit interviews,
  interview feedback, nudges, Unmute, leave supporting documents, or any money.
- **Scope.** `insights.view` with the viewer's data scope (managers: their team; HR/directors: ALL).
- **Small-group privacy.** Minimum group size Not set → Insights refuses. Any bucket below it shows as
  "fewer than N", re-checked after every filter and on totals, so subtraction across buckets cannot
  reveal one. Managers whose whole team is under N see nothing.
- **Screens.** `home-02` KPI cards and `reports-*` chart frames (MAPPED-PARTIAL), with the dataviz rules in
  `DESIGN_SYSTEM.md` §1.5. Not in the report gallery (Session A's code).
- **Risks.** Re-identification by slicing (property test over filter combinations). Definitions changing
  history: each figure shows the definition version it used.

### B.11 Interfaces to the payroll session (I will NOT implement the payroll side)

| Interface | Direction | Shape (plain language) | Who may read |
|---|---|---|---|
| `AssetRecoveryIntent` | Peeps → payroll | incident id, employee, decision (RECOVER_FROM_FNF / RECOVER_FROM_SALARY / WAIVE), amount (exact decimal), decided by, second director if required | Directors |
| `ExitSettlementInputs` | Peeps → payroll | exit case id, employee, last working day, leave balance days, notice shortfall days, clearance complete, open recovery intent ids | Directors |
| `onSettlementCompleted` | payroll → Peeps | exit case id, completed at (no figures) | — |
| `OfferCompensation` | Peeps → payroll | conversion id, employee, offer compensation lines (exact decimals), approved by | Directors |
| `NotOnPayrollFlag` | read by Peeps | whether a joiner is on payroll yet (their Stage 5.2) — used only to show "awaiting payroll set-up" | HR sees yes/no only |

Each is a TypeScript type in `shared/constants/peepsPayrollContract.ts` plus a read function in my
module; a contract test pins the shape so a change on either side fails loudly.

---

## C. Clash map

### C.1 Not mine (never edited)
`backend/src/modules/payroll/**`; payslips, bank/statutory files, pay heads, salary rules, Monthly Inputs,
tax, loans, reimbursements, settlement, parity reports; report gallery code (`modules/reports/*`,
`pages/admin/reports/*`); director navigation and settings screens; the HR switch framework
(`shared/constants/hrCapabilities.ts`, `lib/hrCapabilities.ts`, `modules/hrCapabilities/*`,
`HrCapabilitiesPage.tsx`); the attendance engine, WFH and remote attendance (check-in/out); `.github/workflows/*`;
`docs/plans/MASTER_CHECKLIST.md`, `STAGE_REPORTS.md`, `docs/PROGRESS.md`. Also not mine by caution:
`lib/permissions.ts`, `lib/authDefaults.ts`, `lib/directorAuthority.ts`, `lib/directorNotices.ts`
(read/import only).

### C.2 Shared files I expect to touch (additive only, in `PEEPS-BEGIN/END` blocks)

| File | What I add | How it stays additive |
|---|---|---|
| `backend/prisma/schema.prisma` | New models/enums at the **end of the file** in one block per module. Prisma requires back-relation fields on `Employee`/`User`: added as the **last lines** of those models inside `// PEEPS-BEGIN <module>` … `// PEEPS-END`. One new enum value `BADGE` on `PostKind` (last value). The four new leave types are **seed/migration rows** in `leave_types` (inactive), not schema changes. | Never reorder; never edit existing lines; `prisma format` run only if it changes nothing outside my blocks (checked by diff before commit) |
| `backend/prisma/migrations/peeps_*` | One small migration per commit | New folders only; never touch a payroll table |
| `shared/constants/permissions.ts` | Keys at the end of `PERMISSION_KEYS`, entries at the end of `PERMISSION_CATALOG`, groups at the end of `PERMISSION_GROUPS`, manager-grantable keys at the end of that list | Blocks at the end of each literal |
| `shared/constants/sensitiveData.ts` | New classes, `REVIEWED_NOT_SENSITIVE` entries, `HR_FORBIDDEN_KEYS` additions (offer compensation, asset recovery, `helpdesk.visibility.manage`, `leave.types.approve`) | End-of-list blocks |
| `shared/constants/hrCapabilities.ts` | **Only with agreement** (other session owns it): new Peeps capabilities | End-of-list block; or the other session adds them for me |
| `backend/src/lib/systemRoles.ts` | Peeps keys in HR/manager/developer defaults | End-of-list blocks; plus a `peeps_` migration granting existing roles (defaults touch only new databases) |
| `backend/src/app.ts` (`BASE_MOUNTS`) | `/api/assets`, `/api/exits`, `/api/recruitment`, `/api/badges`, `/api/nudges`, `/api/unmute`, `/api/insights`, `/api/peeps` (settings), `/api/candidate-links` (public, before `/api` auth) | Appended at the end of the list, except the public candidate-link mount, which must sit before authenticated routers (one line, in a marked block next to `/api/people/photos`) |
| `modules/managers/__tests__/routeList.ts`, `routeInventory.ts` | My routes | End-of-file block |
| Access-scan / persona tests (`hrCapabilities/__tests__/hrMatrix.test.ts`, `access/__tests__/*`) | I do **not** edit them; I add my own `peepsMatrix.test.ts` and `peepsConfidential.test.ts` that follow the same pattern | New files |
| `backend/src/lib/fieldKeyRotation.ts` | `ENCRYPTED_COLUMNS` entries | End-of-list block |
| `backend/src/lib/dbRoles.ts` | `UPDATABLE_APPEND_ONLY_TABLES` only if a Peeps append-only table must change state | End-of-list block |
| `backend/src/lib/__tests__/cleanup.ts` | `OPTIONAL_FK_POLICY`, `STANDALONE_ROOT_MODELS`, `STORAGE_KEY_COLUMNS` entries | End-of-object blocks |
| `backend/src/modules/people/fieldPolicy.ts` | Only if a Peeps column lands on `Employee` (avoid) | — |
| `backend/src/modules/tasks/service.ts` | Register Peeps task sources (one line each, end of the registry) | End block; sources live in my modules |
| `backend/prisma/seed.ts` and the demo seed | Peeps demo data labelled DEMO | Calls into `backend/src/modules/<name>/seed.ts`; one marked line each |
| `frontend/src/routes/employeeMenu.config.tsx`, `adminMenu.config.tsx` | Menu entries with `lazyPage(...)` and `needs` | End-of-list blocks; new top-level apps appended last |
| `frontend/e2e/sensitive-ui.mjs`, `popovers.mjs` | Peeps URLs and the candidate/compensation/confidential strings to look for | End-of-list blocks |
| `docs/UI_SCREEN_MAP.md`, the docs index (there is no `docs/plans/README.md`; the index today is the file list in `CLAUDE.md` and each folder's README — I will add only links to the Peeps files there, in a marked block), `docs/GETTING_STARTED.md` | Rows/sections for Peeps | Appended sections only |

### C.3 Merge order for your two branches

1. Merge **`feat/hr-payroll-separation`** first (it is the base; `peeps/foundation` already contains it up
   to the last checkpoint merge).
2. Then merge **`peeps/foundation`**. At every checkpoint I will have merged the latest
   `feat/hr-payroll-separation` into `peeps/foundation` and re-run the suite, so step 2 should be a clean
   merge. If the other branch moves after my last checkpoint, I merge it again before you merge mine.
3. Before step 1, agree two things with the other session: (a) who adds the Peeps HR capabilities
   (B.0.4) — **answered: me, in a PEEPS block**; (b) the helpdesk split (B.3) — **answered: by category; Session A
   owns the Payroll category and its routing, I own the rest**. The text below is kept for the merge rule:
   **after** mine is merged, or they build the whole enum and I build on it. Whichever lands first, the
   other merges it before touching helpdesk.
4. Migrations: theirs are timestamp-named and sort before every `peeps_` folder. A database that already
   applied a `peeps_` migration and later receives a new timestamped payroll migration still deploys
   (Prisma applies unapplied folders in order and does not require history order), but `migrate dev`
   on such a database may report the history as diverged. On dev databases the fix is to rebuild
   (destructive → I ask you first). Staging/production are not involved.

---

## D. Test strategy

For every module: unit tests for the state machines; route tests through the real app (`supertest`) for
Zod validation, `requireAuth`, `requirePermission`, scope; IDOR "employee cannot read others" on every
`/:id` route; Developer locked out of every sensitive value; audit row per state change; settings Not set
→ the module refuses (one test per required key); fixtures cleaned up with
`deleteEmployeesAndDependents` / `deleteWithDependents` (and `cleanup.test.ts` classifications); new
append-only tables refuse UPDATE/DELETE as the app role (`dbRoles` pattern); new encrypted columns
listed (`fieldKeyRotation` test); mutation checks recorded in the stage report (turn a guard off, a named
test must fail); full backend suite run **alone**; frontend lint, typecheck, tests, build, `check:bundle`,
`check:tokens`, `check:sensitive-ui`, `check:popovers` extended to the new screens.

| Module | Specific tests |
|---|---|
| Foundation | Placeholder → Confirmed only by a different person (service + DB trigger + test as the app role); Not set refuses; module switch off → 404 on every route; `peepsConfidential.test.ts`: every confidential table × every persona (director, HR Admin, HR Executive, manager, Developer, unrelated employee, related people) via every route, search, tasks, notifications, exports, socket rooms (joined-room assertion) and log lines (captured pino output) |
| Directory/avatars | `fieldPolicy` guard still green; initials fallback; per-person preference can only narrow |
| Assets | **Single active assignment**: 20 parallel issue calls for one asset → exactly one succeeds, the rest 409, index holds even with the service lock disabled (mutation); return idempotent; HR gets 403 on valuation/recovery (hard lock, persona matrix); recovery intent append-only |
| Ticket desk | A ticket in a category outside the viewer's visibility is absent everywhere (queue, ticket, attachment, Tasks, counts, search, socket); a move out of the handler's visibility removes their access; only directors change visibility (HR hard-locked); my code never reads or writes the Payroll category; existing categories without a row behave exactly as today |
| Leave extension | A new type cannot be requested until a director (not the preparer) approves its rules; every Not set rule value refuses; requests obey `APPROVE_LEAVE` and scope; no self-approval; ledger append-only; supporting documents readable only by the uploader and HR-role holders with the key — **a Super Admin without an HR role gets 404** (mutation: drop the role check → test fails); retention Not set refuses upload; new types excluded from year-end until their rule is approved; PL year-end unchanged (existing tests) |
| Exits | One active resignation per employee (race); acceptance creates exactly one `separations` row (idempotent on retry); checklist generated from active asset assignments; exit interview confidential matrix; `ExitSettlementInputs` contains no money field (type + runtime assertion) |
| Recruitment | Conversion idempotent: same candidate converted twice in parallel → one employee, same id returned; re-conversion after an employee edit doesn't overwrite; offer compensation 403 for HR (hard lock) and absent from HR responses (deep scan of JSON); interviewer sees only assigned candidates and only own feedback before submitting; **expiring private links**: expired/revoked/used-up/wrong-token → same 404, token stored hashed, timing-safe compare, rate limit, no cookies accepted, upload type/size/magic-byte checks |
| Badges/nudges | Award limit under concurrency (parallel awards over the limit → exactly the limit succeed); private nudge absent from feed, search, counts; corrective nudge cannot be edited/deleted |
| Unmute | **Double-booking race**: N parallel bookings of one host slot → exactly one; partial unique index holds with the lock disabled (mutation); cancelled slot can be rebooked; the bookings table has no free-text column (schema test); no booking data in any director/HR/manager response, count or Insights |
| Insights | Cohort minimum enforced after every filter combination (property test); no confidential source queried (static check of the module's Prisma calls); scope respected |
| Payroll contract | Shape tests for every §B.11 type; Peeps never imports from `modules/payroll` except declared read functions (a lint rule / test greps imports) |

---

## E. Document autofill — options and questions only

No provider is chosen and no document leaves the system until you decide. Options:

| Option | Where data goes | Notes |
|---|---|---|
| **None** (manual entry) | Nowhere | Default until decided |
| **On-server OCR** (e.g. Tesseract, or PaddleOCR in a worker container) | Stays on our server | No third party; weaker on photos and Indian ID layouts; needs our own field-extraction rules; CPU cost in the worker |
| **Cloud OCR in India region** (AWS Textract — availability in the Mumbai region to be checked; Google Document AI; Azure AI Document Intelligence) | The provider, in the chosen region | Good accuracy; DPA and region pinning required; AWS work is out of scope now |
| **India-specific KYC / ID-parsing APIs** | A third party | Built for PAN/Aadhaar layouts; Aadhaar handling carries its own legal rules — owners/counsel must decide; never guessed |
| **LLM-based extraction** (any vendor) | The vendor | Flexible; same data-protection questions plus retention/training terms |

Questions: which documents (CV only? ID proofs? education certificates? bank proof → bank data is payroll's
and HR may only *enter* masked changes); is any third party acceptable at all; region requirement; whether
Aadhaar may ever be sent (masking first?); retention at the provider (zero-retention terms?); who reviews
extracted values before they are saved (always a person; autofill only pre-fills); consent wording for
candidates; budget; offline fallback.

Data-protection concerns: DPDP Act consent and purpose limitation for candidates (not yet employees);
cross-border transfer; provider retention/training; Aadhaar-specific restrictions; extracted values
must go through the same encryption and masking as typed ones; audit who triggered extraction; an
extraction failure must never block a joiner.

---

## F. Questions blocking each module

| # | Module | Question | Who answers |
|---|---|---|---|
| Q0 | All | The guide was said to be in `docs/integration/` but is not on any remote branch (checked 2026-10-30). Please push it (to `feat/hr-payroll-separation`, `main` or this branch); then commit 2 adds the chapter column. | You |
| Q-F1 | Foundation | **Answered:** AS1 confirmed. | — |
| Q-F2 | Foundation | **Answered:** me, keys only, inside a PEEPS block; no framework change. | — |
| Q-F3 | Foundation | **Answered:** keep `peeps/foundation`. | — |
| Q-D1 | Directory | Per-person hiding of directory fields: wanted? Photo change review: wanted? | Owners, HR |
| Q-A1 | Assets | Asset categories, whether employees may request, request approval route, overdue threshold. | Owners, HR |
| Q-A2 | Assets | Is recovery for lost/damaged assets ever made, and from F&F only or salary too? (Legal side: never guessed.) | Owners |
| Q-T1 | Ticket desk | ~~Queue split~~ **Answered** (by category; Payroll category is Session A's). Still Not set: visibility per category; whether a "concerns HR" category exists. | Owners |
| Q-L1 | Leave extension | **Answered** (four new types, HR prepares, director approves, HR-only documents, Annual Leave = PL). | — |
| Q-L2 | Leave extension | Every rule value per type; retention of supporting documents; calendar label; whether to show "Annual Leave" for PL. | HR prepares, a director approves |
| Q-L3 | Leave extension | ~~Lateness waiver~~ Out of my scope (attendance and remote attendance are Session A's). | — |
| Q-E1 | Exits | Notice rules (per type/grade), legal minimums with source note; may a manager reject a resignation; who accepts when the manager is missing (AS4). | Owners (legal values: an owner enters, a different director confirms) |
| Q-E2 | Exits | Exit checklist templates and owners; exit interview questions; who interviews; retention. | HR, owners |
| Q-E3 | Exits | Does exits trigger the relieving letter request automatically (directors issue)? | Owners |
| Q-R1 | Recruitment | Pipelines/stages, scorecards, sources, requisition and offer approval routes. | HR, owners |
| Q-R2 | Recruitment | Candidate data retention and consent wording (DPDP). | Owners |
| Q-R3 | Recruitment | Joining-document list, link expiry, exception approver (AS3). | HR, owners |
| Q-R4 | Recruitment | Candidate e-mails: reuse letter/email templates (`letters.template.manage`, HR may edit) or a separate recruitment template set? | Owners |
| Q-B1 | Badges/nudges | Badge catalogue, who awards, limits, public vs private; who sends nudges of each kind (AS2/AS2b). | Owners, HR |
| Q-U1 | Unmute | **Answered** (authorised hosts from any department; scheduling and completion only; participants only; no notes/topic). Still Not set: roster and who maintains it, slot length, booking window, cancellation cut-off, retention. | Owners |
| Q-I1 | Insights | **Answered** (turnover, tenure, exit reasons, hiring funnel; scoped; small-group privacy). Still Not set: each metric definition, minimum group size. | Owners |
| Q-X1 | Autofill | §E questions. | Owners |
| Q-X2 | Auth | **Answered:** Session A makes it optional; not touched by me. | — |

---

## G. Proposed commits (each verified per §D before the next)

| # | Module | Commit | Size |
|---|---|---|---|
| 1 | Docs | This plan, checklist, stage report | small (this commit) |
| 2 | Docs | Chapter mapping once the guide is pushed (**blocked**: not on the remote) | small |
| 3 | Foundation | `peeps_setting_versions` / confirmations, `assertModuleReady`, module switches, migration, tests | medium |
| 4 | Foundation | Confidential-access helper + `peepsConfidential.test.ts` harness (empty class list, grows per module) | medium |
| 5 | Foundation | Peeps settings screen (Admin Tools), Not set / Placeholder / Confirmed states | medium |
| 6 | Directory | `PersonAvatar` + directory filters (+ preferences if Q-D1 says yes) | small |
| 7 | Assets | Schema, catalogue, items, encryption of serials, routes, tests | medium |
| 8 | Assets | Assignment/return with single-active guarantee, race test, history | medium |
| 9 | Assets | Requests, incidents, recovery intents (director-only), contract type | medium |
| 10 | Assets | Screens (admin inventory, detail, my assets, profile tab), sensitive-ui/popovers | medium |
| 11 | Ticket desk | Category visibility (general categories only), move between categories, tests, screen changes | medium |
| 12 | Leave ext. | Audit of fixed-type assumptions in the leave code; four inactive types; rule versions (HR prepares, director approves); requests through the leave service; tests | large |
| 13 | Leave ext. | HR-only supporting documents, retention, access log, year-end exclusion, screens | medium |
| 14 | Exits | Resignations + acceptance → `initiateSeparation`, tests | medium |
| 15 | Exits | Checklist templates/items + asset return gate; screens from `checklist-*` | large |
| 16 | Exits | Exit interviews (confidential), `ExitSettlementInputs` contract | medium |
| 17 | Recruitment | Requisitions, jobs, pipelines/stages, schema + routes | large |
| 18 | Recruitment | Candidates, applications, CV upload, duplicate detection, encryption | large |
| 19 | Recruitment | Interviews, panel, feedback (confidential), scorecards | medium |
| 20 | Recruitment | Offers (non-pay) + director-only compensation, approval step | medium |
| 21 | Recruitment | Expiring private links, joining documents, exceptions | medium |
| 22 | Recruitment | Idempotent conversion, tests (parallel) | medium |
| 23 | Recruitment | Screens from `recruitment-01..19` (+ phone) | large |
| 24 | Badges | Catalogue, awards, limits, Engage `BADGE` posts, screens | medium |
| 25 | Nudges | Private nudges (confidential), screens | small |
| 26 | Unmute | Hosts, availability, bookings with race guard (no notes or topic), screens | medium |
| 27 | Insights | Turnover, tenure, exit reasons, hiring funnel; definition settings; small-group minimum; screens | medium |
| 28 | All | Seed + demo company (DEMO values), GETTING_STARTED, UI_SCREEN_MAP rows, stage report | medium |
| — | Autofill | Nothing until §E is answered | — |

Checkpoints (merge the latest `feat/hr-payroll-separation`, full suite alone, report): after 5
(foundation), after 11, after 16, after 23, after 28.
