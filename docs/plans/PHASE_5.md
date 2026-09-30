# Phase 5 plan — commits A–G

Phase 5 (spec §12): homepage, dashboards, engage, notifications, documents,
helpdesk, reports. Built as seven commits, one at a time, each paused for
review.

## About this file (read first)

The detailed Phase 5 plan was agreed in an earlier chat session and never
written into the repo, so a new session could not recover it. **This file
is a reconstruction, written 2026-09-30.** It is built from:

- what the repo itself records: the one-line commit list in
  `docs/PROGRESS.md`'s status table, and the commit A/B log entries;
- the user's instructions in the 2026-09-30 session (the commit E
  hierarchy scope, the commit G screenshot rule);
- spec §6/§7/§8/§12, `docs/UI_REFERENCE.md`, and the routes still marked
  `phase: "Phase 5"` in `frontend/src/routes/*Menu.config.tsx`.

Markers used below:

- **[recorded]**: stated in the repo before this file existed, or given
  directly by the user.
- **[reconstructed]**: inferred from the spec, UI reference and menu
  config. Treat it as a proposal, not a decision already made. Each
  commit's detailed plan (schema, endpoints, screens, tests) is still
  written up and approved before that commit is built, then added to this
  file under the commit's heading.

Standing rule (CLAUDE.md): any plan the user approves is written into the
repo before it's built.

## Commit list

| Commit | Scope | Status |
|---|---|---|
| A | Notifications substrate, Employee Home, Admin Homepage (Welcome + Dashboard) **[recorded]** | ✅ Done |
| B | Engage: posts, kudos, polls, reactions, comments, groups, moderation, auto-posts **[recorded]** | ✅ Done |
| C | People directory, org chart, Document Center **[recorded]** | ✅ Built 2026-09-30, awaiting review (see "As built" below). |
| D | Helpdesk, Request Hub **[recorded]** | Not started |
| E | Three-level hierarchy (Manager Management, per-manager permissions) + Workflow Delegates **[recorded: user, 2026-09-30]** | Not started |
| F | Reports **[recorded]** | Not started |
| G | Mobile / PWA **[recorded]** | Not started. No longer blocked, see below. |

## C — People directory, org chart, Document Center

**Status: plan APPROVED 2026-09-30** (with the user's five corrections and
answers to four questions, all folded in below). **Built 2026-09-30**, paused
for review. Where the build differs from, or adds to, this plan, see
"As built" at the end of this section.

### Decisions (user, 2026-09-30)

1. **Directory privacy**: one company-wide setting, no per-employee
   opt-out for now. Always shown: name, photo, Employee Code, designation,
   department, branch. Toggleable, **on** by default: official email,
   reporting manager. Toggleable, **off** by default: mobile, personal
   email, birthday (day and month only, never the year), date of joining.
2. **Employee document uploads**: HR-only. Employees upload only their own
   photo.
3. **Policy acknowledgement**: out of scope. Company-document downloads
   are still recorded per employee (correction 4) so "who has read the
   new policy" can be answered later.
4. **Letter templates and generation**: not in C. Settle when planning D.

### Corrections the user added to the original plan

1. **Fix the seed's reporting lines now, not in E**, and add a seed-level
   assertion that fails the seed if any seeded reporting manager lacks
   the `MANAGER` role. Enforcement in the service layer and import still
   belongs to E.
2. **Photos are re-encoded, not just byte-sniffed**: decode with `sharp`,
   auto-orient, strip all metadata (EXIF GPS etc.), re-encode, store only
   the re-encoded output. Also generate a thumbnail for the directory.
3. **Org chart at 500 people**: confirm the payload stays small and the
   frontend renders without jank. Lazy-render collapsed branches rather
   than paginate.
4. **Company-document downloads are recorded** (per document, per
   employee, as an aggregate), alongside the per-employee-document HR
   download audit log.
5. **Directory allowlist guard**: a test that fails if a column is added
   to `EmployeePersonal` (and, for the same reason, `Employee`) without
   being explicitly classified as shown or hidden in the directory, in
   the same spirit as the cleanup guard.

Also: rename `docs/screenshots/*.png.jpeg` to strip the double extension
(done in this commit).

### Seed hierarchy fix (correction 1)

