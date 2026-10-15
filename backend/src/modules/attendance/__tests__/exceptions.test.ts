import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";
import { setRecomputeHandler } from "../recompute";

// The Exceptions queue (Phase 3 commit 3): counts per type, filters, server paging, scope, unmapped device IDs, and the two
// bulk resolutions (map every suggested match; assign a shift to no-shift days). May 1988 is a week no seeded data touches.
// Days are inserted directly where only the queue's reading matters, and computed by the real engine where the point is
// that a corrected day leaves the queue by itself.
const D = ["1988-05-02", "1988-05-03", "1988-05-04", "1988-05-05", "1988-05-06"]; // Mon–Fri
const FROM = D[0]!;
const TO = D[4]!;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);
type Person = { employeeId: string; employeeCode: string; userId: string };
const q = (over: Record<string, string | number> = {}) => new URLSearchParams({ from: FROM, to: TO, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])) }).toString();

describe("Exceptions queue (Phase 3 commit 3)", () => {
  let orgA: TestOrgMasters;
  let orgB: TestOrgMasters;
  const p = {} as Record<"a1" | "a2" | "a3" | "b1" | "hr" | "emp" | "mapMe" | "noShift" | "late" | "ownNs", Person>;
  const tok = {} as Record<"hr" | "emp", string>;
  let deviceA = "";
  let deviceB = "";
  let batchA = "";
  let batchB = "";
  let shiftId = "";
  const auditEntityIds: string[] = [];

  const api = (t: string) => ({
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(t)).send(b),
  });
  const day = (who: Person, date: string, flags: string[], over: object = {}) =>
    prisma.dailyAttendance.create({
      data: { employeeId: who.employeeId, date: d(date), status: flags.includes("NO_SHIFT") ? "NS" : "A", source: "DEVICE", capture: "DEVICE", exceptionFlags: flags, engineVersion: 1, ...over },
    });
  const punch = (deviceId: string, batchId: string, deviceUserId: string, date: string, time: string, employeeId: string | null = null) =>
    prisma.rawPunch.create({
      data: { deviceId, deviceUserId, punchedAt: ist(date, time), localTime: `${date} ${time}:00`, businessDate: d(date), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId },
    });
  const rewind = async (who: Person) => {
    await prisma.employee.update({ where: { id: who.employeeId }, data: { dateOfJoining: d("1988-01-01") } });
    await prisma.employeeJobHistory.updateMany({ where: { employeeId: who.employeeId }, data: { effectiveFrom: d("1988-01-01") } });
    await prisma.employeeNameHistory.updateMany({ where: { employeeId: who.employeeId }, data: { effectiveFrom: d("1988-01-01") } });
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: who.employeeId }, data: { effectiveFrom: d("1988-01-01") } });
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: who.employeeId }, data: { validFrom: d("1988-01-01") } });
  };

  beforeAll(async () => {
    orgA = await createEmployeeTestOrgMasters();
    orgB = await createEmployeeTestOrgMasters();
    for (const k of ["a1", "a2", "a3", "mapMe", "noShift", "late", "ownNs"] as const) p[k] = await createFullTestEmployee(orgA);
    p.b1 = await createFullTestEmployee(orgB);
    p.hr = await createFullTestEmployee(orgA, { roleCode: "HR_ADMIN" });
    p.emp = await createFullTestEmployee(orgA, { roleCode: "EMPLOYEE" });
    tok.hr = await loginAs(p.hr.employeeCode);
    tok.emp = await loginAs(p.emp.employeeCode);
    for (const x of Object.values(p)) await rewind(x);
    deviceA = (await prisma.device.create({ data: { serialNumber: `EXQ-A-${tag}`, name: "Exceptions device A", locationId: orgA.locationId } })).id;
    deviceB = (await prisma.device.create({ data: { serialNumber: `EXQ-B-${tag}`, name: "Exceptions device B", locationId: orgB.locationId } })).id;
    batchA = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId: deviceA } })).id;
    batchB = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId: deviceB } })).id;
    shiftId = (
      await prisma.shift.create({
        data: { code: `EX${tag}`, name: "Exceptions shift", startTime: "10:00", endTime: "19:00", sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "Day", startTime: "10:00", endTime: "19:00" }] } },
      })
    ).id;

    // Seeded exception days (direct rows). The late-in and early-out days are reported, not queued.
    await day(p.a1, D[0]!, ["MISSING_PUNCH"]);
    await day(p.a1, D[1]!, ["SHORTFALL"], { status: "HD" });
    await day(p.a2, D[0]!, ["HALF_DAY_MIN_NOT_MET", "CLOCK_FLAGGED"]);
    await day(p.a2, D[2]!, ["NO_SHIFT"]);
    await day(p.b1, D[0]!, ["MISSING_PUNCH"]);
    await day(p.late, D[0]!, ["LATE_IN"], { status: "P" });
    await day(p.late, D[1]!, ["EARLY_OUT"], { status: "P" });
    await day(p.a3, D[3]!, ["MISSING_PUNCH"], { isLocked: true });
  });

  afterAll(async () => {
    await purgeAppendOnly("AuditLog", { entityId: { in: auditEntityIds } });
    await deleteWithDependents("RawPunch", (await prisma.rawPunch.findMany({ where: { deviceId: { in: [deviceA, deviceB] } }, select: { id: true } })).map((r) => r.id));
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("IngestionBatch", [batchA, batchB]);
    await deleteWithDependents("Device", [deviceA, deviceB]);
    await deleteWithDependents("Shift", [shiftId]);
    await cleanupEmployeeTestOrgMasters(orgA);
    await cleanupEmployeeTestOrgMasters(orgB);
  });

  it("counts per type up front; a day with two reasons counts under both and once in the total; late-in and early-out are not queued", async () => {
    const res = await api(tok.hr).get(`/exceptions?${q({ pageSize: 100 })}`);
    expect(res.status).toBe(200);
    // Company-wide: the seeded company has no exception days in May 1988, so these are exactly the rows above.
    expect(res.body.counts).toMatchObject({ ALL_DAYS: 6, MISSING_PUNCH: 3, SHORTFALL: 1, HALF_DAY_MIN_NOT_MET: 1, NO_SHIFT: 1, CLOCK_FLAGGED: 1 });
    expect(res.body.total).toBe(6);
    const keys = res.body.days.map((x: { employeeId: string; date: string }) => `${x.employeeId}|${x.date}`);
    expect(keys).not.toContain(`${p.late.employeeId}|${D[0]}`);
    expect(keys).not.toContain(`${p.late.employeeId}|${D[1]}`);
    const both = res.body.days.find((x: { employeeId: string; date: string }) => x.employeeId === p.a2.employeeId && x.date === D[0]);
    expect(both.types).toEqual(["HALF_DAY_MIN_NOT_MET", "CLOCK_FLAGGED"]);
  });

  it("a type filter lists that type only; each row carries the person, branch, department and whether the period is finalised", async () => {
    const res = await api(tok.hr).get(`/exceptions?${q({ type: "MISSING_PUNCH", pageSize: 100 })}`);
    expect(res.body.kind).toBe("DAYS");
    expect(res.body.total).toBe(3);
    expect(res.body.days.map((x: { date: string }) => x.date)).toEqual([D[3], D[0], D[0]]); // newest first
    const locked = res.body.days.find((x: { employeeId: string }) => x.employeeId === p.a3.employeeId);
    expect(locked).toMatchObject({ locked: true, employeeCode: p.a3.employeeCode, branch: expect.any(String), department: expect.any(String), status: "A" });
    expect(res.body.days.find((x: { employeeId: string }) => x.employeeId === p.a1.employeeId)).toMatchObject({ locked: false });
  });

  it("filters: branch, department, dates; a range over 93 days is refused", async () => {
    const branch = await api(tok.hr).get(`/exceptions?${q({ locationId: orgA.locationId, pageSize: 100 })}`);
    expect(branch.body.days.some((x: { employeeId: string }) => x.employeeId === p.b1.employeeId)).toBe(false);
    expect(branch.body.counts.MISSING_PUNCH).toBe(2);
    const dept = await api(tok.hr).get(`/exceptions?${q({ departmentId: orgB.departmentId, pageSize: 100 })}`);
    expect(dept.body.days.map((x: { employeeId: string }) => x.employeeId)).toEqual([p.b1.employeeId]);
    const dates = await api(tok.hr).get(`/exceptions?${q({ from: D[2]!, to: D[3]!, pageSize: 100 })}`);
    expect(dates.body.days.map((x: { date: string }) => x.date).sort()).toEqual([D[2], D[3]]);
    const wide = await api(tok.hr).get(`/exceptions?${q({ from: "1988-01-01", to: "1988-12-31" })}`);
    expect(wide.status).toBe(400);
    expect(wide.body.error.code).toBe("TOO_WIDE");
  });

  it("paging is on the server: stable order, no repeats or gaps, total stays the whole", async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await api(tok.hr).get(`/exceptions?${q({ page, pageSize: 2 })}`);
      expect(res.body.total).toBe(6);
      expect(res.body.days.length).toBe(2);
      seen.push(...res.body.days.map((x: { key: string }) => x.key));
    }
    expect(new Set(seen).size).toBe(6);
    expect((await api(tok.hr).get(`/exceptions?${q({ page: 4, pageSize: 2 })}`)).body.days).toEqual([]);
  });

  it("scope: an employee without attendance.view is refused; with it (self scope) they see only their own days", async () => {
    expect((await api(tok.emp).get(`/exceptions?${q()}`)).status).toBe(403);
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "attendance.view" } });
    const grant = await prisma.userPermissionOverride.create({ data: { userId: p.emp.userId, permissionId: perm.id, effect: "GRANT", reason: "exceptions test", createdByUserId: p.hr.userId } });
    await day(p.emp, D[1]!, ["MISSING_PUNCH"]);
    try {
      const mine = await api(await loginAs(p.emp.employeeCode)).get(`/exceptions?${q({ pageSize: 100 })}`);
      expect(mine.status).toBe(200);
      expect(mine.body.days.map((x: { employeeId: string }) => x.employeeId)).toEqual([p.emp.employeeId]);
      expect(mine.body.counts).toMatchObject({ ALL_DAYS: 1, MISSING_PUNCH: 1, UNMAPPED_ID: 0 });
      // a bulk action is not theirs, and unmapped IDs belong to nobody so they are not shown to a scoped viewer
      const unmapped = await api(await loginAs(p.emp.employeeCode)).get(`/exceptions?${q({ type: "UNMAPPED_ID" })}`);
      expect(unmapped.body).toMatchObject({ kind: "UNMAPPED", total: 0, unmapped: [] });
      expect((await api(await loginAs(p.emp.employeeCode)).post("/exceptions/map-device-ids/preview", { deviceUserIds: ["1"] })).status).toBe(403);
      expect((await api(await loginAs(p.emp.employeeCode)).post("/exceptions/assign-shift/preview", { keys: [{ employeeId: p.emp.employeeId, date: D[1] }], shiftId })).status).toBe(403);
    } finally {
      await prisma.userPermissionOverride.delete({ where: { id: grant.id } });
    }
  });

  it("a corrected day leaves the queue by itself: a lone punch is a missing punch; the second punch, recomputed, clears it", async () => {
    await punch(deviceA, batchA, p.late.employeeCode, D[4]!, "10:05", p.late.employeeId);
    await computeAttendance([p.late.employeeId], D[4]!, D[4]!);
    const key = `${p.late.employeeId}|${D[4]}`;
    const before = await api(tok.hr).get(`/exceptions?${q({ type: "MISSING_PUNCH", pageSize: 100 })}`);
    expect(before.body.days.map((x: { key: string }) => x.key)).toContain(key);
    await punch(deviceA, batchA, p.late.employeeCode, D[4]!, "19:00", p.late.employeeId);
    await computeAttendance([p.late.employeeId], D[4]!, D[4]!);
    const after = await api(tok.hr).get(`/exceptions?${q({ type: "MISSING_PUNCH", pageSize: 100 })}`);
    expect(after.body.days.map((x: { key: string }) => x.key)).not.toContain(key);
  });

  describe("unmapped device IDs", () => {
    it("grouped by ID with punch count, days and dates, filtered by branch; the department filter has nothing to match", async () => {
      await punch(deviceA, batchA, "77001", D[0]!, "09:58");
      await punch(deviceA, batchA, "77001", D[0]!, "18:30");
      await punch(deviceA, batchA, "77001", D[1]!, "10:01");
      await punch(deviceB, batchB, "77002", D[2]!, "10:00");
      const res = await api(tok.hr).get(`/exceptions?${q({ type: "UNMAPPED_ID", pageSize: 100 })}`);
      expect(res.body.kind).toBe("UNMAPPED");
      expect(res.body.counts.UNMAPPED_ID).toBeGreaterThanOrEqual(2);
      const g = res.body.unmapped.find((x: { deviceUserId: string }) => x.deviceUserId === "77001");
      expect(g).toMatchObject({ punches: 3, days: 2, firstDay: D[0], lastDay: D[1], devices: ["Exceptions device A"], suggestion: null });
      const onlyA = await api(tok.hr).get(`/exceptions?${q({ type: "UNMAPPED_ID", locationId: orgA.locationId, pageSize: 100 })}`);
      expect(onlyA.body.unmapped.map((x: { deviceUserId: string }) => x.deviceUserId)).toContain("77001");
      expect(onlyA.body.unmapped.map((x: { deviceUserId: string }) => x.deviceUserId)).not.toContain("77002");
      const dept = await api(tok.hr).get(`/exceptions?${q({ type: "UNMAPPED_ID", departmentId: orgA.departmentId })}`);
      expect(dept.body.total).toBe(0);
    });

    it("map every suggested match: only an ID equal to exactly one employee code, who has no device ID yet, who is not the actor", async () => {
      // mapMe: no device ID mapped yet, so their code is an unambiguous match for its unmapped punches
      await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.mapMe.employeeId } });
      await punch(deviceA, batchA, p.mapMe.employeeCode, D[0]!, "10:00");
      await punch(deviceA, batchA, p.mapMe.employeeCode, D[0]!, "19:00");
      // a1 already has a device ID: their code appears unmapped (a punch before the mapping began), but mapping would replace it
      await prisma.deviceUserMapping.updateMany({ where: { employeeId: p.a1.employeeId }, data: { validFrom: d("1988-06-01") } });
      await punch(deviceA, batchA, p.a1.employeeCode, D[0]!, "10:00");
      // the HR user's own code: left out, never mapped by themselves
      await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.hr.employeeId } });
      await punch(deviceA, batchA, p.hr.employeeCode, D[0]!, "10:00");
      const ids = [p.mapMe.employeeCode, p.a1.employeeCode, p.hr.employeeCode, "77001"];
      const preview = await api(tok.hr).post("/exceptions/map-device-ids/preview", { deviceUserIds: ids });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ count: 1, punches: 2, ownLeftOut: 1, items: [{ deviceUserId: p.mapMe.employeeCode, employeeId: p.mapMe.employeeId, punches: 2 }] });
      expect(preview.body.skipped.map((s: { deviceUserId: string }) => s.deviceUserId).sort()).toEqual([p.a1.employeeCode, "77001"].sort());
      expect(preview.body.skipped.find((s: { deviceUserId: string }) => s.deviceUserId === p.a1.employeeCode).reason).toContain("already have a device ID");

      const stale = await api(tok.hr).post("/exceptions/map-device-ids", { deviceUserIds: ids, fingerprint: "0".repeat(64), confirm: true });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("SELECTION_CHANGED");
      expect(await prisma.rawPunch.count({ where: { deviceUserId: p.mapMe.employeeCode, employeeId: null } })).toBe(2);

      const done = await api(tok.hr).post("/exceptions/map-device-ids", { deviceUserIds: ids, fingerprint: preview.body.fingerprint, confirm: true });
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({ mapped: 1, punchesResolved: 2, failed: [] });
      auditEntityIds.push(p.mapMe.employeeId);
      expect(await prisma.rawPunch.count({ where: { deviceUserId: p.mapMe.employeeCode, employeeId: p.mapMe.employeeId } })).toBe(2);
      expect(await prisma.deviceUserMapping.count({ where: { employeeId: p.mapMe.employeeId, deviceUserId: p.mapMe.employeeCode } })).toBe(1);
      const audit = await prisma.auditLog.findMany({ where: { action: "biometric.device_user.mapped", entityId: p.mapMe.employeeId } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.after).toMatchObject({ fromExceptionsQueue: true, bulkId: done.body.bulkId, bulkCount: 1, punchesResolved: 2 });
      // the same confirmation can't be replayed, and the ID has left the queue
      expect((await api(tok.hr).post("/exceptions/map-device-ids", { deviceUserIds: ids, fingerprint: preview.body.fingerprint, confirm: true })).status).toBe(409);
      const queue = await api(tok.hr).get(`/exceptions?${q({ type: "UNMAPPED_ID", pageSize: 100 })}`);
      expect(queue.body.unmapped.map((x: { deviceUserId: string }) => x.deviceUserId)).not.toContain(p.mapMe.employeeCode);
    });

    it("a filter instead of a hand-picked list maps every suggestion it covers, and one of the kinds needs the right permission", async () => {
      const preview = await api(tok.hr).post("/exceptions/map-device-ids/preview", { filter: { from: FROM, to: TO, locationId: orgA.locationId } });
      expect(preview.status).toBe(200);
      expect(preview.body.items).toEqual([]); // the one suggestion was mapped above; the others are skipped or the actor's own
      expect((await api(tok.hr).post("/exceptions/map-device-ids/preview", { deviceUserIds: ["1"], filter: {} })).status).toBe(400); // one or the other
    });
  });

  describe("assign a shift to no-shift days", () => {
    it("people with no attendance assignment get one from the earliest selected day, with the company's week-off pattern and policy; the days recompute and leave the queue", async () => {
      await prisma.attendanceAssignment.deleteMany({ where: { employeeId: p.noShift.employeeId } });
      await computeAttendance([p.noShift.employeeId], D[0]!, D[1]!);
      const rows = await prisma.dailyAttendance.findMany({ where: { employeeId: p.noShift.employeeId, date: { gte: d(D[0]!), lte: d(D[1]!) } }, orderBy: { date: "asc" } });
      expect(rows.map((r) => r.status)).toEqual(["NS", "NS"]);

      const queue = await api(tok.hr).get(`/exceptions?${q({ type: "NO_SHIFT", pageSize: 100 })}`);
      const keys = queue.body.days.filter((x: { employeeId: string }) => x.employeeId === p.noShift.employeeId).map((x: { employeeId: string; date: string }) => ({ employeeId: x.employeeId, date: x.date }));
      expect(keys).toHaveLength(2);

      const preview = await api(tok.hr).post("/exceptions/assign-shift/preview", { keys, shiftId });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ employees: 1, days: 2, blockedEmployees: 0, ownLeftOut: 0, items: [{ employeeId: p.noShift.employeeId, from: D[0], noShiftDays: 2, hasAssignment: false, problem: null }] });
      const stale = await api(tok.hr).post("/exceptions/assign-shift", { keys, shiftId, fingerprint: "1".repeat(64), note: "", confirm: true });
      expect(stale.status).toBe(409);
      expect(await prisma.attendanceAssignment.count({ where: { employeeId: p.noShift.employeeId } })).toBe(0);

      // In the app a recompute request becomes a debounced job; here the request itself is what is observed, then run.
      const asked: string[] = [];
      setRecomputeHandler(async (days) => void asked.push(...days.map((x) => `${x.employeeId}|${x.date.toISOString().slice(0, 10)}`)));
      const done = await api(tok.hr).post("/exceptions/assign-shift", { keys, shiftId, fingerprint: preview.body.fingerprint, note: "New joiner had no shift", confirm: true });
      setRecomputeHandler(null);
      expect(done.status).toBe(200);
      expect(asked).toEqual(expect.arrayContaining([`${p.noShift.employeeId}|${D[0]}`, `${p.noShift.employeeId}|${D[1]}`]));
      await computeAttendance([p.noShift.employeeId], D[0]!, D[1]!);
      expect(done.body).toMatchObject({ employees: 1, days: 2 });
      auditEntityIds.push(p.noShift.employeeId);
      const made = await prisma.attendanceAssignment.findMany({ where: { employeeId: p.noShift.employeeId } });
      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({ shiftId, effectiveFrom: d(D[0]!), changeReason: "New joiner had no shift", createdByUserId: p.hr.userId });
      const audit = await prisma.auditLog.findMany({ where: { action: "attendance.assignment.changed", entityId: p.noShift.employeeId } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.after).toMatchObject({ fromExceptionsQueue: true, bulkId: done.body.bulkId, noShiftDays: 2 });
      const after = await prisma.dailyAttendance.findMany({ where: { employeeId: p.noShift.employeeId, date: { gte: d(D[0]!), lte: d(D[1]!) } } });
      expect(after.every((r) => r.status !== "NS" && r.shiftId === shiftId)).toBe(true);
      const left = await api(tok.hr).get(`/exceptions?${q({ type: "NO_SHIFT", pageSize: 100 })}`);
      expect(left.body.days.some((x: { employeeId: string }) => x.employeeId === p.noShift.employeeId)).toBe(false);
    });

    it("days before an assignment starts can't be fixed by assigning (that would rewrite history): they are listed with where to go; the actor's own days are left out", async () => {
      await prisma.attendanceAssignment.updateMany({ where: { employeeId: p.a2.employeeId }, data: { effectiveFrom: d("1988-05-10") } });
      await day(p.hr, D[3]!, ["NO_SHIFT"]);
      const keys = [
        { employeeId: p.a2.employeeId, date: D[2]! },
        { employeeId: p.hr.employeeId, date: D[3]! },
      ];
      const preview = await api(tok.hr).post("/exceptions/assign-shift/preview", { keys, shiftId });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ employees: 0, days: 0, blockedEmployees: 1, ownLeftOut: 1 });
      expect(preview.body.items).toHaveLength(1);
      expect(preview.body.items[0]).toMatchObject({ employeeId: p.a2.employeeId, problem: "BEFORE_ASSIGNMENT" });
      expect(preview.body.items[0].problemText).toContain("Shift Override");
      const refuse = await api(tok.hr).post("/exceptions/assign-shift", { keys, shiftId, fingerprint: preview.body.fingerprint, note: "", confirm: true });
      expect(refuse.status).toBe(409); // nothing left to assign
      expect(await prisma.attendanceAssignment.count({ where: { employeeId: p.hr.employeeId, shiftId } })).toBe(0);
    });

    it("only no-shift days are taken: other exception days named in the selection are ignored; an inactive shift or one with no working session is refused", async () => {
      const keys = [{ employeeId: p.a1.employeeId, date: D[0]! }]; // a missing punch, not a no-shift day
      const preview = await api(tok.hr).post("/exceptions/assign-shift/preview", { keys, shiftId });
      expect(preview.body).toMatchObject({ employees: 0, days: 0, items: [] });
      const noWork = await prisma.shift.create({ data: { code: `EN${tag}`, name: "No work", startTime: "10:00", endTime: "19:00", sessions: { create: [{ sortOrder: 1, kind: "BREAK", label: "Lunch", startTime: "13:00", endTime: "14:00" }] } } });
      try {
        const bad = await api(tok.hr).post("/exceptions/assign-shift/preview", { keys, shiftId: noWork.id });
        expect(bad.status).toBe(400);
        expect(bad.body.error.message).toContain("no working session");
      } finally {
        await deleteWithDependents("Shift", [noWork.id]);
      }
    });
  });

  it("volume: a few hundred exception days page and count correctly", async () => {
    const people = [p.a1, p.a2, p.a3, p.b1, p.mapMe];
    const start = d("1988-08-01");
    const rows = [];
    for (let i = 0; i < 90; i++) for (const who of people) rows.push({ employeeId: who.employeeId, date: new Date(start.getTime() + i * 86_400_000), status: "A", source: "DEVICE" as const, capture: "DEVICE" as const, exceptionFlags: ["MISSING_PUNCH"], engineVersion: 1 });
    await prisma.dailyAttendance.createMany({ data: rows });
    const t0 = Date.now();
    const res = await api(tok.hr).get(`/exceptions?${new URLSearchParams({ from: "1988-08-01", to: "1988-10-29", type: "MISSING_PUNCH", page: "3", pageSize: "50" })}`);
    const ms = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 450, page: 3 });
    expect(res.body.days).toHaveLength(50);
    expect(res.body.counts.ALL_DAYS).toBe(450);
    expect(ms).toBeLessThan(5000); // a sanity bound; CI's figures are the baseline (docs/plans/PHASE_3.md)
  });
});
