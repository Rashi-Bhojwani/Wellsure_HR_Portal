# Function parity for the Employee and Admin areas (A-9)

Session A, branch `feat/hr-payroll-separation`. Written 2026-11-03 **before** any code for A-9. Our own design system, menus, wording and artwork
throughout: this file lists *functions*, never the other product's screens or text. The repo is public: no real data here.

How to read a row: **Status** is what the code does today (BUILT / PARTIAL / MISSING / NOT WANTED / NOT SHOWN YET / PEEPS-OWNED), checked in the
code named under **Evidence** (never from memory). **Who** is who may use it. **Group** is the build group below. UNVERIFIED says where I did not check.

Ground facts found while auditing (all checked in code):
* Directors = Super Admins; they hold every key (`lib/permissions.ts`). HR's hard lock is `HR_FORBIDDEN_KEYS` (`shared/constants/sensitiveData.ts`): every `payroll.*`
  key, `documents.pay.view`, `letters.generate`, `user.security.manage`, `import.manage`, Admin Tools keys.
* HR switches are `shared/constants/hrCapabilities.ts` (role or named person, effective-dated, applied inside `resolveAccess`, so a switch-off takes effect on the next request).
* The **Developer** role holds `employee.view` (`DEVELOPER_ROLE_PERMISSIONS`), so a route gated only on `employee.view` is open to it. Every new A-9 route therefore refuses
  the Developer role explicitly (`middleware/refuseDeveloper.ts`, new) unless the person is also a director.
