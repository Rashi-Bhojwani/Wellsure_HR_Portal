import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertNoDemoCompany, demoCompanyPresent } from "../demoGuard";
import { prisma } from "../prisma";

describe("the application refuses to start with the demo company outside development", () => {
  beforeAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: "demo.company" } });
  });
  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: "demo.company" } });
  });

  it("starts when there is no demo company, in any environment", async () => {
    expect(await demoCompanyPresent(prisma)).toBe(false);
    for (const env of ["development", "staging", "production"]) await expect(assertNoDemoCompany(prisma, env)).resolves.toBeUndefined();
  });

  it("refuses in staging and production when the demo setting is on, and allows development", async () => {
    await prisma.systemSetting.create({ data: { key: "demo.company", value: true } });
    expect(await demoCompanyPresent(prisma)).toBe(true);
    await expect(assertNoDemoCompany(prisma, "production")).rejects.toThrow(/DEMO COMPANY/);
    await expect(assertNoDemoCompany(prisma, "staging")).rejects.toThrow(/Refusing to start/);
    await expect(assertNoDemoCompany(prisma, "development")).resolves.toBeUndefined();
    await prisma.systemSetting.deleteMany({ where: { key: "demo.company" } });
  });

  it("refuses when a person with a DEMO employee code exists, even without the setting", async () => {
    const e = await prisma.employee.create({ data: { employeeCode: "DEMO-GUARD-TEST", dateOfJoining: new Date("2024-01-01"), employmentType: "PERMANENT" } });
    try {
      expect(await demoCompanyPresent(prisma)).toBe(true);
      await expect(assertNoDemoCompany(prisma, "production")).rejects.toThrow(/DEMO COMPANY/);
    } finally {
      await prisma.employee.delete({ where: { id: e.id } });
    }
  });
});
