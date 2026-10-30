# Peeps — plan for the second build session

**Status: PLAN ONLY. Nothing in this document has been built.** Branch `peeps/foundation`, which holds
`feat/hr-payroll-separation` at `8979072` (merged in, see §0). The other session owns payroll and the files
listed in §C.1. This document, `PEEPS_CHECKLIST.md` and `PEEPS_STAGE_REPORTS.md` are this session's only
reporting files.

The repo is public. This plan names no real person, salary, bank/PAN/UAN/Aadhaar number, device serial, IP,
legal name or greytHR URL. Every quota, duration, threshold, category, stage, scorecard, notice rule, badge,
limit, host roster, retention period and approval route below is **Not set** until the owners choose it;
a feature whose required settings are missing refuses to switch on. The demo company may carry made-up
values, each labelled DEMO.

---

## 0. Ground facts found while starting (read these first)

1. **The integration guide is not in the repo** and no copy was attached to this session. I searched
   `docs/`, every branch on `origin` (`main`, `master`, `ui/design-pass`, `feat/hr-payroll-separation`) and
   the whole working tree for "integration guide", "Peeps", "Unmute". So **section A cannot be mapped
   chapter by chapter yet.** Section A is written per module/topic named in your prompt. When you commit
   the guide (I suggest `docs/integration/PEEPS_GUIDE.md`) I will add a chapter-number column to the A
   table in one docs-only commit before building anything. Wherever this plan has to guess what the guide
   means (e.g. "leave extension", "Unmute", "insights"), it says so and lists the guess as a question in §F.
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
   director. If the owners confirm that Unmute bookings, exit interviews, medical documents and private
   nudges are hidden even from directors (§2, assumption 1), those must be gated by **relationship**
   (booker/host, interviewer of record, document custodian, sender/recipient), not by a key. The plan is
   designed that way from the start, so the answer changes configuration, not schema.
4. **Two-step sign-in.** `backend/src/lib/authDefaults.ts` enforces 2FA for every Super Admin outside
   development, and payroll's Ready-for-first-run checklist requires it (Stage 2). Decision 2 says it is
   optional for directors "for now". This is **auth / payroll-readiness code, not mine**; listed in A as a
   conflict for the other session or you to settle. I will not touch it.
5. **Frontend layout.** Existing screens live in `frontend/src/pages/{employee,admin}/…`; there is no
   `frontend/src/features/` folder. Your prompt names `frontend/src/features/<name>/`, so I will create it
   (one folder per module: `pages/`, `api.ts`, `components/`), lazy-loaded from the menu configs. Nothing
   existing moves.
6. **Placeholder / Confirmed today lives inside payroll** (`payroll_item_versions`,
   `payroll_item_confirmations`, `modules/payroll/items.ts`) — owned by the other session. Peeps needs the
   same rule for its own settings (§B.0), so I will build a small, separate `peeps_setting_versions` store
   rather than import or extend payroll's.
7. **Helpdesk queues (H3) are designed but not built.** `HR_PAYROLL_SEPARATION.md` §7 designs `queue = HR |
   PAYROLL | DIRECTORS`; the schema has no `queue` column yet. Payroll tickets are the other session's;
   grievance and "concerns HR" routing are mine. §B.7 proposes who builds which half.
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
| AS1 | Unmute bookings, exit interviews, medical documents and private nudges are confidential **even from directors**, exactly as the guide says. | Built relationship-gated; directors get **no** reader. A director can be added as a named custodian later by configuration, never by code. |
| AS2 | Who may issue **corrective** private nudges (manager of the person? HR? directors only?). | Not set → corrective nudges refuse to send; appreciative nudges follow AS2b. |
| AS2b | Who may send **appreciative** private nudges. | Not set → refuses. |
| AS3 | Who approves a **joining-document exception** (a joiner without a required document by day one). | Not set → an exception cannot be granted; conversion waits until documents are complete. |
| AS4 | **Missing-manager fallback**: who decides when a person has no manager (or the manager has left) for leave extensions, exit acceptance, asset requests. | Not set → the item waits in the directors' queue with a "no manager" note (same mechanism as `noTeamApprover.ts`). |

---

## A. What already exists, what is missing, what conflicts

Chapter numbers of the guide: **pending the guide** (§0.1). Rows are by topic.

