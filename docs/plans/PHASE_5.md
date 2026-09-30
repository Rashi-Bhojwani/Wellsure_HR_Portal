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
| C | People directory, org chart, Document Center **[recorded]** | Next. Plan to be approved before code. |
| D | Helpdesk, Request Hub **[recorded]** | Not started |
| E | Three-level hierarchy (Manager Management, per-manager permissions) + Workflow Delegates **[recorded: user, 2026-09-30]** | Not started |
| F | Reports **[recorded]** | Not started |
| G | Mobile / PWA **[recorded]** | Not started. No longer blocked, see below. |

## C — People directory, org chart, Document Center

Scope **[recorded]**: People directory, org chart, Document Center.

Detail **[reconstructed]** (spec §6 "People", "Document Center"; §7.2
Documents tab; §9 file uploads; §11 `employee_documents`):

- **People** (`/app/people`, currently a placeholder): directory of
  active employees with name, photo, designation, department, branch and
  contact details, filtered "per privacy settings" (spec §6). Includes
  the org chart.
- **Document Center** (`/app/document-center`, currently a placeholder):
  company policies, forms, my letters, payslips and Form 16. Payslips and
  Form 16 are Phase 6/7, so they show "coming soon".
- Probably also: the employee profile's Documents tab (spec §7.2) and an
  admin screen to publish company documents. `EmployeeDocument` already
  exists in the schema but nothing uses it yet.
- Uploads go through `StorageService`: type/size validation, private
  storage, short-expiry signed URLs (spec §9).

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
  mobile screenshots are in `docs/screenshots/`. On disk the files are
  `mobile-action.png.jpeg`, `mobile-explore-1.png.jpeg`,
  `mobile-explore-2.png.jpeg` and `mobile-engage.png.jpeg` (note the
  double extension).
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
