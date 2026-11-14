# UI Screen Map

Every screen the portal has today, where it sits in the menu, who can open it, and whether it is built. **Generated from the code** on
2026-11-14: the menus (`frontend/src/routes/adminMenu.config.tsx`, `employeeMenu.config.tsx`), the routes (`frontend/src/routes/router.tsx`,
`PortalRoutes.tsx`) and the default roles (`backend/src/lib/systemRoles.ts`, less the HR and Developer ceilings in
`shared/constants/sensitiveData.ts`). Companion to [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md). Board frame ids are the slice names in
`docs/design/slices/`; "—" means the screen is styled by the design system, not by a frame.

**Status:** **built** (the page exists) or **placeholder** (a menu entry that shows a coming-soon page).

**Who can open it.** What the menu requires, with the permission keys; the **API** enforces the same and narrows the data to the person's
scope. Roles: **SA** Super Admin (the two directors; they hold every permission) · **HA** HR Admin · **HE** HR Executive · **AP** Approver ·
**DEV** Developer / operator · **MGR\*** a manager, only if a director or HR granted that key (managers start with none) · **EMP** everyone
signed in. The Payroll Admin and Payroll Approver roles exist but are given to nobody (the two directors are the payroll team), so they are
not listed. HR's powers can be narrowed further by the directors (Admin Tools → What HR Can Do); the table shows the defaults. HR never
sees salary or any pay figure; the Developer never sees a value.

Sensitive values (salary, bank, PAN, Aadhaar, UAN, ESI) appear only to the roles allowed to see them, masked by default.

---

## Public (signed out)

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/login` | Sign in (Employee Code and password) | — | anyone | built | `auth-01`..`03` |
| `/forgot-password` | Forgot password | — | anyone | built | `auth-06` |
| `/reset-password/:token` | Choose a new password (from email) | — | anyone | built | `auth-07` |
| `/set-password/:token` | First sign-in: set your password | — | anyone | built | `auth-07`, success `auth-09` |
| `/totp-challenge` | Two-step code | — | anyone | built | `auth-08` |
| `/totp-setup` | Set up two-step sign-in | — | anyone | built | stepper `auth-10`..`13` |
| `/check-letter` | Check a letter (is an issued letter genuine) | — | anyone | built | — |
| `/dev/screens` | Developer screen index (development builds only) | — | development only | built | — |

## Employee portal (`/app`)

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/app/home` | Home | Home | EMP (own data) | built | `home-02` |
| `/app/engage` | Engage | Engage | EMP (own data) | built | `news-01` (cards) |
| `/app/my-worklife/kudos` | Kudos | My Worklife → Kudos | EMP (own data) | built | `news-01` |
| `/app/my-worklife/feedback` | Feedback | My Worklife → Feedback | EMP (own data) | built | — |
| `/app/todo/tasks` | Tasks | To do → Tasks | EMP (own data) | built | `checklist-01` |
| `/app/todo/review` | Review | To do → Review | EMP (own data) | built | `time-off-05` |
| `/app/todo/onboarding` | Onboarding | To do → Onboarding | EMP (own data) | built | — |
| `/app/salary/payslips` | Payslips | Salary → Payslips | EMP (own data) | built | `payroll-02`/`03` |
| `/app/salary/ytd-reports` | YTD Reports | Salary → YTD Reports | EMP (own data) | built | — |
| `/app/salary/it-statement` | IT Statement | Salary → IT Statement | EMP (own data) | built | none |
| `/app/salary/it-declaration` | IT Declaration | Salary → IT Declaration | EMP (own data) | built | none |
| `/app/salary/loans-advances` | Loans and Advances | Salary → Loans and Advances | EMP (own data) | built | — |
| `/app/salary/reimbursement` | Reimbursement | Salary → Reimbursement | EMP (own data) | built | — |
| `/app/salary/proof-of-investment` | Proof Of Investment | Salary → Proof Of Investment | EMP (own data) | built | none |
| `/app/salary/form-16` | Form 16 | Salary → Form 16 | EMP (own data) | built | — |
| `/app/salary/salary-revision` | Salary Revision | Salary → Salary Revision | EMP (own data) | built | — |
| `/app/leave/apply` | Leave Apply | Leave → Leave Apply | EMP (own data) | built | `time-off-03`/`04` |
| `/app/leave/balances` | Leave Balances | Leave → Leave Balances | EMP (own data) | built | `time-off-01` |
| `/app/leave/calendar` | Leave Calendar | Leave → Leave Calendar | EMP (own data) | built | `time-off-06` |
| `/app/leave/holiday-calendar` | Holiday Calendar | Leave → Holiday Calendar | EMP (own data) | built | `time-off-09` |
| `/app/leave/encashment` | Encashment | Leave → Encashment | EMP (own data) | built | — |
| `/app/attendance/info` | Attendance Info | Attendance → Attendance Info | EMP (own data) | built | SELF |
| `/app/attendance/mark` | Mark Attendance | Attendance → Mark Attendance | SA HA HE MGR* · `attendance.manual.enter` | built | `attendance-05` |
| `/app/attendance/wfh` | Work From Home | Attendance → Work From Home | EMP (own data) | built | — |
| `/app/attendance/overtime` | Overtime | Attendance → Overtime | EMP (own data) | built | — |
| `/app/document-center` | Document Center | Document Center | EMP (own data) | built | `documents-01`..`03` |
| `/app/people` | People | People | EMP (own data) | built | `employees-12`, `-13` |
| `/app/helpdesk` | Helpdesk | Helpdesk | EMP (own data) | built | `help-01`, `-05` |
| `/app/request-hub` | Request Hub | Request Hub | EMP (own data) | built | `time-off-01` (table) |
| `/app/workflow-delegates` | Workflow Delegates | Workflow Delegates | EMP (own data) | built | `settings-05` |
| `/app/profile` | View My Info | (not in the menu: your name, a link or the phone tabs) | EMP (own data) | built | `employees-05`..`11` |
| `/app/security` | Account & security | (not in the menu: your name, a link or the phone tabs) | EMP (own data) | built | `settings-18` |
| `/app/helpdesk/:id` | Helpdesk ticket | (not in the menu: your name, a link or the phone tabs) | EMP (own data) | built | `notifications-05` (chat bubbles) |
| `/app/salary/payslip-link/:token` | Payslip email link (sends you to the payslip after sign-in) | (not in the menu: your name, a link or the phone tabs) | EMP (own data) | built | SELF |
| `/app/action` | Phone: Action tab | (not in the menu: your name, a link or the phone tabs) | EMP (own data) | built | — (UI_REFERENCE PART 4) |
| `/app/explore` | Phone: Explore tab | (not in the menu: your name, a link or the phone tabs) | EMP (own data) | built | — (UI_REFERENCE PART 4) |

