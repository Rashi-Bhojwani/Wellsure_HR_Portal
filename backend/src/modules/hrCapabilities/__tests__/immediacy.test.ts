import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeHrCapabilityQueue } from "../../../jobs/hrCapabilityQueue";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { signAccessToken } from "../../../lib/jwt";
import { prisma } from "../../../lib/prisma";
import { emitPunchesReceived, emitRegularizationSubmitted, getSocketServer, setSocketServer } from "../../../realtime/emit";
import { createSocketServer } from "../../../realtime/socket";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, grantPermissions, loginAs, revokePermissions, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { getRegularizationRequestSink, setRegularizationRequestSink } from "../../admin/regularizationIntegration";
import { EngineRegularizationSink } from "../../attendance/regularization/sink";
import { setSwitch } from "../service";

// Stage 1.3: switching a duty off (or on) is in force on the very next request and in every place that shows or acts on it. One test per place, both directions, for the HR role, a named HR person,
// an employee, a manager and a director. (The routes themselves are proven in hrCapabilities.test.ts; here are the counts, the inbox, the profile of what a browser is told, and the live rooms.)

describe("a switch is felt everywhere at once", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"director" | "hrAdmin" | "hrExec" | "hrNamed" | "manager" | "employee" | "requester", { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<keyof typeof p, string>;
  const requestIds: string[] = [];
  const originalSink = getRegularizationRequestSink();
  let leaveId = "";
  const get = (who: keyof typeof p, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const meta = () => ({ actorUserId: p.director.userId, ipAddress: null, userAgent: null });
  const roleSwitch = (capability: string, roleCode: "HR_ADMIN" | "HR_EXECUTIVE", state: "ON" | "OFF" | "DEFAULT") => setSwitch({ capability, subject: { kind: "ROLE", roleCode }, state, reason: "test" } as never, meta());
  const personSwitch = (capability: string, who: keyof typeof p, state: "ON" | "OFF" | "DEFAULT") => setSwitch({ capability, subject: { kind: "USER", employeeId: p[who].employeeId }, state, reason: "test" } as never, meta());

  beforeAll(async () => {
    setRegularizationRequestSink(new EngineRegularizationSink()); // the app wires it at startup; the tests do it themselves
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.hrNamed = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.requester = await createFullTestEmployee(org, { managerId: p.manager.employeeId });
    p.employee = await createFullTestEmployee(org);
    await grantPermissions("MANAGER", []);
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
    const lop = await prisma.leaveType.findFirstOrThrow({ where: { code: "LOP" } });
    leaveId = (await prisma.leaveRequest.create({ data: { employeeId: p.requester.employeeId, leaveTypeId: lop.id, fromDate: new Date("2026-11-03T00:00:00Z"), toDate: new Date("2026-11-03T00:00:00Z"), totalDays: 1, status: "PENDING", appliedByUserId: p.requester.userId } })).id;
    const reg = await prisma.regularizationRequest.create({ data: { employeeId: p.requester.employeeId, date: new Date("2026-10-27T00:00:00Z"), reasonCode: "FORGOT_TO_PUNCH", inTime: "09:30", outTime: "18:00", reason: "forgot", status: "PENDING", raisedByUserId: p.requester.userId } });
    requestIds.push(reg.id);
  });
  afterEach(async () => {
    await purgeAppendOnly("HrCapabilitySwitch", { createdByUserId: p.director.userId });
  });
  afterAll(async () => {
    setRegularizationRequestSink(originalSink);
    await prisma.regularizationRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.leaveRequest.deleteMany({ where: { id: leaveId } });
    await closeHrCapabilityQueue();
    for (const k of Object.keys(p) as Array<keyof typeof p>) await cleanupFullTestEmployee(p[k].employeeId);
    await revokePermissions("MANAGER", []);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const reviewLeave = async (who: keyof typeof p) => {
    const body = (await get(who, "/api/admin/tasks/counts")).body;
    return body.review?.byType?.find((t: { type: string }) => t.type === "LEAVE")?.count ?? 0;
  };
  const reviewRegularizations = async (who: keyof typeof p) => {
    const body = (await get(who, "/api/admin/tasks/counts")).body;
    return body.review?.byType?.find((t: { type: string }) => t.type === "REGULARIZATION")?.count ?? 0;
  };
  const inbox = async (who: keyof typeof p) => JSON.stringify((await get(who, "/api/tasks/mine")).body);

  it("Approve leave: the counts, the inbox and what the browser is told change on the very next request; nobody else's do", async () => {
    expect(await reviewLeave("hrAdmin")).toBeGreaterThanOrEqual(1);
    expect(await inbox("hrAdmin")).toContain("LEAVE_APPROVAL");
    expect((await get("hrAdmin", "/api/auth/me")).body.permissions).toContain("leave.approve");
    await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "OFF");
    expect(await reviewLeave("hrAdmin")).toBe(0);
    expect(await inbox("hrAdmin")).not.toContain("LEAVE_APPROVAL");
    expect((await get("hrAdmin", "/api/auth/me")).body.permissions).not.toContain("leave.approve");
    expect(await reviewLeave("hrExec")).toBeGreaterThanOrEqual(1); // the other HR role
    expect(await reviewLeave("director")).toBeGreaterThanOrEqual(1); // a director still sees it: it is waiting for them
    expect(await reviewLeave("employee")).toBe(0);
    await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "DEFAULT");
    expect(await reviewLeave("hrAdmin")).toBeGreaterThanOrEqual(1);
    expect(await inbox("hrAdmin")).toContain("LEAVE_APPROVAL");
  });

  it("Approve leave for one named person: only that person, in both directions", async () => {
    await personSwitch("APPROVE_LEAVE", "hrNamed", "OFF");
    expect(await reviewLeave("hrNamed")).toBe(0);
    expect(await reviewLeave("hrExec")).toBeGreaterThanOrEqual(1);
    await personSwitch("APPROVE_LEAVE", "hrNamed", "DEFAULT");
    expect(await reviewLeave("hrNamed")).toBeGreaterThanOrEqual(1);
  });

  it("Approve regularizations: the review count and the queue follow, for the role and for a named person", async () => {
    expect(await reviewRegularizations("hrAdmin")).toBeGreaterThanOrEqual(1);
    expect((await get("hrAdmin", "/api/attendance/regularizations")).status).toBe(200);
    await roleSwitch("APPROVE_REGULARIZATIONS", "HR_ADMIN", "OFF");
    expect(await reviewRegularizations("hrAdmin")).toBe(0);
    expect((await get("hrAdmin", "/api/attendance/regularizations")).status).toBe(403);
    expect(await reviewRegularizations("hrExec")).toBeGreaterThanOrEqual(1);
    await personSwitch("APPROVE_REGULARIZATIONS", "hrExec", "OFF");
    expect(await reviewRegularizations("hrExec")).toBe(0);
    expect(await reviewRegularizations("hrNamed")).toBeGreaterThanOrEqual(1);
    await roleSwitch("APPROVE_REGULARIZATIONS", "HR_ADMIN", "DEFAULT");
    await personSwitch("APPROVE_REGULARIZATIONS", "hrExec", "DEFAULT");
    expect(await reviewRegularizations("hrAdmin")).toBeGreaterThanOrEqual(1);
    expect(await reviewRegularizations("hrExec")).toBeGreaterThanOrEqual(1);
  });

  it("work HR can no longer decide waits for the directors, with a note saying why; it is never decided, lost or recreated, and returns to HR when the switch is back on", async () => {
    const before = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } });
    const heldBy = async (who: keyof typeof p) => (await get(who, "/api/admin/tasks/counts")).body.heldFromHr;
    expect(await heldBy("director")).toBeNull(); // HR can decide: no note
    await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "OFF");
    expect(await heldBy("director")).toBeNull(); // the other HR role still can
    await roleSwitch("APPROVE_LEAVE", "HR_EXECUTIVE", "OFF");
    const note = await heldBy("director");
    expect(note.leave).toBeGreaterThanOrEqual(1);
    expect(await reviewLeave("director")).toBeGreaterThanOrEqual(1); // it is in their queue
    for (const who of ["hrAdmin", "hrExec", "hrNamed", "employee", "manager"] as const) expect(await heldBy(who), who).toBeNull(); // only a director is told
    await personSwitch("APPROVE_LEAVE", "hrNamed", "ON"); // one named person is still allowed: so HR can decide again, and the note goes
    expect(await heldBy("director")).toBeNull();
    await personSwitch("APPROVE_LEAVE", "hrNamed", "DEFAULT");
    expect((await heldBy("director")).leave).toBeGreaterThanOrEqual(1);
    const mid = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } });
    expect([mid.status, mid.decidedByUserId ?? null]).toEqual(["PENDING", null]); // not approved, not rejected, not touched
    await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "DEFAULT");
    await roleSwitch("APPROVE_LEAVE", "HR_EXECUTIVE", "DEFAULT");
    expect(await heldBy("director")).toBeNull();
    expect(await inbox("hrAdmin")).toContain(leaveId); // the very same request, back in HR's inbox
    const after = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } });
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
  });

  it("the same note for attendance regularizations", async () => {
    await roleSwitch("APPROVE_REGULARIZATIONS", "HR_ADMIN", "OFF");
    await roleSwitch("APPROVE_REGULARIZATIONS", "HR_EXECUTIVE", "OFF");
    expect((await get("director", "/api/admin/tasks/counts")).body.heldFromHr.regularizations).toBeGreaterThanOrEqual(1);
    expect((await get("hrAdmin", "/api/admin/tasks/counts")).body.heldFromHr).toBeNull();
    expect((await prisma.regularizationRequest.findUniqueOrThrow({ where: { id: requestIds[0]! } })).status).toBe("PENDING");
    await roleSwitch("APPROVE_REGULARIZATIONS", "HR_ADMIN", "DEFAULT");
    await roleSwitch("APPROVE_REGULARIZATIONS", "HR_EXECUTIVE", "DEFAULT");
    expect((await get("director", "/api/admin/tasks/counts")).body.heldFromHr).toBeNull();
  });

  it("a switch for HR never touches a manager's own grants or an employee", async () => {
    await roleSwitch("APPROVE_LEAVE", "HR_ADMIN", "OFF");
    await roleSwitch("APPROVE_LEAVE", "HR_EXECUTIVE", "OFF");
    expect(await reviewLeave("manager")).toBe(0); // a manager holds nothing by default: unchanged by the switch
    expect((await get("employee", "/api/attendance/who-is-in")).status).toBe(403);
    expect((await get("employee", "/api/hr-capabilities")).status).toBe(403);
  });

  describe("the live rooms", () => {
    let httpServer: ReturnType<typeof createServer>;
    let previous: ReturnType<typeof getSocketServer>;
    let client: Socket;
    let ioServer: Awaited<ReturnType<typeof createSocketServer>>;
    const next = (event: string, ms = 4000) =>
      new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms);
        client.once(event, (payload: unknown) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
    const silence = (event: string, ms = 700) =>
      new Promise<boolean>((resolve) => {
        const handler = () => resolve(false);
        client.once(event, handler);
        setTimeout(() => {
          client.off(event, handler);
          resolve(true);
        }, ms);
      });
    const punch = () => emitPunchesReceived([{ employeeId: p.employee.employeeId, punchedAt: new Date().toISOString(), deviceId: "d", locationId: org.locationId }]); // allow-clock: an instant

    beforeAll(async () => {
      previous = getSocketServer();
      httpServer = createServer();
      ioServer = await createSocketServer(httpServer);
      setSocketServer(ioServer);
      await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      const { port } = httpServer.address() as AddressInfo;
      client = connect(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token: signAccessToken(p.hrAdmin.userId) } });
      await new Promise<void>((resolve, reject) => {
        client.on("connect", () => resolve());
        client.on("connect_error", reject);
      });
    });
    afterAll(async () => {
      client.disconnect();
      await new Promise<void>((resolve) => void ioServer.close(() => resolve()));
      setSocketServer(previous);
    });

    it("an HR person's open screen stops hearing punches the moment View attendance goes off, and hears them again when it is back", async () => {
      const heard = next("punch.received.batch");
      punch();
      await heard; // on today
      const told = next("permissions.changed");
      await roleSwitch("VIEW_ATTENDANCE", "HR_ADMIN", "OFF");
      await told; // the browser is told to refetch its menu
      const quiet = silence("punch.received.batch");
      punch();
      expect(await quiet).toBe(true); // off: no punch reaches them
      const again = next("permissions.changed");
      await roleSwitch("VIEW_ATTENDANCE", "HR_ADMIN", "DEFAULT");
      await again;
      const back = next("punch.received.batch");
      punch();
      await back;
    });

    it("the same for regularizations on their own room", async () => {
      await roleSwitch("APPROVE_REGULARIZATIONS", "HR_ADMIN", "OFF");
      await new Promise((r) => setTimeout(r, 300));
      const quiet = silence("regularization.submitted");
      emitRegularizationSubmitted({ id: "r1", employeeId: p.employee.employeeId }, null);
      expect(await quiet).toBe(true);
      await roleSwitch("APPROVE_REGULARIZATIONS", "HR_ADMIN", "DEFAULT");
      await new Promise((r) => setTimeout(r, 300));
      const heard = next("regularization.submitted");
      emitRegularizationSubmitted({ id: "r2", employeeId: p.employee.employeeId }, null);
      expect(await heard).toMatchObject({ id: "r2" });
    });
  });
});
