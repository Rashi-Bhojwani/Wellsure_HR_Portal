import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { businessTodayIso } from "../businessDate";

// FIX-L6 (independent audit 2026-11-20, finding L6): "Export file names use the UTC date, so before 05:30 IST they carry yesterday's date." They use the IST
// business date now (businessTodayIso), in all four places the audit named.
describe("FIX-L6: export file names carry the IST business date", () => {
  afterEach(() => vi.useRealTimers());

  it("at 04:30 IST on the 21st (23:00 UTC on the 20th) the file date is the 21st", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T23:00:00Z"));
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-20"); // what the old code wrote
    expect(businessTodayIso()).toBe("2026-11-21");
  });

  it("the four export file names use it, and none uses the UTC date any more", () => {
    for (const f of ["../../modules/auditLog/controller.ts", "../../modules/employee/controller.ts", "../../modules/import/service.ts", "../../modules/payroll/reports/service.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).toContain("businessTodayIso()");
      expect(src, f).not.toMatch(/(filename|fileName|stamp)[^\n]*new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
    }
  });
});