## HR / Admin portal (`/admin`)

### Homepage

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin` | Homepage | Homepage | SA, and anyone signed in to the admin portal | built | `home-02` |

### Employee

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin/employee/all` | All Employees | Employee → All Employees | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `employees-01`, `-02` |
| `/admin/employee/add` | Add Employee | Employee → Add Employee | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `employees-03`/`04` |
| `/admin/employee/import` | Bulk Import | Employee → Bulk Import | SA HA HE DEV · `import.manage`, `import.details.manage`, `invitations.send` | built | `recruitment-15` (dropzone) |
| `/admin/employee/segments` | Filters & Segments | Employee → Filters & Segments | SA HA HE · `employee.segments.manage` | built | — |
| `/admin/employee/bulk-upload` | Bulk Upload | Employee → Bulk Upload | SA HA HE · `employee.documents.manage`, `employee.edit` | built | — |
| `/admin/employee/letters` | Letters | Employee → Letters | SA HA HE · `letters.issue.nopay` | built | — |
| `/admin/employee/change-requests` | Change Requests | Employee → Change Requests | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `time-off-05` |
| `/admin/employee/update-import` | Update From File | Employee → Update From File | SA HA HE · `employee.edit` | built | — |
| `/admin/employee/onboarding` | Onboarding | Employee → Onboarding | SA HA HE · `employee.edit` | built | — |
| `/admin/employee/probation` | Probation | Employee → Probation | SA HA HE · `employee.edit` | built | — |
| `/admin/employee/separations` | Separations | Employee → Separations | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `employees-01` |
| `/admin/employee/company-documents` | Company Documents | Employee → Company Documents | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `documents-01`..`05` |
| `/admin/employee/feedback` | Employee Feedback | Employee → Employee Feedback | SA HA HE DEV · `helpdesk.manage` | built | — |
| `/admin/employee/helpdesk` | Helpdesk | Employee → Helpdesk | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `help-01` |
| `/admin/employee/profile/:id` | Employee profile (tabs, history, access, more details) | from All Employees | SA HA HE DEV MGR\* · `employee.view`; Bank and Statutory tabs need their keys | built | `employees-05`..`11` |
| `/admin/employee/helpdesk/:id` | Helpdesk ticket (admin) | from Helpdesk | SA HA HE · `helpdesk.manage` | built | `notifications-05` |

