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
| D | Helpdesk, Request Hub, Tasks inbox **[recorded]** | ✅ Built 2026-10-01; see "As built" under §D and the PROGRESS entry. |
| D2 | Letter templates + PDF generation (headless Chromium), letters saved to Document Center **[recorded: user, 2026-10-01]** | Plan approved 2026-10-01. In progress. |
| E | E1 role & permission system · E2 three-level hierarchy (Manager Management) · E3 Workflow Delegates **[recorded: user, 2026-09-30, revised]** | Plan approved 2026-09-30. Not started (after the Docker fix and D). |
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

## D — Helpdesk, Request Hub (+ To do → Tasks inbox)

**Status: BUILT 2026-10-01** (plan approved the same day, with the user's
answers and two additions folded in below). See "As built" at the end of
this section for the three deviations.

### Decisions (user, 2026-10-01)

1. **To do → Tasks** (employee menu and the admin Tasks app) is an **inbox
   of things waiting on me**, with no new schema: approvals I can act on,
   helpdesk tickets assigned to me, and change requests I can approve. It
   sits alongside Review. A real task system (assign, due date, done) comes
   later with onboarding and exit checklists.
2. **Feedback** (My Worklife) is deferred to **Phase 8** with performance
   reviews, and stays a placeholder (re-marked `phase: "Phase 8"`).
3. **Letter templates and PDF generation** get their own commit right after
   D, using **headless Chromium** (payslips need it in Phase 6). Generated
   letters are saved as employee documents, so they appear in the
   employee's Document Center. The image-size increase gets documented in
   `docs/DEPLOYMENT.md` so it's no surprise at Phase 1.5.
4. **Sensitive helpdesk categories:** HR_EXECUTIVE doesn't see them by
   default (consistent with the salary rule). The seed marks "Payroll &
   Salary" and "Grievance" sensitive. **The flag is configurable per
   category** in the admin screen, so HR can mark a new category sensitive
   without code.
5. **The employee always sees when a ticket will auto-close**, e.g. "Resolved
   — will close automatically on 8 Oct unless you reply", on the list and
   in the thread. The reopen window is shown the same way, so a ticket
   never vanishes unexplained.
6. **Helpdesk attachments go through the same pipeline as Document Center
   uploads:**
   - size, type, extension and magic-byte checks;
   - **images are re-encoded with sharp and stripped of all metadata**
     (EXIF/GPS);
   - photographed payslips and IDs are exactly the leak case.

### Schema
- `HelpdeskCategory`: code, name, `isSensitive`, optional default
  assignee, `isActive`, `sortOrder`. Admin-editable; deactivated, never
  deleted, once used.
- `HelpdeskTicket`:
  - `number` from a Postgres sequence, shown as `HD-000123`;
  - `raisedByEmployeeId`, categoryId, subject, priority
    (`LOW | NORMAL | HIGH`), optional `assigneeEmployeeId`;
  - status `OPEN → IN_PROGRESS → WAITING_ON_EMPLOYEE → RESOLVED → CLOSED`;
  - `resolvedAt`, `closedAt`, `lastActivityAt`.
- `HelpdeskMessage`: ticketId, authorEmployeeId, body, `isInternalNote`
  (HR-only, never sent to the employee).
- `HelpdeskAttachment`: messageId, file metadata, and a storage key
  registered with the cleanup engine.
- New permissions:
  - `helpdesk.manage` (HR_ADMIN, HR_EXECUTIVE): the queue, assignment,
    status, replies, internal notes and categories;
  - `helpdesk.sensitive.view` (HR_ADMIN).

  Both become SUPER_ADMIN-editable in E1.
- Settings (System Settings → Helpdesk): reopen window (days, default 7)
  and auto-close period (days quiet after Resolved, default 7).

### Behaviour
- **Employee:**
  - Raise a ticket (category, subject, first message, attachments), reply,
    and list or view **own** tickets only.
  - Reopen a Resolved ticket within the window.
  - Replying to a Resolved ticket reopens it; replying while it's
    Waiting-on-employee moves it back to Open.
  - Internal notes are excluded server-side from every employee-facing
    response. Another employee's ticket or attachment reads as 404.
- **HR** (`helpdesk.manage`):
  - A queue with status, category and assignee filters, including
    "assigned to me".
  - Assign, change status and priority, reply, and add internal notes.
  - Sensitive-category tickets need `helpdesk.sensitive.view` too; without
    it they're absent from the queue and 404 on direct access.
  - Opening a sensitive ticket is audit-logged.
