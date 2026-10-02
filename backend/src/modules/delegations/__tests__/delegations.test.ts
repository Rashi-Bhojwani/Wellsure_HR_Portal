import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { getSocketServer, setSocketServer, type RoomEmitter } from "../../../realtime/emit";
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

// Workflow Delegates (Phase 5 commit E3, docs/plans/PHASE_5.md §E3).
type Person = { employeeId: string; employeeCode: string; userId: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => businessToday();
const inDays = (n: number) => iso(addCalendarDays(today(), n));

describe("Workflow Delegates (E3)", () => {
  let org: TestOrgMasters;
  let lop: { id: string };
  const p = {} as Record<"sa" | "hrAdmin" | "mgrA" | "mgrB" | "mgrC" | "alice" | "carol" | "dave" | "gina" | "frank", Person>;
  const tok = {} as Record<"sa" | "hrAdmin" | "mgrA" | "mgrB" | "mgrC" | "alice" | "frank", string>;
  const requestIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.sa = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.mgrA = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.mgrB = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.mgrC = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.alice = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgrA.employeeId });
    p.carol = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgrA.employeeId });
    p.frank = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgrA.employeeId }); // a senior in A's team who can approve leave
    p.dave = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgrB.employeeId });
    p.gina = await createFullTestEmployee(org, { roleCode: "EMPLOYEE", managerId: p.mgrC.employeeId });
    const approve = await prisma.permission.findUniqueOrThrow({ where: { key: "leave.approve" } });
    await prisma.userPermissionOverride.create({ data: { userId: p.frank.userId, permissionId: approve.id, effect: "GRANT", reason: "test: senior who approves leave", createdByUserId: p.sa.userId } });
    for (const k of ["sa", "hrAdmin", "mgrA", "mgrB", "mgrC", "alice", "frank"] as const) tok[k] = await loginAs(p[k].employeeCode);
    lop = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } }); // unpaid: approving needs no balance
  });

  afterAll(async () => {
    await prisma.leaveRequest.deleteMany({ where: { id: { in: requestIds } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const api = (t: string) => ({
    get: (path: string) => request(app).get(path).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(path).set(...authHeader(t)).send(b),
  });
  const pending = async (who: Person, offsetDays = 400) => {
    const day = addCalendarDays(today(), offsetDays + requestIds.length);
    const r = await prisma.leaveRequest.create({ data: { employeeId: who.employeeId, leaveTypeId: lop.id, fromDate: day, toDate: day, totalDays: 1, status: "PENDING", appliedByUserId: who.userId } });
    requestIds.push(r.id);
    return r.id;
  };
  const delegate = (from: keyof typeof tok, to: Person, startDate = inDays(0), endDate = inDays(3)) =>
    api(tok[from]).post("/api/delegations/mine", { delegateUserId: to.userId, startDate, endDate, reason: "away" });
  const revokeAll = async () => {
    await prisma.workflowDelegate.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: p.sa.userId } });
  };

  it("HR_ADMIN holds delegation.manage by default; a manager doesn't, and can't reach HR's endpoints", async () => {
    const hr = await prisma.role.findUniqueOrThrow({ where: { code: "HR_ADMIN" }, include: { permissions: { include: { permission: true } } } });
    expect(hr.permissions.map((x) => x.permission.key)).toContain("delegation.manage");
    const mgr = await prisma.role.findUniqueOrThrow({ where: { code: "MANAGER" }, include: { permissions: { include: { permission: true } } } });
    expect(mgr.permissions.map((x) => x.permission.key)).not.toContain("delegation.manage");
    expect((await api(tok.mgrA).get("/api/delegations")).status).toBe(403);
    expect((await api(tok.mgrA).post("/api/delegations", { delegatorUserId: p.mgrB.userId, delegateUserId: p.mgrC.userId, startDate: inDays(0), endDate: inDays(1) })).status).toBe(403);
  });

  describe("who can delegate, and to whom", () => {
    it("only a manager delegates — a Super Admin, an HR Admin or an employee is told why not", async () => {
      const sa = await delegate("sa", p.hrAdmin);
      expect(sa.status).toBe(409);
      expect(sa.body.error.message).toMatch(/Super Admins already cover each other/);
      expect((await delegate("hrAdmin", p.mgrA)).status).toBe(409);
      expect((await delegate("alice", p.mgrA)).status).toBe(409);
      const mine = await api(tok.sa).get("/api/delegations/mine");
      expect(mine.body).toMatchObject({ canDelegate: false, notAllowedReason: expect.stringMatching(/Super Admins/) });
      expect((await api(tok.sa).get("/api/delegations/delegate-options")).body.options).toEqual([]);
    });

    it("the delegate must already hold leave.approve — delegation never grants it — and can't be the delegator", async () => {
      const res = await delegate("mgrA", p.alice);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("DELEGATE_CANNOT_APPROVE");
      expect((await delegate("mgrA", p.mgrA)).status).toBe(400);
      const options = (await api(tok.mgrA).get("/api/delegations/delegate-options")).body.options.map((o: { userId: string }) => o.userId);
      expect(options).toEqual(expect.arrayContaining([p.mgrB.userId, p.hrAdmin.userId, p.frank.userId]));
      expect(options).not.toContain(p.alice.userId);
      expect(options).not.toContain(p.mgrA.userId);
    });

    it("dates: inclusive, never starting in the past, never ending before they start", async () => {
      expect((await delegate("mgrA", p.mgrB, inDays(-1), inDays(2))).body.error.code).toBe("PAST_START");
      expect((await delegate("mgrA", p.mgrB, inDays(3), inDays(2))).body.error.code).toBe("INVALID_RANGE");
    });
  });

  describe("reach — whose team a delegate's approvals resolve against", () => {
    it("only while active: the delegate decides the delegator's team, recorded as on behalf of them; never anyone else", async () => {
      await revokeAll();
      const r1 = await pending(p.alice);
      expect((await api(tok.mgrB).get(`/api/leave/requests/${r1}`)).status).toBe(404);

      const created = await delegate("mgrA", p.mgrB);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ status: "ACTIVE", delegateCanApprove: true, delegator: { userId: p.mgrA.userId }, delegate: { userId: p.mgrB.userId } });

      // The review queue, the request, the balances Review shows, Tasks.
      const queue = await api(tok.mgrB).get("/api/leave/requests?status=PENDING&pageSize=100");
      const row = queue.body.rows.find((x: { id: string }) => x.id === r1);
      expect(row.onBehalfOf).toMatchObject({ userId: p.mgrA.userId });
      expect((await api(tok.mgrB).get(`/api/leave/requests/${r1}`)).status).toBe(200);
      expect((await api(tok.mgrB).get(`/api/leave/balances?employeeId=${p.alice.employeeId}`)).status).toBe(200);
      const tasks = await api(tok.mgrB).get("/api/tasks/mine");
      expect(JSON.stringify(tasks.body)).toContain(r1);

      // Their own team is still their own — no on-behalf tag.
      const own = await pending(p.dave);
      const ownRow = (await api(tok.mgrB).get("/api/leave/requests?status=PENDING&pageSize=100")).body.rows.find((x: { id: string }) => x.id === own);
      expect(ownRow.onBehalfOf).toBeNull();

      // Decide: recorded on the request and in the audit log; the delegator is told.
      const approved = await api(tok.mgrB).post(`/api/leave/requests/${r1}/approve`, {});
      expect(approved.status).toBe(200);
      expect(approved.body.decidedOnBehalfOfUserId).toBe(p.mgrA.userId);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "leave.request.approve", entityId: r1 } });
      expect(audit).toMatchObject({ actorUserId: p.mgrB.userId, onBehalfOfUserId: p.mgrA.userId });
      expect(await prisma.notification.count({ where: { userId: p.mgrA.userId, type: "leave.decided.onBehalf" } })).toBe(1);

      // An outsider (C's team) is still out of reach.
      const outsider = await pending(p.gina);
      expect((await api(tok.mgrB).get(`/api/leave/requests/${outsider}`)).status).toBe(404);
      expect((await api(tok.mgrB).post(`/api/leave/requests/${outsider}/reject`, { comments: "no" })).status).toBe(404);
      expect((await api(tok.mgrB).get(`/api/leave/balances?employeeId=${p.gina.employeeId}`)).status).toBe(404);

      // Delegation covers approvals only — not the team's profiles.
      expect((await api(tok.mgrB).get(`/api/employees/${p.alice.employeeId}`)).status).toBe(404);
    });

    it("the delegator keeps their own access; a decision in their own scope isn't 'on behalf'", async () => {
      const r = await pending(p.carol);
      const res = await api(tok.mgrA).post(`/api/leave/requests/${r}/reject`, { comments: "back early" });
      expect(res.status).toBe(200);
      expect(res.body.decidedOnBehalfOfUserId).toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "leave.request.reject", entityId: r } });
      expect(audit.onBehalfOfUserId).toBeNull();
    });

    it("isn't transitive: covering for B (who covers A) reaches B's team, never A's", async () => {
      expect((await delegate("mgrB", p.mgrC)).status).toBe(201); // A → B is still active
      const a = await pending(p.alice);
      const b = await pending(p.dave);
      expect((await api(tok.mgrC).get(`/api/leave/requests/${b}`)).status).toBe(200);
      expect((await api(tok.mgrC).get(`/api/leave/requests/${a}`)).status).toBe(404);
    });

    it("a scheduled, ended or revoked delegation reaches nothing", async () => {
      await revokeAll();
      const r = await pending(p.alice);
      expect((await delegate("mgrA", p.mgrB, inDays(1), inDays(4))).body.status).toBe("SCHEDULED");
      expect((await api(tok.mgrB).get(`/api/leave/requests/${r}`)).status).toBe(404);
      await revokeAll();
      await prisma.workflowDelegate.create({
        data: { delegatorUserId: p.mgrA.userId, delegateUserId: p.mgrB.userId, startDate: addCalendarDays(today(), -5), endDate: addCalendarDays(today(), -1), createdByUserId: p.mgrA.userId },
      });
      expect((await api(tok.mgrB).get(`/api/leave/requests/${r}`)).status).toBe(404);
      const active = await delegate("mgrA", p.mgrB);
      expect((await api(tok.mgrB).get(`/api/leave/requests/${r}`)).status).toBe(200);
      expect((await api(tok.mgrA).post(`/api/delegations/mine/${active.body.id}/revoke`, { reason: "back" })).status).toBe(200);
      expect((await api(tok.mgrB).get(`/api/leave/requests/${r}`)).status).toBe(404);
    });
  });

  describe("self-approval and the delegate's own permission", () => {
    it("a delegate in the delegator's team still can't decide their own request, nor the delegator's", async () => {
      await revokeAll();
      expect((await delegate("mgrA", p.frank)).status).toBe(201);
      const teammate = await pending(p.alice);
      const own = await pending(p.frank);
      const managers = await pending(p.mgrA);
      expect((await api(tok.frank).get(`/api/leave/requests/${teammate}`)).status).toBe(200);
      const self = await api(tok.frank).post(`/api/leave/requests/${own}/approve`, {});
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe("SELF_APPROVAL_BLOCKED");
      expect((await api(tok.frank).post(`/api/leave/requests/${managers}/approve`, {})).status).toBe(404);
    });

    it("a delegate who loses leave.approve can't act — and the screens flag it", async () => {
      const r = await pending(p.carol);
      await prisma.userPermissionOverride.deleteMany({ where: { userId: p.frank.userId } });
      expect((await api(tok.frank).post(`/api/leave/requests/${r}/approve`, {})).status).toBe(403);
      expect((await api(tok.frank).get(`/api/leave/requests/${r}`)).status).toBe(404);
      const mine = await api(tok.mgrA).get("/api/delegations/mine");
      expect(mine.body.given.find((d: { status: string }) => d.status === "ACTIVE")).toMatchObject({ delegateCanApprove: false });
      const approve = await prisma.permission.findUniqueOrThrow({ where: { key: "leave.approve" } });
      await prisma.userPermissionOverride.create({ data: { userId: p.frank.userId, permissionId: approve.id, effect: "GRANT", reason: "test: senior who approves leave", createdByUserId: p.sa.userId } });
    });
  });

  describe("overlap and revoking", () => {
    it("rejects an overlapping delegation from the same delegator, to anyone; a later one is fine", async () => {
      await revokeAll();
      expect((await delegate("mgrA", p.mgrB, inDays(0), inDays(5))).status).toBe(201);
      const overlap = await delegate("mgrA", p.hrAdmin, inDays(5), inDays(8));
      expect(overlap.status).toBe(409);
      expect(overlap.body.error.code).toBe("OVERLAPPING_DELEGATION");
      expect((await delegate("mgrA", p.hrAdmin, inDays(6), inDays(8))).status).toBe(201);
      // Another delegator's range is independent.
      expect((await delegate("mgrB", p.mgrC, inDays(0), inDays(5))).status).toBe(201);
    });

    it("two simultaneous overlapping requests: exactly one wins", async () => {
      await revokeAll();
      const results = await Promise.all([delegate("mgrA", p.mgrB, inDays(10), inDays(12)), delegate("mgrA", p.hrAdmin, inDays(11), inDays(13))]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it("revoke: the delegator their own, HR anyone's (with a reason); never twice, never an ended one, never someone else's via /mine", async () => {
      await revokeAll();
      const d = (await delegate("mgrA", p.mgrB)).body;
      expect((await api(tok.mgrC).post(`/api/delegations/mine/${d.id}/revoke`, {})).status).toBe(404);
      const byHr = await api(tok.hrAdmin).post(`/api/delegations/${d.id}/revoke`, { reason: "manager returned early" });
      expect(byHr.status).toBe(200);
      expect(byHr.body).toMatchObject({ status: "REVOKED", revokeReason: "manager returned early" });
      expect((await api(tok.mgrA).post(`/api/delegations/mine/${d.id}/revoke`, {})).body.error.code).toBe("ALREADY_REVOKED");
      const ended = await prisma.workflowDelegate.create({
        data: { delegatorUserId: p.mgrA.userId, delegateUserId: p.mgrB.userId, startDate: addCalendarDays(today(), -9), endDate: addCalendarDays(today(), -7), createdByUserId: p.mgrA.userId },
      });
      expect((await api(tok.hrAdmin).post(`/api/delegations/${ended.id}/revoke`, {})).body.error.code).toBe("ALREADY_ENDED");
      const audit = await prisma.auditLog.findMany({ where: { entityType: "WorkflowDelegate", entityId: d.id }, orderBy: { createdAt: "asc" } });
      expect(audit.map((a) => [a.action, a.actorUserId])).toEqual([
        ["delegation.created", p.mgrA.userId],
        ["delegation.revoked", p.hrAdmin.userId],
      ]);
    });
  });

  describe("HR's view", () => {
    it("HR lists everyone's, filters by status, and sets one up for a manager (who is told)", async () => {
      await revokeAll();
      const created = await api(tok.hrAdmin).post("/api/delegations", { delegatorUserId: p.mgrC.userId, delegateUserId: p.mgrB.userId, startDate: inDays(0), endDate: inDays(2) });
      expect(created.status).toBe(201);
      expect(created.body.createdBy).toBeTruthy();
      const active = (await api(tok.hrAdmin).get("/api/delegations?status=ACTIVE")).body.delegations;
      expect(active.map((d: { id: string }) => d.id)).toContain(created.body.id);
      expect(active.every((d: { status: string }) => d.status === "ACTIVE")).toBe(true);
      expect(await prisma.notification.count({ where: { userId: p.mgrC.userId, type: "delegation.created", title: "Your approvals were delegated" } })).toBe(1);
      expect(await prisma.notification.count({ where: { userId: p.mgrB.userId, type: "delegation.created" } })).toBeGreaterThan(0);
      const managers = (await api(tok.hrAdmin).get("/api/delegations/managers")).body.options.map((o: { userId: string }) => o.userId);
      expect(managers).toEqual(expect.arrayContaining([p.mgrA.userId, p.mgrB.userId, p.mgrC.userId]));
      expect(managers).not.toContain(p.hrAdmin.userId);
      // HR can't set one up for a Super Admin either.
      expect((await api(tok.hrAdmin).post("/api/delegations", { delegatorUserId: p.sa.userId, delegateUserId: p.hrAdmin.userId, startDate: inDays(0), endDate: inDays(2) })).status).toBe(409);
    });

    it("the delegate's 'covering for' list shows it", async () => {
      const covering = (await api(tok.mgrB).get("/api/delegations/mine")).body.covering;
      expect(covering.map((d: { delegator: { userId: string } }) => d.delegator.userId)).toContain(p.mgrC.userId);
    });
  });

  describe("notifications and realtime", () => {
    it("a new request from the team reaches the delegate while the delegation is active", async () => {
      await revokeAll();
      expect((await delegate("mgrA", p.mgrB)).status).toBe(201);
      const res = await api(tok.alice).post("/api/leave/requests", { leaveTypeId: lop.id, fromDate: inDays(500), toDate: inDays(500) });
      expect(res.status).toBe(201);
      requestIds.push(res.body.id);
      const note = await prisma.notification.findFirst({ where: { userId: p.mgrB.userId, type: "leave.applied", payload: { path: ["leaveRequestId"], equals: res.body.id } } });
      expect(note?.title).toMatch(/covering for/);
    });

    it("creating and revoking tell the delegator, the delegate and delegation managers live", async () => {
      await revokeAll();
      const sent: { rooms: string[]; event: string }[] = [];
      const previous = getSocketServer();
      setSocketServer({ to: (room) => ({ emit: (event: string) => sent.push({ rooms: ([] as string[]).concat(room), event }) }) } as RoomEmitter);
      try {
        const d = (await delegate("mgrA", p.mgrB)).body;
        await api(tok.mgrA).post(`/api/delegations/mine/${d.id}/revoke`, {});
      } finally {
        setSocketServer(previous);
      }
      const changes = sent.filter((s) => s.event === "delegation.changed");
      expect(changes).toHaveLength(2);
      for (const c of changes) expect(c.rooms).toEqual(expect.arrayContaining([`user:${p.mgrA.employeeId}`, `user:${p.mgrB.employeeId}`, "perm:delegation.manage"]));
    });
  });
});