### Workforce Management

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin/workforce/leave/calendar` | Leave Calendar | Workforce Management → Leave → Leave Calendar | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `time-off-06` |
| `/admin/workforce/leave/employee-leave` | Employee Leave | Workforce Management → Leave → Employee Leave | SA HA HE AP DEV MGR* · `leave.view`, `leave.approve` | built | `time-off-05` |
| `/admin/workforce/leave/granter` | Leave Granter | Workforce Management → Leave → Leave Granter | SA HA HE · `leave.grant` | built | `time-off-13` (form) |
| `/admin/workforce/leave/encashment-requests` | Encashment Requests | Workforce Management → Leave → Encashment Requests | SA (directors only) | built | — |
| `/admin/workforce/leave/year-end` | Year End Process | Workforce Management → Leave → Year End Process | SA · `leave.yearend.manage` | built | `recruitment-09` (stepper) |
| `/admin/workforce/leave/recalculator` | Leave Recalculator | Workforce Management → Leave → Leave Recalculator | SA HA · `leave.recalculate` | built | — |
| `/admin/workforce/attendance/who-is-in` | Who Is In? | Workforce Management → Attendance → Who Is In? | SA HA HE DEV · `attendance.view` | built | `attendance-04` |
| `/admin/workforce/attendance/shift-roster` | Shift Roster | Workforce Management → Attendance → Shift Roster | SA HA DEV · `attendance.roster.manage` | built | `settings-07` |
| `/admin/workforce/attendance/swipes` | Employee Swipes | Workforce Management → Attendance → Employee Swipes | SA HA HE DEV MGR* · `attendance.swipes.view` | built | `attendance-05` |
| `/admin/workforce/attendance/muster` | Attendance Muster | Workforce Management → Attendance → Attendance Muster | SA HA HE DEV MGR* · `attendance.view`, `attendance.manual.enter` | built | — |
| `/admin/workforce/attendance/info` | Attendance Info | Workforce Management → Attendance → Attendance Info | SA HA HE DEV · `attendance.view` | built | `attendance-01` |
| `/admin/workforce/attendance/wfh-requests` | Work From Home | Workforce Management → Attendance → Work From Home | SA (directors only) | built | — |
| `/admin/workforce/attendance/overtime` | Overtime | Workforce Management → Attendance → Overtime | SA HA HE MGR* · `attendance.regularization.approve` | built | — |
| `/admin/workforce/attendance/regularizations` | Regularizations | Workforce Management → Attendance → Regularizations | SA HA HE DEV MGR* · `attendance.regularization.view`, `attendance.regularization.approve` | built | `time-off-05` |
| `/admin/workforce/attendance/process` | Process Attendance | Workforce Management → Attendance → Process Attendance | SA HA HE DEV · `attendance.process` | built | — |
| `/admin/workforce/attendance/finalisation` | Attendance Period Finalisation | Workforce Management → Attendance → Attendance Period Finalisation | SA HA HE DEV · `attendance.finalise`, `attendance.process` | built | — |
| `/admin/workforce/attendance/exceptions` | Attendance Exception | Workforce Management → Attendance → Attendance Exception | SA HA HE DEV · `attendance.exceptions.view` | built | `checklist-03` |
| `/admin/workforce/attendance/remote` | Remote Attendance | Workforce Management → Attendance → Remote Attendance | SA · `attendance.unlock` | built | none |
| `/admin/workforce/attendance/manual-override` | Manual Override | Workforce Management → Attendance → Manual Override | SA HA · `attendance.override.manage` | built | `attendance-03` (modal) |
| `/admin/workforce/attendance/shift-override` | Shift Override | Workforce Management → Attendance → Shift Override | SA HA · `attendance.override.manage` | built | — |
| `/admin/workforce/attendance/settings` | Attendance Settings | Workforce Management → Attendance → Attendance Settings | SA HA HE DEV · `attendance.config.manage`, `attendance.view` | built | `attendance-06`..`08` |

### Assets Management

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin/assets` | Assets Management | Assets Management | SA, and anyone signed in to the admin portal | placeholder (Phase 8) | — |

