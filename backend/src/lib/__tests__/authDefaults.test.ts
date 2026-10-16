import { describe, expect, it } from "vitest";
import { default2faRolesFor } from "../authDefaults";

describe("two-factor starting value", () => {
  it("is off in development and covers the three admin roles in staging and production", () => {
    expect(default2faRolesFor("development")).toEqual([]);
    for (const appEnv of ["staging", "production"]) expect(default2faRolesFor(appEnv).sort()).toEqual(["HR_ADMIN", "PAYROLL_ADMIN", "SUPER_ADMIN"]);
  });
  it("does not require it of ordinary employees", () => {
    expect(default2faRolesFor("production")).not.toContain("EMPLOYEE");
  });
});
