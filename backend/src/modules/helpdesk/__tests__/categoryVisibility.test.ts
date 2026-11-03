import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { cleanupTestHelpdeskCategories } from "./helpdeskTestHelpers";
import { resolveAccess } from "../../../lib/permissions";
import { setVisibility } from "../categoryVisibility";

describe("general category visibility", () => {
  let org: TestOrgMasters;
  type Person = { userId: string; employeeId: string; employeeCode: string };
  const people = {} as Record<"director" | "hr" | "outsider" | "employee" | "other" | "developer", Person>;
  const tokens = {} as Record<keyof typeof people, string>;
  const ids: string[] = [];
  let categoryId: string;
  const get = (who: keyof typeof people, path: string) => request(app).get(`/api/helpdesk${path}`).set(...authHeader(tokens[who]));
  const put = (who: keyof typeof people, path: string, body: object) => request(app).put(`/api/helpdesk${path}`).set(...authHeader(tokens[who])).send(body);
  const setting = (extra: object = {}) => ({ version: 0, hrRoleCodes: [], employeeIds: [people.director.employeeId], reason: "DEMO audience decision", ...extra });
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [who, roleCode] of Object.entries({ director: "SUPER_ADMIN", hr: "HR_ADMIN", outsider: "HR_ADMIN", employee: "EMPLOYEE", other: "EMPLOYEE", developer: "DEVELOPER" })) {
      const key = who as keyof typeof people;
      people[key] = await createFullTestEmployee(org, { roleCode });
      tokens[key] = await loginAs(people[key].employeeCode);
    }
    const c = await prisma.helpdeskCategory.create({ data: { code: `TEST_C2_${randomUUID().slice(0, 8)}`, name: "DEMO visibility" } });
    categoryId = c.id;
    ids.push(c.id);
  });
  afterAll(async () => {
    await cleanupTestHelpdeskCategories(ids);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });
  it("both new visibility routes require authentication and reject HR, employees and Developer", async () => {
    expect((await request(app).get(`/api/helpdesk/categories/${categoryId}/visibility`)).status).toBe(401);
    expect((await request(app).put(`/api/helpdesk/categories/${categoryId}/visibility`).send(setting())).status).toBe(401);
    for (const who of ["hr", "employee", "other", "developer"] as const) {
      expect((await get(who, `/categories/${categoryId}/visibility`)).status, `${who} read`).toBe(403);
      expect((await put(who, `/categories/${categoryId}/visibility`, setting())).status, `${who} write`).toBe(403);
    }
  });
  it("the service guard rejects HR even if passed a forged director permission", async () => {
    await expect(setVisibility(categoryId, setting(), { ...people.hr, permissions: new Set(["helpdesk.visibility.manage"]) }, { actorUserId: people.hr.userId })).rejects.toMatchObject({ status: 403 });
    expect((await resolveAccess(people.hr.userId)).permissions.has("helpdesk.visibility.manage")).toBe(false);
  });
  it("a director chooses an audience with a reason, version check and immutable history", async () => {
    expect((await get("director", `/categories/${categoryId}/visibility`)).body.state).toBe("NOT_SET");
    expect((await put("director", `/categories/${categoryId}/visibility`, setting({ reason: " " }))).status).toBe(400);
    const res = await put("director", `/categories/${categoryId}/visibility`, setting());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "CONFIGURED", version: 1, employeeIds: [people.director.employeeId] });
    expect(res.body.history).toHaveLength(1);
    expect((await put("director", `/categories/${categoryId}/visibility`, setting())).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "helpdesk.visibility.changed", entityId: categoryId } })).toBe(1);
  });
  it("neither visibility route reads or configures Payroll", async () => {
    const payroll = await prisma.helpdeskCategory.findUniqueOrThrow({ where: { code: "PAYROLL_SALARY" }, select: { id: true } });
    expect((await get("director", `/categories/${payroll.id}/visibility`)).status).toBe(404);
    expect((await put("director", `/categories/${payroll.id}/visibility`, setting())).status).toBe(404);
    expect(await prisma.helpdeskCategoryVisibility.count({ where: { categoryId: payroll.id } })).toBe(0);
  });
});
