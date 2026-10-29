# HR / payroll separation — plan

**Status: PLAN, awaiting the owner's approval. Nothing in this document is built.** Branch
`feat/hr-payroll-separation`, based on `main` at `58a6e13` (it contains P7-0 and the UI pass, both verified
by ancestry: `cc95037`, `60132e0`, `46a3064`). The only other commit on the branch is the docs-only
`docs/plans/SCOPE_UPDATE_PAYROLL.md`, cherry-picked from `claude/optimistic-sagan-9xw3y9`.

This plan **supersedes the "HR has no Admin Tools access" reading** in SCOPE_UPDATE_PAYROLL.md §1–§2 (the
owner replaced it, §1 below). The Monthly Inputs, loss-of-pay reversal, Hold Salary, Raise-a-query and
Check in/out items in that document are **not** part of this piece of work and stay as they are there.

The repo is public: this document names no real person, salary, bank, PAN, UAN, ESI or Aadhaar number, debit
account, device serial or IP address. Employee codes (`1001`, `DEMO004`…) are the made-up seed/demo accounts.

---

## 1. Decisions already made (not reopened)

a. **HR (HR Admin and HR Executive) does everything except salary, payroll and payment.** HR sees and changes
   no salary or CTC, and uses no payroll runs, salary revisions, payslip publishing, bank file, statutory
   files, loans, reimbursements or settlement.
b. **HR may enter and edit employee bank details and statutory identifiers (PAN, UAN, ESI).** A change is
   **PENDING** until a payroll role or a director confirms it; the payroll run's Readiness list shows
   unconfirmed changes. HR sees the numbers masked (last four) with an audited Reveal. Use the existing
   change-request mechanism if it fits.
c. **Salary is set only by the directors**, as revisions under the existing two-person approval. Nobody
   changes their own pay.
d. **Admin Tools.** HR keeps: Organisation Setup, Holiday Calendars, Shift Master, Week-off Patterns, Leave
   Types and Policies, Manager Management, Helpdesk Categories, Email and Letter Templates (edit, not issue),
   Devices. **Owner only:** Roles and Permissions, System Settings, Audit Log, Workflow Delegates, Data
   Import/Export, and every payroll item.
e. **Letters.** Only directors can issue them by default. "Issue letters" is a configurable permission,
   grantable and revocable **per letter type** to HR or anyone else by an owner. Letters carrying pay figures
   are a separate grant.
f. **Helpdesk is split.** Payroll-category tickets go to the payroll team and directors. Grievance and
   everything else go to HR, with a way to route a grievance to the directors when it concerns HR.

"Directors" = the people holding `SUPER_ADMIN` (the owners). That reading is my inference from the code and
is confirmed in question Q2.

## 2. How access works today (the facts the plan stands on)

- **Defaults only touch new databases.** `backend/src/lib/systemRoles.ts` defines `HR_EXECUTIVE_PERMS` and
  `HR_ADMIN_PERMS` (= executive + extras). `ensureAccessCatalog` (`backend/src/lib/accessCatalog.ts`,
  run by `modes/migrate.ts`, `db:migrate`, the bootstrap CLI and `prisma/seed.ts`) only *creates* missing
  permissions and missing roles; it never changes an existing role. So **editing `systemRoles.ts` alone
  changes nothing on staging/production/any existing dev database.** A migration is required (§4).
- Effective permissions = union of the user's roles' `role_permissions` + per-user `GRANT` overrides −
  `REVOKE` overrides (`user_permission_overrides`), resolved in `backend/src/lib/permissions.ts`, which also
  applies two ceilings in code (Manager-grantable, Developer) — the model for the HR ceiling in §3.4.
- Sockets join `perm:{key}` rooms from effective permissions and are re-joined live when access changes
  (`realtime/socket.ts`), so payroll events (`payroll.run.*`, `payroll.payslips.published`, `payroll.bank.paid`)
  reach only holders of `payroll.run`/`payroll.approve` — HR stops receiving them when it loses those keys
  (HR never held `payroll.run`/`payroll.approve`; nothing to remove there).
- The HR/Admin menu (`frontend/src/routes/adminMenu.config.tsx`) has **no per-item permission field**; only
  each API route gates. The employee menu already supports an optional `permission` per leaf
  (`canSeeLeaf`). So today HR sees every Admin Tools item and every Payroll item and gets an API error (or a
  broken page) on the ones it can't use.
- The sensitive-data registry (`shared/constants/sensitiveData.ts`) classes every permission as view / edit /
  confirm (`SENSITIVE_CLASSES`) or lists it in `REVIEWED_NOT_SENSITIVE`; a test fails if a permission is in
  neither. The Developer ceiling strips every key in `SENSITIVE_PERMISSION_KEYS`. New keys below join the
  right class, so they are automatically barred from the Developer role.
- **Bank accounts are effective-dated** (`employee_bank_accounts`; `bankAccountsOn` is the reader payroll,
  the payslips, the bank file and the setup sign-off all use). **Statutory identifiers are one mutable row**
  (`employee_statutory`, no history) read directly by payroll.
- A **change-request mechanism exists** (`profile_change_requests`, `modules/employee/changeRequests.ts`):
  the employee submits `bank`/`statutory`/`personal` changes; the body is stored already encrypted
  (`changesJson`: encrypted bytes + last4 + keyed hash, never a raw number); an approver applies it through
  the same writers (`writeBankChange`, statutory upsert). Today approving a bank/statutory request needs
  `profile.changerequest.approve` **and** `employee.bank.edit` / `employee.statutory.edit`.
- HR direct edits (`PATCH /api/employees/:id/bank`, `/statutory`, the Import Center `bank`/`statutory`
  datasets, and bank/statutory given at Add Employee) **write immediately today**.

## 3. (a) Permission changes

### 3.1 Keys REMOVED from HR (system roles `HR_ADMIN`, `HR_EXECUTIVE`)

"Granted by" is the file/migration that put the key where it is today. Every key below has the same
re-grant paths, listed in §3.3.

