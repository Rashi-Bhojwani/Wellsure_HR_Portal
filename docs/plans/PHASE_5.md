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
| D2 | Letter templates + PDF generation (headless Chromium), letters saved to Document Center **[recorded: user, 2026-10-01]** | ✅ Built 2026-10-01; see "As built" under §D2. |
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

### As built (2026-10-01)
- As planned. The measured image size is in `docs/DEPLOYMENT.md`
  (379 → 804 MB).
- **Added: the worker's live events.** Background jobs couldn't push
  Socket.IO events at all (only the api process had a server). The worker
  now publishes through a Redis emitter, which fixes "letter ready", D's
  auto-close and B's auto-posts too.
- **Reproduce is byte-identical per Chromium version** (verified). Across
  an upgrade it's an honest re-render, and the stored PDF stays the record.
- `npm run dev` starts the worker (letters render there).

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

### E1 as built (2026-10-02)

Built to the plan above. Additions and corrections:

- **Correction to recovery step 1:** the plan said a 2FA reset endpoint
  "exists since Phase 1". It didn't. E1 adds three admin security actions
  (`modules/auth/service.ts`): `adminResetTotp` (also signs the person out
  everywhere), `adminUnlock` and `adminIssuePasswordReset` (1-hour link).
  The Access tab and the break-glass CLI both use them.
  - On the Access tab, a Super Admin's sign-in can be reset only by
    *another* Super Admin.
  - HR holding `user.security.manage` can reset only non-Super-Admins.
  - Nobody can reset themselves.
- **Finding: production would have had no roles at all.** Staging and
  production are never seeded, so not even SUPER_ADMIN would exist for the
  bootstrap to assign. The fix is `lib/accessCatalog.ts`
  (`ensureAccessCatalog`), which creates any missing Permission rows and
  any missing system roles from their default definitions. It is additive
  only and never edits an existing role. It runs in:
  - the `migrate` mode, on every deploy;
  - `npm run db:migrate`;
  - the seed;
  - the bootstrap.

  The default definitions moved from the seed to `lib/systemRoles.ts`.
- **Two layers protect the last active Super Admin:**
  - service checks (`lib/superAdminGuard.ts`) give a clear 409
    `LAST_SUPER_ADMIN`;
  - Postgres triggers on `users` and `user_roles` refuse any path at all,
    including direct SQL. `errorHandler` maps their error to the same 409.
  - Separation initiation doesn't count a Super Admin who is already
    leaving, so two Super Admins can't separate each other.
  - The daily separation job skips the last one instead of completing. It
    writes `employee.separation.blocked_last_super_admin` and sends them an
    `access.alert` notification every day until another Super Admin is
    appointed.
- **Data scope** now comes from `Role.dataScope`, widest across a person's
  roles. `lib/dataScope.ts` no longer hardcodes a role list.
  `req.user.dataScope` is resolved once in `authenticate`.
- **Permission rooms:** each socket joins `perm:<key>` for every key it
  effectively holds. `permissions.changed` moves a connected user's
  sockets between rooms server-side (`socketsJoin`/`socketsLeave`), then
  their browser refetches `/me`. Room changes:
  - `helpdesk.queue` now goes to `perm:helpdesk.manage`;
  - `tasks.counts` goes to `perm:leave.approve` + `perm:leave.view` +
    `manager:<id>`.
