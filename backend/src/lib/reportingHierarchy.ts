// The company's reporting structure (Phase 5 commit E2, hierarchy model A —
// user decision 2026-10-02, docs/plans/PHASE_5.md §E2):
//
//   Admin (synthetic root: the Super Admins)
//     ├── Managers ─── Employees
//     └── HR Admins (no team)
//
// Exactly three levels. Super Admins, Managers and HR Admins sit at the top
// level: they have NO reporting manager (the Admin root isn't a person, so
// neither owner is arbitrarily "the boss", and a manager's leave reaches both
// Super Admins). Everyone else reports to an active MANAGER holder — or to
// nobody, which puts them on the Unassigned list.
//
// Pure rule checks over roles; the database-backed enforcement that calls
// these lives in modules/managers/hierarchy.ts (service layer, Excel import)
// and prisma/seed.ts (seed assertion).

export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";
export const MANAGER_ROLE_CODE = "MANAGER";
export const HR_ADMIN_ROLE = "HR_ADMIN";
export const EMPLOYEE_ROLE = "EMPLOYEE";
// Roles whose holders sit directly under the Admin root.
export const TOP_LEVEL_ROLE_CODES = [SUPER_ADMIN_ROLE, MANAGER_ROLE_CODE, HR_ADMIN_ROLE] as const;
// Kept for older callers: who counts as "Admin" — the root itself.
export const ADMIN_ROLE_CODES = [SUPER_ADMIN_ROLE] as const;

const LABELS: Record<string, string> = { SUPER_ADMIN: "Super Admin", MANAGER: "Manager", HR_ADMIN: "HR Admin" };

export const isTopLevel = (roleCodes: readonly string[]) => roleCodes.some((r) => (TOP_LEVEL_ROLE_CODES as readonly string[]).includes(r));
export const isManager = (roleCodes: readonly string[]) => roleCodes.includes(MANAGER_ROLE_CODE);

export interface PersonRoles {
  code: string;
  roleCodes: readonly string[];
}
export interface ManagerRef extends PersonRoles {
  active: boolean;
}

// The reporting line of one person; null = valid. `manager` null = nobody,
// which is required for top-level people and allowed (Unassigned) for others.
export function checkReportingLine(person: PersonRoles, manager: ManagerRef | null): string | null {
  if (isTopLevel(person.roleCodes)) {
    if (!manager) return null;
    const label = LABELS[person.roleCodes.find((r) => (TOP_LEVEL_ROLE_CODES as readonly string[]).includes(r))!];
    return `${person.code} is a ${label} and sits directly under Admin, so they can't have a reporting manager (${manager.code} given).`;
  }
  if (!manager) return null;
  if (!isManager(manager.roleCodes)) {
    return `${person.code} can't report to ${manager.code}: a reporting manager must hold the Manager role (${manager.roleCodes.join(", ") || "no roles"}).`;
  }
  if (!manager.active) return `${person.code} can't report to ${manager.code}: that manager is no longer active.`;
  return null;
}

// E2 manager-grantable guard, at the role level: a MANAGER holder may hold
// no other role except EMPLOYEE. Every other role carries keys outside the
// manager-grantable list or a company-wide data scope, which is exactly what
// a manager must never get, even by a Super Admin's click.
export function checkRoleCombination(roleCodes: readonly string[]): string | null {
  if (!isManager(roleCodes)) return null;
  const others = roleCodes.filter((r) => r !== MANAGER_ROLE_CODE && r !== EMPLOYEE_ROLE);
  if (others.length === 0) return null;
  return `A manager can't also hold ${others.map((r) => LABELS[r] ?? r).join(", ")}: a manager's access is limited to their own team.`;
}

export interface ReportingLine {
  employeeCode: string;
  roleCodes: string[];
  managerCode: string | null;
  managerRoleCodes: string[];
  managerActive: boolean;
}

// One human-readable message per broken line; empty = valid. Used by the
// seed assertion over every active person's current placement.
export function findReportingLineViolations(lines: ReportingLine[]): string[] {
  const violations: string[] = [];
  for (const line of lines) {
    const person = { code: line.employeeCode, roleCodes: line.roleCodes };
    const manager = line.managerCode ? { code: line.managerCode, roleCodes: line.managerRoleCodes, active: line.managerActive } : null;
    const v = checkReportingLine(person, manager) ?? checkRoleCombination(line.roleCodes);
    if (v) violations.push(v);
  }
  return violations;
}
