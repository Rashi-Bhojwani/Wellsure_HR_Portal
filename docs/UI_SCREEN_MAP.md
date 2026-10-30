# UI Screen Map

Every frontend route that exists today, which board frame it is styled from, and what
the board shows that we lack. Companion to [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).
Board frame ids are the slice names in `docs/design/slices/` (`light/<section>/<id>.jpg`,
phone: `light-phone/<section>/m-<id>.jpg`).

**Status key**
- **MAPPED**: a board frame shows this kind of screen; we follow it.
- **MAPPED-PARTIAL**: a board frame covers the layout, but the board shows things we have
  no data or backend for (listed), or our screen has much more than the frame.
- **NOT IN BOARD**: styled by the system (same tokens, components, spacing and behaviour),
  not by a frame.

**Who sees it.** The permission column is what the **API** enforces for the screen's main
data (from `backend/src/modules/*/routes.ts` and the role defaults in
`backend/src/lib/systemRoles.ts`); the UI only hides what the API would refuse. Roles:
SA Super Admin · HA HR Admin · HE HR Executive · PA Payroll Admin · PP Payroll Approver ·
DEV Developer/operator · MGR Manager (only what Admin granted) · AP Approver · EMP everyone
signed in. A Manager starts with nothing (spec §2.1); "MGR*" means "if granted".

Sensitive values (salary, bank, PAN, Aadhaar, UAN, ESI) appear only where they already do
today, for the roles that already see them; the UI pass adds none.

---

## Public (signed out)

| URL | Screen | Permission | Board frame | Status | Notes / what the board has that we lack |
|---|---|---|---|---|---|
| `/login` | Sign in (Employee Code + password) | — | `auth-01`..`03` | MAPPED-PARTIAL | Board: email login, Remember me, Google/Apple, sign-up link, photo panel. Ours: Employee Code, no social, no sign-up (HR creates accounts). The "cannot reach the server" message stays. |
| `/forgot-password` | Forgot password | — | `auth-06` | MAPPED | |
| `/reset-password/:token` | Choose a new password (from email) | — | `auth-07` | MAPPED | Password-rule checklist styled like the board |
| `/set-password/:token` | First login: set your password | — | `auth-07`, success `auth-09` | MAPPED | |
| `/totp-challenge` | Two-step code | — | `auth-08` | MAPPED-PARTIAL | Board: 4 OTP boxes; ours: a 6-digit authenticator code (or a recovery code) |
| `/totp-setup` | Set up two-step sign-in (QR + recovery codes) | — | stepper `auth-10`..`13` | MAPPED-PARTIAL | Board's onboarding stepper reused for the steps |
| — | Privacy policy page | — | `help-03` | **does not exist** | Waits on your DPDP wording (PROGRESS open question). Not created in this pass. |
| `/dev/screens` | Developer screen index (new, **development builds only**) | — | — | NOT IN BOARD | Lists every URL below for review against the demo company. Not in production bundles. |

## Employee portal (`/app`)

