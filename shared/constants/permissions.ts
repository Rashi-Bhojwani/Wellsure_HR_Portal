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
  "letters.generate", // issue / reissue / reproduce letters for employees in scope (any letter, including ones that carry a pay figure)
  "letters.issue.nopay", // issue letters the template engine proves contain no pay figure (HR's; the directors hold letters.generate)
  "invitations.send", // send and resend sign-in invitations (no pay data; parent: employee.create)
  "import.details.manage", // import non-pay details: org masters, employees, leave grants (never salary, bank or statutory; those are import.manage)
  // Phase 5 — Manager Management (commit E2)
  "manager.appoint", // promote an employee to manager / remove a manager (team must be empty)
  "manager.team.assign", // move employees into and out of a manager's team (effective-dated)
  "manager.permissions.manage", // per-manager permission exceptions (meta; manager-grantable keys only)
  // Phase 5 — Workflow Delegates (commit E3)
  "delegation.manage", // see and manage anyone's approval delegations (a manager manages their own with no key)
  // Phase 5 — Core reports (commit F)
  "reports.view", // the Reports app: headcount, joiners, leavers & attrition, birthdays & anniversaries, leave balance, LOP — in data scope
  "reports.attendance.view", // the attendance reports: late coming, excess hours, exceptions, attendance summary (parent: reports.view)
  "reports.leave.view", // the leave reports: leave balance, loss of pay (parent: reports.view)
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
  // Phase 3 commit 1 — HR corrects many employee-days in one action (never manager-grantable)
  "attendance.regularization.bulk", // preview, then raise or raise-and-approve a correction for a date range and a set of employees
  // Phase 3 commit 2 — Manual Override and Shift Override (HR only), and the raw punch log
  "attendance.override.manage", // set a day's status or times, or its shift, directly (preview first); release approved leave on a worked day
  "attendance.swipes.view", // Employee Swipes: the raw punch log in data scope (a manager: their team)
  // Phase 3 commit 3 — Period Finalisation
  "attendance.finalise", // lock a finished attendance cycle so it can reach payroll
  // Stage 1 (docs/plans/HR_CAPABILITIES.md): four pieces split from the keys above so a director can switch each for HR on its own. Each is held by everyone who held its parent.
  "attendance.manual.upload", // upload a manual-branch muster workbook (parent: attendance.manual.enter)
  "attendance.roster.manage", // plan and publish the shift roster (parent: attendance.config.manage)
  "attendance.exceptions.view", // the Attendance Exceptions queue (parent: attendance.view)
  "attendance.unlock", // open a finalised cycle again, with a reason (Super Admin only)
  // Phase 6 — payroll (docs/plans/PHASE_6.md §11). None of these is ever manager-grantable.
  "payroll.rules.view", // see the payroll rules, components, structures and templates, and their history
  "payroll.rules.manage", // edit them (an edit is an unconfirmed value until somebody else confirms it)
  "payroll.rules.confirm", // confirm a value (never the person who wrote it)
  "payroll.salary.view", // see salary, payroll runs and the payroll audit trail (the audit trail has no permission of its own)
  "payroll.salary.edit", // prepare salary revisions (a checker approves them)
  "payroll.adjust", // add payroll adjustments (bonus, recovery, arrears)
  "payroll.run", // the maker: calculate and submit runs, request publish / bank file / period actions
  "payroll.approve", // the checker: approve or reject any of those
  "payroll.unlock", // open a finalised payroll period (Super Admin only)
  "payroll.payslip.view", // see any employee's payslip
  "payroll.bank.view", // see bank transfer batches (masked)
  "reports.salary.view", // salary and statutory reports
  // Phase 6, P6-6 — the owners' secrets (docs/plans/PHASE_6.md §14J). Entered, revealed and confirmed only by the people who hold these.
  "payroll.identifiers.manage", // enter, change and reveal the company's PF, ESI, PT, LWF, PAN and TAN identifiers
  "payroll.identifiers.confirm", // confirm one by typing it again from the owner's own document (a different person from who entered it)
  "payroll.banklayout.manage", // enter and change the bank file layout and the company's debit account, and see them
  "payroll.banklayout.confirm", // check a bank layout against the bank's specification and confirm it (a different person)
  // PEEPS-BEGIN assets
  "assets.view", // the asset register: every asset, its holder and its history (holders narrowed to the caller's data scope)
  "assets.manage", // add and edit assets; issue, return, transfer; record a loss or damage
  "assets.settings.manage", // prepare the asset categories, statuses and conditions (a director other than the preparer confirms them)
  "assets.onboarding.issue", // retired (Q-14, 2026-11): HR manages the register again; no route uses it and no role holds it
  "office.workspace", // open the Wellsure Office workspace (every member; the directors)
  "office.members.manage", // appoint and remove Wellsure Office members (directors only; a different director confirms)
  "peeps.settings.manage", // prepare Peeps working settings (a director who did not enter them confirms)
  "unmute.manage", // authorise Unmute hosts and look after every booking (directors only)
  "badges.give", // give a badge (who may is also decided by the badge settings)
  "nudges.send", // send a private nudge (who may is also decided by the nudge settings)
  "avatars.moderate", // remove someone else's inappropriate profile photo, with a reason (HR and the directors; never replace it)
  "leave.documents.view", // open the supporting documents of the new leave types (HR and the directors; every open audited)
  // PEEPS-END
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
  "Payroll",
  // PEEPS-BEGIN assets
  "Assets",
  "Wellsure Office",
  // PEEPS-END
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
  "letters.issue.nopay": { group: "Documents & letters", label: "Issue letters without pay figures", description: "Issue letters from a template the system has checked contains no pay figure and no field that could carry one. Any other letter needs Issue letters." },
  "invitations.send": { group: "Employees", label: "Send invitations", description: "Send and resend sign-in invitations. No pay data is involved." },
  "import.details.manage": { group: "Organisation & system", label: "Import employee details", description: "Import org masters, employees and leave grants from a spreadsheet. A file with a salary, bank or statutory column is refused; those imports need Import Center." },
  "letters.generate": { group: "Documents & letters", label: "Issue letters", description: "Issue, reissue and reproduce letters for employees in their data scope.", managerGrantable: true },
  "manager.appoint": { group: "Managers", label: "Appoint and remove managers", description: "Promote an employee to manager, or remove a manager once their team has been reassigned." },
  "manager.team.assign": { group: "Managers", label: "Assign teams", description: "Move employees into and out of a manager's team (effective-dated), and work the Unassigned list." },
  "manager.permissions.manage": { group: "Managers", label: "Manager permission exceptions", description: "Grant or revoke individual permissions for a manager — only from the manager-grantable list, never sensitive data.", meta: true },
  "delegation.manage": { group: "Managers", label: "Workflow delegations", description: "See every manager's approval delegations, set one up for a manager, and revoke one. Moves no permission: a delegate must already hold Approve leave." },
  "reports.view": { group: "Reports", label: "Reports", description: "Headcount, joiners, leavers & attrition, birthdays & anniversaries, leave balance and LOP reports, with Excel export — only for people in their data scope.", managerGrantable: true },
  "reports.attendance.view": {
    group: "Reports",
    label: "Attendance reports",
    description: "Late coming, excess hours, attendance exceptions and the attendance summary, in their data scope. Also needs Reports.",
    managerGrantable: true,
  },
  "reports.leave.view": {
    group: "Reports",
    label: "Leave reports",
    description: "Leave balance and loss of pay, in their data scope. Also needs Reports.",
    managerGrantable: true,
  },
  "reports.liability.view": { group: "Reports", label: "Leave liability report", description: "Leave liability in rupees (encashable balance × the encashment daily rate). Salary-derived once payroll exists, so it sits with salary data, never with managers." },
  "attendance.view": { group: "Attendance", label: "View attendance", description: "See other employees' attendance — calendar, day detail, muster, Who Is In? — in their data scope." },
  "attendance.config.manage": { group: "Attendance", label: "Attendance settings", description: "Shifts and their sessions, week-off patterns, policies, assignments, the attendance cycle, and who marks which branch." },
  "attendance.manual.enter": {
    group: "Attendance",
    label: "Mark attendance manually",
    description: "Enter IN/OUT times (or a status) for employees with no biometric device — only in the branches assigned to them. Changes open days only; Admin finalises.",
    managerGrantable: true,
  },
  "attendance.manual.upload": {
    group: "Attendance",
    label: "Upload manual attendance",
    description: "Upload the manual-branch muster workbook (template, preview, commit). Also needs Mark attendance manually, and only in the branches assigned to them.",
    managerGrantable: true,
  },
  "attendance.roster.manage": { group: "Attendance", label: "Shift roster", description: "Plan the shift roster and publish it (preview first)." },
  "attendance.exceptions.view": { group: "Attendance", label: "Attendance exceptions queue", description: "See the queue of days with a missing punch, a shortfall, no shift or an unmapped device ID. Also needs View attendance." },
  "attendance.process": { group: "Attendance", label: "Process attendance", description: "Re-process a date range from raw punches and manual entries, before the period is locked." },
  "attendance.devices.manage": { group: "Attendance", label: "Biometric devices", description: "Devices, sync agents and their keys, unmapped punches, clock warnings." },
  "attendance.regularization.view": { group: "Attendance", label: "View regularizations", description: "See attendance regularization requests (e.g. forgot to punch out) from people in their data scope — a manager: their team.", managerGrantable: true },
  "attendance.regularization.approve": { group: "Attendance", label: "Approve regularizations", description: "Approve or reject attendance regularization requests from people in their data scope, never their own. The day is recomputed with the corrected time.", managerGrantable: true },
  "attendance.regularization.bulk": {
    group: "Attendance",
    label: "Correct attendance in bulk",
    description: "Raise, or raise and approve, an attendance correction for a date range and a set of employees at once (for example a whole branch after a device outage), after a preview. Company-wide; never one's own days.",
  },
  "attendance.override.manage": {
    group: "Attendance",
    label: "Override attendance days and shifts",
    description: "Set a day's status or times, or its shift, directly (after a preview), including marking a day of approved leave as worked and returning the leave balance. Company-wide; never one's own days.",
  },
  "attendance.swipes.view": { group: "Attendance", label: "View Employee Swipes", description: "See the raw punch log — every punch exactly as the device sent it — for people in their data scope. Punches not matched to anyone are visible company-wide only.", managerGrantable: true },
  "attendance.finalise": { group: "Attendance", label: "Finalise attendance periods", description: "Lock a finished attendance cycle once nothing blocks it, so its attendance can reach payroll. Locked days can't be changed." },
  "payroll.rules.view": { group: "Payroll", label: "View payroll rules", description: "See every payroll rule, component, structure and template, whether it is Placeholder or Confirmed, who confirmed it and when, and its history." },
  "payroll.rules.manage": { group: "Payroll", label: "Edit payroll rules", description: "Change a payroll rule, component, structure or template. The change is an unconfirmed value (usable for test runs only) until a different person confirms it." },
  "payroll.rules.confirm": { group: "Payroll", label: "Confirm payroll rules", description: "Confirm a rule value that somebody else wrote. For a statutory figure the confirmer types the value again. Never the person who edited it." },
  "payroll.salary.view": { group: "Payroll", label: "View salary and payroll", description: "See salary, payroll runs, payslip figures and the Payroll audit trail. The audit trail is deliberately not a separate permission, so it can never be more open than salary." },
  "payroll.salary.edit": { group: "Payroll", label: "Prepare salary revisions", description: "Prepare a salary revision or arrears. A different person approves it before it takes effect. Nobody can edit their own salary." },
  "payroll.adjust": { group: "Payroll", label: "Add payroll adjustments", description: "Add a one-off earning, deduction or arrears line to a payroll run." },
  "payroll.run": { group: "Payroll", label: "Prepare payroll runs (maker)", description: "Calculate a payroll run and submit it, and request publishing, the bank file or a period lock. A different person (the checker) approves." },
  "payroll.approve": { group: "Payroll", label: "Approve payroll actions (checker)", description: "Approve or reject a payroll run, payslip publishing, the bank file, a period lock or a salary revision prepared by somebody else." },
  "payroll.unlock": { group: "Payroll", label: "Unlock payroll periods", description: "Open a finalised payroll period again, with a written reason and a checker. Super Admin only; not possible once payslips are published or a bank file exists.", meta: true },
  "payroll.payslip.view": { group: "Payroll", label: "View any payslip", description: "See any employee's payslip. Employees always see their own." },
  "payroll.bank.view": { group: "Payroll", label: "View bank transfer batches", description: "See bank transfer batches (account numbers masked). Nothing here moves money: the file is for HR to upload to the bank." },
  "payroll.identifiers.manage": { group: "Sensitive data", label: "Company identifiers: enter and reveal", description: "Enter or change the company's PF, ESI, PT, LWF, PAN and TAN identifiers, and reveal them (audited). They are stored encrypted. Not the same as editing payroll rules." },
  "payroll.identifiers.confirm": { group: "Sensitive data", label: "Company identifiers: confirm", description: "Confirm a company identifier by typing it again from the company's own document. Never the person who entered it. Does not reveal anything." },
  "payroll.banklayout.manage": { group: "Sensitive data", label: "Bank file layout and debit account: enter", description: "Enter or change the bank file layout and the company's debit account, and see them (audited). They are stored encrypted." },
  "payroll.banklayout.confirm": { group: "Sensitive data", label: "Bank file layout and debit account: confirm", description: "Check the bank file layout against the bank's own specification and confirm it. Never the person who entered it. Sees the layout, to check it." },
  "reports.salary.view": { group: "Reports", label: "Salary and statutory reports", description: "Salary register, variance report and the PF, ESI, PT and LWF statements, with Excel export." },
  "attendance.unlock": { group: "Attendance", label: "Unlock attendance periods", description: "Open a finalised attendance cycle again, with a written reason (and a warning if payroll has used it). Super Admin only.", meta: true },
  "helpdesk.manage": { group: "Helpdesk", label: "Helpdesk queue", description: "Work the ticket queue: assign, status, replies, internal notes, categories." },
  "helpdesk.sensitive.view": { group: "Helpdesk", label: "Sensitive tickets", description: "See tickets in categories marked sensitive (e.g. Payroll & Salary, Grievance)." },
  // PEEPS-BEGIN assets
  "assets.view": { group: "Assets", label: "View the asset register", description: "See every asset, who holds it and its full history. Holders outside the person's data scope are not shown." },
  "assets.manage": { group: "Assets", label: "Manage the asset register", description: "Add and edit assets, issue them to employees, take them back, transfer them, and record a loss or damage. No money is involved." },
  "assets.settings.manage": { group: "Assets", label: "Prepare asset settings", description: "Enter the lists of asset categories, statuses and conditions. A list is used only after a director who did not enter it confirms it." },
  "assets.onboarding.issue": { group: "Assets", label: "Issue assets at onboarding (retired)", description: "Retired: HR now issues assets from the register itself. Opens nothing." },
  "office.workspace": { group: "Wellsure Office", label: "Open the Wellsure Office", description: "Given only by Wellsure Office membership, which the directors decide. A grant made here does nothing on its own." },
  "office.members.manage": { group: "Wellsure Office", label: "Manage Wellsure Office members", description: "Appoint and remove members. Directors only; a different director confirms each change." },
  "peeps.settings.manage": { group: "Wellsure Office", label: "Prepare Peeps settings", description: "Enter Peeps working settings. A director who did not enter a setting confirms it before it is used." },
  "unmute.manage": { group: "Wellsure Office", label: "Look after Unmute", description: "Authorise hosts and handle bookings when a host is removed. Directors only." },
  "badges.give": { group: "Wellsure Office", label: "Give badges", description: "Give badges to employees, while the badge settings allow it." },
  "nudges.send": { group: "Wellsure Office", label: "Send private nudges", description: "Send a private note to an employee, while the nudge settings allow it." },
  "leave.documents.view": { group: "Leave", label: "Open leave supporting documents", description: "Open the medical certificates and similar papers attached to the new leave types. Every open is recorded." },
  "avatars.moderate": { group: "Employees", label: "Remove a profile photo", description: "Remove someone else's inappropriate profile photo, with a reason (audited). Never replaces it: only the person changes their own photo." },
  // PEEPS-END
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
