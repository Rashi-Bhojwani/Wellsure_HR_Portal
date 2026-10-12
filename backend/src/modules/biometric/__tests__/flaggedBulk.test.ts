import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { setRecomputeHandler, type DayRef } from "../../attendance/recompute";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { MAX_BULK_ACCEPT } from "../flaggedBulk";

// Bulk accept for flagged punches (docs/plans/PHASE_2.md "P2-J", D): the device-outage case, where
// flagged punches arrive for a whole branch at once. HR sees exactly what would be accepted, confirms
// that exact set with a reason, and every punch is audited on its own.
type Person = { employeeId: string; employeeCode: string; userId: string };
const suffix = Date.now().toString(36).slice(-5);
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("bulk accept of flagged punches (P2-J)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"hr" | "exec" | "alice" | "bob" | "late", Person>;
  let hrToken = "";
  let execToken = "";
  let deviceA = "";
  let deviceB = "";
  let batchId = "";
  const punchIds: string[] = [];
  const recomputed: DayRef[] = [];
  const hr = () => ({
    get: (path: string) => request(app).get(path).set(...authHeader(hrToken)),
    post: (path: string) => request(app).post(path).set(...authHeader(hrToken)),
  });

  let n = 0;
  async function flagged(deviceId: string, deviceUserId: string, date: string, flag: "TOO_OLD" | "FUTURE", employeeId: string | null) {
    n += 1;
    const punch = await prisma.rawPunch.create({
      data: {
        deviceId, deviceUserId, punchedAt: new Date(`${date}T0${(n % 9) + 1}:${String(10 + (n % 40))}:00Z`), localTime: `${date} 0${(n % 9) + 1}:00:00`, businessDate: d(date),
        status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId, flag,
      },
    });
    punchIds.push(punch.id);
    return punch.id;
  }

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.exec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.alice = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    p.bob = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    p.late = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.late.employeeId } }); // not mapped yet
    hrToken = await loginAs(p.hr.employeeCode);
    execToken = await loginAs(p.exec.employeeCode);
    deviceA = (await prisma.device.create({ data: { serialNumber: `FB-A-${suffix}`, name: `Flag device A ${suffix}`, locationId: org.locationId } })).id;
    deviceB = (await prisma.device.create({ data: { serialNumber: `FB-B-${suffix}`, name: `Flag device B ${suffix}`, locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId: deviceA } })).id;
    setRecomputeHandler(async (days) => void recomputed.push(...days));
  });

  afterAll(async () => {
    setRecomputeHandler(null);
    await purgeAppendOnly("AuditLog", { entityId: { in: punchIds } });
    await deleteWithDependents("RawPunch", punchIds);
    await deleteWithDependents("IngestionBatch", [batchId]);
    await deleteWithDependents("Device", [deviceA, deviceB]);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  // The outage: device A, four old punches for alice over two days and one for bob; one for a late joiner nobody has mapped; a future one; one on device B.
  const outage = {} as Record<"a1" | "a2" | "a3" | "b1" | "u1" | "f1" | "o1", string>;
  beforeAll(async () => {
    outage.a1 = await flagged(deviceA, p.alice.employeeCode, "2026-08-03", "TOO_OLD", p.alice.employeeId);
    outage.a2 = await flagged(deviceA, p.alice.employeeCode, "2026-08-03", "TOO_OLD", p.alice.employeeId);
    outage.a3 = await flagged(deviceA, p.alice.employeeCode, "2026-08-04", "TOO_OLD", p.alice.employeeId);
    outage.b1 = await flagged(deviceA, p.bob.employeeCode, "2026-08-04", "TOO_OLD", p.bob.employeeId);
    outage.u1 = await flagged(deviceA, p.late.employeeCode, "2026-08-04", "TOO_OLD", null);
    outage.f1 = await flagged(deviceA, p.alice.employeeCode, "2099-01-01", "FUTURE", p.alice.employeeId);
    outage.o1 = await flagged(deviceB, p.alice.employeeCode, "2026-08-04", "TOO_OLD", p.alice.employeeId);
  });

  const filterA = () => ({ filter: { deviceId: deviceA, flag: "TOO_OLD", from: "2026-08-01", to: "2026-08-31" } });

  describe("choosing and previewing", () => {
    it("filters the list and says how many there are in all", async () => {
      const all = (await hr().get(`/api/biometric/flagged?deviceId=${deviceA}`)).body;
      expect(all.total).toBe(6);
      expect(all.flagged.map((f: { id: string }) => f.id).sort()).toEqual([outage.a1, outage.a2, outage.a3, outage.b1, outage.u1, outage.f1].sort());
      const old = (await hr().get(`/api/biometric/flagged?deviceId=${deviceA}&flag=TOO_OLD&from=2026-08-04&to=2026-08-04`)).body;
      expect(old.total).toBe(3);
      expect(old.flagged[0]).toMatchObject({ deviceId: deviceA, businessDate: "2026-08-04" });
    });

    it("shows exactly what would be accepted: the counts, the people, the days, the unmapped, every punch", async () => {
      const res = await hr().post("/api/biometric/flagged/bulk-accept/preview").send(filterA());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ count: 5, unmappedCount: 1, affectedDays: 3, employees: 2 }); // alice 3 Aug and 4 Aug, bob 4 Aug
      expect(res.body.byFlag).toEqual([{ flag: "TOO_OLD", count: 5 }]);
      expect(res.body.byDate).toEqual([{ date: "2026-08-03", count: 2 }, { date: "2026-08-04", count: 3 }]);
      expect(res.body.byDevice).toEqual([{ device: `Flag device A ${suffix}`, count: 5 }]);
      expect(res.body.punches.map((x: { id: string }) => x.id).sort()).toEqual([outage.a1, outage.a2, outage.a3, outage.b1, outage.u1].sort());
      expect(res.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(await prisma.punchFlagResolution.count({ where: { punchId: { in: punchIds } } })).toBe(0); // a preview decides nothing
    });

    it("needs a selection: ids or a filter, never both, never neither; and refuses more than it can show", async () => {
      expect((await hr().post("/api/biometric/flagged/bulk-accept/preview").send({})).status).toBe(400);
      expect((await hr().post("/api/biometric/flagged/bulk-accept/preview").send({ filter: {} })).status).toBe(400);
      expect((await hr().post("/api/biometric/flagged/bulk-accept/preview").send({ ids: [outage.a1], filter: { deviceId: deviceA } })).status).toBe(400);
      const byIds = await hr().post("/api/biometric/flagged/bulk-accept/preview").send({ ids: [outage.a1, outage.a2, "not-a-punch"] });
      expect(byIds.body.count).toBe(2); // an id that isn't an undecided flagged punch is simply not in the set

      const many = await prisma.device.create({ data: { serialNumber: `FB-M-${suffix}`, name: `Flag device many ${suffix}`, locationId: org.locationId } });
      const ids: string[] = [];
      try {
        const base = Date.parse("2026-07-01T00:00:00Z");
        const rows = Array.from({ length: MAX_BULK_ACCEPT + 1 }, (_, i) => ({
          deviceId: many.id, deviceUserId: "9999", punchedAt: new Date(base + i * 60_000), localTime: "2026-07-01 00:00:00", businessDate: d("2026-07-01"), status: "1", verifyMode: "255", workcode: "1", reserved: "0",
          rawLine: "t", route: "IMPORT" as const, batchId, flag: "TOO_OLD" as const,
        }));
        await prisma.rawPunch.createMany({ data: rows });
        ids.push(...(await prisma.rawPunch.findMany({ where: { deviceId: many.id }, select: { id: true } })).map((r) => r.id));
        const res = await hr().post("/api/biometric/flagged/bulk-accept/preview").send({ filter: { deviceId: many.id } });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("TOO_MANY");
      } finally {
        await deleteWithDependents("RawPunch", ids);
        await deleteWithDependents("Device", [many.id]);
      }
    });
  });

  describe("confirming", () => {
    it("is refused without the fingerprint, a reason and the explicit confirmation, and for anyone without the device permission", async () => {
      const { fingerprint } = (await hr().post("/api/biometric/flagged/bulk-accept/preview").send(filterA())).body;
      const post = (body: object, token = hrToken) => request(app).post("/api/biometric/flagged/bulk-accept").set(...authHeader(token)).send(body);
      expect((await post({ ...filterA(), reason: "the clock was an hour out" })).status).toBe(400); // no fingerprint
      expect((await post({ ...filterA(), fingerprint, reason: "" , confirm: true })).status).toBe(400); // no reason
      expect((await post({ ...filterA(), fingerprint, reason: "the clock was an hour out" })).status).toBe(400); // not confirmed
      expect((await post({ ...filterA(), fingerprint, reason: "the clock was an hour out", confirm: true }, execToken)).status).toBe(403);
      expect((await request(app).get("/api/biometric/flagged").set(...authHeader(execToken))).status).toBe(403);
      expect((await request(app).post("/api/biometric/flagged/bulk-accept/preview").set(...authHeader(execToken)).send(filterA())).status).toBe(403);
      expect(await prisma.punchFlagResolution.count({ where: { punchId: { in: punchIds } } })).toBe(0);
    });

    it("applies only to the set that was previewed: if one was decided meanwhile, nothing changes and HR is told to look again", async () => {
      const { fingerprint } = (await hr().post("/api/biometric/flagged/bulk-accept/preview").send(filterA())).body;
      await hr().post(`/api/biometric/flagged/${outage.b1}/resolve`).send({ decision: "DISCARDED", reason: "bob was not in that day" });
      const res = await hr().post("/api/biometric/flagged/bulk-accept").send({ ...filterA(), fingerprint, reason: "the clock was an hour out", confirm: true });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SELECTION_CHANGED");
      expect(await prisma.punchFlagResolution.count({ where: { punchId: { in: [outage.a1, outage.a2, outage.a3, outage.u1] } } })).toBe(0);
      expect(await prisma.punchFlagResolution.count({ where: { punchId: outage.b1 } })).toBe(1); // only the one decided by hand
    });

    it("accepts the previewed set: every punch decided, one audit row per punch, the affected days recomputed once, the unmapped one waits", async () => {
      const preview = (await hr().post("/api/biometric/flagged/bulk-accept/preview").send(filterA())).body;
      expect(preview.count).toBe(4); // bob's was discarded above
      recomputed.length = 0;
      const res = await hr().post("/api/biometric/flagged/bulk-accept").send({ ...filterA(), fingerprint: preview.fingerprint, reason: "the device clock was an hour out for a day", confirm: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accepted: 4, recomputedDays: 2, unmapped: 1 });

      const mine = [outage.a1, outage.a2, outage.a3, outage.u1];
      const decisions = await prisma.punchFlagResolution.findMany({ where: { punchId: { in: mine } } });
      expect(decisions).toHaveLength(4);
      expect(decisions.every((x) => x.decision === "ACCEPTED" && x.reason === "the device clock was an hour out for a day" && x.decidedByUserId === p.hr.userId)).toBe(true);

      // One audit row per punch, never one for the batch; the shared bulkId lets the batch be reconstructed.
      const audits = await prisma.auditLog.findMany({ where: { action: "biometric.punch.flag_accepted", entityId: { in: mine } } });
      expect(audits).toHaveLength(4);
      expect(audits.map((a) => a.entityId).sort()).toEqual([...mine].sort());
      expect(new Set(audits.map((a) => (a.after as { bulkId: string }).bulkId)).size).toBe(1);
      expect((audits[0]!.after as { bulkCount: number; reason: string })).toMatchObject({ bulkCount: 4, reason: "the device clock was an hour out for a day" });
      expect(audits.every((a) => a.actorUserId === p.hr.userId)).toBe(true);

      // alice's two days, once each (not once per punch); the unmapped punch has nobody to recompute for yet.
      expect(recomputed.map((x) => `${x.employeeId}|${x.date.toISOString().slice(0, 10)}`).sort()).toEqual([`${p.alice.employeeId}|2026-08-03`, `${p.alice.employeeId}|2026-08-04`].sort());

      // Nothing is left to accept in that selection; repeating it is refused, not repeated.
      expect((await hr().post("/api/biometric/flagged/bulk-accept").send({ ...filterA(), fingerprint: preview.fingerprint, reason: "again", confirm: true })).status).toBe(409);
      expect(await prisma.auditLog.count({ where: { action: "biometric.punch.flag_accepted", entityId: { in: mine } } })).toBe(4);
    });

    it("an unmapped punch accepted now counts the day once its device ID is mapped", async () => {
      recomputed.length = 0;
      const res = await hr().post("/api/biometric/unmapped/map").send({ deviceUserId: p.late.employeeCode, employeeId: p.late.employeeId, effectiveFrom: "2026-08-01" });
      expect(res.status).toBe(200);
      expect(recomputed.map((x) => `${x.employeeId}|${x.date.toISOString().slice(0, 10)}`)).toContain(`${p.late.employeeId}|2026-08-04`);
    });

    it("can also accept by ticked punches, and leaves the future-dated one and other devices' punches alone unless asked", async () => {
      const preview = (await hr().post("/api/biometric/flagged/bulk-accept/preview").send({ ids: [outage.o1, outage.f1] })).body;
      expect(preview.count).toBe(2);
      const res = await hr().post("/api/biometric/flagged/bulk-accept").send({ ids: [outage.o1, outage.f1], fingerprint: preview.fingerprint, reason: "both checked by hand against the log", confirm: true });
      expect(res.status).toBe(200);
      expect(await prisma.punchFlagResolution.count({ where: { punchId: { in: [outage.o1, outage.f1] }, decision: "ACCEPTED" } })).toBe(2);
    });
  });

  // "Nobody acts on their own attendance" (the second place this rule surfaced after the muster): HR does not rule on the evidence of their own day.
  describe("your own punches are decided by someone else", () => {
    it("are left out of a bulk accept (and counted, so HR knows), refused one by one, and cannot be mapped to yourself", async () => {
      const own = await flagged(deviceB, p.hr.employeeCode, "2026-08-10", "TOO_OLD", p.hr.employeeId);
      const others = await flagged(deviceB, p.bob.employeeCode, "2026-08-10", "TOO_OLD", p.bob.employeeId);
      const sel = { filter: { deviceId: deviceB, from: "2026-08-10", to: "2026-08-10" } };
      const preview = (await hr().post("/api/biometric/flagged/bulk-accept/preview").send(sel)).body;
      expect(preview).toMatchObject({ count: 1, ownLeftOut: 1 });
      expect(preview.punches.map((x: { id: string }) => x.id)).toEqual([others]);
      const res = await hr().post("/api/biometric/flagged/bulk-accept").send({ ...sel, fingerprint: preview.fingerprint, reason: "checked against the day's log", confirm: true });
      expect(res.body.accepted).toBe(1);
      expect(await prisma.punchFlagResolution.count({ where: { punchId: own } })).toBe(0);
      const single = await hr().post(`/api/biometric/flagged/${own}/resolve`).send({ decision: "ACCEPTED", reason: "it was me" });
      expect(single.status).toBe(403);
      expect(single.body.error.code).toBe("OWN_ATTENDANCE");
      // Someone else (a second HR admin) can.
      const other = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
      try {
        const otherToken = await loginAs(other.employeeCode);
        const ok = await request(app).post(`/api/biometric/flagged/${own}/resolve`).set(...authHeader(otherToken)).send({ decision: "ACCEPTED", reason: "checked against the log" });
        expect(ok.status).toBe(200);
      } finally {
        await purgeAppendOnly("AuditLog", { entityId: { in: [own, others] } });
        await deleteWithDependents("RawPunch", [own, others]);
        punchIds.splice(punchIds.indexOf(own), 1);
        punchIds.splice(punchIds.indexOf(others), 1);
        await cleanupFullTestEmployee(other.employeeId);
      }
    });

    it("an HR admin cannot map unmapped punches to themselves", async () => {
      const id = await flagged(deviceB, `LONE-${suffix}`, "2026-08-11", "TOO_OLD", null);
      const res = await hr().post("/api/biometric/unmapped/map").send({ deviceUserId: `LONE-${suffix}`, employeeId: p.hr.employeeId });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("OWN_ATTENDANCE");
      expect(await prisma.rawPunch.findUniqueOrThrow({ where: { id } })).toMatchObject({ employeeId: null });
    });
  });
});