- **Daily job:** closes Resolved tickets quiet for the auto-close period.
  It's idempotent, like the other jobs. *(As built: hourly — see below.)*
- **Real-time:** a reply or status change notifies the other side
  (persisted notification plus `notification.new`), and a signal-only
  `helpdesk.queue` refreshes HR queues.
- **Audit-logged:** assignment, status and priority changes, category
  create/edit (including the sensitive flag), and sensitive-ticket views.
- **Request Hub** (`GET /api/request-hub`): my leave requests, profile
  change requests and helpdesk tickets as one normalised list (type,
  title, status, submitted, last update, link), with type and status
  filters. Sources plug in through a registry seam so regularizations
  (Phase 3) and reimbursements (Phase 6) slot in later. Actions stay on
  each module's own screen.
- **Tasks inbox** (`GET /api/tasks/mine`): pending leave approvals in my
  scope, tickets assigned to me, and change requests I can approve, each
  with a link. It powers `/app/todo/tasks` and the admin Tasks app.

### Frontend
- **Employee:**
  - `/app/helpdesk`: my tickets, Raise ticket, and the ticket thread with
    attachments and the auto-close/reopen notices.
  - `/app/request-hub`.
  - `/app/todo/tasks`.
  - The Home page's Track card reads from the Request Hub.
- **Admin:**
  - Helpdesk queue plus thread view (assign, status, priority, internal
    notes).
  - The admin Tasks app (the same inbox).
  - Admin Tools → Helpdesk Categories (with the sensitive toggle), and a
    Helpdesk card in System Settings.
- Feedback is re-marked Phase 8.

### Tests
- Internal notes never reach the employee in any response.
- Ticket and attachment IDOR (another employee; HR without the
  permission).
- Sensitive categories hidden from HR_EXECUTIVE (queue and direct access),
  and the flag's effect when toggled.
- Every status transition, the reopen window, and the auto-close job
  (idempotent, and the notice date matches what the job does).
- **Attachment images stored with no EXIF/GPS**, plus type, size and magic
  checks.
- Notifications, audit entries.
- Request Hub union, scoping and filters; Tasks inbox contents per role.
- The permission matrix.

### Verification
Fresh migrate and seed on the scratch DB; both suites; lint and typecheck;
CI green on GitHub. Browser walkthrough with **two browsers**: an employee
raises a ticket and HR's queue updates live; HR replies and the employee's
thread updates live; an internal note never appears for the employee; the
auto-close notice is visible.

### As built (2026-10-01)
- **The auto-close job runs hourly at :05, not daily.** A daily run could
  close a ticket up to a day after the time the employee was shown, which
  undercuts decision 5. Hourly keeps it within the hour.
- **The admin helpdesk lives under Employee → Helpdesk**
  (`/admin/employee/helpdesk`, thread at `…/helpdesk/:id`). The plan didn't
  place it and UI_REFERENCE has no admin Helpdesk tile. The paths come
  from one shared helper in `shared/constants/helpdesk.ts`.
- **The Home Track card was leaking:** it listed pending leave with no
  employee filter, so managers and HR saw other people's. It now reads
  the self-scoped Request Hub.
- **Carried into E1:** `helpdesk.queue` goes to fixed role rooms. Once
  roles and permissions are editable, a custom role holding
  `helpdesk.manage` needs a permission-keyed room (or a per-holder emit)
  to get the live refresh.

## D2 — Letter templates and PDF generation

**[recorded: user, 2026-10-01]** A separate commit right after D:
- Email & letter templates (the `admin-tools/templates` placeholder) for
  offer, appointment, experience, relieving and address-proof letters
  (spec §7.2).
- PDF rendering with **headless Chromium**, which payslips also need in
  Phase 6.
- Generated letters are saved as `EmployeeDocument`s (category Letters),
  so they appear in the employee's Document Center.
- Chromium enlarges the backend image noticeably. Document the measured
  size in `docs/DEPLOYMENT.md` so it's expected at Phase 1.5.
- Detailed plan written up for approval before building.

**Status: plan APPROVED 2026-10-01**, with these answers:
1. **Letters only.** Making system emails (invite, reset…) editable is its
   own later commit. The menu item keeps the name "Email & Letter
   Templates", with an "emails: later" note on the screen.
2. **Offer letters** are generated against the employee record created at
   joining, with HR typing figures such as CTC at generation time. Phase 6
   revisits this to pull them from salary structures (spec §12, Phase 6).