Current seed violations of the three-level rule: 1024 (plain employee
with designation "Manager") manages 1025 and reports straight to Admin;
1001 (HR_ADMIN, not a manager) manages manager 1005 *and* plain employees
1021–1023; 1090 (separated, plain employee) reports straight to Admin.
Fix:

- 1024 Rajesh Kumar gains the `MANAGER` role. His designation already
  says Manager and he heads the Admin department. He keeps 1025.
- 1021–1023 (HR staff) move from 1001 to 1024.
- Manager 1005 moves from 1001 to Admin (1000).
- 1090 moves from 1000 to manager 1002.
- 1001 (HR Admin) reports to 1000 and has no team.

Seed assertion, run at the end of the seed (throws, so the seed exits
non-zero), over every current job-history row that has a reporting
manager: the manager holds `MANAGER`, and then the report must not also
be a `MANAGER` (managers never report to managers). The one exception is
Admin (`SUPER_ADMIN`), who may be the reporting manager of a `MANAGER` or
of another admin-role holder (`HR_ADMIN`). Which roles count as "Admin"
is left for commit E's plan to decide formally.

### Schema (one additive migration)

- `DocumentCategory`: `code` (unique), `name`, `appliesTo`
  (`COMPANY | EMPLOYEE`), `isActive`, `sortOrder`. Admin-editable, seeded.
  Deactivate, don't delete, once referenced.
- `CompanyDocument`: `title`, `description?`, `categoryId`, file
  metadata (`fileKey`, `fileName`, `mimeType`, `sizeBytes`), optional
  `scopeLocationId`/`scopeDepartmentId` (same audience rule as
  `Announcement`: null means everyone, both set means the intersection),
  `uploadedByUserId`, `archivedAt?`/`archivedByUserId?`. Archiving hides
  a document and never deletes it.
- `CompanyDocumentDownload` (correction 4): one row per (document,
  employee), `firstDownloadedAt`, `lastDownloadedAt`, `downloadCount`,
  upserted on every download. Answers "who has read it" without an audit
  row per click.
- `EmployeeDocument` (exists, never written to): free-text
  `documentType` is replaced by a `categoryId` FK. The migration refuses
  to run if the table has rows rather than guessing a mapping. Adds
  `title`, `visibleToEmployee` (default false: HR opts in per document),
  `archivedAt?`/`archivedByUserId?`.
- `EmployeePersonal` gains `photoThumbStorageKey` and `photoVersion`.
  The version is a short random string changed on every photo change;
  it's what the frontend puts in image URLs so caches bust correctly.
- New optional FKs get cleanup policies (`cleanup.ts`); the guard test
  enforces this.

### Backend

- **Directory** (`modules/people`): `GET /api/people` (search by
  name/code, department and branch filters, paginated), `GET
  /api/people/:id`. Any signed-in user. Only `ACTIVE` employees; anyone
  else 404s. The response is built from an explicit field-policy map
  (`DIRECTORY_FIELD_POLICY`) covering every `Employee` and
  `EmployeePersonal` column, so nothing reaches the response unless
  classified. Bank and statutory data are never involved.
- **Org chart**: `GET /api/people/org-chart` returns the whole tree in
  one compact payload. Nodes are `{id, name, code, designationId,
  departmentId, locationId, managerId, photoVersion}`, with designation,
  department and branch names sent once as lookup maps rather than
  repeated per node. Draws whatever reporting lines exist, so it works
  before and after E. Employees with no manager (other than the root)
  appear in an "Unassigned" group. Payload measured at 500 employees
  (see verification).
- **Photos**:
  - `PUT/DELETE /api/employees/me/photo` (self) and
    `PUT/DELETE /api/employees/:id/photo` (`employee.edit`).
  - Input: JPEG/PNG/WebP, judged from what `sharp` actually decodes, not
    the declared type. Max size is a setting (default 5 MB: phone photos
    are often 3–4 MB and the output is small anyway). Decode is capped at
    64 megapixels (decompression-bomb guard).
  - Output: `.rotate()` (EXIF auto-orient), then a re-encoded 512 px WebP
    plus a 96×96 WebP thumbnail. Metadata is stripped by re-encoding, and
    only these two outputs are stored. The previous photo's objects are
    deleted on replace. Audit-logged.
  - **Serving** (design point 1 above): `GET /api/people/photo-token`
    issues a short-lived (1 h), photo-only HMAC token.
    `GET /api/people/photos/:employeeId/:size?v=&t=` checks it and
    streams the image with `Cache-Control: private, max-age=86400`.
    `v` busts the cache. The `t` query parameter is redacted from request
    logs.