### Tasks

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin/tasks` | Tasks | Tasks | SA, and anyone signed in to the admin portal | built | `checklist-01` |

### Reports

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin/reports/headcount` | Headcount | Reports → People → Headcount | SA HA HE DEV MGR* · `reports.view` | built | `reports-02`..`10` |
| `/admin/reports/joiners` | Joiners | Reports → People → Joiners | SA HA HE DEV MGR* · `reports.view` | built | — |
| `/admin/reports/leavers` | Leavers & attrition | Reports → People → Leavers & attrition | SA HA HE DEV MGR* · `reports.view` | built | — |
| `/admin/reports/celebrations` | Birthdays & anniversaries | Reports → People → Birthdays & anniversaries | SA HA HE DEV MGR* · `reports.view` | built | — |
| `/admin/reports/leave-balance` | Leave balance | Reports → Leave → Leave balance | SA HA HE DEV MGR* · `reports.leave.view` | built | — |
| `/admin/reports/leave-liability` | Leave liability | Reports → Leave → Leave liability | SA · `reports.liability.view` | built | `reports-06` |
| `/admin/reports/lop` | Loss of pay (LOP) | Reports → Leave → Loss of pay (LOP) | SA HA HE DEV MGR* · `reports.leave.view` | built | — |
| `/admin/reports/attendance-muster` | Attendance summary | Reports → Attendance → Attendance summary | SA HA HE DEV MGR* · `reports.attendance.view` | built | — |
| `/admin/reports/late-coming` | Late coming | Reports → Attendance → Late coming | SA HA HE DEV MGR* · `reports.attendance.view` | built | — |
| `/admin/reports/excess-hours` | Excess hours | Reports → Attendance → Excess hours | SA HA HE DEV MGR* · `reports.attendance.view` | built | — |
| `/admin/reports/exception-summary` | Attendance exceptions | Reports → Attendance → Attendance exceptions | SA HA HE DEV MGR* · `reports.attendance.view` | built | — |