| URL | Screen | Permission (API) | Roles | Board frame | Status | Notes |
|---|---|---|---|---|---|---|
| `/app/home` | Home (greeting, review, holidays, track, payslip, quick access) | own data; Review card needs `leave.approve` / regularization approve | EMP | `home-02` | MAPPED-PARTIAL | Board: HR KPI stats + charts (company-wide); ours: the person's own cards. Payslip amounts stay masked until "Show salary". |
| `/app/engage` | Engage feed | EMP (moderation `engage.moderate`) | EMP | `news-01` (cards) | NOT IN BOARD | Social feed is ours; styled with board cards, chips, rich text |
| `/app/my-worklife/kudos` | Kudos received | EMP | EMP | `news-01` | NOT IN BOARD | |
| `/app/my-worklife/feedback` | Feedback | — | — | — | placeholder (Phase 8) | Coming-soon page only |
| `/app/todo/tasks` | Tasks inbox | EMP | EMP | `checklist-01` | MAPPED-PARTIAL | Board: checklist to-dos with checkboxes; ours: tasks from leave/attendance/profile flows |
| `/app/todo/review` | Review (approvals) | `leave.approve`, `attendance.regularization.approve` | MGR*, AP, HA, HE | `time-off-05` | MAPPED-PARTIAL | Approve/reject never optimistic |
| `/app/salary/payslips` | Payslips | own payslips | EMP | `payroll-02`/`03` | MAPPED-PARTIAL | Board shows bank info on the detail; ours does not (bank masked, never on payslip screen) |
| `/app/salary/ytd-reports`, `it-statement`, `it-declaration`, `loans-advances`, `reimbursement`, `proof-of-investment`, `salary-revision` | Salary sub-pages | — | — | — | placeholder (Phase 7) | Coming-soon page only; built in Phase 7 with this system |
| `/app/leave/apply` | Apply for leave | EMP | EMP | `time-off-03`/`04` | MAPPED | Board uses a drawer; ours is a page (kept: same URL) styled as the drawer form |
| `/app/leave/balances` | Leave balances | EMP | EMP | `time-off-01` | MAPPED | |
| `/app/leave/calendar` | Leave calendar | EMP (team scope) | EMP | `time-off-06` | MAPPED | |
| `/app/leave/holiday-calendar` | Holiday calendar | EMP | EMP | `time-off-09` | MAPPED-PARTIAL | Read-only for employees |
| `/app/attendance/info` | Attendance Info (live calendar, day panel, regularize) | own data | EMP | `attendance-01`, `-03` | MAPPED-PARTIAL | Board: clock-in timer and table; ours: month calendar + day detail (biometric, no web clock-in) |
| `/app/attendance/mark` | Mark attendance (manual-capture branches) | `attendance.manual.enter` | HE, HA, MGR* | `attendance-05` | MAPPED-PARTIAL | Hidden from the menu without the permission |
| `/app/document-center` | Document Center | EMP (pay docs `documents.pay.view`) | EMP | `documents-01`..`03` | MAPPED | |
| `/app/people` | People directory + org chart | EMP | EMP | `employees-12`, `-13` | MAPPED | |
| `/app/helpdesk` | Helpdesk (my tickets, raise) | EMP | EMP | `help-01`, `-05` | MAPPED-PARTIAL | |
| `/app/helpdesk/:id` | Ticket thread | own ticket | EMP | `notifications-05` (chat bubbles) | MAPPED-PARTIAL | |
| `/app/request-hub` | Request Hub | EMP | EMP | `time-off-01` (table) | NOT IN BOARD | |
| `/app/workflow-delegates` | Workflow delegates | EMP (manager's own) | EMP | `settings-05` | NOT IN BOARD | |
| `/app/profile` | View My Info | own profile; statutory/bank masked | EMP | `employees-05`..`11` | MAPPED-PARTIAL | Board Payroll tab with bank details is **not** shown that way: masked, Reveal audited, as today |
| `/app/security` | Account & security (password, two-step) | EMP | EMP | `settings-18` | MAPPED | |
| `/app/action` | Phone: Action tab | EMP | EMP | — (UI_REFERENCE PART 4) | NOT IN BOARD | |
| `/app/explore` | Phone: Explore tab | EMP | EMP | — (UI_REFERENCE PART 4) | NOT IN BOARD | |

## HR / Admin portal (`/admin`)

### Homepage, Tasks

| URL | Screen | Permission (API) | Roles | Board frame | Status | Notes |
|---|---|---|---|---|---|---|
| `/admin` | Admin home (Welcome: favourites, my tasks, updates; Dashboard: widgets) | admin-tier | SA HA HE PA PP DEV | `home-02` | MAPPED-PARTIAL | Board's KPI deltas ("+25.5%") need history we do not compute; we show the numbers the API already returns, without invented deltas |
| `/admin/tasks` | Tasks inbox (admin) | admin-tier | SA HA HE PA PP | `checklist-01` | MAPPED-PARTIAL | |

### Employee

| URL | Screen | Permission (API) | Roles | Board frame | Status | Notes |
|---|---|---|---|---|---|---|
| `/admin/employee` | → redirects to All Employees | | | | | |
| `/admin/employee/all` | All Employees grid | `employee.view` (export `employee.export`) | SA HA HE PA DEV | `employees-01`, `-02` | MAPPED | Board shows status as a menu chip; ours keeps status changes in the profile (no inline edit) |
| `/admin/employee/add` | Add Employee | `employee.create` | SA HA HE | `employees-03`/`04` | MAPPED-PARTIAL | Board: drawer; ours: a page (deep link kept) styled as the drawer form, multi-section |
| `/admin/employee/profile/:id` | Employee profile (tabs, history, access) | `employee.view`; bank/statutory tabs need their permissions | SA HA HE PA | `employees-05`..`11` | MAPPED | Sensitive tabs unchanged |
| `/admin/employee/import` | Bulk Import | `import.manage` | SA HA HE | `recruitment-15` (dropzone) | NOT IN BOARD | |
| `/admin/employee/change-requests` | Profile change requests | `profile.changerequest.approve` | SA HA HE | `time-off-05` | NOT IN BOARD | |
| `/admin/employee/separations` | Separations | `employee.separate.view` | SA HA HE | `employees-01` | NOT IN BOARD | |
| `/admin/employee/company-documents` | Company documents | `documents.manage` | SA HA HE | `documents-01`..`05` | MAPPED | |
| `/admin/employee/helpdesk` | Helpdesk queue | `helpdesk.manage` | SA HA HE | `help-01` | NOT IN BOARD | |
| `/admin/employee/helpdesk/:id` | Ticket (admin) | `helpdesk.manage` (sensitive categories `helpdesk.sensitive.view`) | SA HA HE | `notifications-05` | MAPPED-PARTIAL | |

### Workforce Management (leave and attendance)

| URL | Screen | Permission (API) | Roles | Board frame | Status | Notes |
|---|---|---|---|---|---|---|
| `/admin/workforce` | Workforce overview (charts) | `leave.view` | SA HA HE PA AP | `reports-02`, `reports-05` | MAPPED-PARTIAL | |
| `/admin/workforce/leave/calendar` | Leave calendar (org) | `leave.view` | SA HA HE PA AP | `time-off-06` | MAPPED | |
| `/admin/workforce/leave/employee-leave` | Employee leave (requests, act) | `leave.view`, approve `leave.approve` | SA HA HE AP | `time-off-05` | MAPPED | |
| `/admin/workforce/leave/granter` | Leave granter | `leave.grant` | SA HA HE | `time-off-13` (form) | NOT IN BOARD | |
| `/admin/workforce/leave/year-end` | Year end process | `leave.yearend.manage` | SA HA | `recruitment-09` (stepper) | NOT IN BOARD | Audited; never optimistic |
| `/admin/workforce/leave/recalculator` | Leave recalculator | `leave.recalculate` | SA HA | — | NOT IN BOARD | |
| `/admin/workforce/attendance/who-is-in` | Who is in? (live) | `attendance.view` | SA HA HE PA | `attendance-04` | MAPPED-PARTIAL | Live row updates kept |
| `/admin/workforce/attendance/shift-roster` | Shift roster | `attendance.view` / config | SA HA HE | `settings-07` | NOT IN BOARD | |
| `/admin/workforce/attendance/swipes` | Employee swipes (raw punches) | `attendance.swipes.view` | SA HA HE | `attendance-05` | MAPPED-PARTIAL | Compact density |
| `/admin/workforce/attendance/muster` | Attendance muster grid | `attendance.view` | SA HA HE PA | — | NOT IN BOARD | Compact density, sticky columns |
| `/admin/workforce/attendance/info` | Attendance info (any employee) | `attendance.view` | SA HA HE PA | `attendance-01` | MAPPED-PARTIAL | |
| `/admin/workforce/attendance/regularizations` | Regularization queue | `attendance.regularization.view` | SA HA HE | `time-off-05` | MAPPED | |
| `/admin/workforce/attendance/process` | Process attendance | `attendance.process` | SA HA HE | — | NOT IN BOARD | |
| `/admin/workforce/attendance/finalisation` | Attendance period finalisation | `attendance.finalise` (unlock SA) | SA HA PA | — | NOT IN BOARD | Audited; never optimistic |
| `/admin/workforce/attendance/exceptions` | Attendance exceptions | `attendance.view` | SA HA HE | `checklist-03` | NOT IN BOARD | |
| `/admin/workforce/attendance/manual-override` | Manual override | `attendance.override.manage` | SA HA | `attendance-03` (modal) | NOT IN BOARD | Audited |
| `/admin/workforce/attendance/shift-override` | Shift override | `attendance.override.manage` | SA HA | — | NOT IN BOARD | |
| `/admin/workforce/attendance/settings` | Attendance settings | `attendance.config.manage` | SA HA | `attendance-06`..`08` | MAPPED-PARTIAL | Board: geofence/QR (we have none) |

### Reports

| URL | Screen | Permission (API) | Roles | Board frame | Status | Notes |
|---|---|---|---|---|---|---|
| `/admin/reports` | Reports index | `reports.view` | SA HA HE PA MGR* | `reports-01` | MAPPED | |
| `/admin/reports/headcount`, `joiners`, `leavers`, `celebrations`, `leave-balance`, `lop`, `attendance-muster`, `late-coming`, `excess-hours`, `exception-summary` | Report pages (filters, list, export) | `reports.view` (scope-filtered) | SA HA HE PA MGR* | `reports-02`..`10` | MAPPED-PARTIAL | Charts only where the API returns aggregates |
| `/admin/reports/leave-liability` | Leave liability | `reports.liability.view` | SA HA PA | `reports-06` | MAPPED-PARTIAL | Provisional-rate flag kept |

### Engage admin

| URL | Screen | Permission (API) | Roles | Board frame | Status |
|---|---|---|---|---|---|
| `/admin/engage` | → Announcements | | | | |
| `/admin/engage/announcements` | Announcements | `announcements.manage` | SA HA | `news-01`..`05` | MAPPED |
| `/admin/engage/moderation` | Moderation | `engage.moderate` | SA HA | `news-01` | NOT IN BOARD |
| `/admin/engage/groups` | Groups | `engage.groups.manage` | SA HA | `recruitment-17` (tag cards) | NOT IN BOARD |
| `/admin/engage/auto-posts` | Auto-post settings | `engage.autopost.manage` | SA HA | `notifications-02` (toggles) | MAPPED-PARTIAL |

### Payroll (DEMO COMPANY banner and TEST watermark kept exactly)

| URL | Screen | Permission (API) | Roles | Board frame | Status | Notes |
|---|---|---|---|---|---|---|
| `/admin/payroll` | → first payroll page | | | | | |
| `/admin/payroll/setup` | Setup checklist | `payroll.rules.view` | SA HA PA PP DEV | `checklist-03` | NOT IN BOARD | Progress rows |
| `/admin/payroll/ready` | Ready for first run | `payroll.run` / view | SA PA PP | `checklist-09` | NOT IN BOARD | |
| `/admin/payroll/rules` | Rules and setup (maker-checker) | `payroll.rules.view` (manage/confirm) | SA HA PA PP DEV | `payroll-04`/`05` | MAPPED-PARTIAL | Confirm never optimistic |
| `/admin/payroll/overrides` | Rule overrides (department, person) | `payroll.rules.view` / manage / confirm | SA | none | NOT IN BOARD | Placeholder until a different director confirms by retyping; shows source note, dates and reason |
| `/admin/payroll/components` | Salary components | `payroll.rules.view` | SA HA PA PP | `settings-05` | NOT IN BOARD | |
| `/admin/payroll/structures` | Salary structures | `payroll.rules.view` | SA HA PA PP | `payroll-04` | NOT IN BOARD | |
| `/admin/payroll/salaries` | Employee salaries | `payroll.salary.view` | SA HA PA PP | `payroll-01` | MAPPED-PARTIAL | Amounts stay masked/permissioned as today |
| `/admin/payroll/revisions` | Salary revisions (maker-checker) | `payroll.salary.view` / edit / approve | SA HA PA PP | `payroll-01` | MAPPED-PARTIAL | |
| `/admin/payroll/adjustments` | Adjustments | `payroll.adjust` | SA PA | `payroll-01` | NOT IN BOARD | |
| `/admin/payroll/monthly-inputs` | Monthly Inputs (grid, history, confirm, import a file) | `payroll.salary.edit` | SA (directors only) | none | NOT IN BOARD | Opens when the month's attendance is final; one column per head flagged "takes its value from Monthly Inputs"; figures are exact, never overwritten, confirmed by a second director |
| `/admin/payroll/holds` | Held salaries (hold, release) | `payroll.salary.view` / edit | SA | none | NOT IN BOARD | Director-only act; shows reason and status, never an amount |
| `/admin/payroll/run` | Payroll runs list | `payroll.run` / `payroll.approve` | SA PA PP | `payroll-01` | MAPPED-PARTIAL | |
| `/admin/payroll/run/:id` | Payroll run (steps, preview, approval) | `payroll.run` / `payroll.approve` | SA PA PP | stepper `recruitment-09` + `payroll-02` | MAPPED-PARTIAL | Maker-checker states via ApprovalBanner; TEST watermark kept |
| `/admin/payroll/run/:id/step/:slug` | Run step (register, variance, bank file, statutory files, payslips) | as above; bank file `payroll.bank.view` | SA PA PP | `payroll-02`/`03`, `documents-03` | MAPPED-PARTIAL | Downloads never cached by the service worker |
| `/admin/payroll/compare` | Compare registers | `payroll.run` | SA PA | `reports-04` | NOT IN BOARD | |
| `/admin/payroll/audit` | Payroll audit trail | `audit.view` / payroll | SA HA PA PP | `recruitment-08` (timeline) | NOT IN BOARD | |
| `/admin/payroll/layouts` | Bank and statutory layouts | `payroll.banklayout.manage` / confirm | SA PA PP | `recruitment-18`/`19` | NOT IN BOARD | |
| `/admin/payroll/loans` | Loans & advances | — | — | — | placeholder (Phase 7) | |

### Admin Tools

| URL | Screen | Permission (API) | Roles | Board frame | Status |
|---|---|---|---|---|---|
| `/admin/admin-tools` | → Organisation setup | | | | |
| `/admin/admin-tools/organisation` | Organisation setup (company, cities, branches, departments…) | `org.manage` | SA HA HE | `settings-01`..`04` | MAPPED |
| `/admin/admin-tools/holidays` | Holiday calendars | `leave.policy.manage` | SA HA | `time-off-09`/`10` | MAPPED |
| `/admin/admin-tools/shifts` | Shift master | `attendance.config.manage` | SA HA | `settings-06`/`07` | MAPPED |
| `/admin/admin-tools/week-offs` | Week-off patterns | `attendance.config.manage` | SA HA | `settings-06` | MAPPED-PARTIAL |
| `/admin/admin-tools/leave-policies` | Leave types & policies | `leave.policy.manage` | SA HA | `time-off-11`..`13` | MAPPED |
| `/admin/admin-tools/delegates` | Workflow delegates (admin) | `delegation.manage` | SA HA | `settings-05` | NOT IN BOARD |
| `/admin/admin-tools/users-roles` | Roles & permissions (role matrix) | SA only (view `role.view`) | SA (HA HE view) | `settings-08`..`10` | MAPPED |
| `/admin/admin-tools/managers` | Manager management | `manager.appoint` / `manager.team.assign` / `manager.permissions.manage` | SA HA | `settings-09` | MAPPED-PARTIAL |
| `/admin/admin-tools/helpdesk-categories` | Helpdesk categories | `settings.manage` | SA HA | `recruitment-17` | NOT IN BOARD |
| `/admin/admin-tools/templates` | Email & letter templates | `letters.template.manage` | SA HA | `recruitment-18` | MAPPED-PARTIAL |
| `/admin/admin-tools/templates/:id` | Template editor | `letters.template.manage` | SA HA | `recruitment-19` | MAPPED |
| `/admin/admin-tools/devices` | Devices and sync agents | `attendance.devices.manage` | SA HA DEV | `settings-11` (integration cards) | NOT IN BOARD |
| `/admin/admin-tools/import-export` | Data import/export | `import.manage` | SA HA HE | `recruitment-15` | NOT IN BOARD |
| `/admin/admin-tools/audit-log` | Audit log | `audit.view` | SA HA | `recruitment-08` | NOT IN BOARD |
| `/admin/admin-tools/settings` | System settings | `settings.manage` | SA HA | `settings-01`, `settings-19` | MAPPED |
| `/admin/security` | Account & security | EMP | all admin-tier | `settings-18` | MAPPED |
| `/admin/assets` | Assets management | — | — | — | placeholder (Phase 8) |

---

## Board sections with no backend: "later"

Not built in this pass, no nav items, no fake data. Built later with this design system.

| Board section | Frames | Why later |
|---|---|---|
| Recruitment (jobs, candidates, kanban, hiring workflow, email templates) | `recruitment-01`..`19` | No recruitment module in the spec's phases |
| Checklist (onboarding/offboarding templates and to-dos) | `checklist-01`..`10` | No checklist backend (spec §7.2 exit checklist is with Separations) |
| Messages (chat) | `notifications-04`/`05` | No messaging backend; the top bar's chat icon is not shown |
| Subscription, plan picker, pay with card | `settings-13`..`17` | Not a product feature (and no money movement in the app) |
| Integrations marketplace | `settings-11`/`12` | No integrations |
| Help Center FAQ / keyboard shortcuts / contact support content | `help-02`, `help-04`, `help-05` | No content yet; our Help is the helpdesk |
| Performance (sidebar item) | — | Phase 8 |
| Social sign-in, sign-up, company onboarding | `auth-04`/`05`, `auth-10`..`13` content | Accounts are created by HR |

---

## Deep links

Every URL above keeps working: this pass changes no route path. Route-level code
splitting (step 3) changes how pages load, not their addresses.
