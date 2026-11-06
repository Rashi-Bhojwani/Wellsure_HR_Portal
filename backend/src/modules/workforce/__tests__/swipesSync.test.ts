import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { computeAttendance } from "../../attendance/compute";
import { heartbeat } from "../../biometric/agentService";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A-10 G5 (docs/plans/GREYTHR_PARITY_WORKFORCE.md items 13, 14): rejecting and reinstating swipes (the engine ignores a rejected one), the shift column,
// and device sync requests through the agent heartbeat. Fake clock: "today" is Wed 30 Sep 2026.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const DAY = "2026-09-28";
const tag = Date.now().toString(36).slice(-5);

describe("A-10 G5 — swipes and sync requests", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let deviceId = "";
  let agentId = "";
  const punchIds: string[] = [];
  const call = (who: string, method: "get" | "post", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);
  const dayRow = () => prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: p.emp!.employeeId, date: d(DAY) } } });

  beforeAll(async () => {
    setBusinessTodayForTests(d("2026-09-30"));
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    agentId = (await prisma.biometricAgent.create({ data: { name: `G5 agent ${tag}`, keyHash: `g5-${tag}-${Math.random()}`, keyPrefix: "g5g5", createdByUserId: p.hr.userId } })).id;
    deviceId = (await prisma.device.create({ data: { serialNumber: `G5-${tag}`, name: "A-10 G5 device", locationId: org.locationId, route: "AGENT", agentId } })).id;
    const batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    for (const time of ["10:00", "19:00"]) {
      const row = await prisma.rawPunch.create({ data: { deviceId, deviceUserId: p.emp.employeeCode, punchedAt: localTimeToInstant(`${DAY} ${time}:00`, "Asia/Kolkata"), localTime: `${DAY} ${time}:00`, businessDate: d(DAY), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: p.emp.employeeId } });
      punchIds.push(row.id);
    }
    await computeAttendance([p.emp.employeeId], DAY, DAY);
  }, 180_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", [deviceId]);
    await deleteWithDependents("BiometricAgent", [agentId]);
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("the Developer role and an employee are refused; a reason is required", async () => {
    for (const who of ["dev", "emp"]) {
      expect((await call(who, "post", "/api/workforce/swipes/decide", { punchIds, action: "REJECT", reason: "bad punch" })).status, who).toBe(403);
      expect((await call(who, "get", "/api/workforce/sync-requests")).status, who).toBe(403);
    }
    expect((await call("hr", "post", "/api/workforce/swipes/decide", { punchIds, action: "REJECT", reason: "" })).status).toBe(400);
    const own = await prisma.rawPunch.create({ data: { deviceId, deviceUserId: p.hr!.employeeCode, punchedAt: localTimeToInstant(`${DAY} 11:00:00`, "Asia/Kolkata"), localTime: `${DAY} 11:00:00`, businessDate: d(DAY), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId: (await prisma.ingestionBatch.findFirstOrThrow({ where: { deviceId } })).id, employeeId: p.hr!.employeeId } });
    expect((await call("hr", "post", "/api/workforce/swipes/decide", { punchIds: [own.id], action: "REJECT", reason: "my own" })).body.error.code).toBe("OWN_ATTENDANCE");
  });

  it("a rejected swipe is not used by the engine; reinstating brings it back; the list shows the shift and the decision; history is append-only", async () => {
    expect((await dayRow())?.status).toBe("P");
    const out = await call("hr", "post", "/api/workforce/swipes/decide", { punchIds: [punchIds[1]], action: "REJECT", reason: "a colleague punched for them" });
    expect(out.status).toBe(200);
    expect((await call("hr", "post", "/api/workforce/swipes/decide", { punchIds: [punchIds[1]], action: "REJECT", reason: "again" })).status).toBe(409);
    await computeAttendance([p.emp!.employeeId], DAY, DAY);
    expect((await dayRow())?.status).not.toBe("P"); // one punch left: no full day
    const list = await call("hr", "get", `/api/attendance/swipes?from=${DAY}&to=${DAY}&employeeId=${p.emp!.employeeId}`);
    const rows = list.body.entries;
    const rejectedRow = rows.find((r: { id: string }) => r.id === punchIds[1]);
    expect(rejectedRow).toMatchObject({ rejected: true, rejectReason: "a colleague punched for them", shift: "GEN" });
    await call("hr", "post", "/api/workforce/swipes/decide", { punchIds: [punchIds[1]], action: "REINSTATE", reason: "checked, it was them" });
    await computeAttendance([p.emp!.employeeId], DAY, DAY);
    expect((await dayRow())?.status).toBe("P");
    await expect(prisma.swipeDecision.updateMany({ where: { punchId: punchIds[1] }, data: { reason: "rewritten" } })).rejects.toThrow(/SWIPE_DECISION_APPEND_ONLY/);
    expect(await prisma.auditLog.count({ where: { entityType: "RawPunch", entityId: punchIds[1] } })).toBe(2);
  });

  it("a sync request reaches the agent on its heartbeat, is marked done when the agent says so, and can be cancelled only while pending", async () => {
    const made = await call("hr", "post", "/api/workforce/sync-requests", { deviceId, fromDate: "2026-09-27", toDate: "2026-09-28", reason: "device was offline" });
    expect(made.status).toBe(201);
    expect((await call("hr", "post", "/api/workforce/sync-requests", { deviceId, fromDate: "2026-09-27", toDate: "2026-10-28", reason: "too far" })).status).toBe(400);
    const agent = await prisma.biometricAgent.findUniqueOrThrow({ where: { id: agentId } });
    const first = await heartbeat(agent, { version: "t", host: "t", devices: [] });
    expect(first.devices.find((x) => x.serial === `G5-${tag}`)?.resync).toEqual({ requestId: made.body.id, from: "2026-09-27", to: "2026-09-28" });
    await heartbeat(agent, { version: "t", host: "t", devices: [{ device: `G5-${tag}`, reachable: true, resyncDone: made.body.id }] });
    const after = await heartbeat(agent, { version: "t", host: "t", devices: [] });
    expect(after.devices.find((x) => x.serial === `G5-${tag}`)?.resync).toBeNull();
    expect((await call("hr", "post", `/api/workforce/sync-requests/${made.body.id}/cancel`)).status).toBe(409);
    const second = await call("hr", "post", "/api/workforce/sync-requests", { deviceId, fromDate: "2026-09-25", toDate: "2026-09-25", reason: "check" });
    expect((await call("hr", "post", `/api/workforce/sync-requests/${second.body.id}/cancel`)).body.status).toBe("CANCELLED");
    const list = await call("hr", "get", "/api/workforce/sync-requests");
    expect(list.body.requests.filter((r: { device: string }) => r.device === "A-10 G5 device").map((r: { status: string }) => r.status).sort()).toEqual(["CANCELLED", "DONE"]);
    await expect(prisma.deviceSyncRequest.delete({ where: { id: made.body.id } })).rejects.toThrow(/DEVICE_SYNC_APPEND_ONLY/);
  });
});