### Engage

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin/engage/announcements` | Announcements | Engage → Announcements | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `news-01`..`05` |
| `/admin/engage/moderation` | Moderation | Engage → Moderation | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `news-01` |
| `/admin/engage/groups` | Groups | Engage → Groups | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `recruitment-17` (tag cards) |
| `/admin/engage/auto-posts` | Auto-Post Settings | Engage → Auto-Post Settings | SA, and anyone signed in to the admin portal; the page's own API decides what they see | built | `notifications-02` (toggles) |
| `/admin/engage/mass-email` | Mass Email | Engage → Mass Email | SA · `communication.mass.send` | built | — |

### Payroll

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin/payroll/setup` | Setup Checklist | Payroll → Setup Checklist | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `checklist-03` |
| `/admin/payroll/ready` | Ready for First Run | Payroll → Ready for First Run | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `checklist-09` |
| `/admin/payroll/rules` | Rules and Setup | Payroll → Rules and Setup | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `payroll-04`/`05` |
| `/admin/payroll/overrides` | Rule Overrides | Payroll → Rule Overrides | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | none |
| `/admin/payroll/components` | Salary Components | Payroll → Salary Components | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `settings-05` |
| `/admin/payroll/structures` | Salary Structures | Payroll → Salary Structures | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `payroll-04` |
| `/admin/payroll/salaries` | Employee Salaries | Payroll → Employee Salaries | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `payroll-01` |
| `/admin/payroll/revisions` | Salary Revisions | Payroll → Salary Revisions | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `payroll-01` |
| `/admin/payroll/adjustments` | Adjustments | Payroll → Adjustments | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `payroll-01` |
| `/admin/payroll/monthly-inputs` | Monthly Inputs | Payroll → Monthly Inputs | SA · `payroll.salary.edit` · never the Developer | built | none |
| `/admin/payroll/payslip-links` | Payslip Links | Payroll → Payslip Links | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | none |
| `/admin/payroll/not-on-payroll` | Not on Payroll | Payroll → Not on Payroll | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | none |
| `/admin/payroll/tax-years` | Tax Years | Payroll → Tax Years | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | none |
| `/admin/payroll/opening-figures` | Opening Figures | Payroll → Opening Figures | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/loans` | Loans | Payroll → Loans | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/reimbursements` | Reimbursements | Payroll → Reimbursements | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/settlements` | Settlements | Payroll → Settlements | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/off-cycle` | Off-cycle runs | Payroll → Off-cycle runs | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/pay-types` | Loan and claim types | Payroll → Loan and claim types | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/quarterly-tds` | Quarterly TDS data | Payroll → Quarterly TDS data | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/tds-form16` | TDS and Form 16 | Payroll → TDS and Form 16 | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/statutory-challans` | Statutory challans | Payroll → Statutory challans | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/compliance` | Compliance calendar | Payroll → Compliance calendar | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/minimum-wages` | Minimum wages | Payroll → Minimum wages | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/journal` | Accounting journal | Payroll → Accounting journal | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/overtime-encashment` | Overtime and encashment pay | Payroll → Overtime and encashment pay | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/company-settings` | Company settings | Payroll → Company settings | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/reports` | Payroll reports | Payroll → Payroll reports | SA (directors only) · never the Developer | built | — |
| `/admin/payroll/tax-declarations` | Tax Declarations | Payroll → Tax Declarations | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | none |
| `/admin/payroll/holds` | Held Salaries | Payroll → Held Salaries | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | none |
| `/admin/payroll/run` | Payroll Run | Payroll → Payroll Run | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `payroll-01` |
| `/admin/payroll/compare` | Compare Registers | Payroll → Compare Registers | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `reports-04` |
| `/admin/payroll/audit` | Payroll Audit Trail | Payroll → Payroll Audit Trail | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `recruitment-08` (timeline) |
| `/admin/payroll/layouts` | Bank and Statutory Layouts | Payroll → Bank and Statutory Layouts | SA · `payroll.rules.view`, `payroll.salary.view`, `payroll.run`, `payroll.approve` · never the Developer | built | `recruitment-18`/`19` |
| `/admin/payroll/run/:id` | Payroll run (steps, preview, approval) | from Payroll Run | SA (directors only) · never the Developer | built | stepper `recruitment-09` + `payroll-02` |
| `/admin/payroll/run/:id/step/:slug` | Run step (submit, close the period, publish payslips, bank file) | from a payroll run | SA (directors only) · never the Developer | built | `payroll-02`/`03`, `documents-03` |

### Admin Tools

