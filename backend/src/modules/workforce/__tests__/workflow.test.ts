import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { displayLeaveForViewer } from "@shared/leave/display";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A-10 G7 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 16): Workflow Review (pending / completed), Monitor, bulk decisions through the existing functions.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("A-10 G7 — workflow", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let leaveTypeId = "";
  const reqs: Record<string, string> = {};
  const call = (who: string, method: "get" | "post", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.a = await createFullTestEmployee(org);
    p.b = await createFullTestEmployee(org, { managerId: p.a.employeeId });
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    leaveTypeId = (await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } })).id;
    const mk = async (who: Person, date: string) => (await prisma.leaveRequest.create({ data: { employeeId: who.employeeId, leaveTypeId, fromDate: day(date), toDate: day(date), totalDays: 1, status: "PENDING", reason: "family function", appliedByUserId: who.userId } })).id;
    reqs.a = await mk(p.a, "2031-06-10");
    reqs.b = await mk(p.b, "2031-06-11");
    reqs.hr = await mk(p.hr, "2031-06-12");
  }, 180_000);

  afterAll(async () => {
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("the display function passes the type and reason through today (the hook for a privacy rule)", () => {
    expect(displayLeaveForViewer({ leaveTypeCode: "PL", leaveTypeName: "Privilege", reason: "r" }, "BELOW_HR")).toEqual({ typeLabel: "Privilege", reason: "r" });
  });

  it("the Developer role, an ordinary employee and no sign-in are refused", async () => {
    for (const who of ["dev", "a"]) {
      expect((await call(who, "get", "/api/workforce/workflow/review?type=LEAVE")).status, who).toBe(403);
      expect((await call(who, "get", "/api/workforce/workflow/monitor?type=LEAVE")).status, who).toBe(403);
      expect((await call(who, "post", "/api/workforce/workflow/decide", { type: "LEAVE", ids: [reqs.b], approve: true })).body.results?.[0]?.ok ?? false, who).toBe(false);
    }
    expect((await request(app).get("/api/workforce/workflow/review?type=LEAVE")).status).toBe(401);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: reqs.b } })).status).toBe("PENDING");
  });

  it("HR reviews others' pending leave (never its own), which waits in Monitor with who it waits on; a bulk decision reports each item; completed lists it", async () => {
    const pending = await call("hr", "get", "/api/workforce/workflow/review?type=LEAVE&state=PENDING");
    const ids = pending.body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([reqs.a, reqs.b]));
    expect(ids).not.toContain(reqs.hr);
    const monitor = await call("hr", "get", "/api/workforce/workflow/monitor?type=LEAVE");
    const own = monitor.body.items.find((i: { id: string }) => i.id === reqs.hr);
    expect(own).toBeTruthy();
    expect(own.waitingOn).toBe("HR (no reporting manager)");
    expect((await call("hr", "post", "/api/workforce/workflow/decide", { type: "LEAVE", ids: [reqs.a], approve: false })).status).toBe(400); // a rejection needs a reason
    const out = await call("hr", "post", "/api/workforce/workflow/decide", { type: "LEAVE", ids: [reqs.b, reqs.hr], approve: false, note: "clash with the audit" });
    expect(out.body.decided).toBe(1);
    expect(out.body.results.find((r: { id: string }) => r.id === reqs.hr)).toMatchObject({ ok: false, code: "SELF_APPROVAL_BLOCKED" });
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: reqs.b } })).status).toBe("REJECTED");
    const done = await call("hr", "get", "/api/workforce/workflow/review?type=LEAVE&state=COMPLETED");
    expect(done.body.items.map((i: { id: string }) => i.id)).toContain(reqs.b);
    const search = await call("hr", "get", `/api/workforce/workflow/review?type=LEAVE&state=PENDING&search=${p.a!.employeeCode}`);
    expect(search.body.items.map((i: { id: string }) => i.id)).toEqual([reqs.a]);
  });
});
