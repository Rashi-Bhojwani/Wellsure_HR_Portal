import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

describe("general helpdesk visibility database boundary", () => {
  let org: TestOrgMasters;
  let director: { employeeId: string; userId: string };
  let hr: { employeeId: string; userId: string };
  const ids: string[] = [];
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
  });
  afterAll(async () => {
    await deleteWithDependents("HelpdeskCategory", ids);
    await cleanupFullTestEmployee(director.employeeId);
    await cleanupFullTestEmployee(hr.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });
  async function category() {
    const c = await prisma.helpdeskCategory.create({ data: { code: `TEST_C2_${randomUUID().slice(0, 8)}`, name: "DEMO category" } });
    ids.push(c.id);
    return c;
  }
  it("new general categories start Not set, with no audience or history", async () => {
    const c = await category();
    expect(await prisma.helpdeskCategoryVisibility.findUnique({ where: { categoryId: c.id } })).toMatchObject({ configured: false, hrRoleCodes: [], employeeIds: [], version: 0, changedByUserId: null });
    expect(await prisma.helpdeskCategoryVisibilityHistory.count({ where: { categoryId: c.id } })).toBe(0);
  });
  it("both tables derive the actual Payroll code and reject a forged general code", async () => {
    const payroll = await prisma.helpdeskCategory.findUniqueOrThrow({ where: { code: "PAYROLL_SALARY" }, select: { id: true } });
    expect(await prisma.helpdeskCategoryVisibility.count({ where: { categoryId: payroll.id } })).toBe(0);
    await expect(prisma.helpdeskCategoryVisibility.create({ data: { categoryId: payroll.id, categoryCode: "FORGED" } })).rejects.toThrow("peeps_visibility_no_payroll");
    await expect(prisma.helpdeskCategoryVisibilityHistory.create({ data: { categoryId: payroll.id, categoryCode: "FORGED", version: 1, hrRoleCodes: [], employeeIds: [], changedByUserId: director.userId, reason: "DEMO" } })).rejects.toThrow("peeps_visibility_history_no_payroll");
  });
  it("HR cannot configure even by direct SQL; director history cannot be changed, deleted or truncated", async () => {
    const c = await category();
    const data = { categoryId: c.id, categoryCode: c.code, version: 1, hrRoleCodes: [], employeeIds: [director.employeeId], changedByUserId: hr.userId, reason: "DEMO" };
    await expect(prisma.helpdeskCategoryVisibilityHistory.create({ data })).rejects.toThrow("HELPDESK_VISIBILITY_DIRECTORS_ONLY");
    await expect(prisma.helpdeskCategoryVisibility.update({ where: { categoryId: c.id }, data: { configured: true, version: 1, changedByUserId: hr.userId } })).rejects.toThrow("HELPDESK_VISIBILITY_DIRECTORS_ONLY");
    const row = await prisma.helpdeskCategoryVisibilityHistory.create({ data: { ...data, changedByUserId: director.userId } });
    await expect(prisma.helpdeskCategoryVisibilityHistory.update({ where: { id: row.id }, data: { reason: "changed" } })).rejects.toThrow();
    await expect(prisma.helpdeskCategoryVisibilityHistory.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('TRUNCATE helpdesk_category_visibility_history')).rejects.toThrow();
    await deleteWithDependents("HelpdeskCategory", [c.id]);
    expect(await prisma.helpdeskCategoryVisibilityHistory.count({ where: { categoryId: c.id } })).toBe(0);
    expect(await prisma.helpdeskCategoryVisibility.count({ where: { categoryId: c.id } })).toBe(0);
  });
});