- **Bootstrap details:**
  - It attaches to an existing employee, or creates a minimal one (identity
    and contact; addresses and emergency contact read "To be updated in the
    portal"; no job placement, since a fresh database has no departments).
    "Change job details" on the profile now creates the *first* placement
    when there is none.
  - Running it again with the same employee code re-sends an expired
    invitation.
  - While an invitation is pending, it refuses anyone else.
  - `--print-link` covers environments where email can't be relied on yet.
- **Recovery CLI scope:** Super Admin targets only. It can only reset,
  unlock or re-issue, never set a password or grant a role. Audit entries
  have no actor and carry the reason prefixed `[break-glass CLI]`.
- The `admin-tools/users-roles` placeholder is now **Roles & Permissions**
  (the path is kept). The Access tab shows to Super Admins and to holders
  of `role.view` or `user.security.manage`.

### E1.1 — Making break-glass recovery loud (APPROVED 2026-10-02)

**User decisions (2026-10-02):**
- Approved as proposed; built before E2.
- **The audit log being editable is the most important part.** The spec has
  claimed append-only since Phase 1 and it never was. Enforce it at the
  database level, with the test-only exception.
- **Write the shell-operator limit into the spec plainly**, so nobody
  mistakes this for a guarantee. The real control is records outside the
  database, so the CloudWatch line matters more than the audit row.
  **Phase 1.5 must wire it up and alarm on it.**
- **The manager dashboards leak is a live bug, fixed in E1.1** (moved here
  from E2). Survey and report anything else that leaks company-wide data
  to a manager today.

The user's requirement (2026-10-02): `admin:recover` must keep working when
everything else is broken, but **nobody may use it without the other Super
Admin finding out.**

**How E1 actually stands** (checked in the code, not assumed):

| Question | E1 today |
|---|---|
| Logged somewhere that survives? | **Partly.** One `audit_logs` row per action, with no actor. But `audit_logs` is append-only only by convention: spec §9 says append-only, and nothing in the database enforces it. Anyone with the database access the CLI needs can delete the row afterwards. Nothing is written outside the database. |
| Alerts the other Super Admin by email? | **No.** Only the password-reset link email goes, and that goes to the *target*. |
| Refuses unless the in-app routes are unavailable? | **No, that's convention only.** The CLI never checks. |
| Reason mandatory and recorded? | **Mandatory, yes** (≥3 characters). **Recorded: only for reset-2FA and password-reset.** `--unlock` drops the reason (`adminUnlock` never stores it), a gap. |

**A hard limit to be honest about:** whoever can run this CLI has a shell in
a backend container and the database credentials. They can bypass the CLI
completely, with SQL or modified code. So the CLI being loud protects the
honest path and catches the casual one. The real backstop has to be records
that *the app's own database access can't erase*. The proposal therefore
works on both layers.

**Proposed changes:**

1. **Alert before acting, to everyone who must know.** Before changing
   anything, the CLI:
   - emails **every active Super Admin, the target included**, at their
     personal email: what was done, to whom, the reason, when, and from
     where (container hostname, ECS task id when present, operator name);
   - emails a `SECURITY_ALERT_EMAIL` address when one is configured (new,
     optional env var, e.g. an owners' shared inbox outside this system).

   If the mail send fails, the CLI **stops** unless `--mail-is-down` is
   passed. With that flag it proceeds, queues the alert to retry until mail
   works, and still does steps 2–4.
2. **A persistent in-app alarm.** A new append-only `security_events`
   table. Each row raises:
   - a red banner on the Admin home for every Super Admin, which stays
     until a Super Admin **other than the target** acknowledges it
     (acknowledgement recorded);
   - an `access.alert` notification.
3. **A copy outside the database.** A structured `security.breakglass`
   log line (no secrets) goes to stdout, which is CloudWatch Logs in AWS.
   For Phase 1.5 infra:
   - a CloudWatch metric filter and alarm emailing the owners through SNS;
   - ECS Exec session logging to CloudWatch/S3, plus CloudTrail. These
     record *which AWS identity* opened the shell, which the CLI itself
     can't know.
4. **`audit_logs` made actually append-only.** A trigger refuses UPDATE and
   DELETE. Test cleanup needs to delete fixture rows, so the trigger lets
   through only a session that sets `app.audit_purge = 'test'`, and only
   when the database name ends in `_test` or `_devcheck`. (The trigger
   reads `current_database()`, so production can't use the escape hatch.)
   Phase 1.5 adds the stronger layer: the app's database role has no
   UPDATE/DELETE grant on `audit_logs` at all, and only the migrate role
   owns the table.
5. **"Only when the in-app routes fail" stays a judgement, not a check,
   but it becomes explicit and recorded.** The CLI can't verify that the
   other Super Admin is unreachable, and a hard block would break the
   both-locked-out case. Instead, it:
   - lists the other active Super Admins and when each last signed in;
   - requires `--confirm-no-other-admin "<why the in-app route can't be
     used>"`.

   That text goes into the audit row, the security event and the alert
   email.
6. **Reason on every action.** Required for unlock too (fixing the gap),
   minimum 10 characters, stored in the audit row of each action.
   `--operator "<name>"` is required. It's self-declared, so the CloudTrail
   identity from step 3 is what's authoritative.
7. **The in-app path is loud too.** When one Super Admin resets another's
   2FA, unlocks them or sends them a reset link from the Access tab, the
   target gets an email naming who did it.
   - Recovery step 1 legitimately happens in the app, but a compromised
     Super Admin account must not be able to silently take over the other.
   - The same email goes to any user whose sign-in security is changed by
     an admin.
8. **`admin:bootstrap`** writes the same security event and log line, and
   emails `SECURITY_ALERT_EMAIL` when set. No other Super Admin exists to
   tell yet.
9. **The direct-SQL last resort** (GETTING_STARTED §12, step 4) can't be
   made loud from inside the app. The doc will say so, and point to the
   Phase 1.5 RDS log export / pgaudit on the `users` and `audit_logs`
   tables as its trail.

**Tests:**
- the alert reaches every active Super Admin and the security address;
- the CLI stops when mail fails, and `--mail-is-down` queues the alert;
- the security event and banner appear, and acknowledgement by the target
  is refused;
- the audit trigger refuses update and delete, and the purge escape hatch
  is refused on a database without the dev/test suffix;
- reason and operator are recorded for every action, unlock included;
- the in-app reset emails the target.

Built as a small commit of its own, **before E2**, if approved.

### E1.1 as built (2026-10-02)

Built as approved. Differences and additions:

- **The test exception's marker is a table, not a database setting.** The
  plan said "the database name ends in `_test`/`_devcheck`". But CI and
  local dev both use `wellsure_hr`, which production could also be called,
  so the name can't tell them apart. A database-level setting
  (`ALTER DATABASE … SET`) needs superuser on Postgres 16. So the marker is
  a one-row `dev_database_marker` table that only the dev seed fills.
  - The triggers allow a DELETE only with `app.audit_purge = 'test'` **and**
    that row present.
  - UPDATE and TRUNCATE are never allowed.
  - Someone who can insert the marker can also drop a trigger, so this
    adds no new hole (spec §9's honest limit).
- **`audit_logs.actor_user_id` is no longer a foreign key.** It was
  `ON DELETE SET NULL`, an UPDATE the trigger now refuses. The audit
  viewer resolves actor names itself.
- **The in-app unlock now also asks for a reason** (it had none), for
  consistency with "a reason on every action".
- **Security banner** sits on every admin page for Super Admins, not only
  the Admin home. It refreshes live on the `security.event` signal
  (`role:SUPER_ADMIN` room).

**The manager-leak survey, as asked.** These reached a manager
(`employee.view`, `leave.view`, `leave.approve`, `leave.apply.onBehalf`,
TEAM scope) company-wide. All four are fixed and tested:

1. `GET /api/admin/dashboard`: headcount by branch, city and department,
   age, gender, joiners and leavers. It is now computed over the viewer's
   scope; leavers count if their last placement reported into the team.
   Each scope is cached under its own key.
2. `GET /api/leave/dashboard`: leave days by month and type, and
   Restricted Holiday takers, now scoped the same way. Both dashboards
   show "Showing your team only".
3. `GET /api/leave/calendar`: any `leave.view` holder could widen "who's
   on leave" to any department, branch or the whole company. Widening is
   now for ALL scope only. A manager gets their own department plus their
   team.
   - **Also fixed:** a non-HR viewer with no job placement had no
     department filter at all, so they saw the whole company.
4. `GET /api/people/photos/:id/:size` for a **former** employee:
   `employee.view` alone was enough. Now the person must also be within
   the viewer's scope.

**Checked and not leaking:**
- the employee grid, export, profile, reveal and history (all
  scope-filtered);
- leave requests, balances and comp-off (scope-checked);
- the tasks inbox (company-wide "monitor" counts for ALL scope only);
- helpdesk, letters, documents and separations (managers don't hold the
  keys, or the endpoints are scoped).

**Company-wide for every employee by design, not a manager leak:**
- the People directory and org chart (field visibility is configurable);
- Engage employee search;
- holidays;
- announcements and company documents (audience-targeted).

### E2 — Three-level hierarchy and Manager Management (PLAN v2, APPROVED 2026-10-02)

**User decisions (2026-10-02):**
- **Hierarchy model A** (synthetic Admin root; managers and HR Admins have
  no reporting manager).
- **The manager-grantable list is enforced even against a Super Admin.**
  "This is the one place I want the system to overrule me." It is widened
  only by a deliberate code change. The proposed list is right, and bank
  and statutory data staying off it is non-negotiable.
- The dashboards fix moved to E1.1.
- The future-dated job change is a **real correctness bug**, recorded in
  PROGRESS.md's open issues. The general fix is needed before Phase 6.
  Refusing future dates on team moves is the E2 stopgap.

Carried over from the approved outline (2026-09-30):
- three flat levels;
- `manager.appoint`, `manager.team.assign` and `manager.permissions.manage`
  (meta), held by HR_ADMIN by default and revocable by SUPER_ADMIN;
- unassigned employees allowed and listed;
- a manager's own leave is approved by Admin, HR_ADMIN's by SUPER_ADMIN;
- no self-approval.

Below is what's new or decided now.

#### The hierarchy model (open since commit C) — recommendation

Two options for where managers hang:

**A. Managers have no `reportingManagerId`. A synthetic "Admin" root sits
above them.**
- Pro: the two owners are symmetric. Neither is arbitrarily "the" boss of
  every manager.
- Pro: when a Super Admin changes or leaves, no manager has to be moved.
  With B, every manager's job history needs a new row, and that interacts
  with the last-Super-Admin lock.
- Pro: a manager's leave reaches **both** Super Admins (and HR_ADMIN via
  Employee Leave), not one person's queue. Under B it stalls if that one
  Super Admin is away, until E3 delegates exist.
- Pro: "who is at manager level" is answered by the role, the single
  source of truth, rather than by a pointer that can drift.
- Con: a special case in three places:
  - **Leave routing:** a request from someone with no reporting manager
    goes to Admin rather than to `manager:<id>`. This needs a new
    `admins` socket room for SUPER_ADMIN holders. Approval itself needs no
    change: Super Admins already see every pending request through ALL
    scope + `leave.approve`.
  - **The org chart root.**
  - **The Unassigned rule:** a null manager is normal for MANAGER and
    HR_ADMIN, and a problem for anyone else.
- Con: job history no longer records "reports to Admin". That carries no
  information anyway, since every manager does.
- Con: the seed and any existing data need one effective-dated row per
  manager (and HR_ADMIN) clearing the pointer. Only devcheck data exists
  today; production has none.

**B. Managers keep a `reportingManagerId` that must point to a SUPER_ADMIN
holder.**
- Pro: no special cases. Leave routing, the recursive team query and the
  chart all work as they do today. It's the smaller change: the seed is
  already shaped this way.
- Con: the arbitrary choice between two owners, and the mass reassignment
  on any Super Admin change.
- Con: a manager's leave lands with one person.
- Con: a second rule to keep in sync: "points to a SUPER_ADMIN" must be
  re-validated whenever someone loses that role. The last-Super-Admin
  triggers protect *having* one, not *which* one managers point to.

**Recommendation: A.** The deciding factors are the two owners and owner
turnover. B is cheaper by about a day, but it bakes a single point of
approval and a maintenance chore into the structure.

The rules under A, enforced in the service layer, the Excel import and the
seed assertion (`lib/reportingHierarchy.ts`, rewritten):

| Holder | Reporting manager |
|---|---|
| SUPER_ADMIN | none (they *are* the Admin root) |
| MANAGER | none; sits under the Admin root; may not also be HR_ADMIN |
| HR_ADMIN | none; sits under the Admin root; never has a team |
| everyone else (incl. HR_EXECUTIVE, PAYROLL_ADMIN, APPROVER) | must be an active MANAGER holder, or none, which puts them in **Unassigned** |

A reporting manager must always hold MANAGER: never an Admin, never a plain
employee.

#### Manager Management (Admin Tools, replaces the placeholder)

- **List:** every manager with team size, department, branch, and a "0
  reports" state.
- **Appoint** (`manager.appoint`):
  - assigns MANAGER;
  - clears their own reporting line with an effective-dated job row;
  - refused for SUPER_ADMIN and HR_ADMIN holders.
- **Remove a manager** (`manager.appoint`):
  - refused while the team isn't empty ("reassign the N team members
    first", with a link);
  - the dialog requires choosing **their** new manager (effective-dated),
    since they become a plain employee;
  - removes MANAGER.
- **Team** (`manager.team.assign`):
  - add or remove members, singly or in bulk from the Unassigned list;
  - every move is a new `EmployeeJobHistory` row (copying department,
    designation, branch and so on), never an in-place edit;
  - the effective date defaults to today and **may not be in the future**
    (see the finding below);
  - all audited with before and after;
  - realtime `team.changed` goes to the old and new managers;
  - pending leave follows the employee automatically. Approval is resolved
    from the *current* team at decision time; tested.
- **Permissions tab:** E1's Access view for that manager. The default comes
  from the MANAGER role (edited only by SUPER_ADMIN). Per-manager
  differences are E1 overrides. Non-Super-Admins need
  `manager.permissions.manage`, and rules 3 and 4 still apply.
- **Unassigned employees:** active people who need a manager but have none,
  whose manager is inactive or no longer holds MANAGER, or who have no job
  placement at all. It shows a count on the Admin dashboard.
- **Separating a manager who still has a team** is allowed. When it
  completes, the team shows up in Unassigned, and holders of
  `manager.team.assign` get a notification.

#### Which permissions a manager may ever hold — a new guard (recommendation)

A finding from planning: overrides let a SUPER_ADMIN or HR_ADMIN grant a
manager **any** key they hold, but most endpoints were written for ALL-scope
roles and **don't apply data scope**. For example, `employee.edit`'s job
update takes any employee id. A manager granted `employee.edit` today could
edit people outside their team.

Recommendation:
- a `managerGrantable` flag in the permission catalog, initially:
  - `employee.view`
  - `leave.view`
  - `leave.approve`
  - `leave.apply.onBehalf`
  - `employee.documents.view`
  - `letters.generate`

  These are the keys whose endpoints already apply data scope.
  `helpdesk.manage` is deliberately excluded: the helpdesk queue isn't
  team-scoped, so a manager holding it would see every ticket.
- **No one, Super Admin included, can give a MANAGER holder a key outside
  that list**, whether through the MANAGER role or an override. Every key
  on the list gets a TEAM-scope check and an IDOR test at every endpoint
  (the audit below).
- Sensitive-data keys (`employee.bank.*`, `employee.statutory.*`, later
  salary) are **not** on the list, which keeps spec §2's "only
  HR_ADMIN/PAYROLL_ADMIN/SUPER_ADMIN see salary or bank data". Widening
  the list later is a code change with its own scope tests, never a
  checkbox.

#### Endpoint audit (manager reach)

- A **route-inventory guard test**, like the cleanup guard. It walks the
  Express router and fails on any route not classified as one of:
  - `public`;
  - `self` (the caller's own data);
  - `scoped` (permission + data scope);
  - `org-wide`, with a stated reason;
  - `admin-only` (a key that can't be manager-grantable).

  New routes can't slip through unclassified.
- For every `scoped` route reachable with a manager-grantable key, an IDOR
  test: a manager holding the key, acting on someone **outside** their
  team, gets 404 (the existing convention), and on their own team member
  succeeds.
- **Finding to fix in E2:** two dashboards are `org-wide` today and
  reachable by every manager:
  - `GET /api/admin/dashboard` (gated on `employee.view`);
  - `GET /api/leave/dashboard` (gated on `leave.view`).

  Managers currently see company-wide aggregates there: headcount,
  leave-day totals by month and type. Proposal: TEAM-scoped viewers get
  the same widgets computed over their team only.
- **Finding, noted, not fixed in E2:** a *future-dated* job change
  (`updateJob` accepts any date) becomes the "current" row
  (`effective_to IS NULL`) immediately, so scope queries act on it early.
  E2 avoids this for team moves by refusing future dates. A general fix
  (scope queries reading `effective_from <= today`) is listed for a later
  commit.

#### Org chart

- The root is a synthetic **Admin** card naming the Super Admins. Under it
  sit the managers and HR Admins.
- Each node gets a `kind`: `admin`, `manager`, `adminStaff` or `employee`.
  - **A manager always carries a "Manager" badge with a team count, "0" (or
    "No team yet") included.**
  - An HR Admin carries an "HR Admin" badge and no count.
  - A plain employee has neither.

  So Rohan Mehta (HR Admin, no team) can no longer be mistaken for a
  manager with an empty team, or for an employee.
- An "Unassigned" group at the bottom is visible only to holders of
  `manager.team.assign`. (Today the chart computes `unassignedIds` but
  never shows them.)

#### Seed

- Managers and 1001 get their reporting line cleared, via effective-dated
  rows.
- Seed one manager with zero reports (a new fake account) and one
  unassigned employee, so both states are visible.
- The seed assertion uses the new rules.

#### Spec

§2 is rewritten for:
- the admin model;
- the three levels under model A;
- manager-grantable keys;
- overrides;
- the lockout rules.

#### Tests

- every hierarchy rule, through the service, the import and the seed
  assertion;
- appoint and remove, including removal refused while the team isn't
  empty;
- a team move writes an effective-dated row and refuses a future date;
- pending leave follows a moved employee;
- a manager's leave reaches both Super Admins;
- the Unassigned list;
- the manager-grantable guard (the role and override paths, the Super
  Admin included);
- the route-inventory guard;
- IDOR per scoped route;
- the dashboards narrowed to the team;
- the org-chart `kind`;
- realtime `team.changed`.

#### Verification

As usual:
- a fresh devcheck seed, the full suites, lint and typecheck;
- a two-browser walkthrough: HR moves an employee and the old and new
  managers' screens update live, and a manager sees only their team
  everywhere;
- docs updated, CI green, `main` fast-forwarded.

### E2 as built (2026-10-02)

Built as approved. Differences and additions:

- **No new `admins` socket room.** A leave request from someone with no
  reporting manager (a manager, an HR Admin) notifies every active Super
  Admin (never the applicant) through the existing `role:SUPER_ADMIN`
  room. HR_ADMIN still sees it in Employee Leave.
- **The grantable list is enforced in three places,** not only on writes:
  - **the MANAGER role:** in Roles & Permissions, non-grantable boxes are
    disabled with a tooltip and ALL scope isn't offered. The API refuses
    both (403 `NOT_MANAGER_GRANTABLE`) even for a Super Admin.
  - **overrides:** a GRANT of a non-grantable key to a MANAGER holder is
    refused. The Access tab marks those keys "Not for managers".
  - **resolution:** `resolveAccess` intersects a MANAGER holder's keys
    with the grantable list and caps ALL scope at TEAM. So a stale row, a
    raw SQL grant or an old role combination still can't widen a manager.
- **Role combinations:** MANAGER can be combined only with EMPLOYEE. That
  covers "may not also be HR_ADMIN", and also excludes HR_EXECUTIVE,
  PAYROLL_ADMIN and APPROVER, whose keys the cap would silently strip.
  Assigning SUPER_ADMIN or HR_ADMIN clears the person's reporting line
  (an effective-dated row), because those are top-level roles.
- **The Access tab and Manager Management.**
  - Assigning MANAGER in the Access tab runs the same appointment as
    Manager Management.
  - Removing MANAGER there is refused (409 `USE_MANAGER_MANAGEMENT`),
    because removal needs an empty team and a new manager for the person.
  - Holders of `manager.permissions.manage` can edit a manager's
    overrides from the Permissions drawer, which reuses E1's Access view.
- **Every reporting-manager picker lists managers only:** Add Employee,
  Change job details (which gained a Reporting manager field) and the
  Unassigned bulk assign. They are fed by
  `GET /api/managers/options`, gated on
  `employee.create`/`employee.edit`/`manager.appoint`/`manager.team.assign`.
  `updateJob` applies the same hierarchy rules and the same
  no-future-date stopgap when the reporting manager changes.
- **Unassigned shows a reason:** "No reporting manager", "Manager is
  inactive", "Manager no longer holds Manager" or "No job placement".
  The count shows as a warning on the Admin home (Welcome tab) for
  holders of `manager.team.assign`.
- **The route-inventory guard needed two small refactors:**
  - `app.ts` mounts routers from an exported `API_MOUNTS` list, so the
    test sees exactly what the app serves;
  - `requirePermission`/`requireAnyPermission` tag their middleware with
    the keys they check (`tagGate`), so the test compares each
    classification with the route's real gate.

  The classes are `public`, `self`, `everyone` (the plan's "org-wide",
  with a reason), `scoped` and `admin`. A route gated only in the service
  (Super-Admin-only) must say so. Every route reachable with a grantable
  key is either `scoped` with an IDOR case in `managerReach.test.ts`, or
  `everyone` with a reason. 26 routes are manager-reachable and scoped,
  and each has a case.
- **Realtime `team.changed`** goes to the old and new managers
  (`user:<id>`) and to `perm:manager.team.assign`. Screens invalidate
  employees, the org chart, tasks, leave, managers and the admin
  dashboard. In the walkthrough, a manager's All Employees grid showed the
  new member without a reload.
- **The dashboards fix** shipped in E1.1, as recorded there.
- **Seed:**
  - managers 1002–1005 and 1024, and HR Admin 1001, have no reporting
    manager;
  - **1029 Farhan Qureshi** is a manager with no team;
  - **1030 Leela Menon** is an unassigned employee.

  The assertion checks every active placement under the new rules.

### E3 — Workflow Delegates (requirements 2026-10-02; built, pending review)

**User requirements (2026-10-02):**
- A manager delegates their approvals to someone for a date range while
  away.
- **The delegate must already hold the approval permission.** Delegation
  redirects *whose team* their scope resolves against. It never grants a
  permission.
- **The audit log records the real actor and who they acted on behalf
  of.**
- Overlapping active delegations from the same delegator are rejected.
- The self-approval block still holds.
- **Screens:** a manager sets up and revokes their own delegations; HR
  sees and manages anyone's.
- Settle whether a Super Admin can delegate, and to whom. The
  recommendation is below.

#### Can a Super Admin delegate? Recommendation: no — and nothing needs to

Under model A, a Super Admin's approval work is the Admin queue: leave
from managers and HR Admins, who report to no one. That queue already has
three layers of cover with no delegation at all:
1. **Both Super Admins** are notified of every such request, and either
   can decide it. One being away is the normal case the two-owner design
   handles.
2. **HR_ADMIN** holds `leave.approve` with ALL scope, so they can decide
   any manager's leave.
3. That leaves one gap: **HR_ADMIN's own leave** (self-approval blocked)
   while **both** Super Admins are away. It simply waits. Leave can be
   approved after the fact, so nothing is lost.

What delegation *would* mean for a Super Admin, and why each version is
worse:
- **To a manager:** that manager would approve their peers' leave. That
  is a peer-approval hole, and it reaches past the manager-grantable cap
  (spec §2.2) through the back door.
- **To an HR Admin:** pointless, because they already have ALL scope.
  Except for their own leave, which self-approval forbids anyway.
- **To the other Super Admin:** pointless, because they already see
  everything.
- Mechanically, a Super Admin's scope is ALL. "Resolve their team against
  someone else's" has no meaning for ALL scope.

So **only `MANAGER` holders can be delegators.** A Super Admin or HR Admin
trying to set one up gets an explanation instead: "Super Admins already
cover each other; HR Admins can approve any manager's leave." If the gap
in point 3 ever matters in practice, the fix is a second HR Admin or a
third Super Admin. It isn't delegation.

#### Rules

| Rule | Detail |
|---|---|
| Who can delegate | Active `MANAGER` holders. Not Super Admins or HR Admins, as above. HR (`delegation.manage`) can also set one up *for* a manager, e.g. one who fell ill before doing it themselves. |
| Who can be the delegate | Any other active user who **currently** holds `leave.approve` (role or override): another manager, an HR Admin, a Super Admin. Checked at creation, and again on every use, because the approval endpoints are gated on `leave.approve` itself. A delegate who later loses it simply can't act; the screens flag it. Never the delegator. |
| What it covers | **Leave approvals:** the review queue (list), a request's detail, approve, reject, bulk approve, the requester's balances (shown in Review), and the Tasks inbox. *Not* employee profiles, documents, dashboards, the calendar, applying on behalf, or cancelling approved leave. Delegation is about deciding pending approvals, not taking over the team. Regularization approvals (Phase 3) join the same mechanism when they exist. |
| How it works | For a delegate, TEAM scope in those flows resolves against **their own team plus the current team of each manager with an active delegation to them**. Their permissions are unchanged. Not transitive: if B covers A and C covers B, C gets B's team, never A's. |
| The delegator keeps access | Delegation adds a second approver; it doesn't take the delegator's away. Whoever decides first wins, as with two Super Admins. |
| Dates | Inclusive calendar dates (Asia/Kolkata). The start may not be in the past; the end may not be before the start. "Active" means today is in range and it isn't revoked. Future ones show as *Scheduled*. |
| Overlap | A delegator may not have two non-revoked delegations whose ranges overlap, to anyone. Checked under a per-delegator advisory lock, so two simultaneous requests can't both pass. |
| Revoke | Active or scheduled ones can be revoked early, by the delegator, or by HR on anyone's. An ended one can't. Nothing is ever deleted; revocation records who, when, and an optional reason. No editing: revoke and create a new one. |
| Self-approval | Unchanged. Nobody decides their own request, including a delegate who is a member of the delegator's team. The delegator's own leave isn't in their own team, so a delegate never reaches it either. |
| Audit | Creating and revoking are audited. Every decision reached *through* a delegation records `onBehalfOfUserId` (the delegator) next to the real actor: a new `audit_logs.on_behalf_of_user_id` column, plus `leave_requests.decided_on_behalf_of_user_id`. The Audit Log viewer shows "B on behalf of A". |
| Notifications | While a delegation is active: a new request from the team notifies the delegate too ("covering for A"). A decision made on someone's behalf sends the delegator an FYI. Creating or revoking one notifies the delegate. |
| Realtime | `delegation.changed` goes to the delegator, the delegate and holders of `delegation.manage`. Screens refresh delegations, the leave review queue and Tasks. `leave.applied` also reaches active delegates. |

**New permission:** `delegation.manage`, held by HR_ADMIN by default.
- It isn't meta: it moves no permission, and the delegate must already
  hold the approval key.
- It isn't manager-grantable.
- A manager managing **their own** delegations needs no key, only the
  MANAGER role.

#### Data

`workflow_delegates` (spec §11's table name):
- `id`;
- `delegator_user_id` and `delegate_user_id` (both FK → users);
- `start_date` and `end_date` (date);
- `reason`;
- `created_by_user_id` and `created_at`;
- `revoked_at`, `revoked_by_user_id` and `revoke_reason`.

There are indexes on the delegator and the delegate.

#### API

| Route | Gate | Class (route inventory) |
|---|---|---|
| `GET /api/delegations/mine` | signed in | self: delegations I gave, and ones I'm covering |
| `GET /api/delegations/delegate-options` | signed in; only managers get rows | self |
| `POST /api/delegations/mine` | signed in; refused unless MANAGER | self |
| `POST /api/delegations/mine/:id/revoke` | signed in; must be the delegator | self |
| `GET /api/delegations` | `delegation.manage` | admin |
| `GET /api/delegations/managers` | `delegation.manage` | admin |
| `GET /api/delegations/delegate-options/:delegatorUserId` | `delegation.manage` | admin |
| `POST /api/delegations` | `delegation.manage` | admin |
| `POST /api/delegations/:id/revoke` | `delegation.manage` | admin |

The delegated reach is added inside the existing leave endpoints. Their
IDOR cases in `managerReach.test.ts` stay, plus new ones:
- an outsider's request stays 404 for a delegate;
- a delegator's team becomes reachable only while the delegation is
  active.

#### Screens

- **Employee portal → Workflow Delegates** (`/app/workflow-delegates`,
  replacing the placeholder):
  - "My delegations": managers only. Lists them with status, plus Delegate
    (delegate picker, date range, reason) and Revoke.
  - "Covering for": anyone who is a delegate. Shows whose approvals they
    have and until when.
  - Everyone else sees an explanation.
- **Admin Tools → Workflow Delegates** (`/admin/admin-tools/delegates`,
  replacing the placeholder): everyone's delegations with a status filter.
  "Set up a delegation" picks the manager, then a delegate. Revoke with a
  reason.
- **Review:** a request reached through a delegation carries an "On behalf
  of A" tag.

**Not in E3:** Approval Workflows (multi-level chains, spec §7.8). They
stay a placeholder and need their own plan. Nothing in leave today is
multi-level.

#### Tests

- every rule above (who can delegate and be delegated to, dates, overlap
  including the concurrent case, revoke);
- reach exists only while active (scheduled, active, ended, revoked);
- non-transitive;
- the delegator keeps access;
- self-approval still blocked;
- the audit row and the leave row carry on-behalf-of;
- notifications and realtime;
- a delegate who loses `leave.approve` can't act;
- the route-inventory classification for the new routes.

### E3 as built (2026-10-02)

Built as planned above. Differences and additions:

- **`GET /api/delegations/delegate-options` is classified `everyone`,**
  not `self`. It lists other people: name, designation, department and
  role names of active users who can approve leave. Only a MANAGER caller
  gets rows. The route inventory records the reason.
- **"Covering for"** shows only active and scheduled delegations. Ended and
  revoked ones stay in the delegator's list and in HR's.
- **"Decided on their behalf"** is a per-delegation count, read from the
  audit log: rows whose actor is the delegate and whose `on_behalf_of` is
  the delegator, within the delegation's lifetime. It answers "what
  happened while I was away".
- **Refresh after a change** marks leave balances stale instead of
  refetching them. A revoke removes rows from the delegate's Review queue,
  and refetching those rows' balance cells first would 404 on people now
  out of reach. Found in the walkthrough.
- **Two CHECK constraints** back the service rules in the database:
  `end_date >= start_date` and delegator ≠ delegate.
- **The walkthrough ran with the browsers on Asia/Kolkata time.** It ran
  after 00:00 IST, when the container's UTC "today" was still the day
  before. Real users' browsers are on IST, and the server always uses the
  IST business date, so a browser on another timezone could offer a
  "today" the server calls past and get a clear 400 `PAST_START`.

## F — Core reports (requirements 2026-10-03; built, pending review)

**User requirements (2026-10-03):**
- The buildable reports: headcount, joiners, leavers and attrition,
  birthdays and anniversaries, leave balance, leave liability, and LOP.
- Each gets a filtered list view plus an Excel export through the shared
  helper.
- Each is gated by `reports.view` and scope-filtered, so a manager sees
  only their team.
- Leave liability is flagged in the UI as dependent on the encashment
  rate, which is still awaiting the CA, the same way Year End does.
- Nothing that needs attendance or payroll data. Those arrive with
  Phases 3 and 6.

#### Permissions — two consequences of the requirements

1. **`reports.view` joins the manager-grantable list.** Managers must hold
   it, and a MANAGER holder can only ever hold grantable keys (spec §2.2).
   This is the deliberate code change §2.2 describes, with its own scope
   tests:
   - every report route is classified `scoped` in the route inventory and
     listed in `MANAGER_REACHABLE_SCOPED`;
   - `managerReach.test.ts` proves a manager's rows are their team only,
     for every report.

   Held by HR_ADMIN, HR_EXECUTIVE, PAYROLL_ADMIN (LOP and leave figures
   feed payroll) and MANAGER, plus Super Admins.
2. **Leave liability also needs `reports.liability.view`.** This key is
   new and **not** manager-grantable. It is held by HR_ADMIN and
   PAYROLL_ADMIN only.
   - Liability is days × the encashment daily rate. Today the rate is one
     flat HR-entered amount, but from Phase 6 it is "one day's salary", so
     the report reveals salary.
   - Spec §2 keeps salary from HR_EXECUTIVE, and §2.2 keeps it from
     managers, non-negotiably. Gating it now means Phase 6 can't silently
     leak it.

#### The reports

Every report is computed in `modules/reports/` from one definition. The
definition holds its filters, its columns, a function that builds the
rows and summary from the viewer's scoped population, and any notes. The
same rows feed the screen and the export, so the two can't disagree.

Common filters on every report: department, branch and employment type.

| Report | Filters | Rows | Summary |
|---|---|---|---|
| **Headcount** | as of a date (default today) | everyone employed on that date (joined on or before it, and not separated before it), with the department/branch/designation **as of that date** | total, by department, by branch |
| **Joiners** | date range (default: this month) | joined in range | count, by month |
| **Leavers & attrition** | date range (default: year to date) | completed separations with their last working day in range, with tenure and reason | leavers, opening headcount, closing headcount, **attrition = leavers ÷ average of opening and closing headcount** (the formula is shown on screen), by month, by reason |
| **Birthdays & anniversaries** | date range (default: the next 30 days, at most a year), and which kind | active employees whose birthday or work anniversary (1 year or more) falls in range. Birthdays show **day and month only, never the year or age**. A 29 Feb birthday falls on 28 Feb in other years. | count of each |
| **Leave balance** | as of a date, leave type (optional) | one row per active employee, one column per leave type: the ledger sum up to that date, exactly as the Balances screen computes it | totals per type |
| **Leave liability** | as of a date | balance of each year-end-encashable type (PL) × the daily rate from the same provider Year End uses; a negative balance counts as 0 | total days, rate, total liability. A **warning banner says the rate is provisional pending the CA**. If no rate is configured, it shows days only, with "rate not configured". |
| **LOP** | date range (default: this month) | approved LOP leave overlapping the range, counted day by day within it (holidays and week-offs excluded, half-days honoured, as `computeTotalLeaveDays` does) | total days, employees affected. Note: **leave LOP only.** Attendance LOP (half-day minimum not met, spec §4.4) arrives with Phase 3. |

#### Scope

- A manager's population is their current team (`buildEmployeeScopeWhere`).
- Leavers aren't in anyone's current team, so a leaver is in a manager's
  scope if their last placement reported to the manager or someone in the
  team. This is the same rule as the E1.1 dashboard.
- Historical headcount for a manager uses today's team. That's documented
  on screen, the same as the dashboard.

#### Excel

**The shared helper:** `lib/xlsx.ts` builds a workbook from
`{ sheet, columns, rows }` plus optional extra sheets for breakdowns. It
applies a bold header, widths and date/number formats. There wasn't one
before: the employee grid and Year End each built their own, and both now
use it.
- Each report exports its rows on sheet 1, its summary and breakdowns on
  sheet 2, and a footer noting the filters and "team only" when scoped.
- Every export is audit-logged as `report.exported`, with the report key,
  filters, row count and scope.

#### API

| Route | Notes |
|---|---|
| `GET /api/reports` | the catalog the viewer can open (liability only with its key) |
| `GET /api/reports/:key` | the rows, summary, breakdowns and notes |
| `GET /api/reports/:key/export` | the `.xlsx` |

All three are gated on `reports.view`; liability additionally needs
`reports.liability.view` in the service.

#### Screens

- **The Reports app** (`/admin/reports`, replacing the placeholder): a
  landing page of report cards, and one page per report with its filters,
  summary tiles, breakdown tables, the list (sortable, paginated) and
  Export.
- A "Showing your team only" tag appears when scoped.
- **Leave liability** carries the provisional-rate warning. **Year End**
  gets the same warning, as one shared component. Until now its only sign
  was a "Rate Source" column.

#### Tests

- every report's numbers on a fixture: headcount as of a past date,
  joiners, leavers and the attrition formula, the 29 Feb birthday, balances
  as of a date, liability with and without a rate, LOP straddling the
  range and a holiday;
- manager scope for every report, with the IDOR guard;
- liability's second key;
- export through the helper, plus the audit row;
- the route inventory.

### F as built (2026-10-03)

Built as planned above. Differences found while building:

- **Leavers come from the employee record, not only Separation rows.**
  The seeded leavers (1028, 1090), like everyone greytHR will import,
  have `status = SEPARATED` and a last working day but no Separation
  row in this system. So a leaver is any separated employee whose last
  working day falls in the range. The reason comes from their completed
  separation where there is one, else "—".
- **Headcount never counts a separated employee with no last working
  day.** Nothing places them in time. Tested.
- **Leave liability lists only non-zero balances.** It said this on
  screen; listing everyone at ₹0 drowned the people who matter.
- **The walkthrough needed real ledger data.** The seed has no leave
  ledger entries at all (accrual is a scheduled job), so every balance
  is genuinely 0. In the walkthrough, HR granted PL through Leave
  Granter and approved an LOP day before checking liability and LOP.

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
| Admin app `workflow` (Workflow) and `admin-tools/workflows` (Approval Workflows, multi-level chains, spec §7.8) | **Dropped** (user decision 2026-10-03): no approval needs configurable chains; payroll maker-checker is purpose-built in Phase 6. Both placeholders removed; rationale in spec §7.8 |
| `admin-tools/templates` (Email & Letter Templates) | **Settled: its own commit right after D** (headless Chromium; letters saved to Document Center) |
| `admin-tools/users-roles` (Users & Roles) | **Settled: E1** (Roles & Permissions). |