3. **All five letters are visible to the employee by default**; HR can
   untick it per letter.
4. **Editor: TipTap** (MIT), because HR writes these.
5. **Addition: letters are legal documents.** They must be reproducible and
   must never be overwritten (below).

### Schema
- `LetterTemplate`: `code` (unique: `OFFER`, `APPOINTMENT`, `EXPERIENCE`,
  `RELIEVING`, `ADDRESS_PROOF`, plus HR-created ones), name, description,
  `isActive`, `visibleToEmployeeDefault` (true), and a pointer to its
  current version.
- `LetterTemplateVersion` (**append-only**): `templateId`, `version`
  (1, 2, 3…), sanitized `bodyHtml`, `extraFields` (the typed-in fields
  this version asks for at generation, e.g. `ctcAnnual`: label, type
  text|number|currency|date, required), `createdByUserId`, `createdAt`.
  Editing a template always creates a new version; old versions are never
  changed.
- `GeneratedLetter`, one row per issued letter, never replaced:
  - reference `LTR-000123` (a sequence);
  - employee and `templateVersionId`;
  - **`mergeValues`**: every value merged in, including typed extras and a
    letterhead snapshot;
  - **`generatedAt`** (the letter's date);
  - `generatedByUserId`;
  - status `QUEUED → GENERATED | FAILED`, with a failure reason;
  - `employeeDocumentId` (unique), `pdfSha256`, `rendererVersion`
    (Chromium version);
  - optional `reissueOfId` (the letter it reissues).
- **Database-level immutability** (Postgres triggers, so no code path,
  admin screen or later bug can quietly break it):
  - `letter_template_versions` rows can't be updated;
  - a `generated_letters` row's version, merge values, `generatedAt`,
    employee, reference and (once set) PDF hash and document link can't
    change. Only `QUEUED → GENERATED/FAILED` is allowed.
  - **`employee_documents.file_key`, file name, MIME type and size can't
    change after insert**, for every employee document. No code does this
    today; the trigger makes it impossible.
- Settings / letterhead:
  - the company's legal name, registered address and logo (the existing
    `Company` columns; no screen edits them today);
  - the signatory's name and designation (SystemSettings);
  - a new logo upload gets a new storage key and old logos are kept, so
    old letters stay reproducible.
- Permissions:
  - `letters.template.manage`: HR_ADMIN (and SUPER_ADMIN);
  - `letters.generate`: HR_ADMIN, HR_EXECUTIVE.

  Both are SUPER_ADMIN-editable in E1.

### Behaviour
- **Placeholders** come from a fixed catalog in `shared/` (like the
  directory field allowlist):
  - `employee.fullName` (as of the letter date), `employee.code`,
    `employee.designation`, `employee.department`, `employee.branch`,
    `employee.dateOfJoining`, `employee.lastWorkingDate` (from the
    separation; generation is refused with a clear message if there is
    none), `employee.currentAddress`;
  - `company.legalName`, `company.address`;
  - `letter.date`, `letter.reference`;
  - `signatory.name`, `signatory.designation`;
  - `extra.<key>` for the version's typed fields.

  Inserted from a toolbar menu. Saving a template refuses unknown or
  malformed placeholders (e.g. half of one bolded).
- **Safety:**
  - template HTML is sanitized on save (an allowlist of formatting tags
    and text alignment);
  - merge values are HTML-escaped, so typed text can't change the layout;
  - Chromium renders with **JavaScript disabled and every network request
    blocked**;
  - the letterhead logo and the font are embedded in the page, so the
    renderer needs nothing external.
- **One bundled font** (Noto Sans, OFL; it has the ₹ glyph), embedded
  rather than taken from the OS, so the output doesn't depend on which
  machine renders it.
