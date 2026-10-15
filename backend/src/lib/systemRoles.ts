import { PERMISSION_KEYS } from "@shared/constants/permissions";
import type { DataScope } from "@shared/constants/roles";

// The seven system roles' DEFAULT definitions (spec §2) — used to seed a dev
// database and, via ensureAccessCatalog() (lib/accessCatalog.ts), to create
// any that are missing on staging/production. Once a role exists its
// permissions and scope belong to the Super Admins (Roles & Permissions
// screen); these defaults never overwrite an existing role.

export interface SystemRoleDefinition {
  code: string;
  name: string;
  permissions: readonly string[];
  dataScope: DataScope;
}

// HR_EXECUTIVE deliberately excludes employee.statutory.* and
// employee.bank.* — spec §2 says "no salary or bank data"; PAN/Aadhaar/
// UAN are held to the same bar as bank data here, so HR_EXECUTIVE is
// blocked from both reveal endpoints, not just bank (commit C IDOR test
// covers this explicitly).
const HR_EXECUTIVE_PERMS: string[] = [
  "employee.view",
  "employee.create",
  "employee.edit",
  "employee.export",
  "employee.manage",
  "employee.separate",
  "employee.separate.view",
  "profile.changerequest.approve",
  "org.manage",
  "import.manage",
  "role.view",
  // Phase 4 — leave administration stays with HR_EXECUTIVE; config/
  // financial actions (policy.manage/recalculate/yearend.manage) are
  // HR_ADMIN+ only, same narrowing as settings.manage/import.manage.
  "leave.view",
  "leave.approve",
  "leave.grant",
  "leave.apply.onBehalf",
  // Phase 5 commit C — Document Center admin and HR-held employee documents.
  // Not salary/bank data, so HR_EXECUTIVE holds them too; MANAGER does not.
  "documents.manage",
  "employee.documents.view",
  "employee.documents.manage",
  // Phase 5 commit D — the helpdesk queue, but NOT sensitive categories
  // (Payroll & Salary, Grievance): same bar as "no salary or bank data".
  "helpdesk.manage",
  // Phase 5 commit D2 — issuing letters (templates themselves are HR_ADMIN+).
  "letters.generate",
  // Phase 5 commit F — the Reports app (leave liability is HR_ADMIN+ only).
  "reports.view",
  // Phase 2 — attendance operations (settings and devices are HR_ADMIN+).
  "attendance.view",
  "attendance.manual.enter",
  "attendance.process",
  // Phase 2 P2-E — regularization (the forgot-to-punch request): HR decides any.
  "attendance.regularization.view",
  "attendance.regularization.approve",
  // Phase 3 commit 2 — the raw punch log.
  "attendance.swipes.view",
];
const HR_ADMIN_PERMS: string[] = [
  ...HR_EXECUTIVE_PERMS,
  "helpdesk.sensitive.view",
  "letters.template.manage",
  "employee.statutory.view",
  "employee.statutory.edit",
  "employee.bank.view",
  "employee.bank.edit",
  // 2026-10-03 — documents in PAY categories (issued letters carry CTC).
  "documents.pay.view",
  "user.security.manage",
  "audit.view",
  "settings.manage",
  // Phase 3 commit 1 — bulk attendance corrections (HR Admin, not HR Executive).
  "attendance.regularization.bulk",
  // Phase 3 commit 2 — Manual Override and Shift Override (HR Admin, not HR Executive).
  "attendance.override.manage",
  // Phase 3 commit 3 — locking a finished attendance cycle (HR Admin, Payroll Admin; unlocking is Super Admin only).
  "attendance.finalise",
  "leave.policy.manage",
  "leave.recalculate",
  "leave.yearend.manage",
  // Phase 5 — config/financial actions stay HR_ADMIN+, same narrowing as settings.manage/leave.policy.manage
  "announcements.manage",
  "engage.moderate",
  "engage.groups.manage",
  "engage.autopost.manage",
  // Phase 5 commit E2 — Manager Management (user decision: HR_ADMIN holds
  // all three by default; a Super Admin can revoke them).
  "manager.appoint",
  "manager.team.assign",
  "manager.permissions.manage",
  // Phase 5 commit E3 — Workflow Delegates.
  "delegation.manage",
  // Phase 5 commit F — leave liability (salary-derived from Phase 6).
  "reports.liability.view",
  // Phase 2 — attendance settings and biometric devices.
  "attendance.config.manage",
  "attendance.devices.manage",
];
const PAYROLL_ADMIN_PERMS = ["employee.view", "employee.bank.view", "employee.statutory.view", "leave.view", "reports.view", "reports.liability.view", "documents.pay.view", "attendance.view", "attendance.finalise"];
// leave.approve/leave.view here is a real fix over commit A's original
// seed, caught while designing commit B's approve endpoint: MANAGER is
// TEAM-scoped (its Role.dataScope), but scope alone doesn't grant a
// permission — without these, no manager could ever approve their own
// team's leave, contradicting "Manager and HR: approve/reject..." (the
// explicit ask). All three stay TEAM-limited by the role's scope, not by
// being narrower permission strings.
// User decision 2026-10-03: being appointed a manager grants NOTHING on its
// own — a manager starts exactly like a plain employee who happens to have
// people under them. Every power is granted per manager by Admin (Manager
// Management → Grant leave approval, or the Access tab), always within the
// manager-grantable ceiling. The role's definition is locked empty
// (access/service.ts updateRole), so it can't drift back.
const MANAGER_PERMS: string[] = [];
const SUPER_ADMIN_PERMS = PERMISSION_KEYS;

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  // SUPER_ADMIN's rows are informational only: lib/permissions.ts gives a
  // SUPER_ADMIN holder every key and ALL scope in code (E1).
  { code: "SUPER_ADMIN", name: "Super Admin", permissions: SUPER_ADMIN_PERMS, dataScope: "ALL" },
  { code: "HR_ADMIN", name: "HR Admin", permissions: HR_ADMIN_PERMS, dataScope: "ALL" },
  { code: "HR_EXECUTIVE", name: "HR Executive", permissions: HR_EXECUTIVE_PERMS, dataScope: "ALL" },
  { code: "PAYROLL_ADMIN", name: "Payroll Admin", permissions: PAYROLL_ADMIN_PERMS, dataScope: "ALL" },
  { code: "MANAGER", name: "Manager", permissions: MANAGER_PERMS, dataScope: "TEAM" },
  { code: "APPROVER", name: "Approver", permissions: ["leave.approve", "leave.view"], dataScope: "ALL" }, // Phase 4 — more
  // permissions arrive with Phase 6 (payroll maker-checker)
  { code: "EMPLOYEE", name: "Employee", permissions: [], dataScope: "SELF" },
];
