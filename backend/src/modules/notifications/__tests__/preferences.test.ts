import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { notifyEmployee } from "../notifyEmployee";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// NT-09 (M session): a person switches off a notification category for themselves; approvals, decisions and security are never switchable.
describe("notification preferences", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  let me: { employeeId: string; userId: string };
  let other: { employeeId: string; userId: string };
  let token = "";
  const count = (userId: string, type: string) => prisma.notification.count({ where: { userId, type } });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    const a = await createFullTestEmployee(org);
    const b = await createFullTestEmployee(org);
    ids.push(a.employeeId, b.employeeId);
    me = a;
    other = b;
    token = await loginAs(a.employeeCode);
  });
  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("everything is on until the person switches a category off", async () => {
    const res = await request(app).get("/api/notifications/preferences").set(...authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.categories.every((c: { on: boolean }) => c.on)).toBe(true);
    await notifyEmployee(me.employeeId, { type: "document.added", title: "t", body: "b" });
    expect(await count(me.userId, "document.added")).toBe(1);
  });

  it("a switched-off category is not stored; one that cannot be switched off still is; another person is unaffected", async () => {
    const put = await request(app).put("/api/notifications/preferences").set(...authHeader(token)).send({ category: "DOCUMENTS", on: false });
    expect(put.status).toBe(200);
    expect(put.body.categories.find((c: { key: string }) => c.key === "DOCUMENTS").on).toBe(false);
    await notifyEmployee(me.employeeId, { type: "document.added", title: "t", body: "b" });
    expect(await count(me.userId, "document.added")).toBe(1);
    await notifyEmployee(me.employeeId, { type: "leave.decided", title: "t", body: "b" });
    expect(await count(me.userId, "leave.decided")).toBe(1);
    await notifyEmployee(other.employeeId, { type: "document.added", title: "t", body: "b" });
    expect(await count(other.userId, "document.added")).toBe(1);
  });

  it("only the listed categories can be switched off", async () => {
    for (const category of ["APPROVALS", "SECURITY", "PAYROLL"]) {
      expect((await request(app).put("/api/notifications/preferences").set(...authHeader(token)).send({ category, on: false })).status, category).toBe(400);
    }
    expect((await request(app).put("/api/notifications/preferences").send({ category: "DOCUMENTS", on: true })).status).toBe(401);
  });
});