- **Generating** (from the employee's Documents tab):
  1. choose the template, fill its typed fields, tick or untick
     "visible to employee";
  2. the API checks permission and data scope, resolves every merge value
     *now*, stores them, and queues a job;
  3. the worker renders the PDF, stores it, and creates the
     `EmployeeDocument` (category Letters);
  4. if visible, the employee is notified; HR's screen updates live
     (`letter.generated`).
- **Reissuing** creates a *new* letter and document (`reissueOfId` links
  them), so the earlier one stays exactly as issued. There is no "replace
  file" path anywhere.
- **Reproduce:** HR can re-render any issued letter from its stored version
  and merge values and `generatedAt`. The download reports whether it
  matches the stored PDF's hash. Byte-identical output is the goal: the
  bundled font, fixed PDF metadata (dates set to `generatedAt`) and a
  recorded renderer version. If a different Chromium version changes the
  bytes, the stored PDF remains the record of what was sent and the
  reproduction is reported as a re-render, not a match.
- **Preview** while editing: render the draft against a chosen employee,
  without storing anything.
- Letter documents' title and category can't be edited. Visibility and
  archive (both reversible and audited) still work.
- Audited: template create/version/activate, generation, reissue,
  reproduce, and letterhead/signatory changes.

### Frontend
- **Admin Tools → Email & Letter Templates** (replaces the placeholder):
  - the template list;
  - the editor: TipTap toolbar, a placeholder menu, the typed-fields
    editor, the default-visibility toggle and preview with an employee;
  - read-only version history.
- **Employee profile → Documents tab:** a "Generate letter" modal. Letter
  rows show the reference, template version and generated time, plus
  Reissue and Reproduce for HR.
- **System Settings → Letters card:** legal name, registered address, logo
  and signatory.
- Employee Document Center: letters appear under Letters (existing).

### Deployment
- The Docker image adds Alpine `chromium`, with the path given to
  `puppeteer-core` by env (`CHROMIUM_PATH`), plus a build-time check that
  Chromium starts. The measured size increase goes in `docs/DEPLOYMENT.md`.
- **Local dev:** Chromium is auto-detected from common install paths, or
  set with `CHROMIUM_PATH`; documented in GETTING_STARTED. Tests that
  render need it and fail with a clear message if it's missing (never
  silently skipped).
- **CI:** GitHub's runner image ships Google Chrome, so `CHROMIUM_PATH`
  points at it and PDF tests run for real.

### Tests
- The permission matrix and data scope (generate for an out-of-scope
  employee → 404).
- Placeholder validation (unknown, malformed); sanitization (scripts,
  event handlers and external images removed); escaping of typed values.
- A version bump on every edit, and old versions unchanged.
- **The triggers:** updating a template version, a generated letter's
  merge values, or an employee document's file key fails at the database.
- Generation stores the version, values and timestamp. The PDF contains
  the merged text (extracted). The name is as of the letter date, after a
  later name change.
- **Reissue keeps the original intact. Reproduce matches the hash.**
- Network requests from a template are blocked (an external image is
  never fetched).
- Visibility default and notification; failure path (missing last working
  day; renderer error → FAILED with a reason).
- Cleanup classification for the new tables.

### Verification
Fresh seed; suites, lint, typecheck; CI green (with Chrome); the Docker
image built and its size measured. Browser walkthrough: HR edits a
template (new version), previews, generates for an employee, and the
employee sees it live in Document Center; reissue and reproduce work.

## E — Role & permission system, three-level hierarchy, Workflow Delegates

**Status: plan APPROVED 2026-09-30.** It supersedes the earlier E scope, which
had only manager permissions. The user corrected the admin model (two admin
levels, see below), so E now covers role and permission management
generally, and the manager work is built on top of it. Split into
**E1 → E2 → E3**, each its own reviewed commit. Build order across the
phase: Docker fix → D → E1 → E2 → E3.

### Findings that shaped this plan (2026-09-30)

- **Role assignment does not exist anywhere in the product.** Add Employee
  always assigns plain `EMPLOYEE` (`employee/service.ts`), and no screen or
  endpoint assigns any other role. PROGRESS.md used to claim otherwise;
  corrected.
- Data scope is hardcoded by role code (`resolveDataScope`'s
  `ALL_SCOPE_ROLES` list in `lib/dataScope.ts`).
- Effective permissions are computed in two places
  (`middleware/authenticate.ts` and `lib/permissions.ts`), from role rows
  only. They're re-read from the DB on every request, so a change takes
  effect on the user's next request.

### The admin model (user, 2026-09-30)

- **SUPER_ADMIN** is the owner level. It is never restricted, and it alone
  decides what every other role may do, HR_ADMIN included. There will be
  **exactly two real SUPER_ADMIN accounts** (the owners; their names are
  deliberately not recorded in the repo). Only an existing SUPER_ADMIN can
  make another.
- **HR_ADMIN** does day-to-day HR. Its permissions are *configured* by
  SUPER_ADMIN, not fixed. SUPER_ADMIN can grant or revoke any permission for
  the HR_ADMIN role, or for individual HR_ADMIN users.

### E1 — Role & permission system

