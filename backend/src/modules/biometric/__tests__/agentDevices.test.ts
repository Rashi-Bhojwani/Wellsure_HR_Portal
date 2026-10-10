import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_HEALTH_THRESHOLDS, type AgentDeviceReport } from "@shared/attendance/agentProtocol";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { businessToday } from "../../../lib/businessDate";
import { DEVICE_HEALTH_SETTING_KEY } from "../../../lib/deviceHealthSettings";
import { prisma } from "../../../lib/prisma";
import { setSocketServer } from "../../../realtime/emit";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { listDevices } from "../adminService";
import { listDeviceWarnings } from "../deviceHealth";

// The server side of the sync agent (Phase 2 P2-F, docs/plans/PHASE_2.md
// "P2-F build design"): what the heartbeat replies, what it stores, the device
// fields the agent depends on, and the warnings HR sees (clock drift above
// all: "nobody would think to look").
type Person = { employeeId: string; employeeCode: string; userId: string };
const suffix = Date.now().toString(36).slice(-5);
const HOUR = 3_600_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function report(device: string, over: Partial<AgentDeviceReport> = {}): AgentDeviceReport {
  return {
    device,
    reachable: true,
    state: "OK",
    lastReadAt: new Date().toISOString(),
    secondsSinceLastRead: 5,
    lastError: null,
    reportedSerial: device,
    firmware: "Ver 6.60",
    platform: "ZMM220_TFT",
    logCount: 1200,
    logCapacity: 100000,
    clockOffsetSeconds: 3,
    outboxRecords: 0,
    oldestUnsentLocalTime: null,
    retention: { state: "OK", gapHours: 0, windowHours: 72, logFullPercent: 1.2, logNearlyFull: false, capacityUsed: 100000 },
    ...over,
  };
}