- **Documents** (`modules/documents`):
  - Categories: list (any signed-in user), create/update
    (`documents.manage`).
  - Company documents: the employee list is audience-filtered and
    excludes archived documents. A management list shows everything
    including archived, with download counts. Upload (multipart),
    edit metadata, archive/unarchive (`documents.manage`), and
    `GET /:id/downloads` (who downloaded, and how many are in the
    audience). Download returns a 60-second signed URL with the original
    filename and upserts `CompanyDocumentDownload`. Outside the audience,
    both list and download return 404.
  - Per-employee documents: `GET /api/documents/me` and its download
    (own, visible, non-archived only). `GET/POST
    /api/employees/:id/documents` plus edit/archive
    (`employee.documents.view` / `.manage`). An HR download is
    audit-logged. HR adding a visible document notifies the employee
    (persisted notification plus `notification.new`, so their My
    Documents refreshes live).
  - Uploads: allowed MIME types and max size are settings (defaults: PDF,
    PNG, JPEG, DOCX, XLSX; 10 MB). The declared type must be allowed,
    must match the file extension, and must match the file's magic bytes.
  - `StorageService.getObjectSignedUrl` gains an optional
    download-filename.
- **Permissions**: `documents.manage` (HR_ADMIN, HR_EXECUTIVE, and
  SUPER_ADMIN via all), `employee.documents.view` and
  `employee.documents.manage` (the same roles). Managers get none.
- **Settings**: a new "People & Documents" section (`settings.manage`):
  directory visible fields, photo max MB, document max MB, allowed
  document types. All audit-logged like every other settings change.
- Audit-logged: document and category create/edit/archive, photo
  changes, HR downloads of employee documents, settings.

### Frontend

- `/app/people`: Directory tab (search, filters, card grid with
  lazy-loaded thumbnails, detail drawer with the full photo) and Org Chart
  tab (card tree: root, then managers, then teams). A branch's children
  are rendered only when it's expanded, and teams start collapsed.