**Schema:**
- `UserPermissionOverride`: userId, permissionId, effect `GRANT | REVOKE`,
  required reason, createdByUserId, createdAt. Unique per
  (user, permission).
- `Role.dataScope` (`SELF | TEAM | ALL`) replaces the hardcoded list. The
  migration backfills today's mapping, so behaviour is unchanged on day
  one. SUPER_ADMIN's scope is fixed at ALL.
- `Role.isSystem`: the seven built-in roles can't be deleted. Creating new
  roles is out of scope.
- `role.manage` is retired. Role-definition changes are gated on holding
  the SUPER_ADMIN role itself (rule 2).

**Effective permissions:**
- One resolver (`lib/permissions.ts`) used by `authenticate`, the socket
  handshake and the photo route: union of role permissions, plus the
  user's GRANTs, minus the user's REVOKEs.
- **A SUPER_ADMIN holder always gets every key in `PERMISSION_KEYS`,
  computed in code and never read from rows.** No stored row, even one
  deleted directly in the database, can take anything away, and keys added
  by later commits are held automatically.

**Rules, enforced in the service layer, one test each (minimum):**
1. SUPER_ADMIN's permissions can't be edited or revoked by anyone,
   including SUPER_ADMIN: the role's definition is locked, and overrides
   targeting a SUPER_ADMIN holder are refused.
2. Only SUPER_ADMIN can change role definitions (permission set, data
   scope). `role.view` holders get a read-only view.
3. Nobody can grant a permission they don't hold. This applies to every
   grant path: role assignment, overrides and manager permissions.
4. **Meta-permissions** (those that confer power over other people's
   access, flagged in the catalog) can be granted only by SUPER_ADMIN, and
   never to the MANAGER role or to a MANAGER holder. So a manager can never
   grant permissions to anyone.
5. Per-user overrides:
   - SUPER_ADMIN may set them on anyone except a SUPER_ADMIN holder.
   - Anyone else only on MANAGER holders, and only with
     `manager.permissions.manage` (E2).
   - Never on yourself.
6. Role assignment (**new**):
   - SUPER_ADMIN assigns and removes any role, **including SUPER_ADMIN**;
     only an existing SUPER_ADMIN can create another.
   - Admin roles (HR_ADMIN, HR_EXECUTIVE, PAYROLL_ADMIN, APPROVER):
     SUPER_ADMIN only.
   - MANAGER: via Manager Management (E2).
7. **Lockout, with two SUPER_ADMINs in mind:** the **last remaining active**
   SUPER_ADMIN can't be deactivated, suspended, separated (including a
   scheduled separation completing), have the role removed, or lose the
   role any other way. While two or more are active, either may be removed,
   as long as one remains. **Both cases tested**, including the
   separation job refusing (and alerting) instead of locking the company
   out.
8. Every change (role permission sets, data scope, overrides, role
   assignments) is audit-logged with before and after.

**Also in E1:**
- **Permission catalog** in `shared/`: label, group and description per
  key, plus the meta flag. The screens group by area and never show raw
  keys.
- **Live effect:** `permissions.changed` to each affected user. The
  frontend refetches `/me`, so menus and buttons update without a reload.
- **Permission-keyed real-time rooms** (carried from D): signals that
  today go to fixed role rooms, like `helpdesk.queue` to
  `role:HR_ADMIN/HR_EXECUTIVE/SUPER_ADMIN`, must reach anyone whose
  *effective* permissions include the key (e.g. a `perm:helpdesk.manage`
  room joined from the resolved set, re-joined on `permissions.changed`).
  Otherwise a custom role holding `helpdesk.manage` gets correct data but
  no live refresh.
- **Screens** (these retire the Phase-1-deferred `admin-tools/users-roles`
  placeholder):
  - **Admin Tools → Roles & Permissions:** a grid per role, grouped by
    area, with a data-scope selector. The SUPER_ADMIN column is locked
    ("All permissions — can't be changed"). Editable only by SUPER_ADMIN,
    read-only for `role.view`.
  - **Employee profile → Access tab:** roles (assign/remove per rule 6),
    then every effective permission marked **Inherited from <role>** /
    **Granted to this person** / **Revoked for this person**, with
    override toggles that require a reason.
