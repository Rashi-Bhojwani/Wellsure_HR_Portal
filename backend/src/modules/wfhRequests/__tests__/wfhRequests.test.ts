import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { isRemoteOn } from "../../attendance/remote/service";
import { resetPolicy, setPolicy } from "../../policySettings/__tests__/policyTestHelpers";
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

// AT-36 (M session block 2): work-from-home requests, off until two directors turn them on; a director's approval makes the days remote days.
describe("work-from-home requests", () => {
  let orgA: TestOrgMasters;
  let orgB: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const u: Record<string, string> = {};
  let deptCode = "";
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/wfh-requests${p}`).set(...authHeader(t[who]!)),
    post: (p: string, body: object = {}) => request(app).post(`/api/wfh-requests${p}`).set(...authHeader(t[who]!)).send(body),
  });
  beforeAll(async () => {
    setBusinessTodayForTests(new Date("2026-12-01T00:00:00Z"));
    orgA = await createEmployeeTestOrgMasters();
    orgB = await createEmployeeTestOrgMasters();
    for (const [k, org, roleCode] of [["d1", orgA, "SUPER_ADMIN"], ["d2", orgA, "SUPER_ADMIN"], ["emp", orgA, undefined], ["away", orgA, undefined], ["outside", orgB, undefined], ["hr", orgA, "HR_ADMIN"], ["dev", orgA, DEVELOPER_ROLE_CODE]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      u[k] = x.userId;
      t[k] = await loginAs(x.employeeCode);
    }
    deptCode = (await prisma.department.findUniqueOrThrow({ where: { id: orgA.departmentId } })).code;
  });
  afterAll(async () => {
    await resetPolicy("policy.wfh", t.d1!, t.d2!);
    setBusinessTodayForTests(null);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(orgA);
    await cleanupEmployeeTestOrgMasters(orgB);
  });

  it("GOLDEN: while off (the default) nobody may ask and no remote mark is written", async () => {
    expect((await as("emp").get("/mine")).body).toMatchObject({ active: false, eligible: false, requests: [] });
    expect((await as("emp").post("/mine", { fromDate: "2026-12-03", toDate: "2026-12-04", reason: "Plumber visit" })).body.error.code).toBe("WFH_OFF");
    expect(await prisma.remoteWorkMark.count({ where: { employeeId: { in: ids } } })).toBe(0);
  });

  it("on for one department: only its people ask, ahead, within the most days, without overlap", async () => {
    await setPolicy("policy.wfh", { active: true, departments: [deptCode], maxDaysPerRequest: 3 }, t.d1!, t.d2!);
    expect((await as("outside").post("/mine", { fromDate: "2026-12-03", toDate: "2026-12-03", reason: "Plumber visit" })).body.error.code).toBe("NOT_ELIGIBLE");
    expect((await as("emp").post("/mine", { fromDate: "2026-12-01", toDate: "2026-12-01", reason: "Today" })).status).toBe(400);
    expect((await as("emp").post("/mine", { fromDate: "2026-12-03", toDate: "2026-12-07", reason: "Too long" })).body.error.code).toBe("TOO_MANY_DAYS");
    expect((await as("emp").post("/mine", { fromDate: "2026-12-03", toDate: "2026-12-04", reason: "Plumber visit" })).status).toBe(201);
    expect((await as("emp").post("/mine", { fromDate: "2026-12-04", toDate: "2026-12-04", reason: "Again" })).body.error.code).toBe("OVERLAP");
  });

  it("a director approves: remote on those days, not before or after; someone already remote stays remote after", async () => {
    const req = (await as("d1").get("/")).body.requests.find((r: { employeeId: string }) => r.employeeId === e.emp);
    expect((await as("d1").post(`/${req.id}/approve`)).status).toBe(200);
    expect(await isRemoteOn(e.emp!, "2026-12-02")).toBe(false);
    expect(await isRemoteOn(e.emp!, "2026-12-03")).toBe(true);
    expect(await isRemoteOn(e.emp!, "2026-12-04")).toBe(true);
    expect(await isRemoteOn(e.emp!, "2026-12-05")).toBe(false);
    await prisma.remoteWorkMark.create({ data: { employeeId: e.away!, effectiveFrom: new Date("2026-11-01T00:00:00Z"), remote: true, reason: "Works remotely", markedByUserId: u.d1! } });
    const r2 = await as("away").post("/mine", { fromDate: "2026-12-08", toDate: "2026-12-08", reason: "Home visit" });
    expect((await as("d2").post(`/${r2.body.id}/approve`)).status).toBe(200);
    expect(await isRemoteOn(e.away!, "2026-12-09")).toBe(true);
    await expect(prisma.wfhRequest.update({ where: { id: req.id }, data: { reason: "edited" } })).rejects.toThrow(/WFH_DECIDED/);
  });

  it("a rejection needs a reason and tells the employee; nobody decides their own; HR, an employee and the Developer cannot decide", async () => {
    const r = await as("emp").post("/mine", { fromDate: "2026-12-10", toDate: "2026-12-10", reason: "Errand" });
    expect((await as("d1").post(`/${r.body.id}/reject`, { note: "x" })).status).toBe(400);
    for (const who of ["hr", "emp", "away"]) {
      expect((await as(who).get("/")).status, who).toBe(403);
      expect((await as(who).post(`/${r.body.id}/approve`)).status, who).toBe(403);
    }
    for (const p of ["/", `/${r.body.id}/approve`]) expect((p === "/" ? await as("dev").get(p) : await as("dev").post(p)).status).toBe(403);
    expect((await as("d1").post(`/${r.body.id}/reject`, { note: "Team day in office" })).status).toBe(200);
    expect(await prisma.notification.count({ where: { type: "wfh.rejected", user: { employeeId: e.emp! } } })).toBe(1);
    const own = await as("d1").post("/mine", { fromDate: "2026-12-11", toDate: "2026-12-11", reason: "My own" });
    expect((await as("d1").get("/")).body.requests.map((x: { id: string }) => x.id)).not.toContain(own.body.id);
    expect((await as("d1").post(`/${own.body.id}/approve`)).status).toBe(404);
  });
});
