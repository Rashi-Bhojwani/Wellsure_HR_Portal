import { describe, expect, it } from "vitest";
import { assignableRoles } from "../assignableRoles";

// Cleanup C3: the Access tab never offers the payroll roles; everything else the person does not hold is offered.
describe("roles the Access tab offers", () => {
  const roles = [
    { code: "HR_ADMIN" },
    { code: "PAYROLL_ADMIN", directorOnly: true },
    { code: "PAYROLL_APPROVER", directorOnly: true },
    { code: "MANAGER" },
    { code: "EMPLOYEE" },
  ];
  it("leaves out Payroll Admin and Payroll Approver, and the roles already held", () => {
    expect(assignableRoles(roles, [{ code: "EMPLOYEE" }]).map((r) => r.code)).toEqual(["HR_ADMIN", "MANAGER"]);
    expect(assignableRoles(roles, []).map((r) => r.code)).toEqual(["HR_ADMIN", "MANAGER", "EMPLOYEE"]);
  });
});
