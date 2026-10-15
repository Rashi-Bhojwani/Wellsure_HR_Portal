import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { DEFAULT_REGULARIZATION_SETTINGS, REGULARIZATION_SETTING_KEY } from "../../../lib/regularizationSettings";
import { setSetting } from "../../../lib/settings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";

// Shift Override (Phase 3 commit 2): a shift for specific dates, read by the engine ahead of the assignment's shift.
// "Today" is Wed 30 Sep 2026.
type Person = { employeeId: string; employeeCode: string; userId: string };
const TODAY = "2026-09-30";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);
const DAY = "2026-09-16"; // Wed
const OTHER_DAY = "2026-09-17"; // Thu

describe("Shift Override (Phase 3 commit 2)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"s" | "t" | "hr" | "exec" | "emp", Person>;
  const tok = {} as Record<"hr" | "exec" | "emp", string>;
  let deviceId = "";
  let batchId = "";
  let lateShiftId = "";
  let otherShiftId = "";
  let inactiveShiftId = "";
  let savedSettings: unknown = null;

  const hr = () => ({
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(tok.hr)).send(b),
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(tok.hr)),
  });
  const body = (who: Person[], date: string, over: object = {}) => ({ selection: { employeeIds: who.map((x) => x.employeeId) }, from: date, to: date, shiftId: lateShiftId, note: "Covering the late counter that day", ...over });
  const confirm = async (b: ReturnType<typeof body>) => {
    const preview = await hr().post("/shift-overrides/preview", b);
    expect(preview.status).toBe(200);
    return hr().post("/shift-overrides", { ...b, fingerprint: preview.body.fingerprint, confirm: true });
  };
  const dayRow = (who: Person, date: string) => prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: who.employeeId, date: d(date) } } });
  const punch = (who: Person, date: string, time: string) =>
    prisma.rawPunch.create({
      data: { deviceId, deviceUserId: who.employeeCode, punchedAt: ist(date, time), localTime: `${date} ${time}:00`, businessDate: d(date), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: who.employeeId },
    });
  const makeShift = (code: string, start: string, end: string, mid: [string, string], active = true) =>
    prisma.shift.create({
      data: {
        code,
        name: `Override test ${code}`,
        startTime: start,
        endTime: end,
        isActive: active,
        sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "A", startTime: start, endTime: mid[0] }, { sortOrder: 2, kind: "BREAK", label: "Meal", startTime: mid[0], endTime: mid[1] }, { sortOrder: 3, kind: "WORK", label: "B", startTime: mid[1], endTime: end }] },
      },
    });

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    for (const k of ["s", "t"] as const) p[k] = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.exec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    for (const k of ["hr", "exec", "emp"] as const) tok[k] = await loginAs(p[k].employeeCode);
    savedSettings = (await prisma.systemSetting.findUnique({ where: { key: REGULARIZATION_SETTING_KEY } }))?.value ?? null;
    await setSetting(REGULARIZATION_SETTING_KEY, DEFAULT_REGULARIZATION_SETTINGS, p.hr.userId);
    deviceId = (await prisma.device.create({ data: { serialNumber: `SHO-${tag}`, name: "Shift override test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    lateShiftId = (await makeShift(`L${tag}`, "14:00", "23:00", ["18:00", "18:30"])).id;
    otherShiftId = (await makeShift(`M${tag}`, "06:00", "15:00", ["10:00", "10:30"])).id;
    inactiveShiftId = (await makeShift(`I${tag}`, "08:00", "17:00", ["12:00", "12:30"], false)).id;
    // s worked the late shift on DAY (14:10 to 23:05); t worked the normal day on OTHER_DAY.
    await punch(p.s, DAY, "14:10");
    await punch(p.s, DAY, "23:05");
    await punch(p.t, OTHER_DAY, "10:00");
    await punch(p.t, OTHER_DAY, "19:00");
    await computeAttendance([p.s, p.t, p.hr].map((x) => x.employeeId), "2026-09-10", TODAY);
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    if (savedSettings === null) await prisma.systemSetting.deleteMany({ where: { key: REGULARIZATION_SETTING_KEY } });
    else await prisma.systemSetting.update({ where: { key: REGULARIZATION_SETTING_KEY }, data: { value: savedSettings as never } });
    const ids = Object.values(p).map((x) => x.employeeId);
    const rows = (await prisma.shiftOverride.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: rows } });
    await deleteWithDependents("ShiftOverride", rows);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("RawPunch", (await prisma.rawPunch.findMany({ where: { deviceId }, select: { id: true } })).map((r) => r.id));
    await deleteWithDependents("IngestionBatch", [batchId]);
    await deleteWithDependents("Device", [deviceId]);
    await deleteWithDependents("Shift", [lateShiftId, otherShiftId, inactiveShiftId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("is for HR with attendance.override.manage only", async () => {
    for (const t of [tok.exec, tok.emp]) {
      expect((await request(app).post("/api/attendance/shift-overrides/preview").set(...authHeader(t)).send(body([p.s], DAY))).status).toBe(403);
      expect((await request(app).get("/api/attendance/shift-overrides").set(...authHeader(t))).status).toBe(403);
    }
  });

  it("previews each day from its shift to the new one and what the day would become, leaving the actor's own days out", async () => {
    const res = await hr().post("/shift-overrides/preview", body([p.s, p.hr], DAY));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 1, ownLeftOut: 1, shift: `L${tag} 14:00–23:00` });
    expect(res.body.rows[0]).toMatchObject({ employeeCode: p.s.employeeCode, date: DAY, shiftBefore: "GEN" });
    expect(await prisma.shiftOverride.count({ where: { employeeId: p.s.employeeId } })).toBe(0); // a preview writes nothing
  });

  it("applies: the day is computed against the override shift, marked as such, with one audit row", async () => {
    const before = await dayRow(p.s, DAY);
    expect(before.shiftCode).toBe("GEN");
    expect(before.lateInMinutes).toBeGreaterThan(200); // 14:10 against a 10:00 start
    const res = await confirm(body([p.s], DAY));
    expect(res.status).toBe(200);
    const row = await dayRow(p.s, DAY);
    expect(row.shiftCode).toBe(`L${tag}`);
    expect(row.shiftStart).toBe("14:00");
    expect(row.shiftOverrideRef).not.toBeNull();
    expect(row.lateInMinutes).toBeLessThanOrEqual(10);
    expect(await prisma.auditLog.count({ where: { action: "attendance.shift_override.set", entityId: row.shiftOverrideRef! } })).toBe(1);
    // The day detail says the shift came from an override.
    const t = await loginAs(p.s.employeeCode);
    const detail = await request(app).get(`/api/attendance/me/day/${DAY}`).set(...authHeader(t));
    expect(detail.body.shiftOverride).toMatchObject({ reason: "Covering the late counter that day" });
    expect(detail.body.shift.code).toBe(`L${tag}`);
    // The other days are untouched.
    expect((await dayRow(p.s, OTHER_DAY)).shiftOverrideRef).toBeNull();
  });

  it("supersedes: a second shift for the same day wins and both stay on record", async () => {
    expect((await confirm(body([p.s], DAY, { shiftId: otherShiftId, note: "Changed to the early shift instead" }))).status).toBe(200);
    expect((await dayRow(p.s, DAY)).shiftCode).toBe(`M${tag}`);
    const history = await hr().get(`/shift-overrides?employeeId=${p.s.employeeId}`);
    expect(history.body.total).toBe(2);
    expect(history.body.entries.map((e: { inForce: boolean }) => e.inForce)).toEqual([true, false]);
  });

  it("clearing goes back to the assignment's shift and is itself on record", async () => {
    const res = await hr().post("/shift-overrides/clear", { employeeId: p.s.employeeId, date: DAY, note: "Back to the normal shift" });
    expect(res.status).toBe(200);
    const row = await dayRow(p.s, DAY);
    expect(row).toMatchObject({ shiftCode: "GEN", shiftOverrideRef: null });
    expect(await prisma.shiftOverride.count({ where: { employeeId: p.s.employeeId, date: d(DAY), shiftId: null } })).toBe(1);
    expect((await hr().post("/shift-overrides/clear", { employeeId: p.s.employeeId, date: DAY, note: "Again, for nothing" })).status).toBe(409);
    expect((await hr().post("/shift-overrides/clear", { employeeId: p.hr.employeeId, date: DAY, note: "My own shift, no" })).status).toBe(403);
  });

  it("can look forward (a swap next week), and its horizon is the same as a scheduled assignment change", async () => {
    const future = await hr().post("/shift-overrides/preview", body([p.t], "2026-10-02"));
    expect(future.body.count).toBe(1);
    expect(future.body.rows[0].statusAfter).toBeNull(); // computed when the day arrives
    const far = await hr().post("/shift-overrides/preview", body([p.t], "2027-12-01"));
    expect(far.body.cannotOverride[0].code).toBe("TOO_FAR");
    expect((await hr().post("/shift-overrides/preview", body([p.t], "2026-07-01"))).body.cannotOverride[0].code).toBe("TOO_OLD");
  });

  it("refuses the shift it is already on, an inactive shift, a finalised day, a day with a request waiting and a changed set", async () => {
    expect((await hr().post("/shift-overrides/preview", body([p.t], OTHER_DAY, { shiftId: (await prisma.shift.findFirstOrThrow({ where: { code: "GEN" } })).id }))).body.cannotOverride[0].code).toBe("SAME_SHIFT");
    expect((await hr().post("/shift-overrides/preview", body([p.t], OTHER_DAY, { shiftId: inactiveShiftId }))).status).toBe(400);

    const key = { employeeId_date: { employeeId: p.t.employeeId, date: d(OTHER_DAY) } };
    const b = body([p.t], OTHER_DAY);
    const preview = await hr().post("/shift-overrides/preview", b);
    await prisma.dailyAttendance.update({ where: key, data: { isLocked: true } });
    try {
      expect((await hr().post("/shift-overrides/preview", b)).body.cannotOverride[0].code).toBe("LOCKED");
      const stale = await hr().post("/shift-overrides", { ...b, fingerprint: preview.body.fingerprint, confirm: true });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("SELECTION_CHANGED");
    } finally {
      await prisma.dailyAttendance.update({ where: key, data: { isLocked: false } });
    }
    const r = await prisma.regularizationRequest.create({ data: { employeeId: p.t.employeeId, date: d(OTHER_DAY), reasonCode: "FORGOT_TO_PUNCH", inTime: "09:50", outTime: "19:05", raisedByUserId: p.t.userId } });
    try {
      expect((await hr().post("/shift-overrides/preview", b)).body.cannotOverride[0].code).toBe("PENDING_EXISTS");
    } finally {
      await deleteWithDependents("RegularizationRequest", [r.id]);
    }
  });

  it("the override rows can't be edited", async () => {
    await expect(prisma.shiftOverride.updateMany({ where: { employeeId: p.s.employeeId }, data: { reason: "changed" } })).rejects.toThrow(/APPEND_ONLY/);
  });
});