| Topic | Exists today (paths) | Missing for Peeps | Conflicts with a §1 decision |
|---|---|---|---|
| **Roles, permissions, scope** | `shared/constants/permissions.ts` (catalog), `shared/constants/roles.ts`, `backend/src/lib/systemRoles.ts`, `lib/permissions.ts` (`resolveAccess`), `lib/dataScope.ts`, `middleware/rbac.ts` (`requireAuth`, `requirePermission`), `shared/constants/sensitiveData.ts` (sensitive classes, Developer ceiling, `HR_FORBIDDEN_KEYS`) | Peeps keys (§B per module), new sensitive classes, relationship-based readers for confidential classes | Super Admin gets every key (§0.3): confidentiality "even from directors" must be relationship-gated |
| **HR switch framework** | `shared/constants/hrCapabilities.ts`, `lib/hrCapabilities.ts`, `modules/hrCapabilities/*`, `pages/admin/adminTools/HrCapabilitiesPage.tsx` | Switches for the Peeps duties HR may lose (e.g. approve leave extensions, accept resignations, run exit clearance) | **Owned by the other session.** I need additive entries in `HR_CAPABILITY_IDS`/`HR_CAPABILITIES`; see §C.2 |
| **Director authority** | `shared/constants/directorAuthority.ts`, `lib/directorAuthority.ts`, `lib/directorNotices.ts` (notice to the other director) | Peeps "second director" steps (offer approval, exit approval, asset write-off) | The setting `payroll.secondDirector` is payroll's; Peeps uses its own `peeps.secondDirector` setting, reusing `lib/directorNotices.ts` read-only |
| **Two-step sign-in** | `lib/authDefaults.ts` (mandatory for Super Admins outside development), payroll readiness row | — | Conflicts with "optional for directors for now". Not mine; flagged for you / the other session |
| **Audit, append-only, DB roles** | `lib/audit.ts`, append-only triggers, `lib/dbRoles.ts` (`appendOnlyTables` reads the triggers; `UPDATABLE_APPEND_ONLY_TABLES`), `lib/__tests__/dbRoles.test.ts` | Every new append-only Peeps table gets a truncate-blocking trigger (picked up automatically); any that must keep UPDATE needs an additive entry in `UPDATABLE_APPEND_ONLY_TABLES` | None |
| **Field encryption** | `lib/encryption.ts`, `lib/fieldKeys.ts`, `lib/fieldKeyRotation.ts` (`ENCRYPTED_COLUMNS`; a test fails on an unlisted `Bytes` column), `lib/fieldHash.ts` (blind index) | Candidate phone/email/ID numbers, medical notes, nudge bodies, Unmute notes, exit-interview answers, interview feedback | None |
| **Employees, onboarding** | `modules/employee/service.ts` (`createEmployee`, `createEmployeeInTx`), Add Employee wizard, invitations, `modules/import/*` | Candidate → employee conversion (idempotent), joining documents checklist, pre-joining portal | `import.manage` is hard-locked to directors (Checkpoint 1); bulk candidate import must not reuse the Import Center |
| **Separation / exits** | `modules/employee/separations.ts` (initiate, cancel, complete → `markSeparatedInTx`), `separations` table (INITIATED/COMPLETED/CANCELLED), `pages/admin/employee/SeparationsPage.tsx`, Leavers report | Employee resignation request, notice rules, acceptance flow, clearance checklist, exit interview (confidential), asset return gate, F&F hand-off, relieving letter request | F&F and recoveries are money → director-only and payroll's; relieving/experience letters need `letters.generate` (hard-locked to directors) |
| **Assets** | Spec §12 Phase 8 "Assets management"; route placeholder `/admin/assets` (`UI_SCREEN_MAP.md`); spec §7.2 profile tab "Assets" | Everything: catalogue, items, assignment, return, condition, requests, recovery intent | Recovery amounts are money → director-only, payroll implements deduction |
| **Recruitment** | Nothing (UI_SCREEN_MAP: "No recruitment module in the spec's phases"); board frames `recruitment-01..19` | Everything: requisitions, jobs, candidates, pipeline, interviews, feedback, offers (non-pay), joining | Offer compensation is money → director-only; spec Phase 6 note "offer letter figures from salary assignment" is payroll's |
| **Leave** | `modules/leave/*` (5 fixed types `PL/LOP/COF/WFH/RH`, one-row-per-type `leave_policies`, append-only `leave_ledger`, requests, year-end, recalculator, `noTeamApprover.ts`) | "Leave extension" — my reading: extend an approved leave, owner-defined extra leave types, supporting/medical documents (confidential). Guide needed (§F) | HR leave approval is a switch (`APPROVE_LEAVE`) — extensions must obey it. Year-end/encashment is money → untouched. WFH is the other session's (§C.1) |
| **Lateness waiver** | No lateness model in the schema; attendance engine computes late-in | A waiver request/approval if the guide wants it | **Attendance engine is the other session's.** HR approval must sit behind a switch (decision). I will not build it; interface only (§B.4) |
| **Engage, kudos** | `modules/engage/*` (posts, kudos, polls, auto-posts), `PostKind` enum, `emitEngage*` | Badges (catalogue, awards, limits) shown on the feed and profile; private nudges (never on the feed) | None |
| **Helpdesk** | `modules/helpdesk/*`, `helpdesk_categories.is_sensitive`, `helpdesk.sensitive.view`, no queues | H3 queues: HR / DIRECTORS (mine), PAYROLL (theirs); "this concerns HR" and escalate-to-directors | Payroll tickets are the other session's |
| **People directory, avatars** | `modules/people/directory.ts`, `fieldPolicy.ts` (every Employee column classified), `photos.ts` (sharp re-encode, signed photo token), org chart, company-wide toggles in `peopleDocumentsSettings.ts` | Initials avatars everywhere a person is named, per-person privacy choices (if the guide wants them), photo change review (if wanted), directory search/filters by skills/badges | None |
| **Documents** | `modules/documents/*`, `DocumentSensitivity GENERAL/PAY/STATUTORY`, `lib/sensitiveDocs.ts`, `lib/uploads.ts` (magic bytes, sharp re-encode) | MEDICAL class — not a new enum value on the shared table but a separate store (§B.4), since confidential classes never appear in shared lists | Adding `MEDICAL` to `DocumentSensitivity` would surface medical files in Document Center lists/counts — rejected |
| **Tasks, notifications, realtime** | `modules/tasks/service.ts` (`TaskSource` registry, no task table), `modules/notifications/*` (`type` is a free string), `realtime/emit.ts`, rooms `user:/manager:/dept:/location:/role:/perm:/org` | Task sources per module; a real checklist task table (exits, joining) | Confidential classes must never emit to `perm:*`, `role:*`, `dept:*`, `org` rooms; only `user:{id}` of the people in the relationship |
| **Reports / insights** | `modules/reports/*` (definitions, gallery, permission per report), Admin Dashboard widgets | Insights (aggregates for owners/HR/managers) | Report gallery code is the other session's; Insights is a **separate** module with its own endpoints and screens, not new gallery entries |
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
3. **Ticket desk changes** — small; grievance routing is a prerequisite for exits (exit concerns) and Unmute escalation.
4. **Leave extension** — extends an existing flow; medical-document store is reused by exits (not needed) and Unmute (no).
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
with one resolver per class (booker/host, interviewer of record, custodian, sender/recipient, the employee
themself). It **ignores roles and keys entirely**, so a Super Admin is not a reader unless named. A test
crawls every Peeps route as a director, HR Admin, HR Executive, manager, Developer and unrelated employee
and proves no confidential row comes back. Confidential tables are excluded from: Tasks sources, the
notification body (title is generic: "You have a new private message"), e-mail body, Socket.IO rooms
other than `user:{id}` of the related people, logs (`lib/redact.ts` allowlist), exports, search, Insights,
the audit log's `before/after` (audit rows store ids and the action only, never content).

