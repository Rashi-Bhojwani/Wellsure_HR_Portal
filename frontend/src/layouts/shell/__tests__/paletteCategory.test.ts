import { describe, expect, it } from "vitest";
import { HR_FORBIDDEN_KEYS } from "@shared/constants/sensitiveData";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { adminNav, flattenLeaves } from "../nav";
import { categoryOfPath } from "../paletteCategory";

// A-9 G6 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 3): the search dialog's chips, and payroll pages never reaching anyone but a director through it.

describe("search dialog categories", () => {
  it("each admin page falls under one chip by its path", () => {
    expect(categoryOfPath("/admin/payroll/run")).toBe("payroll");
    expect(categoryOfPath("/admin/employee/all")).toBe("employee");
    expect(categoryOfPath("/admin/workforce/leave/granter")).toBe("leave");
    expect(categoryOfPath("/admin/workforce/attendance/who-is-in")).toBe("other");
    expect(categoryOfPath("/admin/employee-x")).toBe("other");
  });

  it("the search lists the menu's own pages: a person holding every key HR may hold sees no payroll page; a director sees them", () => {
    const hrKeys = new Set<string>(PERMISSION_KEYS.filter((k) => !(HR_FORBIDDEN_KEYS as readonly string[]).includes(k)));
    const hrPayroll = flattenLeaves(adminNav((k) => hrKeys.has(k), false)).filter((l) => categoryOfPath(l.path) === "payroll" && !l.soon);
    expect(hrPayroll.map((l) => l.key)).toEqual([]);
    const directorPayroll = flattenLeaves(adminNav(() => true, true)).filter((l) => categoryOfPath(l.path) === "payroll");
    expect(directorPayroll.length).toBeGreaterThan(5);
    // The A-9 pages are in the menu, with what each needs.
    const director = flattenLeaves(adminNav(() => true, true)).map((l) => l.key);
    for (const k of ["segments", "bulk-upload", "letters", "letter-settings", "mass-email"]) expect(director, k).toContain(k);
    expect(flattenLeaves(adminNav((k) => hrKeys.has(k), false)).map((l) => l.key)).not.toContain("letter-settings");
  });
});