* A-2 (HR's import rules) and A-3 (letter figures from the salary structure) are **not on this branch** (no commit; `git log`). So item 14 is audit only, and letter figure fields are a documented hook.
* Every route is listed in the endpoint inventory (`backend/src/modules/managers/__tests__/routeInventory.ts`); that test fails on an unclassified route. That is the "access-scan entry".

## A. Home and search

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 1 | My Favourites (per user, plus tile, remove) | **BUILT** | `backend/src/modules/admin/favourites.ts` (per-user rows, reorder), `frontend/src/pages/admin/home/HomePage.tsx` `FavouriteTiles` (plus tile, remove with confirm), `AddFavouriteDrawer.tsx`; tiles hidden when the page's needs are not met (`adminNeedsForPath`) | everyone on the admin portal, own list only | G6 adds a star in search only |
| 2 | My Tasks: review / monitor counts, Monitor link into a scoped list | **BUILT** | `backend/src/modules/admin/tasks.ts` (`review` = what I may decide, `monitor` = pending elsewhere, ALL scope only; leave + regularizations; `heldFromHr` for directors), `HomePage.tsx` "Things to review / monitor" with a Monitor action, `pages/admin/tasks/AdminTasksPage.tsx` | director: all; HR/manager: their scope | — |
| 3 | Global search: actions and employees, category chips, favourite star; payroll tiles directors only | **PARTIAL** | `frontend/src/layouts/shell/CommandPalette.tsx` searches menu pages and shell actions only (menu entries already filtered by `needs`, so payroll pages never show to HR); **no** employee results, **no** category chips, **no** star | per the menu's needs; employee results within the viewer's scope (server) | G6 |
| 4 | Celebrations card (birthdays, anniversaries) with "Send a wish" | **BUILT** | Engage auto-posts birthday / anniversary / joining posts (`backend/src/modules/engage/autoPosts.ts`, `autoPostSettings.ts`); colleagues react and comment on the post (`engage/comments.ts`, `reactions.ts`) which is the wish; admin report `reports/celebrations` | everyone (feed) | — |
| — | Vendor news feed, vendor help links | **NOT WANTED** | — | — | — |

## B. Employee directory and profile

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 5 | Directory: search name/number/email; columns (employee, contact, department, designation, status, type); column chooser; current/past/all; pagination + total; masked audited export; contact numbers masked with audited reveal | **PARTIAL** | `backend/src/modules/employee/grid.ts` + `pages/admin/employee/AllEmployeesPage.tsx`: search on code, name, personal email, mobile (**not official email**); column chooser exists but is lost on reload unless saved as a view; status filter only (**no current/past/all**); pagination + total; export audited (`employee.export` / `.sensitive`); **mobile shown in full** in the grid and the export (no reveal) | `employee.view` + data scope; export `employee.export` | G1 |
| 6 | Profile tabs Personal, Job, Pay and Benefits; Pay directors only; masked fields with audited reveal | **PARTIAL** | `EmployeeProfilePage.tsx`: Official (job), Personal, Statutory, Bank (masked, audited reveal `/:id/statutory/reveal`, `/:id/bank/reveal`), Documents, History, Access. **No Pay tab**; salary is only on Payroll → Employee Salaries (`GET /api/payroll/salary/employees/:id`, `payroll.salary.view`), and opening it writes **no** audit entry | Pay: directors only (HR hard lock) | G1 |
| 7 | Saved employee filter (optionally shared with other admins); segment = saved group used as an audience | **PARTIAL** | `SavedView` (`schema.prisma`, `grid.ts` `createSavedView`): per user, never shared; **no segment**, nothing resolves a saved group as an audience | holder of `employee.view`; a shared filter resolves inside **each viewer's own** scope | G1 |
| 8 | Asset tracker on the profile | **PEEPS-OWNED** | not on this branch; build nothing | — | — |

## C. Position history

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 9 | Effective-dated, append-only history of division, cost centre, grade, designation, location, department, attendance shift; card per attribute with current value, date, Add/Edit (= new dated entry, reason, audited) through the existing update paths | **PARTIAL** | `EmployeeJobHistory` (department, designation, location, grade, cost centre, manager; effective-dated, `changeReason`), written only by `employee/service.ts` `updateJob` (`PATCH /api/employees/:id/job`, audited); shift is `AttendanceAssignment` (effective-dated, `POST /api/attendance/config/assignments/:employeeId`). Shown today as one job timeline on the History tab; **no card per attribute**, reason optional. **Division does not exist** anywhere (no master, no column) | `employee.edit` (job), `attendance.config.manage` (shift); read: `employee.view` + scope | G2 (division: open question, not built) |

Grade and cost centre are labels here. Any payroll effect of a grade (for example a structure chosen by grade) belongs to Session A's payroll model and is not wired by A-9.

## D. Separation modes

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 10 | Separation with a mode (configurable data, Not set) and a status | **PARTIAL** | `Separation` has `reason` (free text), `notes`, `status` (INITIATED/COMPLETED/CANCELLED) — `employee/separations.ts`, `SeparationsPage.tsx`. **No mode and no leaving-reason master** (the import's `exitReason` is free text too). Resignation details from C-3: not on this branch (UNVERIFIED what C-3 adds) | `employee.separate` | G7 |

## E. Letters

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 11 | Templates with an enabled flag; gallery of starter templates (11 kinds), original wording, loaded only by a directors-only audited action; figure letters director-only; figure fields from the structure after A-3 | **PARTIAL** | `letters/service.ts`: templates versioned, `isActive` (enabled), letterhead, `payFreeProof` (a template that could carry pay is never issuable by HR). **No starter gallery.** Figure fields from the structure: A-3 not landed → hook only | template edit `letters.template.manage`; starters: directors | G3 |
| 12 | Generate workflow: one or many (batch), In Progress / Completed, up to two signatories each pending/signed, serial from a sequence setting (Not set), remarks, edit, download, publish to documents, void (never delete, audited); prepare and issue separate permissions per letter type (default directors; owner may grant HR); HR never issues a figure letter | **PARTIAL** | Today one letter is issued at once (`POST /api/letters/employees/:id`), filed to the person's documents, reissue/reproduce; `letters.generate` (directors) or `letters.issue.nopay` (HR switch, pay-free templates only). **No batch, no draft stage, no signatories, no serial setting, no void, no per-type grants** | prepare/issue: directors by default; per-type grants by a director | G3 |

## F. Bulk tools

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 13a | Bulk document upload, files named by employee number, preview, validation, result report, audit | **MISSING** | `documents/routes.ts`: one file per request (`POST /api/documents/employees/:employeeId`) | `employee.documents.manage` + scope; PAY / STATUTORY categories need their read keys | G4 |
| 13b | Bulk photo upload the same way | **MISSING** | single photo `PUT /api/employees/:id/photo` (`people/photos.ts` re-encodes) | `employee.edit` + scope | G4 (uses that path; avatar module PEEPS-OWNED) |
| 14 | Excel import: types against the groups | **AUDIT ONLY** | see the table below | — | — |

Item 14, importer types today (`backend/src/modules/import/types.ts`, `payroll/inputs/importService.ts`, `attendance` punch import):

| Group | Importer today | Gap |
|---|---|---|
| Employee information | `employees` (new joiners and migrated ex-employees, incl. addresses and emergency contact) | no **update** importer for existing employees' details |
| Address | inside `employees` (new rows only) | no address-update importer |
| Leave grants | `leave-grants` | — |
| Bank and statutory | `bank`, `statutory` (Import Center, directors' `import.manage`) | — |
| Organisation masters | `org-masters` (location, department, designation, grade, cost centre) | no division (no division master) |
| Declarations | none | tax declarations are pay: Session A's payroll stage, not built by A-9 |
| Pay overrides | Monthly Inputs import (`payroll/inputs/importService.ts`, directors) | — (pay; not touched) |

Not built in A-9: A-2 (HR's import rules) is not on this branch, so who may import stays exactly as it is and no importer was added.

## G. Communication

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 15 | Mass email: everyone / saved filter / segment / selected people; category; history; draft edit + delete before sending; recipient count before sending; mail interface; no pay or private data; audited; email only | **MISSING** | no module; mail interface exists (`integrations/mail`) | new key `communication.mass.send`: directors; an HR switch an owner can turn on | G5 |
| 16 | Bulletin board | **BUILT** | Engage announcements (`modules/announcements`: title, body, link, location/department scope, active dates, pause) + the Engage feed | `announcements.manage` | — |

## H. Account utilities

| # | Function | Status | Evidence | Who | Group |
|---|---|---|---|---|---|
| 17a | Disable / enable portal access | **MISSING** | `UserStatus.SUSPENDED` exists and is refused at sign-in and on every request (`auth/service.ts`, `middleware/authenticate.ts`), but nothing sets it | as unlock: `user.security.manage` (HR-locked) or a director; a director's account only by another director | G7 |
| 17b | Regenerate password | **BUILT** | `POST /api/access/employees/:id/password-reset` (link by email, audited, person told) | as above | — |
| 17c | Unlock, reset two-step | **BUILT** (owner-only stays owner-only) | `access/service.ts` `unlockAccount`, `resetTwoFactor` | as above | — |
| 17d | Invitations | **BUILT** | `employee` invitations (`invitations.send`, an HR switch) | — | — |

## I. NOT SHOWN YET (build nothing)

Company policies and forms with acknowledgment; identity verification; contract details; document storage drive.

## Build plan (groups, in order; one commit per sub-step)

**G1 (items 7, 5, 6)**
* `employee_segments`: name, kind FILTER (saved criteria) or LIST (named people), owner, shared flag, archived (never deleted). Routes `/api/employee-segments`. A segment is always resolved **inside the viewer's own scope**: a shared filter never shows anyone the viewer cannot already see. Create/update/archive audited.
* Directory: search official email too; `population` current / past / all; mobile masked to the last 4 in the grid and the export, with an audited reveal (`GET /api/employees/:id/contact/reveal?reason=`); column choice remembered per user (a per-user preference row, not shared).
* Profile Pay tab: `GET /api/employees/:id/pay`, `payroll.salary.view` (directors; HR-locked), writes `employee.pay.opened` each time it is opened.

**G2 (item 9)** `GET /api/employees/:id/position-history` grouped per attribute (department, designation, location, grade, cost centre, shift) and a Position tab with one card each; a change goes through the existing `PATCH /:id/job` or the attendance assignment path, with a reason required from this screen. Division: not built (open question).

**G3 (items 11, 12)** starters in `shared/constants/letterStarters.ts` (original wording, labelled starter) loaded by `POST /api/letters/starters/:code/load` (directors, audited, never automatic); a letter request stage (`letter_requests` + `letter_request_signatories`, batch id, remarks, serial, VOID with reason) in front of the existing issue path; per-template grants (`letter_template_grants`: PREPARE / ISSUE, role or person) set by a director; a non-director needs the grant **and** the HR letter switch key **and** a pay-free template. A-3 hook: `letterFigureFields()` returns nothing until A-3 lands.

**G4 (item 13)** bulk document and photo upload: preview (match by employee number, duplicates, unmatched, wrong names, wrong type), then commit through the existing single-file service, a result report and a batch audit row.

**G5 (item 15)** `mass_emails` + `mass_email_recipients`: drafts, edit, discard, preview count, send through `mailService`, history; audience resolved on the server at send time; body checked for pay figures and identity numbers; audited.

**G6 (items 1–4)** search dialog: category chips, employee results (server, scoped), favourite star.

**G7 (items 10, 17)** separation modes as data (`separation_modes`, none seeded: Not set) and a mode on a separation; disable / enable portal access.

## Settings left Not set
Letter serial sequence; separation modes (none seeded); mass-email categories (free text, none preset).

## Open questions (not guessed)
* Does the company use divisions? (no master exists; not built)
* Should the letter serial be per letter type or one company sequence? (built as one company sequence, Not set)

## What was built (after the audit above)

| Group | Commit | Items | Where |
|---|---|---|---|
| G1 | `d81f0ba` | 5, 6, 7 | `backend/src/modules/parity/{segments,contact,pay,gridColumns}.ts`; `/api/employee-segments`, `/api/employee-extras/*`; Filters & Segments page, Pay tab, contact reveal, Who filter, remembered columns |
| G2 | `c9bc156` | 9 | `parity/position.ts`; Position tab (one card per attribute) |
| G3 | `0829a3a` | 11, 12 | `letters/{starters,workflow,workflowController}.ts`, `shared/constants/letterStarters.ts`; Letters page, Letter Settings (directors) |
| G4 | `6397ad1` | 13 (14 audit only) | `parity/bulk.ts`; Bulk Upload page |
| G5 | `6ee5f12` | 15 (16 built already) | `parity/massEmail.ts`; `/api/mass-email`; Mass Email page |
| G6 | `7aa4520` | 3 (1, 2, 4 built already) | `layouts/shell/CommandPalette.tsx`, `paletteCategory.ts` |
| G7 | `8fa2777` | 10, 17 | `parity/separationModes.ts`, `access/service.ts setPortalAccess`; Separations page modes, Access tab button |

**Decided by me (owners may change):** mass email is granted through Roles & Permissions (a new key, `communication.mass.send`), not through a new HR switch;
the two G1 keys (`employee.segments.manage`, `employee.contact.reveal`) are held by both HR roles by default (no pay data); a loaded starter arrives switched off;
voiding an issued letter is the directors' only (its copy is filed under the PAY letters category, which HR cannot read); a mass email goes to the official
address, else the personal one, current staff only, plain text; the letter serial is one company-wide sequence; the Position tab and changes need `employee.edit`
(job) or `attendance.config.manage` (shift), never a manager key; bulk file names are `<code>.<ext>` or `<code>__anything.<ext>`.

**Hooks left:** A-3 — `letterFigureFields()` in `backend/src/modules/letters/starters.ts` returns nothing until letter figures come from the salary structure.
A-2 — no importer was added and who may import is unchanged (item 14 is audit only).
