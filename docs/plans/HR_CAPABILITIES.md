# HR capability switches and the HR hard-lock — plan (master Stage 1)

Written at Stage 1.2 of the master build, from the owner's master prompt (A5, Stage 1) and the report in `STAGE_REPORTS.md` (1.1).
Builds on `HR_PAYROLL_SEPARATION.md` (H1/H6 ceiling part only) and `DIRECTOR_AUTHORITY.md`. No real data.

## 1. Two separate things

**A. The hard lock (never grantable to HR).** A fixed set of permission keys, `HR_FORBIDDEN_KEYS` in `shared/constants/sensitiveData.ts`:
every `payroll.*` key, plus `reports.salary.view`, `reports.liability.view`, `documents.pay.view`. Enforced in four layers, like the developer ceiling:
1. `resolveAccess` removes them from anyone holding `HR_ADMIN` or `HR_EXECUTIVE` who is not also a Super Admin, whatever any row says;
2. the Roles & Permissions service refuses to add them to an HR role or to grant them to an HR holder, in words;
3. a database trigger refuses `role_permissions` rows of these keys for the HR system roles and `GRANT` overrides of them to HR holders;
4. the system-role defaults no longer contain them, and a migration removes the rows existing databases still hold (each copied first into the
   append-only `role_permission_removals`, so it can be put back by a forward migration; the app database role has no UPDATE/DELETE on it).

Not in this set, on purpose, and listed as open: `employee.bank.*` / `employee.statutory.*` (HR **enters** a masked change; a director confirms — approved
plan, decision b; the confirm step is D2), `letters.generate` (per-type grants are H4, not built, so HR can still issue letters, including ones with
pay figures, until then), `settings.manage`, `audit.view`, `role.view`, `delegation.manage`, `user.security.manage`, `import.manage` (Admin Tools filter is H7, not
built), `leave.yearend.manage` (open question Q12). Each is in the Stage 1 report as an unlocked gap.

**B. Capability switches (what a director may turn on or off for HR).** Twelve capabilities (the twelfth, See leave counts, was added after Checkpoint 1), each a named set of permission keys:

| Capability | Keys it controls |
|---|---|
| View individual attendance | `attendance.view`, `attendance.swipes.view` |
| Approve regularizations | `attendance.regularization.view`, `attendance.regularization.approve` |
| Approve leave | `leave.approve` (and `leave.view`) |
| Edit muster | `attendance.manual.enter` |
| Upload manual-branch muster | `attendance.manual.upload` (new, split from manual.enter) |
| Finalise a month | `attendance.finalise` |
| Corrections | `attendance.regularization.bulk`, `attendance.override.manage` |
| Shift roster | `attendance.roster.manage` (new, split from config.manage) |
| Exceptions queue | `attendance.exceptions.view` (new, split from view) |
| Attendance reports | `reports.attendance.view` (new) |
| Leave reports | `reports.leave.view` (new) |