describe("sync agent: the server side (P2-F)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"hr" | "emp", Person>;
  let hrToken: string;
  let empToken: string;
  const deviceIds: string[] = [];
  const agentIds: string[] = [];
  let agentKey = "";
  let otherKey = "";
  const dev = {} as Record<"a" | "b" | "inactive" | "other", { id: string; serialNumber: string }>;
  let savedThresholds: unknown;
  const emitted: Array<{ room: string | string[]; event: string; payload: unknown }> = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    hrToken = await loginAs(p.hr.employeeCode);
    empToken = await loginAs(p.emp.employeeCode);
    savedThresholds = (await prisma.systemSetting.findUnique({ where: { key: DEVICE_HEALTH_SETTING_KEY } }))?.value ?? null;

    const agent = await hr().post("/api/biometric/agents").send({ name: `F1 agent ${suffix}` });
    const other = await hr().post("/api/biometric/agents").send({ name: `F1 other agent ${suffix}` });
    agentIds.push(agent.body.agent.id, other.body.agent.id);
    agentKey = agent.body.key;
    otherKey = other.body.key;
    const mk = async (serial: string, agentId: string, extra: Record<string, unknown> = {}) => {
      const r = await hr().post("/api/biometric/devices").send({ serialNumber: serial, name: `Device ${serial}`, locationId: org.locationId, route: "AGENT", agentId, ...extra });
      expect(r.status).toBe(201);
      deviceIds.push(r.body.id);
      return r.body as { id: string; serialNumber: string };
    };
    dev.a = await mk(`F1A-${suffix}`, agent.body.agent.id, { isSimulated: true });
    dev.b = await mk(`F1B-${suffix}`, agent.body.agent.id, { syncFrom: "2026-09-01", retentionDays: 10, retentionRecords: 50000 });
    dev.inactive = await mk(`F1I-${suffix}`, agent.body.agent.id);
    await hr().patch(`/api/biometric/devices/${dev.inactive.id}`).send({ isActive: false });
    dev.other = await mk(`F1O-${suffix}`, other.body.agent.id);
  });

  afterAll(async () => {
    setSocketServer(null);
    if (savedThresholds === null) await prisma.systemSetting.deleteMany({ where: { key: DEVICE_HEALTH_SETTING_KEY } });
    else await prisma.systemSetting.update({ where: { key: DEVICE_HEALTH_SETTING_KEY }, data: { value: savedThresholds as never } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", deviceIds);
    await deleteWithDependents("BiometricAgent", agentIds);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...deviceIds, ...agentIds, "deviceHealth"] } });
    await cleanupEmployeeTestOrgMasters(org);
  });

  function hr() {
    return {
      get: (path: string) => request(app).get(path).set(...authHeader(hrToken)),
      post: (path: string) => request(app).post(path).set(...authHeader(hrToken)),
      patch: (path: string) => request(app).patch(path).set(...authHeader(hrToken)),
      put: (path: string) => request(app).put(path).set(...authHeader(hrToken)),
    };
  }
  const beat = (body: object, key = agentKey) => request(app).post("/api/biometric/agent/heartbeat").set("Authorization", `Bearer ${key}`).send(body);
  const body = (devices: AgentDeviceReport[]) => ({ version: "1.0.0", host: "OFFICE-PC", startedAt: new Date().toISOString(), outboxRecords: 0, lastPostAt: null, lastPostError: null, pcClockOffsetSeconds: 0, devices });

  describe("device fields the agent depends on", () => {
    it("a new device syncs from today (IST) by default; the retention values are pessimistic until the model is known", async () => {
      const a = await prisma.device.findUniqueOrThrow({ where: { id: dev.a.id } });
      expect(iso(a.syncFrom)).toBe(iso(businessToday()));
      expect(a).toMatchObject({ retentionDays: 3, retentionRecords: 20000 });
      const b = await prisma.device.findUniqueOrThrow({ where: { id: dev.b.id } });
      expect(iso(b.syncFrom)).toBe("2026-09-01");
      expect(b).toMatchObject({ retentionDays: 10, retentionRecords: 50000 });
    });

    it("refuses a sync-from date in the future and out-of-range retention", async () => {
      const tomorrow = iso(new Date(businessToday().getTime() + 86_400_000));
      const future = await hr().patch(`/api/biometric/devices/${dev.b.id}`).send({ syncFrom: tomorrow });
      expect(future.status).toBe(400);
      expect(future.body.error.message).toMatch(/future/);
      expect((await hr().patch(`/api/biometric/devices/${dev.b.id}`).send({ retentionDays: 0 })).status).toBe(400);
      expect((await hr().patch(`/api/biometric/devices/${dev.b.id}`).send({ retentionRecords: 10 })).status).toBe(400);
    });

    it("changing sync-from is audited with before and after, and the agent's report never fills the audit row", async () => {
      await prisma.device.update({ where: { id: dev.b.id }, data: { agentReport: { state: "OK", noise: "x".repeat(50) }, agentReportAt: new Date() } });
      const res = await hr().patch(`/api/biometric/devices/${dev.b.id}`).send({ syncFrom: "2026-08-15" });
      expect(res.status).toBe(200);
      expect(res.body.syncFrom).toBe("2026-08-15");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: dev.b.id, action: "biometric.device.updated", actorUserId: p.hr.userId }, orderBy: { createdAt: "desc" } });
      expect(audit.before).toMatchObject({ syncFrom: "2026-09-01" });
      expect(audit.after).toMatchObject({ syncFrom: "2026-08-15" });
      expect(JSON.stringify(audit.before)).not.toContain("agentReport");
      expect(JSON.stringify(audit.after)).not.toContain("noise");
      await prisma.device.update({ where: { id: dev.b.id }, data: { agentReport: undefined, agentReportAt: null } });
    });
  });

  describe("the heartbeat", () => {
    it("replies with each active device assigned to this agent — serial, timezone, sync-from, retention, simulated — and the thresholds", async () => {
      const res = await beat(body([]));
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(Math.abs(new Date(res.body.serverTime).getTime() - Date.now())).toBeLessThan(10_000);
      const serials = res.body.devices.map((d: { serial: string }) => d.serial);
      expect(serials).toEqual(expect.arrayContaining([dev.a.serialNumber, dev.b.serialNumber]));
      expect(serials).not.toContain(dev.inactive.serialNumber); // inactive: not polled
      expect(serials).not.toContain(dev.other.serialNumber); // another agent's
      const b = res.body.devices.find((d: { serial: string }) => d.serial === dev.b.serialNumber);
      expect(b).toEqual({ serial: dev.b.serialNumber, name: `Device ${dev.b.serialNumber}`, timezone: "Asia/Kolkata", syncFrom: "2026-08-15", retentionDays: 10, retentionRecords: 50000, isSimulated: false });
      expect(res.body.devices.find((d: { serial: string }) => d.serial === dev.a.serialNumber).isSimulated).toBe(true);
      expect(res.body.thresholds).toEqual(DEFAULT_DEVICE_HEALTH_THRESHOLDS);
    });

    it("stores each assigned device's report, placing the last read on the SERVER's clock whatever the PC's clock says", async () => {
      const wrongPcClock = new Date(Date.now() - 6 * HOUR).toISOString(); // the PC is 6 h behind
      const before = Date.now();
      const res = await beat(body([report(dev.a.serialNumber, { lastReadAt: wrongPcClock, secondsSinceLastRead: 60 })]));
      expect(res.status).toBe(200);
      const a = await prisma.device.findUniqueOrThrow({ where: { id: dev.a.id } });
      const stored = a.agentReport as Record<string, unknown>;
      expect(stored).toMatchObject({ state: "OK", firmware: "Ver 6.60", logCount: 1200, lastReadAt: wrongPcClock });
      const serverRead = new Date(stored.serverLastReadAt as string).getTime();
      expect(serverRead).toBeGreaterThanOrEqual(before - 61_000);
      expect(serverRead).toBeLessThanOrEqual(Date.now() - 59_000);
      expect(a.agentReportAt).not.toBeNull();
      expect(a.lastHeartbeatAt).not.toBeNull();
    });

    it("ignores a report on a device that isn't this agent's, and accepts an older agent's minimal report", async () => {
      expect((await beat(body([report(dev.other.serialNumber)]))).status).toBe(200);
      expect((await prisma.device.findUniqueOrThrow({ where: { id: dev.other.id } })).agentReport).toBeNull();
      const minimal = await beat({ version: "0.9.0", host: "OLD-PC", devices: [{ device: dev.b.serialNumber, reachable: false }] });
      expect(minimal.status).toBe(200);
      expect((await prisma.device.findUniqueOrThrow({ where: { id: dev.b.id } })).agentReport).toMatchObject({ reachable: false });
    });

    it("emits device.status to holders of attendance.devices.manage", async () => {
      emitted.length = 0;
      setSocketServer({ to: (room) => ({ emit: (event: string, payload: unknown) => void emitted.push({ room, event, payload }) }) });
      await beat(body([]));
      setSocketServer(null);
      expect(emitted).toContainEqual({ room: "perm:attendance.devices.manage", event: "device.status", payload: { agentId: agentIds[0] } });
    });
  });

  describe("what HR sees: the Devices screen and the warnings", () => {
    it("a device assigned to an agent whose report leaves it out is 'not configured on the agent PC'", async () => {
      await beat(body([report(dev.a.serialNumber)])); // b omitted this time
      const { devices } = await listDevices();
      expect(devices.find((d) => d.id === dev.b.id)!.health.notConfiguredOnAgent).toBe(true);
      expect(devices.find((d) => d.id === dev.a.id)!.health.notConfiguredOnAgent).toBe(false);
    });

    it("clock drift beyond the threshold is a warning HR sees, in words, on the Devices screen and the warnings list", async () => {
      await beat(body([report(dev.a.serialNumber, { clockOffsetSeconds: 200 })]));
      const { devices } = await listDevices();
      const a = devices.find((d) => d.id === dev.a.id)!;
      expect(a.health.clockDrift).toEqual({ offsetSeconds: 200, text: "3 min 20 s ahead", exceeded: true });
      expect(a.warnings.map((w) => w.kind)).toEqual(["CLOCK_DRIFT"]);
      const res = await hr().get("/api/biometric/device-warnings");
      expect(res.status).toBe(200);
      const w = res.body.warnings.find((x: { deviceId: string }) => x.deviceId === dev.a.id);
      expect(w.kind).toBe("CLOCK_DRIFT");
      expect(w.message).toMatch(/3 min 20 s ahead.*device's own menu/);
      // Within the threshold: no warning.
      await beat(body([report(dev.a.serialNumber, { clockOffsetSeconds: -90 })]));
      expect((await listDevices()).devices.find((d) => d.id === dev.a.id)!.warnings).toEqual([]);
    });

    it("retention climbs to WARNING then RISK on its own when the agent stops reporting (worked out when read, not when reported)", async () => {
      await beat(body([report(dev.a.serialNumber, { secondsSinceLastRead: 0 })])); // read just now; 3-day window
      const at = (hours: number) => new Date(Date.now() + hours * HOUR);
      const state = async (hours: number) => (await listDevices(at(hours))).devices.find((d) => d.id === dev.a.id)!.health.retention!.state;
      expect(await state(30)).toBe("OK"); // 42% of 72 h
      expect(await state(40)).toBe("WARNING"); // 56%
      expect(await state(56)).toBe("RISK"); // 78%
      const later = await listDeviceWarnings(at(56));
      expect(later.warnings.find((w) => w.deviceId === dev.a.id)).toMatchObject({ kind: "RETENTION_RISK" });
    });

    it("a nearly full log is its own warning (90% by default)", async () => {
      await beat(body([report(dev.a.serialNumber, { logCount: 95_000, logCapacity: 100_000 })]));
      const a = (await listDevices()).devices.find((d) => d.id === dev.a.id)!;
      expect(a.health.retention).toMatchObject({ logFullPercent: 95, logNearlyFull: true, capacityUsed: 100_000 });
      expect(a.warnings.map((w) => w.kind)).toEqual(["LOG_NEARLY_FULL"]);
    });

    it("the warnings need attendance.devices.manage", async () => {
      expect((await request(app).get("/api/biometric/device-warnings").set(...authHeader(empToken))).status).toBe(403);
    });
  });

  describe("System Settings → Attendance → Device health", () => {
    it("reads and changes the thresholds (audited), refuses a warning at or above the alarm, and the agent gets the new values", async () => {
      expect((await hr().get("/api/settings/device-health")).body).toEqual(DEFAULT_DEVICE_HEALTH_THRESHOLDS);
      const bad = await hr().put("/api/settings/device-health").send({ retentionWarningPercent: 80 });
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toMatch(/before the alarm/);
      const ok = await hr().put("/api/settings/device-health").send({ clockDriftWarningSeconds: 60, logNearlyFullPercent: 95 });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ ...DEFAULT_DEVICE_HEALTH_THRESHOLDS, clockDriftWarningSeconds: 60, logNearlyFullPercent: 95 });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: "deviceHealth", actorUserId: p.hr.userId }, orderBy: { createdAt: "desc" } });
      expect(audit.before).toMatchObject({ clockDriftWarningSeconds: 120 });
      expect(audit.after).toMatchObject({ clockDriftWarningSeconds: 60 });
      expect((await beat(body([]))).body.thresholds.clockDriftWarningSeconds).toBe(60);
      // The new threshold applies to the stored report at once: 90 s is now drift.
      await beat(body([report(dev.a.serialNumber, { clockOffsetSeconds: -90 })]));
      expect((await listDevices()).devices.find((d) => d.id === dev.a.id)!.health.clockDrift).toMatchObject({ text: "1 min 30 s behind", exceeded: true });
    });

    it("needs settings.manage", async () => {
      expect((await request(app).get("/api/settings/device-health").set(...authHeader(empToken))).status).toBe(403);
      expect((await request(app).put("/api/settings/device-health").set(...authHeader(empToken)).send({ clockDriftWarningSeconds: 30 })).status).toBe(403);
    });
  });

  it("another agent's key can't report on this agent's devices", async () => {
    await beat(body([report(dev.a.serialNumber, { firmware: "SPOOFED" })]), otherKey);
    expect(((await prisma.device.findUniqueOrThrow({ where: { id: dev.a.id } })).agentReport as { firmware: string }).firmware).not.toBe("SPOOFED");
  });
});
