import { describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { canSeeLeaf, employeeMenu, isEmployeeMenuGroup } from "../employeeMenu.config";

// FIX-L1 (independent audit 2026-11-20): the Developer saw a "Late Arrivals" menu item and the page then refused them (the API refuses the Developer on every
// lateness route). The item is now hidden from the Developer; everyone else still sees it.
describe("FIX-L1: Late Arrivals is not offered to the Developer", () => {
  const leaf = employeeMenu.flatMap((e) => (isEmployeeMenuGroup(e) ? e.children : [])).find((l) => l.key === "lateness")!;
  const anyKey = () => true;
  it("is hidden from the Developer, shown to an employee and to a director who also holds the Developer role", () => {
    expect(canSeeLeaf(leaf, anyKey, [DEVELOPER_ROLE_CODE, "EMPLOYEE"])).toBe(false);
    expect(canSeeLeaf(leaf, anyKey, ["EMPLOYEE"])).toBe(true);
    expect(canSeeLeaf(leaf, anyKey, [DEVELOPER_ROLE_CODE, "SUPER_ADMIN"])).toBe(true);
  });
});
