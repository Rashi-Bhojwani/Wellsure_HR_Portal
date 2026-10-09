// Permission keys (spec §2), Phase 1 + Phase 4. Single source of truth for
// backend (RBAC middleware, seed data) and frontend (menu-config
// permission gating) — never hardcode a permission string anywhere else.
export const PERMISSION_KEYS = [
  // Phase 1
  "employee.view",
  "employee.create",
  "employee.edit",
  "employee.export",
  "employee.manage",
  "employee.statutory.view",
  "employee.statutory.edit",
  "employee.bank.view",
  "employee.bank.edit",
  "employee.separate",
  "employee.separate.view",
  "profile.changerequest.approve",
  "org.manage",
  "role.view", // read-only view of roles, their permissions and data scope (role DEFINITIONS are changed only by SUPER_ADMIN — E1)
  "user.security.manage",
  "import.manage",
  "audit.view",
  "settings.manage",
  // Phase 4 — Leave
  "leave.apply.onBehalf", // apply for leave as someone else
  "leave.view", // see other employees' leave requests/ledger/balances (TEAM/ALL, via resolveDataScope)
  "leave.approve", // approve/reject/bulk-approve/cancel-on-behalf
  "leave.grant", // Leave Granter — manual grant/debit + manual comp-off credit
  "leave.policy.manage", // leave types, policies, holidays, restricted holidays
  "leave.recalculate", // Leave Recalculator
  "leave.yearend.manage", // Year End Process
  // Phase 5 — Homepage, Dashboards, Notifications
  "announcements.manage", // create/edit/deactivate the Home page HR banner
  // Phase 5 — Engage
  "engage.moderate", // soft-hide a post (and its backing kudos/poll) from the feed
  "engage.groups.manage", // create/rename/deactivate groups + manage membership
  "engage.autopost.manage", // per-kind template/enabled toggle + the shared daily run hour
  // Phase 5 — People / Document Center (commit C)
  "documents.manage", // company documents (upload/edit/archive, download stats) + document categories
  "employee.documents.view", // see another employee's HR-held documents (letters, ID proofs); download is audit-logged
  "employee.documents.manage", // upload/edit/archive another employee's documents
  "documents.pay.view", // documents in PAY-sensitivity categories (letters, payslips) — never a manager's (2026-10-03)
  // Phase 5 — Helpdesk (commit D)
  "helpdesk.manage", // the HR ticket queue: assign, status, priority, replies, internal notes, categories
  "helpdesk.sensitive.view", // tickets in categories flagged sensitive (e.g. Payroll & Salary, Grievance)
  "letters.template.manage", // letter templates: edit (new version), activate, typed fields, letterhead & signatory
  "letters.generate", // issue / reissue / reproduce letters for employees in scope
  // Phase 5 — Manager Management (commit E2)
  "manager.appoint", // promote an employee to manager / remove a manager (team must be empty)
  "manager.team.assign", // move employees into and out of a manager's team (effective-dated)
  "manager.permissions.manage", // per-manager permission exceptions (meta; manager-grantable keys only)
  // Phase 5 — Workflow Delegates (commit E3)
  "delegation.manage", // see and manage anyone's approval delegations (a manager manages their own with no key)
  // Phase 5 — Core reports (commit F)
  "reports.view", // the Reports app: headcount, joiners, leavers & attrition, birthdays & anniversaries, leave balance, LOP — in data scope
  "reports.liability.view", // leave liability (days × encashment rate — salary-derived from Phase 6, so never a manager's)
  // Phase 2 — Attendance (docs/plans/PHASE_2.md §2.4)
  "attendance.view", // others' attendance (calendar, day detail, muster, Who Is In?) in data scope
  "attendance.config.manage", // shifts, sessions, week-off patterns, policies, assignments, the cycle, manual-entry branches
  "attendance.manual.enter", // mark attendance (IN/OUT times or status) for manual-capture employees in ASSIGNED BRANCHES only
  "attendance.process", // re-process a date range from raw punches and manual entries, before the period is locked
  "attendance.devices.manage", // biometric devices, agents and keys, unmapped punches, clock flags, simulator controls
  // Phase 2 P2-E — regularization's first kind (forgot to punch), brought forward from Phase 3
  "attendance.regularization.view", // see regularization requests in data scope (a manager: their team)
  "attendance.regularization.approve", // approve or reject them, in data scope, never one's own
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// ── Permission catalog (Phase 5 commit E1) ─────────────────────────────
// What the Roles & Permissions screens show instead of raw keys. `meta`
// marks permissions that confer power over OTHER people's access (sign-in,
// 2FA, security policy): only SUPER_ADMIN may grant them, and never to the
// MANAGER role or a MANAGER holder (E1 rule 4). Typed as a complete record,
// so adding a key above without describing it here fails to compile.
export interface PermissionInfo {
  group: string;
  label: string;
  description: string;
  meta?: true;
  // E2: one of the few keys a MANAGER holder may ever have (see
  // MANAGER_GRANTABLE_KEYS below).
  managerGrantable?: true;
}

export const PERMISSION_GROUPS = [
  "Employees",
  "Sensitive data",
  "Organisation & system",
  "Access & security",
  "Managers",
  "Leave",
  "Attendance",
  "Home & Engage",
  "Documents & letters",
  "Helpdesk",
  "Reports",
] as const;

export const PERMISSION_CATALOG: Record<PermissionKey, PermissionInfo> = {
  "employee.view": { group: "Employees", label: "View employees", description: "See employees in their data scope: grid, profiles, history.", managerGrantable: true },
  "employee.create": { group: "Employees", label: "Add employees", description: "Run the Add Employee wizard and send invitations." },
  "employee.edit": { group: "Employees", label: "Edit employees", description: "Edit official and personal details, job and name history." },
  "employee.export": { group: "Employees", label: "Export employees", description: "Export the employee grid to Excel/CSV." },
  "employee.manage": { group: "Employees", label: "Manage employee records", description: "Saved views and other employee-grid administration." },
  "employee.separate": { group: "Employees", label: "Separate employees", description: "Initiate and cancel separations (exit with last working day)." },
  "employee.separate.view": { group: "Employees", label: "View separations", description: "See the separations list." },
  "profile.changerequest.approve": { group: "Employees", label: "Approve profile changes", description: "Approve or reject employees' bank, statutory and personal change requests." },
  "employee.statutory.view": { group: "Sensitive data", label: "View statutory details", description: "Reveal PAN, Aadhaar, UAN and ESI numbers (audited)." },
  "employee.statutory.edit": { group: "Sensitive data", label: "Edit statutory details", description: "Change PAN, Aadhaar, UAN and ESI numbers." },
  "employee.bank.view": { group: "Sensitive data", label: "View bank details", description: "Reveal bank account numbers (audited)." },
  "employee.bank.edit": { group: "Sensitive data", label: "Edit bank details", description: "Change an employee's bank account." },
  "org.manage": { group: "Organisation & system", label: "Organisation setup", description: "Cities, branches, departments, designations, grades and cost centres." },
  "import.manage": { group: "Organisation & system", label: "Data import", description: "Run Import Center uploads and the reconciliation report." },
  "audit.view": { group: "Organisation & system", label: "View audit log", description: "Read the audit log." },
  "settings.manage": { group: "Access & security", label: "System settings", description: "Security policy (password rules, lockout, which roles need 2FA) and other system settings.", meta: true },
  "role.view": { group: "Access & security", label: "View roles & permissions", description: "See what each role may do, read-only. Only a Super Admin can change roles." },
  "user.security.manage": { group: "Access & security", label: "Manage others' sign-in security", description: "Reset another person's 2FA, unlock accounts and resend invitations.", meta: true },
  "leave.apply.onBehalf": { group: "Leave", label: "Apply on behalf", description: "Apply for leave for someone else in their data scope.", managerGrantable: true },
  "leave.view": { group: "Leave", label: "View others' leave", description: "See other employees' requests, ledgers and balances in their data scope.", managerGrantable: true },
  "leave.approve": { group: "Leave", label: "Approve leave", description: "Approve, reject or cancel leave requests in their data scope.", managerGrantable: true },
  "leave.grant": { group: "Leave", label: "Leave Granter", description: "Manual leave grants/debits and comp-off credits." },
  "leave.policy.manage": { group: "Leave", label: "Leave policies & holidays", description: "Leave types, policies, holidays and restricted holidays." },
  "leave.recalculate": { group: "Leave", label: "Leave Recalculator", description: "Preview and commit ledger recalculations." },
  "leave.yearend.manage": { group: "Leave", label: "Year End Process", description: "Run year-end encashment and carry-forward." },
  "announcements.manage": { group: "Home & Engage", label: "Announcements", description: "Create and manage the Home page HR announcements." },
  "engage.moderate": { group: "Home & Engage", label: "Moderate Engage", description: "Hide posts, kudos and polls from the feed." },
  "engage.groups.manage": { group: "Home & Engage", label: "Engage groups", description: "Create and manage Engage groups and membership." },
  "engage.autopost.manage": { group: "Home & Engage", label: "Engage auto-posts", description: "Birthday, joining and anniversary post templates and timing." },
  "documents.manage": { group: "Documents & letters", label: "Company documents", description: "Publish company documents and manage document categories." },
  "employee.documents.view": { group: "Documents & letters", label: "View employee documents", description: "See and download employees' HR-held documents (audited).", managerGrantable: true },
  "documents.pay.view": { group: "Sensitive data", label: "View pay documents", description: "See and download documents in pay categories — issued letters, payslips — and a letter's typed values (e.g. CTC). Never manager-grantable." },
  "employee.documents.manage": { group: "Documents & letters", label: "Manage employee documents", description: "Upload, edit and archive employees' documents." },
  "letters.template.manage": { group: "Documents & letters", label: "Letter templates", description: "Edit letter templates, the letterhead and the signatory." },
  "letters.generate": { group: "Documents & letters", label: "Issue letters", description: "Issue, reissue and reproduce letters for employees in their data scope.", managerGrantable: true },
  "manager.appoint": { group: "Managers", label: "Appoint and remove managers", description: "Promote an employee to manager, or remove a manager once their team has been reassigned." },
  "manager.team.assign": { group: "Managers", label: "Assign teams", description: "Move employees into and out of a manager's team (effective-dated), and work the Unassigned list." },
  "manager.permissions.manage": { group: "Managers", label: "Manager permission exceptions", description: "Grant or revoke individual permissions for a manager — only from the manager-grantable list, never sensitive data.", meta: true },
  "delegation.manage": { group: "Managers", label: "Workflow delegations", description: "See every manager's approval delegations, set one up for a manager, and revoke one. Moves no permission: a delegate must already hold Approve leave." },
  "reports.view": { group: "Reports", label: "Reports", description: "Headcount, joiners, leavers & attrition, birthdays & anniversaries, leave balance and LOP reports, with Excel export — only for people in their data scope.", managerGrantable: true },
  "reports.liability.view": { group: "Reports", label: "Leave liability report", description: "Leave liability in rupees (encashable balance × the encashment daily rate). Salary-derived once payroll exists, so it sits with salary data, never with managers." },
  "attendance.view": { group: "Attendance", label: "View attendance", description: "See other employees' attendance — calendar, day detail, muster, Who Is In? — in their data scope." },
  "attendance.config.manage": { group: "Attendance", label: "Attendance settings", description: "Shifts and their sessions, week-off patterns, policies, assignments, the attendance cycle, and who marks which branch." },
  "attendance.manual.enter": {
    group: "Attendance",
    label: "Mark attendance manually",
    description: "Enter IN/OUT times (or a status) for employees with no biometric device — only in the branches assigned to them. Changes open days only; Admin finalises.",
    managerGrantable: true,
  },
  "attendance.process": { group: "Attendance", label: "Process attendance", description: "Re-process a date range from raw punches and manual entries, before the period is locked." },
  "attendance.devices.manage": { group: "Attendance", label: "Biometric devices", description: "Devices, sync agents and their keys, unmapped punches, clock warnings." },
  "attendance.regularization.view": { group: "Attendance", label: "View regularizations", description: "See attendance regularization requests (e.g. forgot to punch out) from people in their data scope — a manager: their team.", managerGrantable: true },
  "attendance.regularization.approve": { group: "Attendance", label: "Approve regularizations", description: "Approve or reject attendance regularization requests from people in their data scope, never their own. The day is recomputed with the corrected time.", managerGrantable: true },
  "helpdesk.manage": { group: "Helpdesk", label: "Helpdesk queue", description: "Work the ticket queue: assign, status, replies, internal notes, categories." },
  "helpdesk.sensitive.view": { group: "Helpdesk", label: "Sensitive tickets", description: "See tickets in categories marked sensitive (e.g. Payroll & Salary, Grievance)." },
};

// "Grant leave approval" — the one-click grant on Manager Management (user
// decision 2026-10-03: a manager starts with nothing; approving the team's
// leave is the common grant). Both keys are manager-grantable; view is
// needed to see the review queue, approve to decide.
export const LEAVE_APPROVAL_GRANT = ["leave.view", "leave.approve"] as const satisfies readonly PermissionKey[];

export const META_PERMISSION_KEYS = PERMISSION_KEYS.filter((k) => PERMISSION_CATALOG[k].meta);

// ── Manager-grantable keys (Phase 5 commit E2, user decision 2026-10-02) ─
// The ONLY permissions a MANAGER holder may ever have — through the MANAGER
// role, a per-user GRANT or any other role. Enforced in code even against a
// Super Admin ("the one place I want the system to overrule me"), and again
// when access is resolved (backend lib/permissions.ts). Every key here is
// TEAM-scoped at every endpoint that checks it, with an IDOR test
// (modules/managers/__tests__/managerReach.test.ts). Bank, statutory and
// salary data are deliberately and permanently absent; widening this list
// is a reviewed code change with its own scope tests, never a click.
export const MANAGER_GRANTABLE_KEYS = PERMISSION_KEYS.filter((k) => PERMISSION_CATALOG[k].managerGrantable);
