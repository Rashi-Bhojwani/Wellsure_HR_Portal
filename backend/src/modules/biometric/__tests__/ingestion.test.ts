import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { formatAttlogLine, instantToLocalTime } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { employeeForDeviceUserOn, employeesForDeviceUsersOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { setRecomputeHandler, type DayRef } from "../../attendance/recompute";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// Biometric ingestion (Phase 2 commit P2-B, docs/plans/PHASE_2.md §2.2, §3):
// three routes, one service, one dedupe; raw punches immutable as received.
type Person = { employeeId: string; employeeCode: string; userId: string };
const HOUR = 3_600_000;
const ist = (msAgo: number) => instantToLocalTime(new Date(Date.now() - msAgo), "Asia/Kolkata");
const line = (deviceUserId: string, localTime: string) => formatAttlogLine({ deviceUserId, localTime });
const suffix = Date.now().toString(36).slice(-5);

describe("biometric ingestion (P2-B)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"hr" | "hrExec" | "alice" | "bob", Person>;
  let hrToken: string;
  let execToken: string;
  const deviceIds: string[] = [];
  const agentIds: string[] = [];
  let agentKey = "";
  let agentDevice: { id: string; serialNumber: string };
  let pushDevice: { id: string; serialNumber: string };
  const recomputed: DayRef[] = [];
  const UNMAPPED = `U${suffix}`; // a device user ID nobody has yet
  // One fixed timestamp reused by later tests as "already stored" — never
  // recomputed from the clock, which moves on between tests (CI is slower).
  const storedEarlier = ist(5 * HOUR);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.alice = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" }); // mapped: device user ID = her code, from 2024-01-01
    p.bob = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.bob.employeeId } }); // bob: manual capture, no mapping yet
    hrToken = await loginAs(p.hr.employeeCode);
    execToken = await loginAs(p.hrExec.employeeCode);
    setRecomputeHandler(async (days) => void recomputed.push(...days));

    const agent = await hr().post("/api/biometric/agents").send({ name: `Test agent ${suffix}` });
    agentIds.push(agent.body.agent.id);
    agentKey = agent.body.key;
    const d1 = await hr().post("/api/biometric/devices").send({ serialNumber: `AG-${suffix}`, name: "Test agent device", locationId: org.locationId, route: "AGENT", agentId: agent.body.agent.id });
    const d2 = await hr().post("/api/biometric/devices").send({ serialNumber: `PU-${suffix}`, name: "Test push device", locationId: org.locationId, route: "PUSH" });
    agentDevice = d1.body;
    pushDevice = d2.body;
    deviceIds.push(d1.body.id, d2.body.id);
  });

  afterEach(() => {
    recomputed.length = 0;
  });

  afterAll(async () => {
    setRecomputeHandler(null);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", deviceIds);
    await deleteWithDependents("BiometricAgent", agentIds);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...deviceIds, ...agentIds] } });
    await cleanupEmployeeTestOrgMasters(org);
  });

  function hr() {
    return {
      get: (path: string) => request(app).get(path).set(...authHeader(hrToken)),
      post: (path: string) => request(app).post(path).set(...authHeader(hrToken)),
      patch: (path: string) => request(app).patch(path).set(...authHeader(hrToken)),
    };
  }
  const agentPost = (lines: string[], device = agentDevice.serialNumber, key = agentKey) =>
    request(app).post("/api/biometric/agent/punches").set("Authorization", `Bearer ${key}`).send({ device, lines });

  describe("the agent route", () => {
    it("stores a batch: mapped punches get their employee, unmapped ones wait, a near-duplicate is kept raw", async () => {
      const t1 = ist(3 * HOUR);
      const t2 = ist(2 * HOUR);
      const t2b = instantToLocalTime(new Date(Date.now() - 2 * HOUR + 3000), "Asia/Kolkata"); // 3 s later, like the sample's user 113
      const res = await agentPost([line(p.alice.employeeCode, t1), line(p.alice.employeeCode, t2), line(p.alice.employeeCode, t2b), line(UNMAPPED, t1)]);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalLines: 4, newCount: 4, duplicateCount: 0, unmappedCount: 1, rejectedCount: 0, flaggedCount: 0, highestLocalTime: t2b });
      const stored = await prisma.rawPunch.findMany({ where: { batchId: res.body.batchId }, orderBy: { punchedAt: "asc" } });
      expect(stored.filter((s) => s.employeeId === p.alice.employeeId)).toHaveLength(3);
      expect(stored.every((s) => s.direction === "UNKNOWN" && s.route === "AGENT" && s.status === "1" && s.verifyMode === "255")).toBe(true);
      expect(stored.find((s) => s.deviceUserId === UNMAPPED)!.employeeId).toBeNull();
      // recompute asked for alice's day(s), never for the unmapped punch
      expect(new Set(recomputed.map((r) => r.employeeId))).toEqual(new Set([p.alice.employeeId]));
      const device = await prisma.device.findUniqueOrThrow({ where: { id: agentDevice.id } });
      expect(device.lastPunchAt?.toISOString().slice(0, 19)).toBe(stored.at(-1)!.punchedAt.toISOString().slice(0, 19));
    });

    it("is idempotent: re-sending the same lines (a retry after a lost response) stores nothing new", async () => {
      const t = storedEarlier;
      const first = await agentPost([line(p.alice.employeeCode, t)]);
      const again = await agentPost([line(p.alice.employeeCode, t), line(p.alice.employeeCode, t)]);
      expect(first.body.newCount).toBe(1);
      expect(again.body).toMatchObject({ newCount: 0, duplicateCount: 2, highestLocalTime: t });
      expect(await prisma.rawPunch.count({ where: { deviceId: agentDevice.id, localTime: t } })).toBe(1);
    });

    it("keeps a bad line verbatim on the batch and stores the rest", async () => {
      const res = await agentPost([line(p.alice.employeeCode, ist(6 * HOUR)), "not a punch", `${p.alice.employeeCode}\t2026-13-01 10:00:00\t1`]);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ newCount: 1, rejectedCount: 2 });
      const batch = await prisma.ingestionBatch.findUniqueOrThrow({ where: { id: res.body.batchId } });
      expect((batch.rejectedLines as Array<{ raw: string }>).map((r) => r.raw)).toEqual(["not a punch", `${p.alice.employeeCode}\t2026-13-01 10:00:00\t1`]);
    });

    it("flags implausible times (future, too old), stores them, and leaves them out of computation", async () => {
      const future = ist(-2 * HOUR);
      const old = ist(60 * 24 * HOUR);
      const res = await agentPost([line(p.alice.employeeCode, future), line(p.alice.employeeCode, old)]);
      expect(res.body).toMatchObject({ newCount: 2, flaggedCount: 2 });
      expect(recomputed).toEqual([]);
      const stored = await prisma.rawPunch.findMany({ where: { batchId: res.body.batchId } });
      expect(stored.map((s) => s.flag).sort()).toEqual(["FUTURE", "TOO_OLD"]);
    });

    it("refuses a bad key, an inactive agent, and a device not assigned to the agent", async () => {
      expect((await agentPost([line("1", ist(HOUR))], agentDevice.serialNumber, "wsa_nope")).status).toBe(401);
      expect((await agentPost([line("1", ist(HOUR))], pushDevice.serialNumber)).status).toBe(403);
      await hr().patch(`/api/biometric/agents/${agentIds[0]}`).send({ isActive: false });
      expect((await agentPost([line("1", ist(HOUR))])).status).toBe(401);
      await hr().patch(`/api/biometric/agents/${agentIds[0]}`).send({ isActive: true });
    });

    it("rotating the key stops the old one at once", async () => {
      const old = agentKey;
      const rotated = await hr().post(`/api/biometric/agents/${agentIds[0]}/rotate-key`);
      agentKey = rotated.body.key;
      expect(agentKey).not.toBe(old);
      expect((await agentPost([line("1", ist(HOUR))], agentDevice.serialNumber, old)).status).toBe(401);
      expect((await agentPost([line(p.alice.employeeCode, ist(7 * HOUR))])).status).toBe(200);
      const stored = await prisma.biometricAgent.findUniqueOrThrow({ where: { id: agentIds[0] } });
      expect(stored.keyHash).not.toContain(agentKey); // only the hash is kept
    });

    it("heartbeat records the agent's report and which assigned devices it can reach", async () => {
      const res = await request(app)
        .post("/api/biometric/agent/heartbeat")
        .set("Authorization", `Bearer ${agentKey}`)
        .send({ version: "0.1.0", host: "OFFICE-PC", devices: [{ device: agentDevice.serialNumber, reachable: true, clockOffsetSeconds: 4 }] });
      expect(res.status).toBe(200);
      expect(res.body.devices.map((d: { serial: string }) => d.serial)).toEqual([agentDevice.serialNumber]); // P2-F: per-device config, see agentDevices.test.ts
      const agent = await prisma.biometricAgent.findUniqueOrThrow({ where: { id: agentIds[0] } });
      expect(agent).toMatchObject({ host: "OFFICE-PC", version: "0.1.0" });
      expect((await prisma.device.findUniqueOrThrow({ where: { id: agentDevice.id } })).lastHeartbeatAt).not.toBeNull();
    });
  });

  describe("raw punches are immutable as received", () => {
    it("the database refuses changing a received column, and deleting", async () => {
      const punch = await prisma.rawPunch.findFirstOrThrow({ where: { deviceId: agentDevice.id } });
      await expect(prisma.rawPunch.update({ where: { id: punch.id }, data: { punchedAt: new Date() } })).rejects.toThrow(/RAW_PUNCH_IMMUTABLE/);
      await expect(prisma.rawPunch.update({ where: { id: punch.id }, data: { rawLine: "edited" } })).rejects.toThrow(/RAW_PUNCH_IMMUTABLE/);
      await expect(prisma.rawPunch.delete({ where: { id: punch.id } })).rejects.toThrow(/RAW_PUNCH_IMMUTABLE/);
    });
  });

  describe("the ADMS push route (/iclock)", () => {
    it("handshakes, stores ATTLOG as PUSH, acknowledges other tables, and refuses unknown or agent-route serials", async () => {
      const hs = await request(app).get(`/iclock/cdata?SN=${pushDevice.serialNumber}&options=all`);
      expect(hs.status).toBe(200);
      expect(hs.text).toContain(`GET OPTION FROM: ${pushDevice.serialNumber}`);
      expect(hs.text).toContain("TimeZone=5.5");
      const t = ist(4 * HOUR);
      const up = await request(app).post(`/iclock/cdata?SN=${pushDevice.serialNumber}&table=ATTLOG&Stamp=1`).set("Content-Type", "text/plain").send(`${line(p.alice.employeeCode, t)}\n`);
      expect(up.text).toBe("OK: 1");
      expect(await prisma.rawPunch.count({ where: { deviceId: pushDevice.id, localTime: t, route: "PUSH", employeeId: p.alice.employeeId } })).toBe(1);
      expect((await request(app).post(`/iclock/cdata?SN=${pushDevice.serialNumber}&table=OPERLOG`).set("Content-Type", "text/plain").send("OPLOG 4\t0\t2021-09-01 10:00:00")).text).toBe("OK");
      expect((await request(app).get(`/iclock/getrequest?SN=${pushDevice.serialNumber}`)).text).toBe("OK");
      expect((await request(app).get("/iclock/cdata?SN=NOPE-123")).status).toBe(401);
      expect((await request(app).get(`/iclock/cdata?SN=${agentDevice.serialNumber}`)).status).toBe(401);
    });

    it("a device in another timezone has its local time read in that zone", async () => {
      const patched = await hr().patch(`/api/biometric/devices/${pushDevice.id}`).send({ timezone: "Asia/Dubai" });
      expect(patched.body).toMatchObject({ timezone: "Asia/Dubai", route: "PUSH" }); // only what was named changes
      const instant = new Date(Math.floor((Date.now() - 8 * HOUR) / 1000) * 1000);
      const local = instantToLocalTime(instant, "Asia/Dubai"); // UTC+4: 1h30m behind IST on the device's own clock
      const up = await request(app).post(`/iclock/cdata?SN=${pushDevice.serialNumber}&table=ATTLOG`).set("Content-Type", "text/plain").send(line(p.alice.employeeCode, local));
      expect(up.text).toBe("OK: 1");
      const stored = await prisma.rawPunch.findFirstOrThrow({ where: { deviceId: pushDevice.id, localTime: local } });
      expect(stored.punchedAt.toISOString()).toBe(instant.toISOString());
      await hr().patch(`/api/biometric/devices/${pushDevice.id}`).send({ timezone: "Asia/Kolkata" });
    });
  });

  describe("the unmapped queue and map-to-employee", () => {
    it("lists the unmapped device user ID; mapping it to bob resolves its stored punches and recomputes them, audited", async () => {
      const queue = (await hr().get("/api/biometric/unmapped")).body.unmapped;
      const row = queue.find((u: { deviceUserId: string }) => u.deviceUserId === UNMAPPED);
      expect(row).toMatchObject({ punches: 1 });
      const res = await hr().post("/api/biometric/unmapped/map").send({ deviceUserId: UNMAPPED, employeeId: p.bob.employeeId });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ resolved: 1, stillUnmapped: 0, mapping: { deviceUserId: UNMAPPED, validFrom: row.firstDay, plan: "first" } });
      expect(await prisma.rawPunch.count({ where: { deviceUserId: UNMAPPED, employeeId: p.bob.employeeId } })).toBe(1);
      expect(recomputed.map((r) => r.employeeId)).toEqual([p.bob.employeeId]);
      expect(await prisma.auditLog.findFirst({ where: { action: "biometric.device_user.mapped", entityId: p.bob.employeeId } })).not.toBeNull();
      expect((await hr().get("/api/biometric/unmapped")).body.unmapped.some((u: { deviceUserId: string }) => u.deviceUserId === UNMAPPED)).toBe(false);
      // later punches of that ID now go straight to bob
      const later = await agentPost([line(UNMAPPED, ist(HOUR))]);
      expect(later.body.unmappedCount).toBe(0);
    });

    it("one device ID is never two people on the same day", async () => {
      const tomorrow = instantToLocalTime(new Date(Date.now() + 24 * HOUR), "Asia/Kolkata").slice(0, 10);
      const res = await hr().post("/api/biometric/unmapped/map").send({ deviceUserId: p.alice.employeeCode, employeeId: p.bob.employeeId, effectiveFrom: tomorrow });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/belongs to someone else|already actively assigned to someone else/);
      // and history before bob's current mapping is never rewritten
      expect((await hr().post("/api/biometric/unmapped/map").send({ deviceUserId: `Q${suffix}`, employeeId: p.bob.employeeId, effectiveFrom: "2025-01-01" })).status).toBe(400);
    });

    it("the bulk resolver agrees with the single-punch reader (EF4)", async () => {
      const day = new Date(`${ist(HOUR).slice(0, 10)}T00:00:00Z`);
      const bulk = await employeesForDeviceUsersOn([{ deviceUserId: UNMAPPED, day }, { deviceUserId: p.alice.employeeCode, day }, { deviceUserId: "nobody", day }]);
      expect(bulk.get(`${UNMAPPED}|${day.toISOString().slice(0, 10)}`)).toBe(await employeeForDeviceUserOn(UNMAPPED, day));
      expect(bulk.get(`${p.alice.employeeCode}|${day.toISOString().slice(0, 10)}`)).toBe(p.alice.employeeId);
      expect(bulk.has(`nobody|${day.toISOString().slice(0, 10)}`)).toBe(false);
    });
  });

  describe("flagged punches", () => {
    it("lists unresolved flags; accepting one recomputes its day, discarding doesn't; decided once", async () => {
      const flagged = (await hr().get("/api/biometric/flagged")).body.flagged.filter((f: { device: string }) => f.device === "Test agent device");
      expect(flagged.length).toBeGreaterThanOrEqual(2);
      const accept = await hr().post(`/api/biometric/flagged/${flagged[0].id}/resolve`).send({ decision: "ACCEPTED", reason: "device clock checked" });
      expect(accept.status).toBe(200);
      expect(recomputed.map((r) => r.employeeId)).toEqual([p.alice.employeeId]);
      recomputed.length = 0;
      await hr().post(`/api/biometric/flagged/${flagged[1].id}/resolve`).send({ decision: "DISCARDED", reason: "clock was wrong" });
      expect(recomputed).toEqual([]);
      expect((await hr().post(`/api/biometric/flagged/${flagged[0].id}/resolve`).send({ decision: "DISCARDED", reason: "again" })).status).toBe(409);
    });
  });

  describe("the emergency file upload", () => {
    it("previews without writing, needs a reason to commit, then stores through the same service — once", async () => {
      const t = ist(9 * HOUR);
      const existing = storedEarlier; // stored by the idempotence test above
      const file = [line(p.alice.employeeCode, t), line(p.alice.employeeCode, existing), line(`Z${suffix}`, t), "bad line"].join("\n");
      const preview = await hr().post("/api/biometric/import/preview").field("deviceId", agentDevice.id).attach("file", Buffer.from(file), "attlog.txt");
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ totalLines: 4, newCount: 2, duplicateCount: 1, unmappedCount: 1, rejectedCount: 1 });
      expect(await prisma.rawPunch.count({ where: { deviceId: agentDevice.id, localTime: t } })).toBe(0);
      expect((await hr().post(`/api/biometric/import/${preview.body.batchId}/commit`).send({ reason: "" })).status).toBe(400);
      const commit = await hr().post(`/api/biometric/import/${preview.body.batchId}/commit`).send({ reason: "Agent PC was down for a day" });
      expect(commit.body).toMatchObject({ newCount: 2, duplicateCount: 1, unmappedCount: 1, rejectedCount: 1 });
      expect(await prisma.rawPunch.count({ where: { deviceId: agentDevice.id, localTime: t, route: "IMPORT" } })).toBe(2);
      expect((await hr().post(`/api/biometric/import/${preview.body.batchId}/commit`).send({ reason: "again please" })).status).toBe(409);
      expect(await prisma.auditLog.findFirst({ where: { action: "biometric.punches.imported", entityId: preview.body.batchId } })).not.toBeNull();
      await purgeAppendOnly("AuditLog", { entityId: preview.body.batchId });
    });
  });

  describe("who may manage devices", () => {
    it("HR Admin can; HR Executive can't (attendance.devices.manage is Admin-only)", async () => {
      expect((await hr().get("/api/biometric/devices")).status).toBe(200);
      expect((await request(app).get("/api/biometric/devices").set(...authHeader(execToken))).status).toBe(403);
      expect((await request(app).post("/api/biometric/agents").set(...authHeader(execToken)).send({ name: "x" })).status).toBe(403);
    });

    it("a serial number is registered once", async () => {
      const dup = await hr().post("/api/biometric/devices").send({ serialNumber: agentDevice.serialNumber, name: "dup", locationId: org.locationId });
      expect(dup.status).toBe(409);
    });
  });
});
