// The company's reporting structure is strictly three flat levels
// (user decision 2026-09-30, docs/plans/PHASE_5.md commit E):
//
//   Admin  →  Managers (report directly to Admin)  →  Employees (report to a Manager)
//
// Managers never report to other managers. This module holds the pure
// rule check over reporting lines. Commit C uses it as a seed-level
// assertion (prisma/seed.ts); commit E adds enforcement in the service
// layer and the Excel import, and formally decides which roles count as
// "Admin" — until then that's ADMIN_ROLE_CODES below.

export const MANAGER_ROLE_CODE = "MANAGER";
// Provisional: SUPER_ADMIN is "Admin". HR_ADMIN is admin-level staff who
// may report to Admin but never manages a team. Commit E's plan settles this.
export const ADMIN_ROLE_CODES = ["SUPER_ADMIN"] as const;
const ADMIN_LEVEL_REPORT_ROLE_CODES = ["SUPER_ADMIN", "HR_ADMIN"];

export interface ReportingLine {
  employeeCode: string;
  roleCodes: string[];
  managerCode: string;
  managerRoleCodes: string[];
}

// One human-readable message per broken line; empty = valid.
export function findReportingLineViolations(lines: ReportingLine[]): string[] {
  const violations: string[] = [];
  for (const line of lines) {
    const managerIsManager = line.managerRoleCodes.includes(MANAGER_ROLE_CODE);
    const managerIsAdmin = line.managerRoleCodes.some((r) => (ADMIN_ROLE_CODES as readonly string[]).includes(r));
    const reportIsManager = line.roleCodes.includes(MANAGER_ROLE_CODE);
    const reportIsAdminLevel = line.roleCodes.some((r) => ADMIN_LEVEL_REPORT_ROLE_CODES.includes(r));

    if (managerIsManager) {
      if (reportIsManager) {
        violations.push(
          `${line.employeeCode} is a MANAGER but reports to ${line.managerCode}, another MANAGER — managers report only to Admin.`,
        );
      }
    } else if (managerIsAdmin) {
      if (!reportIsManager && !reportIsAdminLevel) {
        violations.push(
          `${line.employeeCode} reports directly to Admin (${line.managerCode}) but isn't a MANAGER — employees must report to a Manager.`,
        );
      }
    } else {
      violations.push(
        `${line.employeeCode} reports to ${line.managerCode}, who holds neither the MANAGER role nor an Admin role ` +
          `(${line.managerRoleCodes.join(", ") || "no roles"}).`,
      );
    }
  }
  return violations;
}
