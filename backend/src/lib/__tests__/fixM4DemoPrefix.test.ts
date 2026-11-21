import { describe, expect, it } from "vitest";
import { reservedEmployeeCodeMessage } from "../demoGuard";
import { assertEmployeeCodeNotReserved } from "../../modules/employee/service";
import { loadReferenceData, newBatchTracker, validateEmployeeRow } from "../../modules/import/rowValidators";

// FIX-M4 (independent audit 2026-11-20, finding M4): "An employee number starting DEMO can be created in production, and then the app refuses to start at the
// next deploy or restart." The prefix is reserved outside development in every place an employee number is set: the Add Employee wizard and every other creator
// (createEmployeeInTx), the change of employee number (assertEmployeeCodeAvailable), and the import's row validator.
describe("FIX-M4: the DEMO employee-number prefix is reserved outside development", () => {
  it("is refused in staging and production, any case, and allowed in development (where the demo company lives)", () => {
    for (const env of ["staging", "production"]) {
      expect(reservedEmployeeCodeMessage("DEMO1", env)).toMatch(/reserved/);
      expect(reservedEmployeeCodeMessage(" demo042 ", env)).toMatch(/reserved/);
      expect(() => assertEmployeeCodeNotReserved("Demo7", env)).toThrow(/reserved/);
      expect(reservedEmployeeCodeMessage("1042", env)).toBeNull();
      expect(reservedEmployeeCodeMessage("ADEMO1", env)).toBeNull();
    }
    expect(reservedEmployeeCodeMessage("DEMO1", "development")).toBeNull();
    expect(() => assertEmployeeCodeNotReserved("DEMO1", "development")).not.toThrow();
  });

  it("the wizard, every creator and the change of employee number use the same check", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../../modules/employee/service.ts", import.meta.url), "utf8");
    expect(src).toMatch(/async function assertEmployeeCodeAvailable[\s\S]{0,120}assertEmployeeCodeNotReserved\(employeeCode\)/);
    expect(src).toMatch(/createEmployeeInTx[\s\S]{0,600}assertEmployeeCodeNotReserved\(official\.employeeCode\)/);
  });

  it("the import validator names it as a row error outside development", async () => {
    const { env } = await import("../../config/env");
    const refs = await loadReferenceData();
    const was = env.APP_ENV;
    (env as { APP_ENV: string }).APP_ENV = "production";
    try {
      const r = validateEmployeeRow({ rowNumber: 2, data: { employeeCode: "DEMO9" }, values: { employeeCode: "DEMO9" } } as never, refs, newBatchTracker());
      expect(r.errors.join(" ")).toMatch(/reserved for the made-up demo company/);
    } finally {
      (env as { APP_ENV: string }).APP_ENV = was;
    }
  });
});