The new keys are added to the permission catalog, granted by the migration to every role that holds the key they were split from (so the default is
exactly today's behaviour), and to the sensitive-data registry's "reviewed, not sensitive" list.

**Rules (decided by the owner's prompt, with my reading where it is silent):**
- Only a Super Admin changes a switch. Each change needs a reason, is audited, and shows in a visible history.
- A switch is for a **role** (`HR_ADMIN` or `HR_EXECUTIVE`) or a **named person** who holds an HR role.
- No row = today's behaviour (the role's permission rows decide). `ON` adds the keys, `OFF` removes them.
- Precedence: a named-person switch beats a role switch; at the same level OFF beats ON; if a person holds both HR roles, OFF on either role beats ON.
- Effective-dated: each row has an `effective_from` instant (now, or later). The state at any moment is the latest row in force per
  capability and subject. History is never edited (append-only table; superseding is a new row). So there is no range to overlap; uniqueness on
  (capability, subject, effective_from) is the database constraint.
- The hard-locked set is stripped **last** in `resolveAccess`, so a switch can never add it, and the catalog of switchable keys is checked disjoint from it by a test.
- Resolution happens in `resolveAccess` (one place; it has no cache), so routes, service checks, socket rooms, task counts, emails and search follow with no
  per-place change. Changing a switch calls `notifyAccessChanged` for the affected people (rooms re-synced, `/me` refetched). A switch with a future
  effective time is applied by the existing midnight-free approach: resolution compares `effective_from <= now` on every request, so no job is needed.
- A person who holds an HR role **and** another role (e.g. manager) loses the switched-off keys entirely (conservative; the permission set has no provenance).
- Super Admins are never affected. Developers never hold these keys.

## 2. Pending work when a switch goes off (1.4)
Requests already waiting (leave, regularizations) stay PENDING; they are not decided, not auto-approved, not lost. They appear in the directors'
queue with a visible note that HR may not currently decide them, and in HR's own list they are hidden because HR no longer holds the key. When the
switch goes back on, they return to HR's queue; nothing is re-created. Concretely: the directors' task counts include requests whose normal approvers
no longer hold the key (the same mechanism as "pending leave no manager can decide").

## 3. Reports gallery (1.5)
Each report gets a required key: attendance reports `reports.attendance.view`, leave reports `reports.leave.view` (plus `reports.view`), people reports
`reports.view`; leave liability additionally `reports.liability.view` (now hard-locked from HR). The catalog endpoint lists only reports the viewer may
open; run and export enforce the same check server-side.

## 4. Commits
1. Plan (this file) + hard lock A (resolver, service, trigger, removal migration, defaults, tests, mutations).
2. Capability switches: schema, service, routes, resolver integration, new keys, tests, mutations.
3. Switches screen for Super Admins (role & person tabs, history).
4. Immediate effect everywhere: admin menu gets a `permission` per item, search follows, tests per place and persona (1.3).
5. Pending-work routing (1.4).
6. Reports gallery (1.5).
7. `check:sensitive-ui` extended and the persona matrix test (1.6).


## After Checkpoint 1: four more hard-locked keys
`user.security.manage`, `import.manage`, `letters.generate`, `leave.yearend.manage` joined `HR_FORBIDDEN_KEYS` (migration `20261030090000`; what it removed is copied first to `role_permission_removals`, a personal grant as `USER_OVERRIDE:<id>`). Consequences the owners should know: HR cannot reset 2FA / unlock / send a password link; cannot use the Import Center (bulk employee import, invitations); cannot issue any letter; cannot run the leave year-end. Directors do these until narrower keys exist. Tests: `hrHardLockFourKeys.test.ts` (each key on each route, every HR switch on, role edit, personal grant, database triggers, resolver with triggers off) and the extended persona matrix.

## Narrower keys (after the owners' review of Checkpoint 1)
The four hard locks stay for what involves pay or access: letters that carry a CTC or any pay figure (`letters.generate`), the leave year-end (`leave.yearend.manage`), importing salary, bank or statutory data (`import.manage`), resetting another person's sign-in or 2FA (`user.security.manage`). Three narrower keys, each a director-controlled HR switch whose default is "as before D1" (both HR roles hold them), carry no pay data:
| Key | HR switch | What it opens | What keeps it from pay |
|---|---|---|---|
| `invitations.send` (split from `employee.create`) | Send invitations | list, send and resend invitations | no pay data is involved |
| `import.details.manage` | Import employee details | org masters, employees, leave grants (templates, uploads, batches, error reports) | the statutory and bank datasets, and their batches, are refused and hidden; a file with ANY pay, bank or statutory column (by word: ctc, salary, basic, gross, allowance, bonus, pf, esi, pan, aadhaar, uan, account, ifsc, bank, tds, loan …) is refused whole, not ignored |
| `letters.issue.nopay` | Issue letters without pay figures | issue a letter from a template the engine proves pay-free | the proof (`payFreeProof` in `letters/template.ts`): the closed placeholder list has no pay placeholder; no number or currency field and no field named or labelled like pay; no pay word, currency sign or amount in the fixed text; what HR types into a text field is checked the same way. Anything else is refused with the reasons, and the template list shows which templates HR may issue. Reissuing and reproducing an issued letter stay the directors' |
Tests: `hrCapabilities/__tests__/narrowKeys.test.ts` (invitations: three routes; import: every dataset, every real column of every non-pay dataset, 26 pay columns in each non-pay dataset, batches; each with the switch on, off and on for one named person, for an employee, a manager and a director), `letters.test.ts` ("letters without pay figures") and `payFreeProof.test.ts` (15 refusals, formatting-hidden words, typed values). Mutation checks: guard removed from batch reads, pay-column refusal disabled, invitations back on `employee.create`, letter proof skipped: each caught.
Decision of mine: a bank "branch name" alone is not treated as a pay column (branch is an organisation word); a bank file always carries an account or IFSC column, which is.