- **Real SUPER_ADMIN bootstrap** (user requirement): the seed stays fake
  (seeded accounts unchanged; no real names or details ever in the repo).
  A one-time CLI, `npm run admin:bootstrap --prefix backend`, creates the
  first real SUPER_ADMIN on staging or production:
  - All details are supplied at runtime (interactive prompts or env vars
    for the invocation), never hardcoded.
  - It refuses to run if an active SUPER_ADMIN already exists (further ones
    are created in-app by an existing SUPER_ADMIN, per rule 6).
  - Audit-logged, and it issues the normal set-password invitation so no
    password ever passes through the CLI.
  - Documented in GETTING_STARTED.md. The two real accounts are created
    during Phase 1.5 staging setup.
- **Recovery procedure** in GETTING_STARTED.md (user requirement, needed
  before go-live), covering a SUPER_ADMIN who has lost their password or
  2FA device:
  1. The other SUPER_ADMIN resets it in-app. The 2FA reset endpoint exists
     since Phase 1; the Access tab gets the button.
  2. Forgot-password covers a lost password with 2FA intact.
  3. If no SUPER_ADMIN can sign in, a documented break-glass CLI run with
     database access (`admin:recover`) resets 2FA and/or issues a fresh
     set-password link for a named SUPER_ADMIN, audit-logged.
  4. The equivalent direct SQL is written down as a last resort, with
     SSM port-forwarding per spec §15.7.

**Tests:** every rule above, including SUPER_ADMIN keeping every permission
after its role rows are deleted directly; last-SUPER_ADMIN protection
across deactivate, role removal, separation and the scheduled separation
job; override resolution order; override IDOR; audit rows;
`permissions.changed`; the bootstrap CLI (refuses when a SUPER_ADMIN
exists, never takes a password); the recovery CLI.

### E2 — Three-level hierarchy on top of E1

- **Structure:** strictly three flat levels: Admin (SUPER_ADMIN) → Managers
  (report directly to Admin) → Employees (report to a Manager). Managers
  never report to managers. HR_ADMIN reports to Admin and never manages a
  team (as the commit C seed assertion already models).
- **New permissions:** `manager.appoint`, `manager.team.assign` and
  `manager.permissions.manage` (meta). **HR_ADMIN holds all three by
  default** (user decision); SUPER_ADMIN can revoke them.
- **Manager Management** (Admin Tools):
  - Every manager with team size, department and branch.
  - Promote an employee to manager (assigns `MANAGER`).
  - Demote, which requires reassigning the whole team first.
  - Open a manager to add or remove team members. Every move writes an
    effective-dated `EmployeeJobHistory` row, never an in-place overwrite.
    All audit-logged.
  - A **Permissions** tab reusing E1's Access view: the default is the
    MANAGER role (edited only by SUPER_ADMIN), and per-manager differences
    are E1 overrides.
  - An **Unassigned employees** list.
- **Validation** in the service layer and the Excel import, reusing
  `lib/reportingHierarchy.ts`: a reporting manager must hold MANAGER, and a
  manager's own reporting manager can only be Admin.
- **Enforcement:** an audit of every manager-reachable endpoint for both
  checks (permission and team scope), with IDOR tests for acting outside
  your own team while holding the permission.
- The recursive team-scope query stays, with a note in code and spec that
  exactly three levels are supported. Spec §2 is rewritten for the
  two-level admin model, the three-level structure, overrides and the
  lockout rules.
- **Answered questions:**
  - An employee with no manager is **allowed at creation** and surfaced in
    the Unassigned list, plus a count on the admin dashboard.
  - A manager's own leave is **approved by Admin**: managers report to
    SUPER_ADMIN, so it lands in their Review queue, and HR_ADMIN can
    approve via Employee Leave if it holds `leave.approve`.
  - HR_ADMIN's own leave goes to SUPER_ADMIN.
  - Self-approval stays blocked.

### E3 — Workflow Delegates

**[reconstructed]** (spec §6): a manager delegates their approvals to
someone for a date range while away. Covers `/app/workflow-delegates` and
`/admin/admin-tools/delegates`. Plan written up for review before building.

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
| `/app/my-worklife/feedback` (Feedback) | **Settled: Phase 8** (performance reviews); placeholder kept |
| `/app/todo/tasks` and admin app `tasks` (Tasks) | **Settled: D** (inbox of things waiting on me) |
| Admin app `workflow` (Workflow) and `admin-tools/workflows` (Approval Workflows, multi-level chains, spec §7.8) | E3, alongside delegates (confirm when E3 is planned) |
| `admin-tools/templates` (Email & Letter Templates) | **Settled: its own commit right after D** (headless Chromium; letters saved to Document Center) |
| `admin-tools/users-roles` (Users & Roles) | **Settled: E1** (Roles & Permissions). |
