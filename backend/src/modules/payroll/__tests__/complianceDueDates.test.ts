import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { dueOn, inWindow, remindDueDates } from "../compliance/service";

// ST-30 (docs/plans/A_PARITY_ROWS.md part 2): compliance due dates entered by directors (none preset), marked done, reminded once a month. Made-up dates only.
describe("ST-30 — the day a date falls on, and the reminder window", () => {
  it("the day is clamped to the month's last day; the window runs from N days before up to the day itself", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2100 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }), (y, m, d) => {
        const month = `${y}-${String(m).padStart(2, "0")}`;
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        expect(dueOn(month, d)).toBe(`${month}-${String(Math.min(d, last)).padStart(2, "0")}`);
      }),
      { numRuns: 300 },
    );
    expect(dueOn("2027-02", 31)).toBe("2027-02-28");
    expect(dueOn("2028-02", 30)).toBe("2028-02-29");
    expect(inWindow("2026-11-12", "2026-11-15", 3)).toBe(true);
    expect(inWindow("2026-11-11", "2026-11-15", 3)).toBe(false);
    expect(inWindow("2026-11-15", "2026-11-15", 0)).toBe(true);
    expect(inWindow("2026-11-16", "2026-11-15", 30)).toBe(false);
  });
});

describe("ST-30 — over the routes", () => {
  let org: TestOrgMasters;
  const p: Record<string, Awaited<ReturnType<typeof createFullTestEmployee>>> = {};
  const tok: Record<string, string> = {};
  const ids: string[] = [];
  const call = (who: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/payroll-compliance${path}`).set(...authHeader(tok[who]!)).send(body);
  const date = { statute: "ZZ-TEST", item: "A made-up return", dueDay: 15, remindDaysBefore: 3, source: "test fixture" };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.d1 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.d2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.mgr = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
  }, 180_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await deleteWithDependents("ComplianceDueDate", ids);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("HR, a manager, an employee and the Developer are refused every route; no sign-in is refused; nothing is preset", async () => {
    for (const who of ["hr", "mgr", "emp", "dev"]) {
      expect((await call(who, "get", "/")).status, who).toBe(403);
      expect((await call(who, "post", "/", date)).status, who).toBe(403);
      expect((await call(who, "post", "/x/done", { month: "2026-11" })).status, who).toBe(403);
      expect((await call(who, "post", "/x/retire", { reason: "test" })).status, who).toBe(403);
    }
    expect((await request(app).get("/api/payroll-compliance")).status).toBe(401);
    expect(await prisma.complianceDueDate.count({ where: { createdByUserId: { notIn: [p.d1!.userId, p.d2!.userId] }, retiredAt: null, statute: "ZZ-TEST" } })).toBe(0);
  });

  it("a director adds a date with its source; it is marked done once per month (never a future month); it is retired, never edited; every step is audited", async () => {
    setBusinessTodayForTests(new Date("2026-11-13T00:00:00Z"));
    expect((await call("d1", "post", "/", { ...date, source: "" })).status).toBe(400);
    expect((await call("d1", "post", "/", { ...date, dueDay: 32 })).status).toBe(400);
    const a = await call("d1", "post", "/", date);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    ids.push(a.body.id);
    const row = (await call("d2", "get", "/")).body.dates.find((d: { id: string }) => d.id === a.body.id);
    expect(row).toMatchObject({ dueThisMonth: "2026-11-15", state: "DUE_SOON", source: "test fixture" });
    expect((await call("d2", "post", `/${a.body.id}/done`, { month: "2026-12" })).status).toBe(400);
    expect((await call("d2", "post", `/${a.body.id}/done`, { month: "2026-11" })).status).toBe(200);
    expect((await call("d1", "post", `/${a.body.id}/done`, { month: "2026-11" })).body.error.code).toBe("ALREADY_DONE");
    expect((await call("d1", "get", "/")).body.dates.find((d: { id: string }) => d.id === a.body.id).state).toBe("DONE");
    await expect(prisma.complianceDueDate.update({ where: { id: a.body.id }, data: { dueDay: 20 } })).rejects.toThrow(/COMPLIANCE_DUE_DATE_IMMUTABLE/);
    await expect(prisma.complianceDueMark.updateMany({ where: { dueDateId: a.body.id }, data: { note: "x" } })).rejects.toThrow(/COMPLIANCE_DUE_MARK_APPEND_ONLY/);
    expect((await call("d1", "post", `/${a.body.id}/retire`, { reason: "replaced in a test" })).status).toBe(200);
    expect((await call("d1", "get", "/")).body.dates.some((d: { id: string }) => d.id === a.body.id)).toBe(false);
    const audits = await prisma.auditLog.findMany({ where: { entityId: a.body.id, action: { startsWith: "payroll.compliance." } } });
    expect(audits.map((x) => x.action).sort()).toEqual(["payroll.compliance.date_added", "payroll.compliance.date_retired", "payroll.compliance.done"]);
  });

  it("the reminder tells every director once a month inside the window, never after the date is done, never outside the window", async () => {
    setBusinessTodayForTests(new Date("2026-11-13T00:00:00Z"));
    const inside = await call("d1", "post", "/", { ...date, item: "Inside the window" });
    const outside = await call("d1", "post", "/", { ...date, item: "Outside the window", dueDay: 28 });
    const done = await call("d1", "post", "/", { ...date, item: "Already done" });
    ids.push(inside.body.id, outside.body.id, done.body.id);
    await call("d2", "post", `/${done.body.id}/done`, { month: "2026-11" });
    const before = await prisma.notification.count({ where: { type: "payroll.compliance.due" } });
    await remindDueDates();
    await remindDueDates(); // the hourly sweep again: nothing more
    const marks = await prisma.complianceDueMark.findMany({ where: { dueDateId: { in: [inside.body.id, outside.body.id, done.body.id] }, kind: "REMINDED" } });
    expect(marks.map((m) => m.dueDateId)).toEqual([inside.body.id]);
    const notes = await prisma.notification.findMany({ where: { type: "payroll.compliance.due", body: "Inside the window" } });
    const directorUsers = [p.d1!.userId, p.d2!.userId];
    for (const u of directorUsers) expect(notes.filter((n) => n.userId === u)).toHaveLength(1);
    expect(notes.some((n) => [p.hr!.userId, p.mgr!.userId, p.emp!.userId, p.dev!.userId].includes(n.userId))).toBe(false);
    expect(await prisma.notification.count({ where: { type: "payroll.compliance.due" } })).toBeGreaterThanOrEqual(before + 2);
  });
});