| Key | From | Why (decision) | Granted by today |
|---|---|---|---|
| `payroll.salary.view` | HR_ADMIN | (a) salary, runs, payslip figures, payroll audit trail | `systemRoles.ts` HR_ADMIN; migration `20261016090000_payroll_foundations` |
| `payroll.salary.edit` | HR_ADMIN | (a) prepares revisions, components, structures, adjustments | same migration |
| `payroll.rules.view` | HR_ADMIN | (a) payroll/statutory rules, setup checklist, layouts | same migration |
| `documents.pay.view` | HR_ADMIN | (a)/(e) PAY documents = letters with CTC | `systemRoles.ts`; migration `20261003130000_document_sensitivity` |
| `reports.liability.view` | HR_ADMIN | (a) leave liability in rupees (salary-derived) | `systemRoles.ts`; migration `20261003090000_f_reports_permissions` |
| `letters.generate` | HR_EXECUTIVE, HR_ADMIN | (e) issuing is director-only by default; replaced by per-type grants (§6) | `systemRoles.ts` (Phase 5 D2) |
| `role.view` | HR_EXECUTIVE, HR_ADMIN | (d) Roles and Permissions is owner-only | `systemRoles.ts` |
| `audit.view` | HR_ADMIN | (d) Audit Log owner-only | `systemRoles.ts` |
| `settings.manage` | HR_ADMIN | (d) System Settings owner-only | `systemRoles.ts` |
| `delegation.manage` | HR_ADMIN | (d) Workflow Delegates owner-only | `systemRoles.ts`; migration `20261002191517_e3_workflow_delegates` |
| `import.manage` | HR_EXECUTIVE, HR_ADMIN | (d) Data Import/Export owner-only — **but HR bulk-imports employees today; see Q10** | `systemRoles.ts` |
| `user.security.manage` | HR_ADMIN | (d) sits with Roles and Permissions (unlock, 2FA reset, overrides) — see Q11 | `systemRoles.ts` |
| `leave.yearend.manage` | HR_ADMIN | (a) year-end encashment amounts are money — see Q12 | `systemRoles.ts` |

`import.manage`, `user.security.manage` and `leave.yearend.manage` are marked **provisional**: the owner's
decisions point at removing them but HR's retained duties may depend on them, so I will not remove them until
Q10–Q12 are answered. The first ten are not in doubt.

### 3.2 Keys HR KEEPS or GAINS

| Key | HR_ADMIN | HR_EXECUTIVE | Note |
|---|---|---|---|
| `employee.bank.view` | keeps | **gains** | masked + audited Reveal (decision b) |
| `employee.bank.edit` | keeps | **gains** | now means "*enter* a change", not "apply it" — see §5 |
| `employee.statutory.view` | keeps | **gains** | PAN, Aadhaar*, UAN, ESI masked + audited Reveal |
| `employee.statutory.edit` | keeps | **gains** | enter-only, as above |
| `profile.changerequest.approve` | keeps | keeps | **personal-details** requests only; no longer approves bank/statutory |
| `helpdesk.manage`, `helpdesk.sensitive.view` | keeps (both) / Exec: manage only | | `sensitive.view` narrows to Grievance-type categories (§7) |
| `letters.template.manage` | keeps | not held | edit templates; pay-figure templates need an owner (§6) |
| all of `org.manage`, `leave.*` (except year-end), `attendance.*`, `manager.*`, `announcements.manage`, `engage.*`, `documents.manage`, `employee.documents.*`, `employee.*`, `reports.view` | keeps | as today | unchanged |

\* Aadhaar is not named in decision b; I have included it because it lives in the same row, tab and key —
confirm in Q5.

HR_EXECUTIVE gaining bank/statutory reverses a deliberate earlier rule (the comment above
`HR_EXECUTIVE_PERMS`: "HR_EXECUTIVE deliberately excludes employee.statutory.* and employee.bank.*"). That
comment, `docs/SENSITIVE_DATA.md` and `GETTING_STARTED.md` are rewritten in the same commit.

### 3.3 Every grant path (what the migration and tests must cover)

1. `backend/src/lib/systemRoles.ts` — `HR_EXECUTIVE_PERMS`, `HR_ADMIN_PERMS` (new databases).
2. `backend/src/lib/accessCatalog.ts` (`ensureAccessCatalog`) — creates the new permission rows; never
   removes; the new migration does the removal.
3. Migrations that inserted the keys into the existing `HR_ADMIN` role (the removal migration reverses their
   *effect*; they are never edited): `20261002061248_e2_manager_management_permissions`,
   `20261002191517_e3_workflow_delegates`, `20261003090000_f_reports_permissions`,
   `20261003130000_document_sensitivity`, `20261008100000_attendance_config`,
   `20261011090000_regularization_missing_punch`, `20261013090100_regularization_generalised`,
   `20261014090000_manual_override_shift_override_swipes`, `20261015090000_period_finalisation`,
   `20261016090000_payroll_foundations`. (The removal list touches only the keys in §3.1; the others in those
   migrations stay.)
4. `backend/prisma/seed.ts` — roles come from `SYSTEM_ROLES` via `ensureAccessCatalog`; seeded users: `1000`
   SUPER_ADMIN, `1001` HR_ADMIN, `1025` PAYROLL_ADMIN, `1027` PAYROLL_APPROVER, managers. The seed also
   writes made-up bank/statutory data directly (kept: seeds are not the HR flow, but must not leave a stale
   pending row).
5. `backend/scripts/demo/seedDemoCompany.ts` — `DEMO001` SUPER_ADMIN, `DEMO002` PAYROLL_ADMIN, `DEMO003`
   PAYROLL_APPROVER, `DEMO004` HR_ADMIN, `DEMO005` DEVELOPER. It makes `DEMO002` the maker of salary
   revisions — changes under §8.
6. **Per-user overrides**: `user_permission_overrides` GRANTs of a removed key to a user who holds an HR role
   (and no payroll/director role) must be revoked by the migration and listed (§4).
