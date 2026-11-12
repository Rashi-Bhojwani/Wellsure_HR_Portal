import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { probationLastDay, sendProbationReminders } from "../service";
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

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("probation last day", () => {
  it("is the joining date plus the months, less a day, keeping the end of a short month", () => {
    expect(probationLastDay("2026-01-01", 3)).toBe("2026-03-31");
    expect(probationLastDay("2026-01-15", 3)).toBe("2026-04-14");
    expect(probationLastDay("2026-11-30", 3)).toBe("2027-02-27");
    expect(probationLastDay("2025-12-31", 2)).toBe("2026-02-27");
    expect(probationLastDay("2026-03-31", 6)).toBe("2026-09-29");
  });
});

// M session block 2, ER-26: the due list, confirm and extend, the reminder, and who may do it.
describe("probation", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/probation${p}`).set(...authHeader(t[who]!)),
    post: (p: string, body: object) => request(app).post(`/api/probation${p}`).set(...authHeader(t[who]!)).send(body),
  });
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    const mgr = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    ids.push(mgr.employeeId);
    e.mgr = mgr.employeeId;
    t.mgr = await loginAs(mgr.employeeCode);
    for (const [k, roleCode] of [["hr", "HR_ADMIN"], ["old", undefined], ["new", undefined], ["soon", undefined], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      const x = await createFullTestEmployee(org, { ...(roleCode ? { roleCode } : {}), managerId: mgr.employeeId });
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
    await prisma.employee.update({ where: { id: e.new! }, data: { dateOfJoining: addCalendarDays(businessToday(), -5) } });
    // "soon": its last day is exactly 15 days (the default reminder) from today: joined 3 months before (today + 16 days).
    const target = addCalendarDays(businessToday(), 16);
    await prisma.employee.update({ where: { id: e.soon! }, data: { dateOfJoining: new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() - 3, target.getUTCDate())) } });
  });
  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("lists people whose probation is ending or past; a new joiner only under all; the default is 3 months", async () => {
    const due = await as("hr").get("/");
    expect(due.status).toBe(200);
    expect(due.body.policy).toEqual({ months: 3, reminderDays: 15 });
    const dueIds = due.body.people.map((p: { employeeId: string }) => p.employeeId);
    expect(dueIds).toContain(e.old);
    expect(dueIds).not.toContain(e.new);
    expect(due.body.people.find((p: { employeeId: string }) => p.employeeId === e.old)).toMatchObject({ lastDay: "2024-03-31", overdue: true });
    expect((await as("hr").get("/?show=all")).body.people.map((p: { employeeId: string }) => p.employeeId)).toContain(e.new);
    expect(due.body.people.map((p: { employeeId: string }) => p.employeeId)).not.toContain(e.hr);
  });

  it("the reminder tells the manager and HR admins on the day the window opens", async () => {
    const before = await prisma.notification.count({ where: { type: "probation.due", user: { employeeId: e.mgr! } } });
    await sendProbationReminders();
    expect(await prisma.notification.count({ where: { type: "probation.due", user: { employeeId: e.mgr! } } })).toBe(before + 1);
    expect(await prisma.notification.count({ where: { type: "probation.due", user: { employeeId: e.hr! } } })).toBeGreaterThan(0);
  });

  it("extend needs a later date and a reason; confirm ends it; both audited, told and kept", async () => {
    expect((await as("hr").post(`/${e.old}/extend`, { until: "2024-03-01", reason: "Needs more time" })).status).toBe(400);
    expect((await as("hr").post(`/${e.old}/extend`, { until: "2024-06-30", reason: "" })).status).toBe(400);
    expect((await as("hr").post(`/${e.old}/extend`, { until: "2024-06-30", reason: "Needs more time" })).status).toBe(200);
    expect((await as("old").get("/mine")).body).toMatchObject({ lastDay: "2024-06-30", extended: true, confirmedAt: null });
    expect((await as("hr").post(`/${e.old}/confirm`, { reason: "Met the goals" })).status).toBe(200);
    expect((await as("hr").post(`/${e.old}/confirm`, { reason: "Again" })).status).toBe(409);
    expect((await as("hr").get("/?show=all")).body.people.map((p: { employeeId: string }) => p.employeeId)).not.toContain(e.old);
    expect(await prisma.auditLog.count({ where: { entityId: e.old, action: { startsWith: "employee.probation." } } })).toBe(2);
    expect(await prisma.notification.count({ where: { type: "probation.confirmed", user: { employeeId: e.old! } } })).toBe(1);
    const row = await prisma.employeeProbationDecision.findFirstOrThrow({ where: { employeeId: e.old! } });
    await expect(prisma.employeeProbationDecision.update({ where: { id: row.id }, data: { reason: "edited" } })).rejects.toThrow(/PROBATION_APPEND_ONLY/);
  });

  it("an employee, a manager and the Developer cannot list or decide; nobody decides their own", async () => {
    for (const who of ["new", "mgr", "dev"]) {
      expect((await as(who).get("/")).status, who).toBe(403);
      expect((await as(who).post(`/${e.new}/confirm`, { reason: "Not mine to do" })).status, who).toBe(403);
    }
    expect((await as("hr").post(`/${e.hr}/confirm`, { reason: "My own" })).body.error.code).toBe("OWN_RECORD");
    expect(iso(businessToday())).toMatch(/^\d{4}/);
  });
});
