import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { grantManager } from "../../../lib/__tests__/testHelpers";
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

// A manager starts with no permissions (2026-10-03), so a request can land
// where nobody on the team side can decide it. It must never be stranded:
// HR (everyone with company-wide leave approval) is told directly, the
// request is flagged in HR's queue, and Admin Home counts it — live, so a
// later grant clears it.
describe("leave requests with no team-side approver", () => {
  let org: TestOrgMasters;
  type Person = { employeeId: string; employeeCode: string; userId: string };
  const p = {} as Record<"hrAdmin" | "manager" | "member" | "unassigned", Person>;
  const tok = {} as Record<keyof typeof p, string>;
  let lopId = "";
  const req = {} as Record<"member" | "unassigned", string>;

  const as = (who: keyof typeof p) => ({
    get: (path: string) => request(app).get(path).set(...authHeader(tok[who])),
    post: (path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body),
  });
  const apply = async (who: "member" | "unassigned", day: string) => {
    const res = await as(who).post("/api/leave/requests", { leaveTypeId: lopId, fromDate: day, toDate: day, fromDayPart: "FULL", toDayPart: "FULL" });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const flagged = async () =>
    new Map(
      ((await as("hrAdmin").get("/api/leave/requests?status=PENDING&noTeamApprover=true&pageSize=200")).body.rows as Array<{ id: string; noTeamApprover: string }>).map((r) => [r.id, r.noTeamApprover]),
    );

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" }); // granted nothing
    p.member = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.unassigned = await createFullTestEmployee(org); // no reporting manager
    lopId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "LOP" } })).id;
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
    req.member = await apply("member", "2026-12-14");
    req.unassigned = await apply("unassigned", "2026-12-15");
  });

  afterAll(async () => {
    await prisma.userPermissionOverride.deleteMany({ where: { userId: p.manager.userId } });
    for (const k of ["member", "unassigned", "manager", "hrAdmin"] as const) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("HR is told directly; the manager who can't approve is not", async () => {
    const hrNotes = await prisma.notification.findMany({ where: { userId: p.hrAdmin.userId, type: "leave.applied.noTeamApprover" } });
    const about = (id: string) => hrNotes.find((n) => (n.payload as { leaveRequestId?: string }).leaveRequestId === id);
    expect(about(req.member)?.payload).toMatchObject({ reason: "MANAGER_CANNOT_APPROVE" });
    expect(about(req.member)?.link).toBe("/admin/workforce/leave/employee-leave?noTeamApprover=1");
    expect(about(req.unassigned)?.payload).toMatchObject({ reason: "NO_MANAGER" });
    expect(await prisma.notification.count({ where: { userId: p.manager.userId, type: { startsWith: "leave.applied" } } })).toBe(0);
  });

  it("flagged in HR's queue and counted on Admin Home, without anyone going looking", async () => {
    const f = await flagged();
    expect(f.get(req.member)).toBe("MANAGER_CANNOT_APPROVE");
    expect(f.get(req.unassigned)).toBe("NO_MANAGER");
    const all = (await as("hrAdmin").get("/api/leave/requests?status=PENDING&pageSize=200")).body.rows as Array<{ id: string; noTeamApprover: string | null }>;
    expect(all.find((r) => r.id === req.member)?.noTeamApprover).toBe("MANAGER_CANNOT_APPROVE");
    const counts = (await as("hrAdmin").get("/api/admin/tasks/counts")).body;
    expect(counts.leaveNoTeamApprover).toBeGreaterThanOrEqual(2);
  });

  it("granting the manager leave approval clears the flag at once", async () => {
    await grantManager(p.manager.userId, ["leave.view", "leave.approve"]);
    const f = await flagged();
    expect(f.has(req.member)).toBe(false);
    expect(f.has(req.unassigned)).toBe(true);
    await prisma.userPermissionOverride.deleteMany({ where: { userId: p.manager.userId } });
  });

  it("only company-wide viewers can use the filter", async () => {
    await grantManager(p.manager.userId, ["leave.view"]);
    tok.manager = await loginAs(p.manager.employeeCode);
    expect((await as("manager").get("/api/leave/requests?noTeamApprover=true")).status).toBe(403);
    await prisma.userPermissionOverride.deleteMany({ where: { userId: p.manager.userId } });
  });
});