7. **Custom (non-system) roles** a Super Admin created that hold removed keys: not touched by the migration
   (they are the owners' choice) but listed (§4) and covered by the ceiling in §3.4.
8. `shared/constants/permissions.ts` (`PERMISSION_KEYS`, `PERMISSION_CATALOG` labels/descriptions),
   `shared/constants/sensitiveData.ts` (classes + `REVIEWED_NOT_SENSITIVE`), and the generated
   `docs/SENSITIVE_DATA.md` (`npm run docs:sensitive --prefix backend`; CI's `sensitiveDocs.test.ts` fails on
   drift).
9. Frontend uses of the keys: `AllEmployeesPage` (bank/statutory columns), `EmployeeProfilePage` (tabs),
   `ImportCenterPage` (`canManageBank`), `EmployeeDocumentsTab` (`letters.generate`), `SystemSettingsPage`
   (`letters.template.manage`), the payroll pages (`payroll.salary.edit`).
10. `DEVELOPER_ROLE_PERMISSIONS` (unchanged; it never held any of these).

### 3.4 The ceiling (so a removed key cannot quietly come back) — *proposal, Q1*

Same mechanism as the Developer ceiling: `lib/permissions.ts` strips a fixed set of keys from anyone who holds
`HR_ADMIN` or `HR_EXECUTIVE`, unless they **also** hold `SUPER_ADMIN`; plus a database trigger on
`role_permissions` / `user_permission_overrides` refusing to insert a pay key against the HR system roles or a
GRANT for a user holding an HR role, with a test mirroring `developerCeiling.test.ts`. The set
(`HR_FORBIDDEN_KEYS`, in `sensitiveData.ts`): `payroll.*` (all), `reports.salary.view`,
`reports.liability.view`, `documents.pay.view`, `letters.pay.issue`, `letters.pay.manage`, the new
`payroll.salary.revise`, and `employee.bank.confirm` / `employee.statutory.confirm` (HR enters; HR must not
confirm — otherwise one HR person could do both halves). Whether to build a hard ceiling or only change
defaults is Q1.

## 4. (b) The migration for existing databases

`backend/prisma/migrations/<timestamp>_hr_payroll_separation/migration.sql` (forward-only, as every migration
here is), run by the `migrate` entrypoint on deploy.

**Does:**
1. `DELETE FROM role_permissions` for the roles with `code IN ('HR_ADMIN','HR_EXECUTIVE')` and the removed
   keys in §3.1 (provisional ones only after Q10–Q12).
2. `INSERT` the gained keys for `HR_EXECUTIVE` (`employee.bank.view/edit`, `employee.statutory.view/edit`).
3. Insert the new permission rows (the app's `ensureAccessCatalog` would too; the migration does it so SQL
   and app agree) and grant the new confirm/revise/issue keys to the roles in §3.5.
4. Delete `GRANT` rows in `user_permission_overrides` for removed keys where the user holds an HR role and
   neither `SUPER_ADMIN` nor a `PAYROLL_*` role; write one `audit_logs` row per deletion (`access.hr_separation.
   revoked`, actor = system, key + user id, **no** values).
5. Create the new tables/columns/triggers of §5–§7 (the schema changes ride in their own commits, §10; this
   migration is the *permission flip*, last).
6. Apply the ceiling trigger (§3.4) — **only after** steps 1 and 4, so it never fails on existing rows.

**What it does to customised roles:** a system role the owner already edited (`HR_ADMIN` with extra keys, or
keys removed) is treated per key: only the removed keys in §3.1 are deleted; every other customisation is left
as it is. Custom (non-system) roles are not modified. The migration prints (and writes to `audit_logs`) the
names of custom roles and the count of users still holding a removed key through them, and the Roles and
Permissions page shows a banner for them to review. A system role the owner *had already removed a key from*
needs no change (delete of a missing row is a no-op).

**Rollback.** There is no down-migration (the project has none). Rollback is a **new forward migration** that
re-inserts exactly the rows this one deleted. To make that possible the migration first copies every deleted
`role_permissions` and `user_permission_overrides` row into an append-only table
`hr_separation_removed_grants` (role/user, key, removed_at); the rollback migration reads it. Dropping the
ceiling trigger is the other half of a rollback. I will rehearse forward → rollback → forward on a scratch
database and say so in the commit.

**Risks:** (i) live sessions keep old effective permissions until the JWT/permission cache refreshes — the
migration bumps a `permissions_version` the same way role edits do (verify the existing mechanism in the build;
if none, sessions refresh on the next login/token rotation and the docs say so); (ii) open payroll helpdesk
tickets assigned to HR (§7); (iii) pending direct HR writes in flight — none, the app is stopped during deploy.

### 3.5 Who gets the new keys (system-role defaults)

| New key | Class | SUPER_ADMIN | PAYROLL_ADMIN | PAYROLL_APPROVER | HR_* |
|---|---|---|---|---|---|
| `employee.bank.confirm` | EMPLOYEE_BANK confirm | all | yes | yes | **never** |
| `employee.statutory.confirm` | EMPLOYEE_STATUTORY confirm | all | yes | yes | **never** |
| `payroll.salary.revise` (create/cancel/submit/withdraw/apply a salary revision) | SALARY_AND_PAYROLL edit | all | **no** | no | never |
| `letters.pay.issue` | pay letters | all | no (default) | no | never |
| `letters.pay.manage` (create/edit pay-figure templates) | pay letters | all | no | no | never |
| `letters.grants.manage` (who may issue which type) | ACCESS_CONTROL (meta) | all | no | no | no |
| `helpdesk.payroll.manage` (Payroll-queue tickets) | SENSITIVE_TICKETS | all | yes | no (Q14) | **never** |
| `helpdesk.directors.manage` (Directors-queue tickets) | SENSITIVE_TICKETS | all | no | no | no |
| `helpdesk.routing.manage` (which queue a category belongs to) | ACCESS_CONTROL (meta) | all | no | no | no |

`payroll.salary.edit` **stays** with PAYROLL_ADMIN (components, structures, one-off adjustments): it gates
`/components`, `/structures` and `/adjustments` as well as revisions (`payroll/routes.ts:53–90`), so removing
it from PAYROLL_ADMIN would stop payroll doing its own setup. Decision c is met by moving only the *revision*
routes onto the new `payroll.salary.revise` (§8). Whether adjustments should also be director-only is Q4.

## 5. (c) Every place HR sees pay data today, and the fix

"Refusal" below means a 403 JSON error with a plain-language message *and* a visible "You don't have access to
this" page in the browser — never an empty page (§9).

| # | Where | What HR sees today | Fix |
|---|---|---|---|
| 1 | `/api/payroll/**` (rules, setup, components, structures, salaries, revisions, adjustments, runs, items, variance, export, approvals, payslip-preview, bank batches, layouts, audit) | everything gated by `payroll.rules.view` / `payroll.salary.view` / `payroll.salary.edit` | keys removed; routes unchanged; refusal test over all of them |
| 2 | Admin menu: whole **Payroll** app (14 items) | visible to HR | per-item permission filter (§8); the app is hidden when no item is visible |
| 3 | Payroll audit trail & **Audit Log** payroll rows | `auditLog/controller.ts` shows payroll rows if `payroll.salary.view`; HR_ADMIN has `audit.view` | HR loses both; Audit Log owner-only (d) |
| 4 | Profile **Bank** tab, bank history, Reveal | masked, audited | stays for HR (b); edit becomes *propose* (§5.1); history shows pending rows to HR as "waiting for confirmation" with last4 only |
| 5 | Profile **Statutory** tab + Reveal | masked, audited (HR_ADMIN only today) | stays; HR_EXECUTIVE gains; edit becomes *propose* |
| 6 | **Change Requests** page (`/admin/employee/change-requests`) and `profile.changerequest.approve` | HR_ADMIN approves bank/statutory | HR still sees all requests (read-only for bank/statutory) and decides **personal** ones; bank/statutory decided only with `…confirm` |
| 7 | **Tasks inbox** (`modules/tasks/service.ts` `PROFILE_CHANGE_APPROVAL`) | "Bank details change"/"Statutory details change" tasks for approvers | bank/statutory tasks only for `…confirm` holders; a new task type `PAY_IDENTITY_CONFIRMATION` for them; HR still gets personal-change tasks |
| 8 | Employee **grid** and **export** (`grid.ts`) | "Bank Account (last 4)", "PAN (last 4)", "Aadhaar (last 4)" columns if bank/statutory view | **checked: `EXPORT_COLUMNS` has no salary or CTC column.** Last-four columns stay (masked, decision b). Add a sentinel test that no salary/CTC/net-pay value appears in grid, export or saved views for an HR token |
| 9 | **Bulk Import / Import Center** `bank` and `statutory` datasets (`import/service.ts`) | writes directly if `.edit` | commit creates PENDING requests, not rows (§5.1); preview shows last4 only (as today) |
| 10 | **Add Employee** with bank/statutory (`createEmployeeInTx`) | writes directly | employee is created without the rows; bank/statutory become PENDING requests |
| 11 | **Letters**: issuing, the `ctcAnnual` field, issued letters in PAY category | HR issues Offer letters with CTC and reads them (`documents.pay.view`) | §6 |
| 12 | **Employee profile → Documents** tab | PAY-category documents (issued letters), STATUTORY ID proofs | PAY hidden from HR (key removed); STATUTORY ID-proof scans stay visible to HR because HR keeps `employee.statutory.view` (decision b) — **Q19** |
| 13 | **Year End Process** (`leave.yearend.manage`) + its Excel (encashed amount column) + `leave.encashment.defaultDailyRate` setting | amounts and a rate | provisional removal; Q12 |
| 14 | **Reports → Leave liability** | ₹ liability | removed with `reports.liability.view` |
| 15 | **Reports → LOP, Leave balance, Headcount…** | days and headcounts | **to verify in the build**: none shows money; a sentinel test asserts it |
| 16 | **Helpdesk** Payroll & Salary tickets | HR_ADMIN reads them (and attachments: "a photographed payslip") | §7 |
| 17 | **Separations** page | name/dates/reason | unchanged now; the settlement amounts arrive in P7-6 and will not be shown to HR |
| 18 | **Search results** | there is no global search module; employee-list search matches name/code only | sentinel test that a pay value is never matched or returned by any list/search endpoint |
| 19 | **Socket events** | payroll events go to `perm:payroll.run`/`perm:payroll.approve` rooms only; HR holds neither | test: an HR socket receives no `payroll.*` event after a run publishes; the new confirmation event goes to `perm:employee.*.confirm` rooms and carries no number |
| 20 | **Emails/notifications** | payslip mail goes to the employee only | no change; the new "waiting for confirmation" notice has no numbers; test |
| 21 | **Setup Checklist / Ready for First Run** rows about bank and PF numbers | payroll screens | already payroll-only after removal; signers keep `employee.bank.view`/`statutory.view` |
| 22 | Docs & seeds | `GETTING_STARTED.md` role table says `1001` has "bank/statutory data, pay documents… Import Center/Audit Log/System Settings"; `SENSITIVE_DATA.md`; `FIRST_REAL_PAYROLL_RUN.md`; `PHASE_6.md` | rewritten in the docs commit |

## 5.1 (d) Pending confirmation of bank and statutory changes

**Principle:** the live tables never hold an unconfirmed value. `bankAccountsOn`, the payslips, the bank file,
the statutory files and the setup sign-off therefore need **no change** — they see only confirmed rows. A
change HR enters is a stored *request* until someone else confirms it, then it is applied by the existing
writers (`writeBankChange`, the statutory upsert).

**Schema** — extend `profile_change_requests` (it already stores encrypted `changesJson`, status, requester,
decider, remarks) rather than a new table:

- `origin` enum `EMPLOYEE_SELF | HR_ENTRY | HR_IMPORT | HR_CREATE` (default `EMPLOYEE_SELF`; existing rows
  backfilled).
- `effective_from date null` (bank requests: the date HR entered; see Q9).
- `reason text null` (HR's note: e.g. "new joiner", "employee supplied proof"; required for `HR_*` origins).
- new status `SUPERSEDED` (a newer open request for the same employee + group replaces an older one; never
  silently both). Partial unique index: **one PENDING request per (employee, field_group) for bank and
  statutory.**
- `confirmed_at` is the existing `decided_at`; `confirmed_by_user_id` is the existing `decided_by_user_id`.
- DB constraints/triggers: (1) `changes_json` is immutable once inserted (so what a confirmer sees is exactly
  what is applied — the same guarantee the hash gives payroll approvals, without a second mechanism);
  (2) for `bank`/`statutory` rows `status = APPROVED` requires `decided_by_user_id <> requested_by_user_id`
  and `decided_by_user_id` not the subject employee's own user; (3) rows are never deleted.

**Who can confirm:** a user holding the new `employee.bank.confirm` / `employee.statutory.confirm` — by
default `PAYROLL_ADMIN`, `PAYROLL_APPROVER`, `SUPER_ADMIN`; never HR (ceiling §3.4). Not the requester, and
never the person whose own account it is ("nobody changes their own"). Rejection also needs the key and a
remark. A confirmer reads the **new** value through a Reveal that is audited and available only to confirm
holders (`GET /api/employees/change-requests/:id/reveal`), so they can check it against whatever evidence they
hold; the current value is shown masked.

**API changes (all in `modules/employee`):**
- `PATCH /:id/bank` and `PATCH /:id/statutory` (gated by `.edit`, unchanged): instead of writing, create a
  `HR_ENTRY` request and return `{ status: "PENDING_CONFIRMATION", requestId }`. The profile shows a
  "Waiting for confirmation" tag; HR can withdraw its own pending request.
- `POST /change-requests/:id/approve|reject`: bank/statutory need the matching `…confirm` key (not `.edit`)
  plus the two person checks above; personal requests keep `profile.changerequest.approve`.
- Import commit and Add Employee: create `HR_IMPORT`/`HR_CREATE` requests, one per employee per group.
- The approve path passes the **requester** (not the confirmer) as `createdByUserId`/`updatedByUserId` of the
  applied row, and records the confirmer on the request, so the setup sign-off's "signer did not enter these
  rows" rule keeps its meaning (Q7 asks whether the confirmer is also barred).

**Readiness.** `payroll/run/service.ts → readiness()` gains
`identityChanges: { pendingCount, pending: [{ employeeId, name, group, enteredAt, enteredBy }] }` (capped list
like the other lists, **no numbers**); the Setup Checklist's "bank accounts" and "PF numbers" rows show "N
changes waiting for confirmation"; the run page and the bank-file page show the same count. Whether a pending
change **blocks** submitting a run or is a warning is Q8 (my recommendation: a warning).

**Masking and Reveal for HR:** unchanged mechanics — lists and tabs read `*_last4` only; the only decrypting
paths are the audited `…/bank/reveal` and `…/statutory/reveal`. New: HR sees **its own pending request**
masked (last four), never the number in clear except through Reveal; the Reveal endpoints stay gated by
`.view` and write `employee.bank.revealed` / `employee.statutory.revealed` audit rows (ESI included; UAN
included). Q20 asks whether a Reveal should also require a short stated reason.

**Notifications:** payroll/directors get a Tasks-inbox entry and a realtime nudge (`perm:` room) saying "N
bank/statutory changes waiting" — no names beyond the employee's, no numbers. The requester is told on
confirm/reject.

## 6. (f) Letter issuing: a permission per letter type

**Today:** `letters.generate` (HR) gates issue/reissue/reproduce; the Offer Letter template has a typed
`ctcAnnual` currency field; every issued letter is filed in the `LETTERS` category, which is `PAY`
sensitivity, read with `documents.pay.view`.

**Design**
- `letter_templates.carries_pay boolean` — true if the template's current version has any `currency`-type
  extra field or a pay merge token; the flag can be set only by someone with `letters.pay.manage`, and saving
  a template version that adds such a field is refused unless the saver holds it (so HR, who edits templates
  per decision d, cannot turn a plain letter into a pay letter, or the reverse). Migration: Offer Letter →
  `true`; the rest `false`.
- `letter_issue_grants` (append-only): `id, template_id, subject_kind ('ROLE'|'USER'), subject_id,
  granted_by_user_id, granted_at, revoked_at, revoked_by_user_id, reason`. Partial unique index on active
  grants. Granting and revoking need `letters.grants.manage` (owner/meta) and write audit rows.
- **Issue check (service layer, not just the route):** issue / reissue / reproduce / list-for-employee succeed
  only if the actor is `SUPER_ADMIN`, or holds an active grant for that template (directly or via a role they
  hold) **and** the employee is in their data scope; if `carries_pay` they must also hold `letters.pay.issue`.
  No grant → 404/403, never an empty list. `GET /letters/templates` returns, for non-owners, only the
  templates they may issue. `letters.generate` is kept only as the key that shows the Letters screens; it is
  removed from HR defaults, and **default grants are none** — only directors can issue until an owner grants.
- **Filing:** a new GENERAL category `HR_LETTERS` receives letters of non-pay templates; `LETTERS` (PAY)
  keeps receiving pay letters. Sensitivity can be raised but never lowered, so letters **already issued** stay
  where they are (non-pay ones stay in the PAY category and HR can no longer open them; they can be
  re-rendered by a granted issuer). I will check the `employee_documents` triggers in the build; if a
  document's category can be changed safely I will move old non-pay letters, otherwise leave them and say so.
- **UI:** Admin Tools → "Email and Letter Templates" gets a per-template "Who can issue" panel (owner-only,
  lists role/user grants, add/revoke with a reason); the employee profile "Issue letter" button lists only
  permitted types.
- **What HR keeps:** edit non-pay templates (new version), preview, letterhead. HR cannot issue.

## 7. (g) Helpdesk: Payroll / Grievance split

**Today:** `helpdesk_categories.is_sensitive` plus one key `helpdesk.sensitive.view` covers both Payroll &
Salary and Grievance; `HR_ADMIN` holds it; payroll roles hold no helpdesk key; a ticket you raised yourself is
never in your queue.

**Design**
- `helpdesk_categories.queue` enum `HR | PAYROLL | DIRECTORS` (default `HR`; `is_sensitive` stays for the
  "private" semantics). Migration: `PAYROLL_SALARY → PAYROLL`; `GRIEVANCE → HR` (sensitive); everything else
  `HR`.
- `helpdesk_tickets.queue` copied from the category at creation, so later changes to a category do not move
  existing tickets.
- Visibility = queue → key: `HR` (non-sensitive) `helpdesk.manage`; `HR` sensitive `helpdesk.manage` +
  `helpdesk.sensitive.view`; `PAYROLL` `helpdesk.payroll.manage`; `DIRECTORS` `helpdesk.directors.manage`.
  Directors (`SUPER_ADMIN`) hold all. Non-holders get 404 (as now), including from the Tasks inbox
  (`HELPDESK_ASSIGNED` source) and attachments.
- **Route a grievance to the directors:** (1) at raising time the employee can tick "this concerns HR" on a
  Grievance — the ticket is created in the `DIRECTORS` queue and HR never sees it; (2) an HR handler can
  **Escalate to directors** on any HR-queue ticket: one-way, needs a reason (internal note), after which the
  HR handler loses access (the raiser keeps the thread). Directors can hand back to `HR`. Every move is
  audited and posts a system note.
- `helpdesk.routing.manage` (owner) is required to change a category's queue to/from `PAYROLL` or `DIRECTORS`,
  so HR, who keeps Helpdesk Categories (d), cannot re-route Payroll tickets to itself.
- **Migration of open tickets:** open `PAYROLL_SALARY` tickets assigned to an HR person are un-assigned and left
  in the Payroll queue with a system note; the migration prints the count. The category's
  `default_assignee` is cleared if it is an HR person.
- **Payroll roles** get `helpdesk.payroll.manage` only (not `helpdesk.manage`: that would also open the HR
  queue).

## 8. (e) Admin Tools: per-item filter and who can open what

**Mechanism (frontend):** add `permission?: string | string[]` (any-of) to `AdminMenuLeaf` and `AdminApp`,
mirroring `canSeeLeaf`; `adminNav()` takes `hasPermission` and drops leaves/apps with no visible item; an app
with no visible leaf disappears from the App Switcher. Routes are generated from the same config
(`resolveMenuRoutes.tsx`), so each route is wrapped in a guard that renders a **"You don't have access to
this"** page (with a link home), not a blank page, when the permission is missing. Backend gating is unchanged
and remains the real control; the filter is only the front door. A menu test fails if any leaf for a page that
calls an API gated by key K lacks K (or a superset) in its `permission` — so the menu cannot drift from the
routes.

**Item by item (Admin Tools app), before → after.** "Gate" is the real API key. SA = Super Admin.

| Admin Tools item | Gate | HR_ADMIN before | HR_ADMIN after | HR_EXEC before | HR_EXEC after | Payroll roles | Dev |
|---|---|---|---|---|---|---|---|
| Organisation Setup | `org.manage` | open | open | open | open | no | open |
| Holiday Calendars | `leave.policy.manage` | open | open | no | no (unchanged) | no | open |
| Shift Master | `attendance.config.manage` | open | open | no | no | no | open |
| Week-off Patterns | `attendance.config.manage` | open | open | no | no | no | open |
| Leave Types & Policies | `leave.policy.manage` | open | open | no | no | no | open |
| Workflow Delegates | `delegation.manage` | open | **closed (SA)** | no | no | no | no |
| Roles & Permissions | `role.view` / `user.security.manage` / `manager.permissions.manage` | open (view + manage) | **closed (SA)** | view | **closed** | no | view (role.view) |
| Manager Management | `manager.*` | open | open (Q: depends on `role.view` — verify) | no | no | no | no |
| Helpdesk Categories | `helpdesk.manage` (+ `helpdesk.routing.manage` for queue) | open | open | open | open | no | open |
| Email & Letter Templates | `letters.template.manage` | open | open (edit; pay templates owner-only) | no | no | no | no |
| Devices | `attendance.devices.manage` | open | open | no | no | no | open |
| Data Import/Export | `import.manage` | open | **closed (SA) — Q10** | open | **closed — Q10** | no | open |
| Audit Log | `audit.view` | open | **closed (SA)** | no | no | no | open |
| System Settings | `settings.manage` | open | **closed (SA)** | no | no | no | no |

Other apps that need the filter: **Payroll** (14 items) — payroll roles + SA only, closed for HR and managers;
**Employee** app items (Change Requests — everyone with `profile.changerequest.approve` or a `…confirm`;
Bulk Import — `import.manage`; Separations; Helpdesk queue — by queue key); **Workforce** (Leave: Year End
Process by `leave.yearend.manage`); **Reports** (Leave liability by `reports.liability.view`).

Owner-only items are also hidden from the **Developer** role where they were (the developer ceiling is
unchanged).

## 9. (h) Before / after, every role

Legend: ● has, ○ does not, ◐ partly (see note). Columns are system-role defaults.

| Capability | SA | HR_ADMIN before→after | HR_EXEC before→after | PAYROLL_ADMIN | PAYROLL_APPROVER | DEVELOPER | MANAGER / EMPLOYEE |
|---|---|---|---|---|---|---|---|
| See salary / CTC / runs / payslip figures | ● | ● → ○ | ○ → ○ | ● | ● | ○ | ○ |
| Prepare a salary **revision** | ● | ● → ○ | ○ | ● → ○ (new `salary.revise`: SA only) | ○ | ○ | ○ |
| Components / structures / one-off adjustments | ● | ● → ○ | ○ | ● (unchanged) | ○ | ○ | ○ |
| Approve a salary revision, a run, payslips, bank file | ● | ○ | ○ | ○ | ● | ○ | ○ |
| Payroll rules view | ● | ● → ○ | ○ | ● | ● | ● (view) | ○ |
| Enter / change bank + statutory | ● | ● → ◐ (proposes) | ○ → ◐ (proposes) | ○ | ○ | ○ | self-request |
| **Confirm** bank + statutory | ● | ● (as approver) → ○ | ○ | ● (new) | ● (new) | ○ | ○ |
| View bank/statutory masked + audited Reveal | ● | ● → ● | ○ → ● | ● | ● | ○ | own only |
| PAY documents (letters with CTC) | ● | ● → ○ | ○ | ● | ● | ○ | own payslips |
| Issue any letter | ● | ● → ○ (until granted) | ● → ○ | ○ | ○ | ○ | ○ |
| Edit non-pay letter templates | ● | ● → ● | ○ | ○ | ○ | ○ | ○ |
| Leave liability report; year-end encashment | ● | ● → ○ (Q12) | ○ | ● liability | ● liability | ○ | ○ |
| Payroll helpdesk tickets | ● | ● → ○ | ○ | ○ → ● | ○ → ○ (Q14) | ○ | ○ |
| Grievance tickets | ● | ● → ● | ○ | ○ | ○ | ○ | ○ |
| Directors queue tickets | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| Roles, System Settings, Audit Log, Delegates, Data Import/Export | ● | ● → ○ | ◐ → ○ | ○ | ○ | ◐ (audit/import view) | ○ |
| Employees, attendance, muster, finalise, regularise, leave, Engage, documents, people reports | ● | ● | ● (no finalise) | ◐ (finalise) | ○ | ◐ | scoped |

**Demo-dataset people affected.** Dev seed (`prisma/seed.ts`): `1001` (HR_ADMIN) — loses everything in §3.1;
`1000` (SA) — now the only person who can prepare salary revisions; `1025` (PAYROLL_ADMIN) — loses revision
preparation (keeps components/structures/adjustments), gains confirmation and the Payroll helpdesk queue;
`1027` (PAYROLL_APPROVER) — gains confirmation; the seeded helpdesk queue (assigned to `1001`, includes a
Payroll & Salary ticket) is re-queued. **No HR Executive exists in the dev seed** — I propose adding one so
the HR_EXECUTIVE rows can be walked through (Q21). Demo company (`seedDemoCompany.ts`): `DEMO004` (HR_ADMIN)
fills "pay details" for itself — that becomes a pending request confirmed by `DEMO002`/`DEMO003`; `DEMO002`
no longer makes revisions, so the demo's revisions are made by `DEMO001` (SA) and approved by `DEMO003`; **the
payroll approver `DEMO003` and the owner `DEMO001` themselves each need a revision made by someone other than
themselves**, which with a single director has no valid maker — the demo needs a second director (`DEMO006`,
shifting employee numbering) and the question of one-director firms is Q2/Q3.

## 10. (i) Tests

New file `backend/src/modules/access/__tests__/hrSeparation.test.ts` (and friends). A named test per removed
key, each failing if the key is regranted:

- `it.each(REMOVED_FROM_HR)("%s is not in the HR_ADMIN or HR_EXECUTIVE default role")` (reads `SYSTEM_ROLES`).
- `it.each(REMOVED_FROM_HR)("%s is gone from the HR roles in a database after the migration")` (runs the
  migration on a scratch DB seeded with the *old* grants, asserts rows deleted, overrides revoked, copies kept
  in `hr_separation_removed_grants`, custom roles untouched and reported).
- `it.each(REMOVED_FROM_HR)("granting %s to HR_ADMIN is refused by the database / ceiling")` and "an HR user
  with a GRANT override for %s still doesn't have it".
- **Refusal on every pay route:** drive `listApiRoutes()` (already exists for the route-inventory test) —
  every route whose `gateKeys` intersect `HR_FORBIDDEN_KEYS` is called with an HR_ADMIN token and an
  HR_EXECUTIVE token and must return `403` with a JSON `{ error: { code: "FORBIDDEN", message } }` body — a
  new route that forgets its gate fails `routeInventory` (classification) **and** this test.
- Browser (Playwright, existing harness): as `1001`, the Payroll app is absent from the switcher, a typed URL
  `/admin/payroll/salaries` shows the "You don't have access" page (not blank), owner-only Admin Tools items
  are absent and their URLs are refused; as `1000` and `1025` they are present.
- Pending confirmation: HR edit creates a PENDING request and **does not** change `bankAccountsOn` /
  statutory row; confirm by a different payroll user applies it; confirm by the requester, by an HR user, by
  the subject employee, and a second confirm are each refused; `changes_json` cannot be updated (DB); Readiness
  lists the pending item with no number; import and Add Employee create requests, not rows; supersede works;
  the `…/reveal` of a pending value is audited and refused to HR.
- Letters: no grant → refusal; grant for type A does not allow type B; revoke takes effect on the next request;
  a pay letter needs both the grant and `letters.pay.issue`; HR cannot add a currency field or toggle
  `carries_pay`; HR can edit a plain template; reproduce/reissue follow the same rule.
- Helpdesk: an HR token gets 404 on a Payroll ticket (read, reply, attachment download, Tasks inbox); payroll
  token sees Payroll and not HR queue; escalation to directors removes HR access; "concerns HR" never appears
  in the HR queue; changing a category's queue needs `helpdesk.routing.manage`.
- Sentinels: seeded made-up pay values never appear in any response/export/search/socket payload/e-mail body
  reachable by an HR token (extends `releases.test.ts` and `check:sensitive-ui`).
- Existing guards that must stay green: `sensitiveDocs.test.ts` (regenerate `SENSITIVE_DATA.md`),
  `routeInventory.test.ts`, `managerReach.test.ts`, `developerCeiling.test.ts`, `cleanup.test.ts` (new
  tables classified), `currentRowGuard.test.ts`, the effective-dating readers' tests, the payroll
  literal/float/`new Date` scans.

**Planned mutation checks** (each: break on purpose, confirm a *named* test fails, restore):
1. re-add `payroll.salary.view` to `HR_ADMIN_PERMS` → "…is not in the HR_ADMIN default role";
2. remove the ceiling's strip of a key → "an HR user with a GRANT override…";
3. drop the DB trigger → "granting … is refused by the database";
4. remove `employee.bank.confirm` from the approve gate (fall back to `.edit`) → "confirm by an HR user is refused";
5. remove the requester≠confirmer check (service and DB constraint, separately) → the two named tests;
6. make `PATCH /:id/bank` write directly again → "HR edit does not change bankAccountsOn";
7. make the import commit write rows → "import creates requests, not rows";
8. skip the per-type grant check in `issueLetter` → "grant for type A does not allow type B";
9. skip `letters.pay.issue` for `carries_pay` → "a pay letter needs both";
10. drop the queue visibility filter in `hrVisibleWhere` / the Tasks source → the Payroll-ticket 404 tests;
11. remove the route-wrapping guard on one admin route → the browser "not blank" test;
12. remove the `permission` field from one menu leaf → the menu/route-gate consistency test;
13. restore `payroll.salary.edit` on a revision route (instead of `revise`) → "PAYROLL_ADMIN cannot prepare a revision".

## 11. (j) Commit plan — each is reviewable; I pause after each

Every commit: fresh scratch database, full backend and frontend suites run alone, lint, typecheck, migration
drift clean (`prisma migrate diff` empty), `npm run docs:sensitive` check, live browser walkthrough as
more than one role where UI changes, the mutation checks listed for that commit, docs updated, CI read after
the push and reported honestly; `main` fast-forwarded only to a commit with green CI.

| # | Commit | Contents | Schema? | CI should show |
|---|---|---|---|---|
| H0 | This plan (docs only) | `HR_PAYROLL_SEPARATION.md`; SCOPE_UPDATE_PAYROLL.md marked partly superseded | no | docs-only; all jobs green, clock audit unaffected |
| H1 | New keys + ceiling machinery | permission rows, registry classes, `HR_FORBIDDEN_KEYS`, ceiling in `permissions.ts` (inactive until H6), default holders for payroll roles/SA, regenerated `SENSITIVE_DATA.md` | no | green; `sensitiveDocs`, `developerCeiling`, `permissions` tests updated |
| H2 | Pending confirmation of bank/statutory | schema (§5.1), HR edit/import/create → requests, confirm gate + checks, Reveal-for-confirm, Readiness list, Tasks source, UI (profile tags, confirm screen) | yes | green; new test files; migration drift clean |
| H3 | Helpdesk queues | schema (§7), visibility, escalation, routing key, Tasks filter, migration of open tickets, UI | yes | green |
| H4 | Letter grants | schema (§6), service checks, categories, "Who can issue" UI | yes | green |
| H5 | Salary revisions → `payroll.salary.revise` | route re-gating, demo/seed changes (owner makes revisions, second director), Payroll UI gating (`canEdit`) | no (keys only) | green; demo test updated |
| H6 | **The flip** | removal migration (§4) with copy table and rollback rehearsal, `systemRoles.ts` defaults, ceiling activated, refusal-on-every-pay-route test, per-user override clean-up | yes | green; this is the commit that changes who can do what |
| H7 | Admin Tools / menu filter | `permission` field, filtered nav, route guard + "no access" page, menu↔gate consistency test, browser tests | no | green; Playwright walkthrough as `1000`, `1001`, `1025`, new HR Executive |
| H8 | Docs, seeds, close-out | `GETTING_STARTED.md` role table, `SENSITIVE_DATA.md`, `FIRST_REAL_PAYROLL_RUN.md` (who does which step), `PHASE_6.md` matrix, `PROGRESS.md`, `LOCAL_ASSUMPTIONS.md` (none expected), dev seed HR Executive, `PHASE_7.md` amended for the new roles (declaration verification etc. are payroll-only — per SCOPE_UPDATE §3) | no | green |

The order puts every *new* capability (confirm, queues, grants, revise) in before the single commit (H6) that
takes the old ones away, so no intermediate commit leaves a duty with nobody able to perform it.

## 12. Rules I decided myself (where neither the spec nor you covered it)

101. The live tables never hold unconfirmed bank/statutory values; a request is the pending state, immutable.
102. One PENDING request per employee and group; a new one supersedes the old (audited).
103. The confirmer can never be the requester, an HR user, or the subject employee; enforced in service and DB.
104. HR cannot confirm, ever (ceiling) — otherwise one HR person could enter and confirm.
105. Readiness shows counts and names, never numbers; the pending value is revealable only to confirm holders.
106. Non-owners cannot add a currency field to a letter or flip `carries_pay`; granted issuing is deny-by-default.
107. A category's queue can be moved to/from Payroll or Directors only with `helpdesk.routing.manage`.
108. Escalating a ticket to the directors is one-way for HR; the raiser always keeps the thread.
109. The migration copies every row it deletes into an append-only table; rollback is a forward migration.
110. New keys join the sensitive-data registry, so the Developer role is barred from them automatically.
111. `payroll.salary.edit` stays with payroll (components/structures/adjustments); revisions get their own key.
112. Already-issued letters are not moved or re-categorised (immutability), only new ones are filed by type.

## 13. (k) Open questions — each with my recommendation; I have chosen no default

**Q1. Hard ceiling or just defaults?** Make the HR pay keys *impossible* to grant to HR roles/users (DB
trigger + resolve-time strip, like the Developer role), or only remove them from the defaults so an owner could
re-grant? And may one person hold an HR role *and* a payroll role? *Recommend:* hard ceiling; HR role + payroll
role refused (a person doing both jobs gets the payroll role only for payroll work, in a separate account);
HR + SUPER_ADMIN allowed since owners can do everything.

**Q2. Who are "directors", and how many?** I read it as everyone holding `SUPER_ADMIN`. Decision c ("nobody
changes their own pay") means each director's own salary needs *another* director as maker. With one director
that cannot happen. *Recommend:* confirm directors = Super Admin; require at least two for any real run, and
have Readiness say plainly when only one exists. If you have a single director, tell me how their pay is set.

**Q3. Who checks a salary revision?** Maker = a director. Checker today is any `payroll.approve` holder
(`PAYROLL_APPROVER` or a director). *Recommend:* keep that (a payroll approver or a *different* director), so
a one-director firm can still operate for everyone but the director.

**Q4. One-off adjustments, components and structures** stay with PAYROLL_ADMIN under `payroll.salary.edit`
(they share the key with revisions today). Should a one-off bonus/deduction also be director-only?
*Recommend:* no — they are monthly operations and a checker approves the run; revisit with Monthly Inputs.

**Q5. Does HR's statutory entry include Aadhaar?** The decision names PAN, UAN, ESI. *Recommend:* yes, same
tab, same key, same pending flow.

**Q6. Employee-initiated bank/statutory requests:** with HR's approval gone, payroll/directors confirm them
directly. *Recommend:* yes; HR can still see them read-only.

**Q7. Setup sign-off independence:** keep "the signer did not enter these rows" as is (requester barred), or
also bar the confirmer? *Recommend:* bar both — otherwise the same person confirms and then signs off the set.
Cost: with two payroll staff and two directors there is always someone left.

**Q8. Does a pending change block a payroll run?** *Recommend:* warning, not blocker — a pending *change* means
the person is still paid to the confirmed old account (safe); a person with *no* confirmed account is already
held and named.

**Q9. Back-dating a bank change:** HR supplies an effective date. *Recommend:* never earlier than the
confirmation date (a back-dated account would rewrite who was paid where); future dates allowed.

**Q10. Data Import/Export is owner-only (d), but HR bulk-imports employees from the Employee app today.**
Should HR keep Bulk Import for org masters, employees and leave grants (with bank/statutory rows becoming
pending requests), and only the Admin Tools "Data Import/Export" entry go owner-only? Both menu entries open
the same page and the same key. *Recommend:* HR keeps Bulk Import; split the key (`import.manage` for HR's
datasets, a new owner key for the rest).

**Q11. `user.security.manage`** (unlock accounts, reset 2FA, per-user exceptions) — owner-only with Roles and
Permissions, or does HR keep helping staff who are locked out? *Recommend:* owner-only, with a documented
procedure (and confirm Manager Management keeps working without `role.view`).

**Q12. Leave year-end** computes encashment ₹ from a daily-rate setting and writes adjustments payroll pays.
Options: (A) whole Year End Process becomes payroll/director-only; (B) split — HR runs the leave reset and
carry-forward (days), payroll/directors compute and approve encashment amounts. *Recommend:* A for now (smaller,
safer); HR still sees balances in the Leave screens. Also: leave-liability report payroll-only?

**Q13. Grievance:** HR_ADMIN only (as today) or HR_EXECUTIVE as well? And should the "concerns HR" tick be
shown on every category or only Grievance? *Recommend:* HR_ADMIN only; Grievance only.

**Q14. Payroll helpdesk queue:** `PAYROLL_ADMIN` and directors only, or the approver too? Who is the default
assignee? *Recommend:* PAYROLL_ADMIN + directors; default assignee unset until you name one.

**Q15. Which letters carry pay figures?** Today only the Offer Letter (`ctcAnnual`). Appointment, revision and
increment letters will. *Recommend:* derive from a currency field/merge token plus an owner-set flag, as in §6.

**Q16. Who manages letter grants?** Only owners (`letters.grants.manage`), or HR Admin for non-pay types?
*Recommend:* owners only, as you said "by an owner".

**Q17. Customised roles and per-user grants that hold a removed key:** strip them or only report? *Recommend:*
strip the two system HR roles and HR users' GRANT overrides; only report custom roles (banner + audit entry).

**Q18. Existing sessions** keep old permissions until their token refreshes. *Recommend:* force a refresh on
deploy (revoke refresh tokens for HR users) — costs one re-login.

**Q19. ID-proof scans (STATUTORY documents).** HR keeps statutory view, so HR (now including HR Executive) can
open PAN/Aadhaar scans, which show full numbers although the tabs mask them. *Recommend:* keep (HR collects
them); but say if scans should need the Reveal's audit.

**Q20. Reveal reason.** Add a mandatory one-line reason to every Reveal (bank, statutory, ESI, UAN) written to
the audit row? *Recommend:* yes — cheap and it deters curiosity.

**Q21. Seeds.** Add an HR Executive (and, for Q2, a second director) to the dev seed and the demo company so
every role can be walked through. *Recommend:* yes, made-up names only.

**Q22. Evidence for a bank change.** Require HR to attach a document (e.g. a cancelled-cheque image) to a bank
request? *Recommend:* not in this piece — an optional note now, an attached-document link as a later change.

**Q23. Open payroll tickets assigned to HR** are un-assigned and kept in the Payroll queue with a system note
(count printed by the migration). *Recommend:* confirm, rather than closing or deleting them.

**Q24. The three provisional keys** (`import.manage`, `user.security.manage`, `leave.yearend.manage`) are not
removed until Q10–Q12 are answered; H6 is held back until then.

## 14. Scope boundaries

Not in this work: Monthly Inputs, loss-of-pay reversal, Hold Salary, Raise-a-query, Check in/out, and any
Phase 7 step (P7-1 onwards). Amendments to `PHASE_7.md` (declaration verification and reopening move to
payroll; letters/revision flows follow §6/§8) are made in H8, after this plan is approved.
