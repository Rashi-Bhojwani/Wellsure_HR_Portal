import { describe, expect, it } from "vitest";
import { findReportingLineViolations } from "../reportingHierarchy";

const line = (employeeCode: string, roleCodes: string[], managerCode: string, managerRoleCodes: string[]) => ({
  employeeCode,
  roleCodes,
  managerCode,
  managerRoleCodes,
});

// The three-level rule (Admin → Managers → Employees) as used by the seed
// assertion today and commit E's enforcement later.
describe("findReportingLineViolations", () => {
  it("accepts employee→manager, manager→Admin and HR admin→Admin", () => {
    expect(
      findReportingLineViolations([
        line("E1", ["EMPLOYEE"], "M1", ["MANAGER"]),
        line("M1", ["MANAGER"], "A1", ["SUPER_ADMIN"]),
        line("H1", ["HR_ADMIN"], "A1", ["SUPER_ADMIN"]),
      ]),
    ).toEqual([]);
  });

  it("rejects a reporting manager who is neither a MANAGER nor Admin", () => {
    const [v] = findReportingLineViolations([line("E2", ["EMPLOYEE"], "H1", ["HR_ADMIN"])]);
    expect(v).toContain("E2 reports to H1, who holds neither the MANAGER role nor an Admin role (HR_ADMIN)");
    expect(findReportingLineViolations([line("E3", ["EMPLOYEE"], "E4", [])])[0]).toContain("no roles");
  });

  it("rejects a manager reporting to another manager, and a plain employee reporting straight to Admin", () => {
    expect(findReportingLineViolations([line("M2", ["MANAGER"], "M1", ["MANAGER"])])[0]).toContain("managers report only to Admin");
    expect(findReportingLineViolations([line("E5", ["EMPLOYEE"], "A1", ["SUPER_ADMIN"])])[0]).toContain("employees must report to a Manager");
  });
});