| URL | Screen | Menu path | Who can open it | Status | Board frame |
|---|---|---|---|---|---|
| `/admin/admin-tools/organisation` | Organisation Setup | Admin Tools → Organisation Setup | SA HA HE DEV · `org.manage` | built | `settings-01`..`04` |
| `/admin/admin-tools/holidays` | Holiday Calendars | Admin Tools → Holiday Calendars | SA HA DEV · `leave.policy.manage` | built | `time-off-09`/`10` |
| `/admin/admin-tools/shifts` | Shift Master | Admin Tools → Shift Master | SA HA DEV · `attendance.config.manage` | built | `settings-06`/`07` |
| `/admin/admin-tools/week-offs` | Week-off Patterns | Admin Tools → Week-off Patterns | SA HA DEV · `attendance.config.manage` | built | `settings-06` |
| `/admin/admin-tools/leave-policies` | Leave Types & Policies | Admin Tools → Leave Types & Policies | SA HA DEV · `leave.policy.manage` | built | `time-off-11`..`13` |
| `/admin/admin-tools/delegates` | Workflow Delegates | Admin Tools → Workflow Delegates | SA · `delegation.manage` | built | `settings-05` |
| `/admin/admin-tools/users-roles` | Roles & Permissions | Admin Tools → Roles & Permissions | SA DEV · `role.view` | built | `settings-08`..`10` |
| `/admin/admin-tools/hr-capabilities` | What HR Can Do | Admin Tools → What HR Can Do | SA (directors only) | built | — |
| `/admin/admin-tools/managers` | Manager Management | Admin Tools → Manager Management | SA HA · `manager.appoint`, `manager.team.assign`, `manager.permissions.manage` | built | `settings-09` |
| `/admin/admin-tools/helpdesk-categories` | Helpdesk Categories | Admin Tools → Helpdesk Categories | SA HA HE DEV · `helpdesk.manage` | built | `recruitment-17` |
| `/admin/admin-tools/workforce-settings` | Workforce Settings | Admin Tools → Workforce Settings | SA (directors only) | built | — |
| `/admin/admin-tools/attendance-locks` | Attendance Locks | Admin Tools → Attendance Locks | SA (directors only) | built | — |
| `/admin/admin-tools/leave-reviewers` | Leave Reviewers | Admin Tools → Leave Reviewers | SA (directors only) | built | — |
| `/admin/admin-tools/calendar-adjustments` | Calendar Adjustments | Admin Tools → Calendar Adjustments | SA HA DEV · `leave.policy.manage`, `attendance.config.manage` | built | — |
| `/admin/admin-tools/device-sync` | Device Sync Requests | Admin Tools → Device Sync Requests | SA HA DEV · `attendance.devices.manage` | built | — |
| `/admin/admin-tools/leavers` | Leavers | Admin Tools → Leavers | SA HA · `leave.recalculate` | built | — |
| `/admin/admin-tools/workflow` | Workflow | Admin Tools → Workflow | SA HA HE AP DEV MGR* · `leave.approve`, `leave.view`, `attendance.regularization.approve`, `attendance.regularization.view` | built | — |
| `/admin/admin-tools/letter-settings` | Letter Settings | Admin Tools → Letter Settings | SA (directors only) | built | — |
| `/admin/admin-tools/templates` | Email & Letter Templates | Admin Tools → Email & Letter Templates | SA HA · `letters.template.manage` | built | `recruitment-18` |
| `/admin/admin-tools/devices` | Devices | Admin Tools → Devices | SA HA DEV · `attendance.devices.manage` | built | `settings-11` (integration cards) |
| `/admin/admin-tools/import-export` | Data Import/Export | Admin Tools → Data Import/Export | SA HA HE DEV · `import.manage`, `import.details.manage`, `invitations.send` | built | `recruitment-15` |
| `/admin/admin-tools/audit-log` | Audit Log | Admin Tools → Audit Log | SA DEV · `audit.view` | built | `recruitment-08` |
| `/admin/admin-tools/settings` | System Settings | Admin Tools → System Settings | SA · `settings.manage` | built | `settings-01`, `settings-19` |
| `/admin/settings/behaviours` | Default behaviours | Admin Tools → Default behaviours | SA (directors only) | built | — |
| `/admin/settings/policies` | Policy settings | Admin Tools → Policy settings | SA (directors only) | built | — |
| `/admin/settings/companies` | Companies | Admin Tools → Companies | SA (directors only) | built | — |
| `/admin/settings/data-retention` | Data retention | Admin Tools → Data retention | SA (directors only) | built | — |
| `/admin/settings/custom-fields` | Custom fields | Admin Tools → Custom fields | SA (directors only) | built | — |
| `/admin/admin-tools/templates/:id` | Template editor | from Email & Letter Templates | SA HA · `letters.template.manage` | built | `recruitment-19` |
| `/admin/security` | Account & security | (your name) | everyone signed in | built | `settings-18` |

---

## Board sections with no screen

Not built, no menu items, no made-up data.

| Board section | Frames | Why |
|---|---|---|
| Recruitment | `recruitment-01`..`19` | Built on another branch (Peeps) |
| Messages (chat) | `notifications-04`/`05` | No messaging; the top bar shows no chat icon |
| Subscription, plan picker, pay with card | `settings-13`..`17` | Not a product feature, and the portal never moves money |
| Integrations marketplace | `settings-11`/`12` | No integrations |
| Help Center FAQ, keyboard shortcuts, contact support content | `help-02`, `help-04`, `help-05` | No content yet; our Help is the Helpdesk |
| Performance | — | Phase 8 |
| Social sign-in, sign-up, company onboarding | `auth-04`/`05`, `auth-10`..`13` content | Accounts are created by HR |

## Deep links

Every URL above keeps working. An address the person may not open shows the forbidden state; an unknown address inside a portal goes to
that portal's home.
