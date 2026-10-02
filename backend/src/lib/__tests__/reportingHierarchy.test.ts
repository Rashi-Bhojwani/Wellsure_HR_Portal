import { describe, expect, it } from "vitest";
import { checkReportingLine, checkRoleCombination, findReportingLineViolations } from "../reportingHierarchy";

const line = (employeeCode: string, roleCodes: string[], managerCode: string | null, managerRoleCodes: string[] = [], managerActive = true) => ({
  employeeCode,
  roleCodes,
  managerCode,
  managerRoleCodes,
  managerActive,
});

// Hierarchy model A (Phase 5 commit E2): Super Admins, Managers and HR
// Admins sit directly under a synthetic Admin root with NO reporting
// manager; everyone else reports to an active MANAGER, or to nobody
// (Unassigned).
describe("reporting-line rules (model A)", () => {
  it("accepts employee→manager, top-level people with no manager, and an unassigned employee", () => {
    expect(
      findReportingLineViolations([
        line("E1", ["EMPLOYEE"], "M1", ["MANAGER", "EMPLOYEE"]),
        line("M1", ["MANAGER", "EMPLOYEE"], null),
        line("H1", ["HR_ADMIN"], null),
        line("A1", ["SUPER_ADMIN"], null),
        line("E2", ["EMPLOYEE"], null),
        line("X1", ["HR_EXECUTIVE", "EMPLOYEE"], "M1", ["MANAGER"]),
      ]),
    ).toEqual([]);
  });

  it("refuses a reporting manager for anyone at the top level — including a manager reporting to Admin", () => {
    expect(checkReportingLine({ code: "M1", roleCodes: ["MANAGER"] }, { code: "A1", roleCodes: ["SUPER_ADMIN"], active: true })).toContain("M1 is a Manager and sits directly under Admin");
    expect(checkReportingLine({ code: "H1", roleCodes: ["HR_ADMIN"] }, { code: "M1", roleCodes: ["MANAGER"], active: true })).toContain("HR Admin");
    expect(checkReportingLine({ code: "A2", roleCodes: ["SUPER_ADMIN"] }, { code: "A1", roleCodes: ["SUPER_ADMIN"], active: true })).toContain("Super Admin");
  });

  it("refuses a reporting manager who isn't a manager (Admin, HR Admin or a plain employee), or who is inactive", () => {
    expect(checkReportingLine({ code: "E1", roleCodes: ["EMPLOYEE"] }, { code: "A1", roleCodes: ["SUPER_ADMIN"], active: true })).toContain("must hold the Manager role");
    expect(checkReportingLine({ code: "E1", roleCodes: ["EMPLOYEE"] }, { code: "H1", roleCodes: ["HR_ADMIN"], active: true })).toContain("must hold the Manager role");
    expect(checkReportingLine({ code: "E1", roleCodes: ["EMPLOYEE"] }, { code: "E9", roleCodes: [], active: true })).toContain("no roles");
    expect(checkReportingLine({ code: "E1", roleCodes: ["EMPLOYEE"] }, { code: "M9", roleCodes: ["MANAGER"], active: false })).toContain("no longer active");
  });

  it("a manager can hold no role but EMPLOYEE alongside MANAGER", () => {
    expect(checkRoleCombination(["MANAGER", "EMPLOYEE"])).toBeNull();
    expect(checkRoleCombination(["HR_ADMIN", "HR_EXECUTIVE"])).toBeNull();
    expect(checkRoleCombination(["MANAGER", "HR_ADMIN"])).toContain("HR Admin");
    expect(checkRoleCombination(["MANAGER", "APPROVER"])).toContain("APPROVER");
    expect(findReportingLineViolations([line("M1", ["MANAGER", "PAYROLL_ADMIN"], null)])[0]).toContain("PAYROLL_ADMIN");
  });
});