- `/app/document-center`: Company Policies & Forms (grouped by category),
  My Documents, Payslips ("Coming in Phase 6") and Form 16 ("Coming in
  Phase 7").
- Photo upload with preview and remove on View My Info and on the admin
  employee profile. The admin profile gains a Documents tab.
- Admin: Employee app → Company Documents (Documents tab with upload,
  scope, archive and a Downloads modal; Categories tab). System Settings
  gains a People & Documents card.
- Both placeholders (`people`, `document-center`) are retired and the
  route guard test enforces it.

### Tests

- Directory: the allowlist guard (correction 5) fails naming any
  unclassified `Employee`/`EmployeePersonal` column. A sentinel test puts
  a unique marker in every `EmployeePersonal` text column and asserts only
  permitted ones ever appear in directory/org-chart responses, for both
  "all toggles off" and "all toggles on". Birthday never includes the
  year; separated and inactive employees 404; filters and search work.
- Org chart shape, the Unassigned group, and payload bytes at scale.
- Photos: EXIF (including GPS) present in the input and absent from both
  stored outputs; output is WebP at the right sizes; a non-image, a
  mislabelled file and an oversized file are rejected; replacing deletes
  the old objects; the token is required, expires, and is photo-only.
- Documents: audience 404 on list and download; per-employee IDOR
  (another employee, a manager, and the employee on a hidden document are
  all refused); magic-byte mismatch, disallowed type and oversize are
  rejected; archive hides without deleting; download records upsert and
  count; HR download is audit-logged; the visible-upload notification is
  persisted.
- The permission matrix against every seeded role; the seed hierarchy
  assertion (a unit test on the checker function).
- Test-created storage objects are deleted.

### Verification

Fresh migrate and seed on `wellsure_hr_devcheck`; full backend and
frontend suites; lint and typecheck; org chart measured with about 500
generated employees (payload bytes, render and expand timings, long-task
count, in a scratch run only, nothing committed); browser walkthrough as
Super Admin and as a plain employee; two browsers side by side for the
live My Documents update.

### As built — additions and differences from the approved plan

- **Org chart performance** (correction 3), measured with about 490
  generated employees on a production build:
  - The payload is 130 KB of JSON, now **gzipped per route** to 13.8 KB. The
    directory list is gzipped too; compression is deliberately not
    app-wide (see Security fixes).
  - Cards are plain memoised elements with CSS ellipsis and one shared photo
    token, and expand/collapse run in `startTransition`. Result:
    "Expand all" produces **zero long tasks** (all 488 cards mounted in
    184 ms, rendered in interruptible slices). Expanding one team produces a
    single 75 ms block, down from 270 ms.
  - Payload shape is unchanged: lookup maps plus ids per node.
- **Photo max size default is 5 MB**, not the 2 MB first floated. Phone
  photos are commonly 3–4 MB, and only the re-encoded output is stored.
  It's a setting either way.
- **`StorageService` gained `getObject()`**: photos are streamed through the
  API behind the photo token. Signed URLs also gained a download filename,
  which is part of the local driver's signature.
- **Scope FKs are now `RESTRICT`** for both `CompanyDocument` and the existing
  `Announcement`. Branch merge now repoints scoped content, and branch or
  department delete is refused while anything is scoped to it. Before
  this, deleting or merging away a branch silently turned an announcement
  scoped to it into an org-wide one.
- **Security fixes found while building:**
  - `photoStorageKey` could be set as a raw string through create, HR edit
    and employee self-edit. With photos served by key, that would have let
    anyone point their "photo" at another stored file. Removed from all
    three schemas; the upload endpoint is the only writer.
  - pino-http's default request serializer was logging every request
    header, including `Authorization: Bearer …` and the refresh-token
    cookie. The request log is now an allowlist (id, method, URL with the
    photo token redacted, remote address).
- **Seed**: the first attempt at the hierarchy fix exposed an ordering bug.
  A manager defined after their reports silently became "no manager". The
  seed now throws in that case, and 1024 moved above its reports.
- `notifyEmployee()` moved from `leave/requests.ts` to
  `notifications/notifyEmployee.ts`, shared by leave and documents.
- The cleanup engine (`lib/__tests__/cleanup.ts`) now also deletes stored
  files for rows it removes (`STORAGE_KEY_COLUMNS`, guarded like the FK
  policy). Two pre-existing test-residue bugs were fixed along the way:
  - announcements deleting a scoped branch;
  - totpAndPrivacy deleting the seeded `auth.require2faRoles` row.
- **Left for later:**
  - The employee sidebar greeting still shows a generic icon, because
    `/api/auth/me` doesn't return the employee id or photo version.
  - Global response compression is a Phase 5.5 decision.
  - Existing AntD `List` usages (notification bell, Home) remain the
    documented Phase 0 follow-up; commit C adds no new ones.

## D — Helpdesk, Request Hub

Scope **[recorded]**: Helpdesk, Request Hub.

Detail **[reconstructed]** (spec §6, §11 `helpdesk_tickets`/`helpdesk_messages`):

- **Helpdesk** (`/app/helpdesk`): raise a ticket to HR by category, track
  its status, chat-style replies. Real-time replies are likely, following
  the `notification.new` pattern.
- **Request Hub** (`/app/request-hub`): all of *my* requests in one place.
  Today that means leave and profile change requests, plus helpdesk
  tickets once D lands. Regularization and reimbursement join when Phases
  3 and 6 exist.
- Admin side: a ticket queue with categories as an admin-editable master.

## E — Three-level hierarchy + Workflow Delegates

Hierarchy scope **[recorded: user, 2026-09-30]**, verbatim in substance:

- Strictly three flat levels: Admin → Managers (directly under Admin) →
  Employees (directly under a Manager). Managers never report to other
  managers. Only Admin appoints or removes a manager, places employees
  under a manager, and decides what a manager may do.
- **Manager Management** (Admin Tools): list every manager with team
  size, department and branch. Promote an employee to manager. Demote a
  manager, which requires reassigning their team first. Open a manager to
  add or remove team members. Every change writes an effective-dated
  `EmployeeJobHistory` row (never an in-place overwrite), and every change
  is audit-logged.
- **Per-manager permissions**: Admin edits one default manager permission
  set centrally, plus per-manager overrides. The UI shows which
  permissions are inherited and which are overridden. A manager can never
  grant permissions to anyone.
- **Enforcement**: every manager endpoint checks both the permission and
  the team scope, so a manager acting outside their own team is rejected
  even when they hold the permission. IDOR tests prove it.
- **Validation**: anyone set as a reporting manager must hold the
  `MANAGER` role, and a manager's own reporting manager can only be Admin.
  Enforced in the service layer and in the Excel import.
- The recursive team-scope query (`lib/dataScope.ts`) can stay, with a
  note in code and in the spec that exactly three levels are supported.
- Update `docs/PROJECT_SPEC.md` §2 to describe this explicitly.
- Also for E's plan **[recorded: commit C]**: which roles count as "Admin"
  for reporting purposes. Commit C's seed assertion provisionally treats
  only `SUPER_ADMIN` as Admin (with `HR_ADMIN` allowed to report to Admin
  but never to manage a team) — see `backend/src/lib/reportingHierarchy.ts`.
- Questions the commit E plan must answer **[recorded: user]**: is an
  employee with no manager blocked at creation, or allowed and surfaced in
  an "unassigned employees" list? And who approves a manager's own leave,
  given self-approval is blocked (presumably Admin)?

Workflow Delegates detail **[reconstructed]** (spec §6): a manager
delegates their approvals to someone else for a date range while away.
Covers `/app/workflow-delegates` and `/admin/admin-tools/delegates`.

## F — Reports

Scope **[recorded]**: Reports.

Detail **[reconstructed]** (spec §7.6, and §12's "core reports +
exports"): the reports that exist without attendance or payroll data.
Likely headcount, joiners, leavers/attrition, birthdays and
anniversaries, leave balance and leave liability, and LOP (from the leave
ledger), each with an Excel export. Attendance, salary and statutory
reports wait for their phases. The custom report builder is Phase 8.
Covers the admin `reports` app (`/admin/reports`, currently a
placeholder).

## G — Mobile / PWA

Scope **[recorded]**: Mobile/PWA, a mobile bottom tab bar, plus spec §12's
"PWA install".

- **[recorded: user, 2026-09-30]** No longer blocked: the four greytHR
  mobile screenshots are in `docs/screenshots/`: `mobile-action.jpeg`,
  `mobile-explore-1.jpeg`, `mobile-explore-2.jpeg`, `mobile-engage.jpeg`
  (renamed from a double `.png.jpeg` extension in commit C; they are
  JPEGs).
- **[recorded: user]** Before building, read them and write
  **PART 4 — EMPLOYEE MOBILE APP** into `docs/UI_REFERENCE.md`.
- **[recorded: user]** The tab contents must be driven from
  `frontend/src/routes/employeeMenu.config.tsx`, not from a second
  hardcoded list.
- **[reconstructed]** PWA: a web manifest, a service worker for install
  and offline shell, and our own icons.

## Placeholder routes no commit above clearly owns

These still carry `phase: "Phase 5"` in the menu configs. None of the
recorded one-liners names them. The assignment below is a
**[reconstructed]** proposal to confirm when the relevant commit is
planned. Every route must be wired by the end of Phase 5.

| Route | Proposed home |
|---|---|
| `/app/my-worklife/feedback` (Feedback) | D (a request/response flow like Helpdesk), or defer and re-mark |
| `/app/todo/tasks` and admin app `tasks` (Tasks) | D, alongside Request Hub (both are "my open items") |
| Admin app `workflow` (Workflow) and `admin-tools/workflows` (Approval Workflows, multi-level chains, spec §7.8) | E, alongside the hierarchy and delegates |
| `admin-tools/templates` (Email & Letter Templates) | C (letters in Document Center) or a later commit. Letter generation was deferred from Phase 1. |
| `admin-tools/users-roles` (Users & Roles) | Marked `Phase 1`, deliberately deferred since Phase 1. Overlaps E's per-manager permissions, so decide in E's plan. |
