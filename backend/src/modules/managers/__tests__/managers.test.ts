import request from "supertest";
import { grantManager } from "../../../lib/__tests__/testHelpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { getSocketServer, setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { processScheduledSeparations } from "../../employee/separations";
import { loadReferenceData, newBatchTracker, validateEmployeeRow } from "../../import/rowValidators";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { MANAGER_GRANTABLE_KEYS, PERMISSION_KEYS } from "@shared/constants/permissions";

// Manager Management and the three-level rules (Phase 5 commit E2,
// hierarchy model A — docs/plans/PHASE_5.md §E2).
type Person = { employeeId: string; employeeCode: string; userId: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("Manager Management and the three-level hierarchy (E2)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"sa" | "hrAdmin" | "mgrA" | "mgrB" | "alice" | "bob" | "carol", Person>;
  const tok = {} as Record<"sa" | "hrAdmin" | "mgrA", string>;
  const extra: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.sa = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.mgrA = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.mgrB = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    for (const k of ["mgrA", "mgrB"] as const) await grantManager(p[k].userId, ["leave.view", "leave.approve"]); // granted, not default (2026-10-03)
    p.alice = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgrA.employeeId });
    p.bob = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" }); // unassigned
    p.carol = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgrA.employeeId });
    for (const k of ["sa", "hrAdmin", "mgrA"] as const) tok[k] = await loginAs(p[k].employeeCode);
  });

  afterAll(async () => {
    for (const x of [...Object.values(p).map((v) => v.employeeId), ...extra]) await cleanupFullTestEmployee(x);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const api = (t: string) => ({
    get: (path: string) => request(app).get(path).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(path).set(...authHeader(t)).send(b),
    del: (path: string, b: object = {}) => request(app).delete(path).set(...authHeader(t)).send(b),
    patch: (path: string, b: object) => request(app).patch(path).set(...authHeader(t)).send(b),
    put: (path: string, b: object) => request(app).put(path).set(...authHeader(t)).send(b),
  });
  const hr = () => api(tok.hrAdmin);
  const currentJob = (employeeId: string) => prisma.employeeJobHistory.findFirstOrThrow({ where: { employeeId, effectiveTo: null } });
  const roles = async (userId: string) => (await prisma.userRole.findMany({ where: { userId }, include: { role: true } })).map((r) => r.role.code).sort();

  it("HR_ADMIN holds the three Manager Management keys by default; a manager holds none and can't reach the screens", async () => {
    const hrRole = await prisma.role.findUniqueOrThrow({ where: { code: "HR_ADMIN" }, include: { permissions: { include: { permission: true } } } });
    const keys = hrRole.permissions.map((x) => x.permission.key);
    expect(keys).toEqual(expect.arrayContaining(["manager.appoint", "manager.team.assign", "manager.permissions.manage"]));
    expect((await api(tok.mgrA).get("/api/managers")).status).toBe(403);
    expect((await hr().get("/api/managers")).status).toBe(200);
  });

  it("lists managers with team size — a manager with no team shows 0", async () => {
    const res = await hr().get("/api/managers");
    const a = res.body.managers.find((x: { employeeId: string }) => x.employeeId === p.mgrA.employeeId);
    const b = res.body.managers.find((x: { employeeId: string }) => x.employeeId === p.mgrB.employeeId);
    expect(a.teamSize).toBe(2);
    expect(b.teamSize).toBe(0);
  });

  it("the Unassigned list: people with no (valid) manager — never top-level people", async () => {
    const res = await hr().get("/api/managers/unassigned");
    const ids = res.body.employees.map((e: { employeeId: string }) => e.employeeId);
    expect(ids).toContain(p.bob.employeeId);
    expect(ids).not.toContain(p.alice.employeeId);
    for (const top of [p.sa, p.hrAdmin, p.mgrA, p.mgrB]) expect(ids).not.toContain(top.employeeId);
  });

  describe("team moves", () => {
    it("assigning writes an effective-dated placement (old row closed, new row opened), audited, and tells both managers live", async () => {
      const sent: Array<{ rooms: string[]; event: string }> = [];
      const previous = getSocketServer();
      setSocketServer({ to: (room) => ({ emit: (event: string) => sent.push({ rooms: ([] as string[]).concat(room), event }) }) } as RoomEmitter);
      try {
        const before = await currentJob(p.bob.employeeId);
        const res = await hr().post(`/api/managers/${p.mgrB.employeeId}/team`, { employeeIds: [p.bob.employeeId] });
        expect(res.status).toBe(200);
        expect(res.body.assigned).toBe(1);
        const closed = await prisma.employeeJobHistory.findUniqueOrThrow({ where: { id: before.id } });
        expect(closed.effectiveTo).not.toBeNull();
        const now = await currentJob(p.bob.employeeId);
        expect(now.id).not.toBe(before.id);
        expect(now.reportingManagerId).toBe(p.mgrB.employeeId);
        expect(now.departmentId).toBe(before.departmentId); // everything else copied
        expect(await prisma.auditLog.count({ where: { action: "manager.team.member_assigned", entityId: p.bob.employeeId } })).toBe(1);
        expect(sent.some((e) => e.event === "team.changed" && e.rooms.includes(`user:${p.mgrB.employeeId}`))).toBe(true);
      } finally {
        setSocketServer(previous);
      }
    });

    it("a future-dated team move is refused (job history can't represent a pending change yet — PROGRESS open issue)", async () => {
      const res = await hr().post(`/api/managers/${p.mgrA.employeeId}/team`, { employeeIds: [p.bob.employeeId], effectiveFrom: iso(addCalendarDays(businessToday(), 3)) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("FUTURE_DATE");
      // Same rule through Change job details.
      const viaJob = await hr().patch(`/api/employees/${p.bob.employeeId}/job`, { reportingManagerId: p.mgrA.employeeId, effectiveFrom: iso(addCalendarDays(businessToday(), 3)) });
      expect(viaJob.status).toBe(400);
    });

    it("pending leave follows the employee: the new manager can decide it, the old one can't", async () => {
      const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
      const day = new Date(Date.UTC(2031, 6, 10));
      const r = await prisma.leaveRequest.create({ data: { employeeId: p.carol.employeeId, leaveTypeId: pl.id, fromDate: day, toDate: day, totalDays: 1, status: "PENDING", appliedByUserId: p.carol.userId } });
      try {
        expect((await api(tok.mgrA).get(`/api/leave/requests/${r.id}`)).status).toBe(200);
        expect((await hr().post(`/api/managers/${p.mgrB.employeeId}/team`, { employeeIds: [p.carol.employeeId] })).status).toBe(200);
        expect((await api(tok.mgrA).get(`/api/leave/requests/${r.id}`)).status).toBe(404);
        const tokB = await loginAs(p.mgrB.employeeCode);
        expect((await api(tokB).post(`/api/leave/requests/${r.id}/reject`, { comments: "new manager decides" })).status).toBe(200);
      } finally {
        await prisma.leaveRequest.delete({ where: { id: r.id } });
      }
    });

    it("removing someone from a team leaves them Unassigned", async () => {
      expect((await hr().del(`/api/managers/${p.mgrB.employeeId}/team/${p.carol.employeeId}`)).status).toBe(204);
      expect((await currentJob(p.carol.employeeId)).reportingManagerId).toBeNull();
      const ids = (await hr().get("/api/managers/unassigned")).body.employees.map((e: { employeeId: string }) => e.employeeId);
      expect(ids).toContain(p.carol.employeeId);
    });

    it("only a manager can have a team, and top-level people can't be put in one", async () => {
      expect((await hr().post(`/api/managers/${p.alice.employeeId}/team`, { employeeIds: [p.carol.employeeId] })).status).toBe(404);
      const top = await hr().post(`/api/managers/${p.mgrA.employeeId}/team`, { employeeIds: [p.hrAdmin.employeeId] });
      expect(top.status).toBe(400);
      expect(top.body.error.code).toBe("HIERARCHY");
      expect((await hr().post(`/api/managers/${p.mgrA.employeeId}/team`, { employeeIds: [p.mgrB.employeeId] })).body.error.code).toBe("HIERARCHY");
    });
  });

  describe("the rules everywhere a reporting manager is set", () => {
    it("Change job details: a reporting manager must hold MANAGER; a manager can't have one", async () => {
      const toHr = await hr().patch(`/api/employees/${p.carol.employeeId}/job`, { reportingManagerId: p.hrAdmin.employeeId, effectiveFrom: iso(businessToday()) });
      expect(toHr.status).toBe(400);
      expect(toHr.body.error.code).toBe("HIERARCHY");
      const mgrUnderMgr = await hr().patch(`/api/employees/${p.mgrB.employeeId}/job`, { reportingManagerId: p.mgrA.employeeId, effectiveFrom: iso(businessToday()) });
      expect(mgrUnderMgr.body.error.code).toBe("HIERARCHY");
    });

    it("Access tab: assigning MANAGER is an appointment; HR_ADMIN can't be combined with MANAGER; MANAGER is removed only in Manager Management", async () => {
      const appoint = await api(tok.sa).post(`/api/access/employees/${p.alice.employeeId}/roles`, { code: "MANAGER" });
      expect(appoint.status).toBe(200);
      expect((await currentJob(p.alice.employeeId)).reportingManagerId).toBeNull(); // model A: under Admin
      const combo = await api(tok.sa).post(`/api/access/employees/${p.alice.employeeId}/roles`, { code: "HR_ADMIN" });
      expect(combo.status).toBe(400);
      expect(combo.body.error.code).toBe("HIERARCHY");
      const remove = await api(tok.sa).del(`/api/access/employees/${p.alice.employeeId}/roles/MANAGER`);
      expect(remove.status).toBe(409);
      expect(remove.body.error.code).toBe("USE_MANAGER_MANAGEMENT");
    });

    it("the MANAGER role itself can't be changed at all — not widened, not given company-wide scope — even by a Super Admin", async () => {
      const wider = await api(tok.sa).put("/api/access/roles/MANAGER", { permissions: ["employee.bank.view"] });
      expect(wider.status).toBe(403);
      expect(wider.body.error.code).toBe("MANAGER_ROLE_LOCKED");
      const all = await api(tok.sa).put("/api/access/roles/MANAGER", { dataScope: "ALL" });
      expect(all.body.error.code).toBe("MANAGER_ROLE_LOCKED");
      // …and per-manager grants still stop at the ceiling, Super Admin included.
      const bank = await api(tok.sa).put(`/api/access/employees/${p.mgrA.employeeId}/overrides/employee.bank.view`, { effect: "GRANT", reason: "should be refused" });
      expect(bank.body.error.code).toBe("NOT_MANAGER_GRANTABLE");
    });

    it("Excel import: a row's reporting manager must be an active manager (blank is allowed — Unassigned)", async () => {
      const refs = await loadReferenceData();
      // The validator expects every template column (blank = ""); only the manager varies.
      const row = (reportingManagerCode: string) => ({ rowNumber: 2, values: { deviceUserId: "X-IMP-1", employeeCode: "X-IMP-1", reportingManagerCode } as Record<string, string> });
      const errorsFor = (code: string) => validateEmployeeRow(row(code), refs, newBatchTracker()).errors.filter((e) => e.toLowerCase().includes("manager"));
      expect(errorsFor(p.hrAdmin.employeeCode).join(" ")).toContain("isn't an active Manager");
      expect(errorsFor(p.bob.employeeCode).join(" ")).toContain("isn't an active Manager"); // a plain employee
      expect(errorsFor(p.mgrA.employeeCode)).toEqual([]);
      expect(errorsFor("")).toEqual([]);
    });

    it("Add Employee: a new hire's reporting manager must be an active manager", async () => {
      const managerId = p.hrAdmin.employeeId; // not a manager
      const res = await hr().post("/api/employees", {
        official: { deviceUserId: `E2-${Date.now()}`, employeeCode: `E2-${Date.now()}`, dateOfJoining: "2026-01-05", departmentId: org.departmentId, designationId: org.designationId, locationId: org.locationId, employmentType: "PERMANENT", reportingManagerId: managerId },
        personal: { fullName: "E2 Hire", dateOfBirth: "1995-01-01", gender: "OTHER", personalEmail: `e2.hire.${Date.now()}@gmail.com`, mobile: "9000000009", currentAddress: "a", permanentAddress: "a", emergencyContactName: "b", emergencyContactPhone: "9000000008", emergencyContactRelation: "c" },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("HIERARCHY");
    });
  });

  describe("appoint and remove", () => {
    it("appointing clears the person's reporting line (they sit under Admin) and is audited; HR Admins can't be appointed", async () => {
      expect((await hr().post(`/api/managers/${p.mgrA.employeeId}/team`, { employeeIds: [p.carol.employeeId] })).status).toBe(200);
      const res = await hr().post("/api/managers", { employeeId: p.carol.employeeId });
      expect(res.status).toBe(201);
      expect(await roles(p.carol.userId)).toContain("MANAGER");
      expect((await currentJob(p.carol.employeeId)).reportingManagerId).toBeNull();
      expect(await prisma.auditLog.count({ where: { action: "manager.appointed", entityId: p.carol.employeeId } })).toBe(1);
      const hrA = await hr().post("/api/managers", { employeeId: p.hrAdmin.employeeId });
      expect(hrA.status).toBe(400);
    });

    it("removing a manager is refused while they have a team, then needs a manager of their own", async () => {
      expect((await hr().post(`/api/managers/${p.carol.employeeId}/team`, { employeeIds: [p.bob.employeeId] })).status).toBe(200);
      const blocked = await hr().del(`/api/managers/${p.carol.employeeId}`, { newManagerId: p.mgrA.employeeId });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("TEAM_NOT_EMPTY");
      expect((await hr().post(`/api/managers/${p.mgrB.employeeId}/team`, { employeeIds: [p.bob.employeeId] })).status).toBe(200);
      const badNew = await hr().del(`/api/managers/${p.carol.employeeId}`, { newManagerId: p.hrAdmin.employeeId });
      expect(badNew.body.error.code).toBe("HIERARCHY");
      const ok = await hr().del(`/api/managers/${p.carol.employeeId}`, { newManagerId: p.mgrA.employeeId });
      expect(ok.status).toBe(204);
      expect(await roles(p.carol.userId)).not.toContain("MANAGER");
      expect(await roles(p.carol.userId)).toContain("EMPLOYEE");
      expect((await currentJob(p.carol.employeeId)).reportingManagerId).toBe(p.mgrA.employeeId);
    });
  });

  it("a manager's own leave goes to every Super Admin (model A: nobody above them is a person)", async () => {
    const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } }); // unpaid: no balance needed
    const res = await api(tok.mgrA).post("/api/leave/requests", { leaveTypeId: pl.id, fromDate: "2031-08-04", toDate: "2031-08-04" });
    try {
      if (res.status !== 201) throw new Error(`apply failed: ${res.status} ${JSON.stringify(res.body)}`);
      const notes = await prisma.notification.findMany({ where: { type: "leave.applied", payload: { path: ["leaveRequestId"], equals: res.body.id } } });
      const admins = await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: "SUPER_ADMIN" } } } }, select: { id: true } });
      expect(admins.length).toBeGreaterThanOrEqual(2); // the seeded one and this file's
      expect(new Set(notes.map((n) => n.userId))).toEqual(new Set(admins.map((a) => a.id)));
    } finally {
      if (res.body?.id) await prisma.leaveRequest.delete({ where: { id: res.body.id } }).catch(() => undefined);
    }
  });

  it("when a manager with a team separates, the team shows as Unassigned and team-assigners are told", async () => {
    const m = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    const r = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: m.employeeId });
    extra.push(r.employeeId, m.employeeId);
    await prisma.separation.create({ data: { employeeId: m.employeeId, lastWorkingDate: new Date("2020-01-31"), reason: "Resigned", initiatedByUserId: p.hrAdmin.userId } });
    await processScheduledSeparations();
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: m.employeeId } })).status).toBe("SEPARATED");
    const ids = (await hr().get("/api/managers/unassigned")).body.employees.map((e: { employeeId: string }) => e.employeeId);
    expect(ids).toContain(r.employeeId);
    expect(await prisma.notification.count({ where: { userId: p.hrAdmin.userId, type: "team.unassigned" } })).toBeGreaterThan(0);
  });

  // User decision 2026-10-03: being appointed a manager grants nothing.
  describe("a manager starts with nothing — every power is granted per manager", () => {
    const fresh = {} as Record<"mgr" | "member", { employeeId: string; employeeCode: string; userId: string }>;
    const appointerOnly = `TEST_APPOINT_ONLY_${Date.now()}`;
    let requestId = "";

    beforeAll(async () => {
      fresh.mgr = await createFullTestEmployee(org);
      fresh.member = await createFullTestEmployee(org);
      expect((await hr().post("/api/managers", { employeeId: fresh.mgr.employeeId })).status).toBe(201);
      expect((await hr().post(`/api/managers/${fresh.mgr.employeeId}/team`, { employeeIds: [fresh.member.employeeId] })).status).toBe(200);
      const lop = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } });
      const day = new Date(Date.UTC(2031, 9, 15));
      requestId = (await prisma.leaveRequest.create({ data: { employeeId: fresh.member.employeeId, leaveTypeId: lop.id, fromDate: day, toDate: day, totalDays: 1, status: "PENDING", appliedByUserId: fresh.member.userId } })).id;
    });

    afterAll(async () => {
      await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: [fresh.member.employeeId] } } });
      for (const x of Object.values(fresh)) extra.push(x.employeeId);
      await cleanupTestRole(appointerOnly);
    });

    it("a newly appointed manager holds no permission at all, and Manager Management says so", async () => {
      const row = (await hr().get("/api/managers")).body.managers.find((m: { employeeId: string }) => m.employeeId === fresh.mgr.employeeId);
      expect(row).toMatchObject({ permissions: [], leaveApproval: false, teamSize: 1 });
      const t = await loginAs(fresh.mgr.employeeCode);
      expect((await api(t).get(`/api/leave/requests/${requestId}`)).status).toBe(404);
      expect((await api(t).post(`/api/leave/requests/${requestId}/approve`, {})).status).toBe(403);
      expect((await api(t).get(`/api/employees/${fresh.member.employeeId}`)).status).toBe(403);
      expect((await api(t).get("/api/reports/headcount")).status).toBe(403);
    });

    it("a manager who can't approve isn't asked to: no 'New leave request' for them", async () => {
      const lop = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } });
      const res = await api(await loginAs(fresh.member.employeeCode)).post("/api/leave/requests", { leaveTypeId: lop.id, fromDate: "2031-10-20", toDate: "2031-10-20" });
      expect(res.status).toBe(201);
      expect(await prisma.notification.count({ where: { userId: fresh.mgr.userId, type: "leave.applied" } })).toBe(0);
    });

    it("'Grant leave approval' is one deliberate click — audited, live — and can be taken back", async () => {
      const granted = await hr().post(`/api/managers/${fresh.mgr.employeeId}/leave-approval`, { grant: true });
      expect(granted.status).toBe(200);
      expect(granted.body).toMatchObject({ leaveApproval: true, permissions: ["leave.approve", "leave.view"] });
      const overrides = await prisma.userPermissionOverride.findMany({ where: { userId: fresh.mgr.userId }, include: { permission: true } });
      expect(overrides.map((o) => [o.permission.key, o.effect]).sort()).toEqual([["leave.approve", "GRANT"], ["leave.view", "GRANT"]]);
      expect(await prisma.auditLog.count({ where: { action: "manager.leave_approval.granted", entityId: fresh.mgr.employeeId } })).toBe(1);
      const t = await loginAs(fresh.mgr.employeeCode);
      expect((await api(t).get(`/api/leave/requests/${requestId}`)).status).toBe(200);
      // A manager can't grant themselves anything, and nobody without the key can click it.
      expect((await api(t).post(`/api/managers/${fresh.mgr.employeeId}/leave-approval`, { grant: true })).status).toBe(403);

      const removed = await hr().post(`/api/managers/${fresh.mgr.employeeId}/leave-approval`, { grant: false });
      expect(removed.body).toMatchObject({ leaveApproval: false, permissions: [] });
      expect((await api(await loginAs(fresh.mgr.employeeCode)).get(`/api/leave/requests/${requestId}`)).status).toBe(404);
    });

    it("appointing never grants by default; granting at appointment is an explicit choice that needs the permission-granting key", async () => {
      await grantPermissions(appointerOnly, ["manager.appoint"]);
      const appointer = await createFullTestEmployee(org, { roleCode: appointerOnly });
      const target = await createFullTestEmployee(org);
      const other = await createFullTestEmployee(org);
      extra.push(appointer.employeeId, target.employeeId, other.employeeId);
      const t = await loginAs(appointer.employeeCode);
      const refused = await api(t).post("/api/managers", { employeeId: target.employeeId, grantLeaveApproval: true });
      expect(refused.status).toBe(403);
      expect(await roles(target.userId)).not.toContain("MANAGER"); // nothing half-done
      expect((await hr().post("/api/managers", { employeeId: target.employeeId, grantLeaveApproval: true })).body.leaveApproval).toBe(true);
      const row = (await hr().get("/api/managers")).body.managers.find((m: { employeeId: string }) => m.employeeId === target.employeeId);
      expect(row.leaveApproval).toBe(true);
      expect((await api(t).post("/api/managers", { employeeId: other.employeeId })).status).toBe(201); // plain appointment: allowed, grants nothing
      expect((await hr().get("/api/managers")).body.managers.find((m: { employeeId: string }) => m.employeeId === other.employeeId).permissions).toEqual([]);
    });

    it("removing a manager takes their manager grants with the role — they're exactly a plain employee again", async () => {
      await hr().post(`/api/managers/${fresh.mgr.employeeId}/leave-approval`, { grant: true });
      await hr().del(`/api/managers/${fresh.mgr.employeeId}/team/${fresh.member.employeeId}`);
      expect((await hr().del(`/api/managers/${fresh.mgr.employeeId}`, { newManagerId: null })).status).toBe(204);
      expect(await prisma.userPermissionOverride.count({ where: { userId: fresh.mgr.userId } })).toBe(0);
    });
  });

  it("crucial operations can never reach a manager: no payroll, bank-file, salary, bank or statutory key is (or can become) manager-grantable", () => {
    const forbidden = /^(payroll|bank|salary)\.|^employee\.(bank|statutory|salary)\./;
    expect(MANAGER_GRANTABLE_KEYS.filter((k) => forbidden.test(k))).toEqual([]);
    // Every such key that exists today is outside the ceiling.
    expect(PERMISSION_KEYS.filter((k) => forbidden.test(k)).every((k) => !(MANAGER_GRANTABLE_KEYS as readonly string[]).includes(k))).toBe(true);
  });
});
