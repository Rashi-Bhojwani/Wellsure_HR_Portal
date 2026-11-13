import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { eligibleMinutes } from "../service";
import { overtimePolicy, settledDay } from "./overtimeTestHelpers";
import { resetPolicy } from "../../policySettings/__tests__/policyTestHelpers";
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

describe("overtime minutes", () => {
  it("nothing below the minimum; otherwise rounded down to the step", () => {
    const p = { minimumMinutes: 60, roundToMinutes: 30 };
    expect(eligibleMinutes(59, p)).toBe(0);
    expect(eligibleMinutes(60, p)).toBe(60);
    expect(eligibleMinutes(89, p)).toBe(60);
    expect(eligibleMinutes(95, p)).toBe(90);
    expect(eligibleMinutes(null, p)).toBe(0);
  });
});

// AT-19 (M session block 2): off until two directors turn it on; then claimed by the employee and decided by a director or an approver in scope.
describe("overtime claims", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const u: Record<string, string> = {};
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/overtime${p}`).set(...authHeader(t[who]!)),
    post: (p: string, body: object = {}) => request(app).post(`/api/overtime${p}`).set(...authHeader(t[who]!)).send(body),
  });
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["emp", undefined], ["other", undefined], ["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      u[k] = x.userId;
      t[k] = await loginAs(x.employeeCode);
    }
    await settledDay(e.emp!, "2026-10-05", 95);
    await settledDay(e.emp!, "2026-10-06", 40);
    await settledDay(e.emp!, "2026-10-07", 120, true);
    await settledDay(e.emp!, "2026-10-08", 75);
  });
  afterAll(async () => {
    await resetPolicy("policy.overtime");
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("GOLDEN: while off (the default) nothing is offered or accepted, and attendance is untouched", async () => {
    const before = await prisma.dailyAttendance.findMany({ where: { employeeId: e.emp! }, orderBy: { date: "asc" } });
    expect((await as("emp").get("/mine?month=2026-10")).body).toEqual({ active: false, days: [] });
    expect((await as("emp").post("/mine", { date: "2026-10-05" })).body.error.code).toBe("OVERTIME_OFF");
    expect((await as("hr").get("/")).body).toEqual({ active: false, claims: [] });
    expect(JSON.stringify(await prisma.dailyAttendance.findMany({ where: { employeeId: e.emp! }, orderBy: { date: "asc" } }))).toBe(JSON.stringify(before));
  });

  it("on: the employee sees days with overtime and claims one; under the minimum or unsettled is refused", async () => {
    await overtimePolicy({ active: true, minimumMinutes: 60, roundToMinutes: 30, approver: "MANAGER_OR_DIRECTOR" }, u.d1!, u.d2!);
    const mine = (await as("emp").get("/mine?month=2026-10")).body;
    expect(mine.days.map((d: { date: string; eligibleMinutes: number }) => [d.date, d.eligibleMinutes])).toEqual([["2026-10-05", 90], ["2026-10-08", 60]]);
    expect((await as("emp").post("/mine", { date: "2026-10-06" })).body.error.code).toBe("NO_OVERTIME");
    expect((await as("emp").post("/mine", { date: "2026-10-07" })).body.error.code).toBe("NOT_SETTLED");
    expect((await as("emp").post("/mine", { date: "2026-10-05", note: "Month-end close" })).body.minutes).toBe(90);
    expect((await as("emp").post("/mine", { date: "2026-10-05" })).body.error.code).toBe("ALREADY_CLAIMED");
  });

  it("HR (the approval key, all in scope) approves; the minutes are read again; a director sees the month's totals; nobody decides their own", async () => {
    const list = (await as("hr").get("/")).body.claims;
    const c = list.find((x: { employeeId: string }) => x.employeeId === e.emp);
    await settledDay(e.emp!, "2026-10-05", 70); // recomputed lower since the claim
    expect((await as("hr").post(`/${c.id}/approve`)).body.approvedMinutes).toBe(60);
    expect((await as("hr").post(`/${c.id}/reject`, { note: "Too late" })).status).toBe(409);
    await expect(prisma.overtimeClaim.update({ where: { id: c.id }, data: { note: "edited" } })).rejects.toThrow(/OVERTIME_DECIDED/);
    const totals = (await as("d1").get("/totals?month=2026-10")).body.people.find((p: { employeeId: string }) => p.employeeId === e.emp);
    expect(totals).toMatchObject({ days: 1, minutes: 60 });
    expect((await as("hr").get("/totals?month=2026-10")).status).toBe(403);
    const own = await as("emp").post("/mine", { date: "2026-10-08" });
    expect((await as("emp").post(`/${own.body.id}/approve`)).status).toBe(403);
    // An approver never decides their own claim, though they hold the key and everyone is in their scope.
    await settledDay(e.hr!, "2026-10-09", 90);
    const hrOwn = await as("hr").post("/mine", { date: "2026-10-09" });
    expect(hrOwn.status).toBe(201);
    expect((await as("hr").get("/")).body.claims.map((c: { id: string }) => c.id)).not.toContain(hrOwn.body.id);
    expect((await as("hr").post(`/${hrOwn.body.id}/approve`)).status).toBe(404);
  });

  it("set to directors only: HR no longer decides; a rejection needs a reason and tells the employee", async () => {
    await overtimePolicy({ active: true, minimumMinutes: 60, roundToMinutes: 30, approver: "DIRECTOR" }, u.d1!, u.d2!);
    const claim = await prisma.overtimeClaim.findFirstOrThrow({ where: { employeeId: e.emp!, status: "PENDING" } });
    expect((await as("hr").post(`/${claim.id}/reject`, { note: "No" })).status).toBe(400);
    expect((await as("hr").post(`/${claim.id}/reject`, { note: "Not agreed" })).status).toBe(404);
    expect((await as("d2").post(`/${claim.id}/reject`, { note: "Not agreed beforehand" })).status).toBe(200);
    expect(await prisma.notification.count({ where: { type: "overtime.rejected", user: { employeeId: e.emp! } } })).toBe(1);
  });

  it("an employee, a manager without the key and the Developer cannot list or decide claims", async () => {
    for (const who of ["other", "mgr", "dev"]) {
      expect((await as(who).get("/")).status, who).toBe(403);
      expect((await as(who).post("/x/approve")).status, who).toBe(403);
    }
    expect((await as("dev").get("/mine?month=2026-10")).status).toBe(403);
  });
});