**B.0.4 HR switches for Peeps duties.** The framework is the other session's. I will add entries to
`HR_CAPABILITY_IDS`/`HR_CAPABILITIES` only inside a `// PEEPS-BEGIN hr-capabilities` block at the end of
each list, after you (or they) agree — see §C.2. Until then, Peeps duties for HR are ordinary keys in the
HR role defaults and the directors can remove them through Roles & Permissions.

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

### B.3 Ticket desk changes (non-payroll)

- **Data.** Build the `queue` half of H3 that is not payroll's: `helpdesk_categories.queue` and
  `helpdesk_tickets.queue` with values `HR | DIRECTORS | PAYROLL`. I add the enum with all three values and
  the HR/DIRECTORS behaviour; `PAYROLL` behaviour (who sees it, migrating open payroll tickets) is the other
  session's (§F Q-T1). Columns added to existing helpdesk tables (helpdesk is not on the other session's
  list, but this is still an additive column, default `HR`). Append-only `helpdesk_queue_moves`.
- **States.** Ticket statuses unchanged. Queue moves: `HR → DIRECTORS` (escalate, reason required, one way
  for HR); `DIRECTORS → HR` (hand back, directors only). Raising a Grievance with "This concerns HR" creates
  it directly in `DIRECTORS`.
- **Permissions.** `helpdesk.directors.manage` (directors; hard-locked from HR), `helpdesk.routing.manage`
  (directors; changing a category's queue). Existing `helpdesk.manage`, `helpdesk.sensitive.view` unchanged
  for the HR queue. After escalation the HR handler loses access (404); the raiser keeps the thread.
- **Confidentiality.** DIRECTORS-queue tickets never reach HR's queue, counts, Tasks, search or sockets.
- **Notifications.** Escalation → directors (bell, `perm:helpdesk.directors.manage` room is fine because
  only directors hold it); raiser gets a neutral "your ticket was moved to another team".
- **Screens.** Existing `/admin/employee/helpdesk` (MAPPED-PARTIAL `help-01`) gains a queue filter and
  Escalate action; Raise form gains the checkbox. Styled by system.
- **Settings Not set.** Which categories go to DIRECTORS by default.
- **Payroll hooks.** PAYROLL queue visibility and migration of open payroll tickets — other session.
- **Risks.** Shared helpdesk files edited by both sessions if the other one builds PAYROLL at the same
  time → agree the split before either starts (§C.3).

### B.4 Leave extension (my reading; guide needed)

- **Data.**
  - `leave_extension_requests`: original approved request, new end date/day part, reason, status, decided
    by. Approving writes the extra days as an **additional** leave request linked to the original (the
    ledger stays append-only; nothing in an approved request is edited).
  - Owner-defined extra leave types: today `leave_types` has 5 seeded codes and `leave_policies` is one row
    per fixed type. If the guide wants more types (sick, bereavement, parental…), that is a change to the
    leave module's policy model; I will propose it as its own small plan first, because accrual and
    year-end touch payroll (encashment).
  - `medical_documents` (confidential store, **not** `employee_documents`): owner employee, linked leave
    request (optional), file key (separate storage prefix), uploaded at, custodian(s) of record, retention
    until (Not set → upload refuses), an append-only `medical_document_access_log`.
- **States.** Extension: `PENDING → APPROVED | REJECTED | CANCELLED`; on APPROVED the linked request goes
  through the normal leave service (balance check, attendance integration).
- **Permissions.** Deciding an extension = deciding leave: `leave.approve` in scope, obeying the
  `APPROVE_LEAVE` HR switch; no self-approval; missing manager → AS4. Medical documents: the employee and
  the named custodian(s) only (relationship); the approver sees "a medical document is on file: yes/no",
  never the file, unless the owners decide otherwise (§F).
- **Confidentiality.** Medical documents: confidential class (B.0.3).
- **Notifications.** Same as leave applied/decided (`emitLeaveApplied`, existing rooms) for extensions;
  medical uploads notify the custodian with a generic title.
- **Screens.** Employee: "Extend" action on an approved leave (`time-off-03/04` drawer pattern, MAPPED);
  approver: extension appears in Review (`time-off-05`). Medical upload: styled by system.
- **Settings Not set.** Whether extensions are allowed per type, max extension, document requirement
  threshold (days), custodians, retention.
- **Lateness waiver (not built).** Attendance engine is the other session's. Interface proposal only:
  they expose `lateWaiverEligible(employeeId, date)` and accept a `LatenessWaiverDecision`; HR approval is
  a new HR switch in their framework.
- **Payroll hooks.** None directly (LOP flows through attendance as today).
- **Risks.** Extension over a holiday/week-off or across the year boundary; concurrent apply + extend
  (reuse `leave/concurrency.ts` lock).

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
  Relieving/experience letters: requested from exits, **issued** by a director (`letters.generate`).
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
    (director-only; money; exact decimals). Offer letter is a letter → `letters.generate` (directors).
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
  employee. Invitation goes through the existing invitation flow. Assets for day one: B.2 requests.
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

### B.9 Unmute (my reading: private conversations booked with a trained host)

- **Data.** `unmute_hosts` (roster Not set; a host is an employee), `unmute_availability` (host slots),
  `unmute_bookings` (confidential: booker, host, slot start/end, mode, status), `unmute_notes` (host's
  private notes, encrypted, host-only; retention Not set).
- **Double booking.** Partial unique index `UNIQUE (host_id, slot_start) WHERE status IN
  ('BOOKED','CONFIRMED')` + a per-host advisory lock; a person cannot book their own manager as host if the
  owners say so (Not set).
- **States.** `BOOKED → CONFIRMED → COMPLETED | CANCELLED_BY_BOOKER | CANCELLED_BY_HOST | NO_SHOW`.
- **Permissions.** No keys for content. `unmute.hosts.manage` (who may maintain the roster — Not set; the
  roster screen shows names only, never bookings). Directors and HR see nothing about bookings (AS1);
  Insights shows nothing.
- **Notifications.** Booker and host only, generic titles, `user:{id}` rooms only; e-mails carry the time
  and no reason.
- **Screens.** Styled by system (calendar slots like `attendance-01`, booking drawer).
- **Settings Not set.** Host roster, slot length, booking window, cancellation rules, retention,
  escalation path if a host is worried about safety (owners must decide; Unmute never auto-escalates).
- **Payroll hooks.** None.
- **Risks.** Duty-of-care escalation conflicts with confidentiality → owners' policy before go-live.

### B.10 Insights (new)

- **What.** Aggregates for directors, HR and managers (in scope): headcount trend, joiners/leavers,
  time-to-hire, offer acceptance, open requisitions, exit reasons (categories), asset utilisation, badge
  counts. Never: anything from a confidential class (not even counts), any money, any individual row.
- **Minimum cohort size** (Not set → Insights refuses): a bucket with fewer people is shown as "fewer than
  N". Managers see their team only and only if the team is ≥ N.
- **Permissions.** `insights.view` (data scope applies); pay-derived insights do not exist here.
- **Screens.** `home-02` KPI/charts (MAPPED-PARTIAL), `reports-*` frames for charts; uses the dataviz rules
  in `DESIGN_SYSTEM.md` §1.5.
- **Payroll hooks.** None. **Not** in the report gallery (other session's code).
- **Risks.** Re-identification by slicing (filters respect the cohort minimum after every filter).

### B.11 Interfaces to the payroll session (I will NOT implement the payroll side)

| Interface | Direction | Shape (plain language) | Who may read |
|---|---|---|---|
| `AssetRecoveryIntent` | Peeps → payroll | incident id, employee, decision (RECOVER_FROM_FNF / RECOVER_FROM_SALARY / WAIVE), amount (exact decimal), decided by, second director if required | Directors |
| `ExitSettlementInputs` | Peeps → payroll | exit case id, employee, last working day, leave balance days, notice shortfall days, clearance complete, open recovery intent ids | Directors |
| `onSettlementCompleted` | payroll → Peeps | exit case id, completed at (no figures) | — |
| `OfferCompensation` | Peeps → payroll | conversion id, employee, offer compensation lines (exact decimals), approved by | Directors |
| `NotOnPayrollFlag` | read by Peeps | whether a joiner is on payroll yet (their Stage 5.2) — used only to show "awaiting payroll set-up" | HR sees yes/no only |
| `LatenessWaiverDecision` | Peeps ↔ attendance | only if the guide requires it and the attendance owner agrees | — |

Each is a TypeScript type in `shared/constants/peepsPayrollContract.ts` plus a read function in my
module; a contract test pins the shape so a change on either side fails loudly.

---

## C. Clash map

### C.1 Not mine (never edited)
`backend/src/modules/payroll/**`; payslips, bank/statutory files, pay heads, salary rules, Monthly Inputs,
tax, loans, reimbursements, settlement, parity reports; report gallery code (`modules/reports/*`,
`pages/admin/reports/*`); director navigation and settings screens; the HR switch framework
(`shared/constants/hrCapabilities.ts`, `lib/hrCapabilities.ts`, `modules/hrCapabilities/*`,
`HrCapabilitiesPage.tsx`); the attendance engine and WFH; `.github/workflows/*`;
`docs/plans/MASTER_CHECKLIST.md`, `STAGE_REPORTS.md`, `docs/PROGRESS.md`. Also not mine by caution:
`lib/permissions.ts`, `lib/authDefaults.ts`, `lib/directorAuthority.ts`, `lib/directorNotices.ts`
(read/import only).

### C.2 Shared files I expect to touch (additive only, in `PEEPS-BEGIN/END` blocks)

| File | What I add | How it stays additive |
|---|---|---|
| `backend/prisma/schema.prisma` | New models/enums at the **end of the file** in one block per module. Prisma requires back-relation fields on `Employee`/`User`: added as the **last lines** of those models inside `// PEEPS-BEGIN <module>` … `// PEEPS-END`. One new enum value `BADGE` on `PostKind` (last value). `queue` columns on two helpdesk models (last field). | Never reorder; never edit existing lines; `prisma format` run only if it changes nothing outside my blocks (checked by diff before commit) |
| `backend/prisma/migrations/peeps_*` | One small migration per commit | New folders only; never touch a payroll table |
| `shared/constants/permissions.ts` | Keys at the end of `PERMISSION_KEYS`, entries at the end of `PERMISSION_CATALOG`, groups at the end of `PERMISSION_GROUPS`, manager-grantable keys at the end of that list | Blocks at the end of each literal |
| `shared/constants/sensitiveData.ts` | New classes, `REVIEWED_NOT_SENSITIVE` entries, `HR_FORBIDDEN_KEYS` additions (compensation, recovery, directors queue) | End-of-list blocks |
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
   (B.0.4); (b) the helpdesk queue split (B.3) — I add the enum and HR/DIRECTORS; they add PAYROLL behaviour
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
| Ticket desk | Escalation removes HR access everywhere (queue, ticket, attachment, Tasks, socket); "concerns HR" never visible to HR; directors hand back; routing key required to change a category's queue |
| Leave extension | Extension obeys `APPROVE_LEAVE` switch and data scope; no self-approval; ledger append-only; concurrent extend + cancel; medical document unreadable by approver/HR/director unless custodian; retention Not set refuses upload |
| Exits | One active resignation per employee (race); acceptance creates exactly one `separations` row (idempotent on retry); checklist generated from active asset assignments; exit interview confidential matrix; `ExitSettlementInputs` contains no money field (type + runtime assertion) |
| Recruitment | Conversion idempotent: same candidate converted twice in parallel → one employee, same id returned; re-conversion after an employee edit doesn't overwrite; offer compensation 403 for HR (hard lock) and absent from HR responses (deep scan of JSON); interviewer sees only assigned candidates and only own feedback before submitting; **expiring private links**: expired/revoked/used-up/wrong-token → same 404, token stored hashed, timing-safe compare, rate limit, no cookies accepted, upload type/size/magic-byte checks |
| Badges/nudges | Award limit under concurrency (parallel awards over the limit → exactly the limit succeed); private nudge absent from feed, search, counts; corrective nudge cannot be edited/deleted |
| Unmute | **Double-booking race**: N parallel bookings of one host slot → exactly one; partial unique index holds with the lock disabled (mutation); cancelled slot can be rebooked; host notes host-only; no booking data in any director/HR response, count or Insights |
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
| Q0 | All | Please commit the integration guide (19 chapters) so section A can carry chapter numbers and my readings below can be checked. | You |
| Q-F1 | Foundation | Confirm AS1 (confidential even from directors). | Owners |
| Q-F2 | Foundation | Who adds the Peeps HR capabilities to the switch framework (me in a PEEPS block, or the other session)? | You / other session |
| Q-F3 | Foundation | May `peeps/foundation` keep `main`'s three docs commits (§0.2), or start a fresh branch name from the base? | You |
| Q-D1 | Directory | Per-person hiding of directory fields: wanted? Photo change review: wanted? | Owners, HR |
| Q-A1 | Assets | Asset categories, whether employees may request, request approval route, overdue threshold. | Owners, HR |
| Q-A2 | Assets | Is recovery for lost/damaged assets ever made, and from F&F only or salary too? (Legal side: never guessed.) | Owners |
| Q-T1 | Ticket desk | Helpdesk queue split: who builds the `queue` enum and the PAYROLL half; which categories default to DIRECTORS. | You / other session; owners |
| Q-L1 | Leave extension | What "leave extension" means in the guide (extend an approved leave? new leave types? medical documents?). | You (guide) |
| Q-L2 | Leave extension | Who may see a medical document (custodians), retention period, document threshold. | Owners |
| Q-L3 | Leave extension | Lateness waiver: in scope? If so, the attendance owner builds the engine side. | You / other session |
| Q-E1 | Exits | Notice rules (per type/grade), legal minimums with source note; may a manager reject a resignation; who accepts when the manager is missing (AS4). | Owners (legal values: an owner enters, a different director confirms) |
| Q-E2 | Exits | Exit checklist templates and owners; exit interview questions; who interviews; retention. | HR, owners |
| Q-E3 | Exits | Does exits trigger the relieving letter request automatically (directors issue)? | Owners |
| Q-R1 | Recruitment | Pipelines/stages, scorecards, sources, requisition and offer approval routes. | HR, owners |
| Q-R2 | Recruitment | Candidate data retention and consent wording (DPDP). | Owners |
| Q-R3 | Recruitment | Joining-document list, link expiry, exception approver (AS3). | HR, owners |
| Q-R4 | Recruitment | Candidate e-mails: reuse letter/email templates (`letters.template.manage`, HR may edit) or a separate recruitment template set? | Owners |
| Q-B1 | Badges/nudges | Badge catalogue, who awards, limits, public vs private; who sends nudges of each kind (AS2/AS2b). | Owners, HR |
| Q-U1 | Unmute | Confirm my reading (private conversations with trained hosts); host roster; slot length; booking window; safety escalation policy; retention of host notes. | You (guide), owners |
| Q-I1 | Insights | Which insights, for whom; minimum cohort size. | Owners |
| Q-X1 | Autofill | §E questions. | Owners |
| Q-X2 | Auth | 2FA optional for directors (decision) vs mandatory in code and payroll readiness — who changes it? | You / other session |

---

## G. Proposed commits (each verified per §D before the next)

| # | Module | Commit | Size |
|---|---|---|---|
| 1 | Docs | This plan, checklist, stage report | small (this commit) |
| 2 | Docs | Chapter mapping once the guide is committed | small |
| 3 | Foundation | `peeps_setting_versions` / confirmations, `assertModuleReady`, module switches, migration, tests | medium |
| 4 | Foundation | Confidential-access helper + `peepsConfidential.test.ts` harness (empty class list, grows per module) | medium |
| 5 | Foundation | Peeps settings screen (Admin Tools), Not set / Placeholder / Confirmed states | medium |
| 6 | Directory | `PersonAvatar` + directory filters (+ preferences if Q-D1 says yes) | small |
| 7 | Assets | Schema, catalogue, items, encryption of serials, routes, tests | medium |
| 8 | Assets | Assignment/return with single-active guarantee, race test, history | medium |
| 9 | Assets | Requests, incidents, recovery intents (director-only), contract type | medium |
| 10 | Assets | Screens (admin inventory, detail, my assets, profile tab), sensitive-ui/popovers | medium |
| 11 | Ticket desk | Queue enum + HR/DIRECTORS + escalation + "concerns HR", tests, screen changes | medium |
| 12 | Leave ext. | Extension requests through the leave service, tests | medium |
| 13 | Leave ext. | Medical document store (confidential), retention, access log, screens | medium |
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
| 26 | Unmute | Hosts, availability, bookings with race guard, notes, screens | large |
| 27 | Insights | Aggregates with cohort minimum, screens | medium |
| 28 | All | Seed + demo company (DEMO values), GETTING_STARTED, UI_SCREEN_MAP rows, stage report | medium |
| — | Autofill | Nothing until §E is answered | — |

Checkpoints (merge the latest `feat/hr-payroll-separation`, full suite alone, report): after 5
(foundation), after 11, after 16, after 23, after 28.
