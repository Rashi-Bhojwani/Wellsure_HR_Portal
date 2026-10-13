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
import { finalisationBlockers } from "../finalisation";

// Regularization, complete (Phase 3 commit 1, docs/plans/PHASE_3.md): one request type for any correctable
// device-capture day: no punches at all, wrong times, a wrong status. "Today" is pinned to Wed 30 Sep 2026, so
// September is the current cycle and August the previous one.
type Person = { employeeId: string; employeeCode: string; userId: string };
const TODAY = "2026-09-30";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time.length === 5 ? `${time}:00` : time}`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);

describe("regularization for any correctable day (Phase 3 commit 1)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"dev" | "leaver" | "manual" | "hr" | "emp", Person>;
  const tok = {} as Record<"dev" | "hr" | "emp" | "manual", string>;
  let deviceId = "";
  let batchId = "";
  let savedSettings: unknown = null;

  const as = (t: string) => ({
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(t)).send(b),
  });
  const raise = (t: string, body: object) => as(t).post("/me/regularizations", { reasonCode: "FORGOT_TO_PUNCH", ...body });
  const punch = (who: Person, date: string, time: string) =>
    prisma.rawPunch.create({
      data: { deviceId, deviceUserId: who.employeeCode, punchedAt: ist(date, time), localTime: `${date} ${time}:00`, businessDate: d(date), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: who.employeeId },
    });
  const dayRow = (who: Person, date: string) => prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: who.employeeId, date: d(date) } } });
  const decide = (t: string, id: string, verb: "approve" | "reject", note?: string) => as(t).post(`/regularizations/${id}/${verb}`, note ? { note } : {});

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    p.dev = await createFullTestEmployee(org);
    p.leaver = await createFullTestEmployee(org); // on approved leave one day
    p.manual = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.manual.employeeId } });
    for (const k of ["dev", "hr", "emp", "manual"] as const) tok[k] = await loginAs(p[k].employeeCode);
    savedSettings = (await prisma.systemSetting.findUnique({ where: { key: REGULARIZATION_SETTING_KEY } }))?.value ?? null;
    await setSetting(REGULARIZATION_SETTING_KEY, DEFAULT_REGULARIZATION_SETTINGS, p.hr.userId);

    deviceId = (await prisma.device.create({ data: { serialNumber: `REG-${tag}`, name: "Regularization test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    // dev: 14 Sep punched with a device clock that ran late; 15 and 16 Sep the device was down (no punches); 18 Sep finalised;
    // 21 Sep punched normally; 12 Aug and 31 Jul have no punches.
    await punch(p.dev, "2026-09-14", "10:45");
    await punch(p.dev, "2026-09-14", "19:00");
    await punch(p.dev, "2026-09-21", "10:00");
    await punch(p.dev, "2026-09-21", "19:00");
    const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
    await prisma.leaveRequest.create({ data: { employeeId: p.leaver.employeeId, leaveTypeId: pl.id, fromDate: d("2026-09-17"), toDate: d("2026-09-17"), totalDays: 1, status: "APPROVED", appliedByUserId: p.leaver.userId } });
    await computeAttendance([p.dev.employeeId, p.leaver.employeeId, p.manual.employeeId, p.hr.employeeId], "2026-07-25", TODAY);
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.dev.employeeId, date: d("2026-09-18") } }, data: { isLocked: true } });
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    if (savedSettings === null) await prisma.systemSetting.deleteMany({ where: { key: REGULARIZATION_SETTING_KEY } });
    else await prisma.systemSetting.update({ where: { key: REGULARIZATION_SETTING_KEY }, data: { value: savedSettings as never } });
    await purgeAppendOnly("AuditLog", { entityId: { in: ["regularization"] } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: Object.values(p).map((x) => x.employeeId) } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("the request itself", () => {
    it("takes exactly one kind of correction (times or a status), a reason code, and a note when the reason is Other", async () => {
      const day = "2026-09-15";
      expect((await raise(tok.dev, { date: day, note: "x" })).status).toBe(400); // nothing to correct
      expect((await raise(tok.dev, { date: day, inTime: "10:00", outTime: "19:00", status: "P" })).status).toBe(400); // both kinds
      expect((await raise(tok.dev, { date: day, status: "B" })).status).toBe(400);
      expect((await raise(tok.dev, { date: day, reasonCode: "OTHER", status: "P" })).status).toBe(400); // Other needs a note
      expect((await raise(tok.dev, { date: day, reasonCode: "NOPE", status: "P" })).status).toBe(400);
      expect((await raise(tok.dev, { date: day, inTime: "9:5", outTime: "19:00" })).status).toBe(400);
    });

    it("a day with no punches at all (the device was down) needs both times, then recomputes like a timed day; raw punches untouched", async () => {
      const day = "2026-09-15";
      expect(await dayRow(p.dev, day)).toMatchObject({ status: "A", punchCount: 0 });
      const lone = await raise(tok.dev, { date: day, reasonCode: "DEVICE_DOWN", outTime: "19:00" });
      expect(lone.status).toBe(400);
      expect(lone.body.error.message).toMatch(/no punches that day, so give both/);
      const res = await raise(tok.dev, { date: day, reasonCode: "DEVICE_DOWN", note: "The device was off for the morning", inTime: "10:00", outTime: "19:00" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ reasonCode: "DEVICE_DOWN", inTime: "10:00", outTime: "19:00", targetStatus: null, status: "PENDING" });
      // Nobody approves their own; the employee cannot; an ordinary employee cannot; HR can.
      expect((await decide(tok.dev, res.body.id, "approve")).status).toBe(403);
      expect((await decide(tok.emp, res.body.id, "approve")).status).toBe(403);
      expect((await decide(tok.hr, res.body.id, "approve", "Confirmed against the paper register")).status).toBe(200);
      expect(await dayRow(p.dev, day)).toMatchObject({ status: "P", source: "OVERRIDE", overrideKind: "REGULARIZATION", firstIn: ist(day, "10:00"), lastOut: ist(day, "19:00"), exceptionFlags: [], lopDays: expect.anything() });
      expect(await prisma.rawPunch.count({ where: { employeeId: p.dev.employeeId, businessDate: d(day) } })).toBe(0);
      const override = await prisma.attendanceOverride.findFirstOrThrow({ where: { employeeId: p.dev.employeeId, date: d(day) } });
      expect(override).toMatchObject({ origin: "REGULARIZATION", kind: "TIMES", inTime: "10:00", outTime: "19:00", requestId: res.body.id, createdByUserId: p.hr.userId });
      const detail = (await as(tok.dev).get(`/me/day/${day}`)).body;
      expect(detail.override).toMatchObject({ origin: "REGULARIZATION", kind: "TIMES", text: "In 10:00 · Out 19:00", reasonLabel: "Device was down", reason: "The device was off for the morning" });
      expect(detail.source).toBe("OVERRIDE");
      expect(await prisma.auditLog.count({ where: { entityId: res.body.id, action: "attendance.regularization.approved" } })).toBe(1);
    });

    it("wrong times: both times replace the device's for the day (the punches stay on record), so a late-stamped 10:45 is no longer late", async () => {
      const day = "2026-09-14";
      expect(await dayRow(p.dev, day)).toMatchObject({ source: "DEVICE", exceptionFlags: expect.arrayContaining(["LATE_IN"]) });
      const res = await raise(tok.dev, { date: day, note: "The device clock ran 45 minutes slow", inTime: "10:00", outTime: "19:00" });
      expect(res.status).toBe(201);
      await decide(tok.hr, res.body.id, "approve");
      const after = await dayRow(p.dev, day);
      expect(after).toMatchObject({ status: "P", source: "OVERRIDE", firstIn: ist(day, "10:00"), lastOut: ist(day, "19:00") });
      expect(after.exceptionFlags).not.toContain("LATE_IN");
      expect(await prisma.rawPunch.count({ where: { employeeId: p.dev.employeeId, businessDate: d(day) } })).toBe(2);
      expect((await as(tok.dev).get(`/me/day/${day}`)).body.punches.map((x: { time: string }) => x.time)).toEqual(["10:45:00", "19:00:00"]); // exactly what arrived
    });

    it("a wrong status: on duty elsewhere sets the day present, with no figures", async () => {
      const day = "2026-09-16";
      const res = await raise(tok.dev, { date: day, reasonCode: "ON_DUTY_ELSEWHERE", note: "At the client site all day", status: "P" });
      expect(res.status).toBe(201);
      await decide(tok.hr, res.body.id, "approve");
      expect(await dayRow(p.dev, day)).toMatchObject({ status: "P", source: "OVERRIDE", firstIn: null, lateInMinutes: null, punchCount: 0 });
      const queue = (await as(tok.hr).get("/regularizations?status=APPROVED")).body.requests;
      expect(queue.find((r: { id: string }) => r.id === res.body.id)).toMatchObject({ reasonCode: "ON_DUTY_ELSEWHERE", reasonLabel: "On duty elsewhere", targetStatus: "P", correctionText: "Present", reason: "At the client site all day" });
    });

    it("a rejected request leaves the day alone, and the day can be asked for again", async () => {
      const day = "2026-09-21";
      const res = await raise(tok.dev, { date: day, status: "A", note: "Mistaken" });
      expect((await decide(tok.hr, res.body.id, "reject", "Punches show you were in")).status).toBe(200);
      expect(await dayRow(p.dev, day)).toMatchObject({ status: "P", source: "DEVICE", overrideKind: null });
      expect((await raise(tok.dev, { date: day, status: "HD_SECOND", note: "Left at lunch" })).status).toBe(201);
    });
  });

  describe("which days can be corrected", () => {
    it("not a week-off, a day on leave, a finalised day, a day marked by hand, the future, or one already corrected", async () => {
      const eligibility = async (who: Person, tokenOf: string, date: string) => (await as(tokenOf).get(`/me/regularizations/eligibility?date=${date}`)).body;
      expect(await eligibility(p.dev, tok.dev, "2026-09-20")).toMatchObject({ ok: false, code: "OFF_DAY" }); // a Sunday
      const leaverTok = await loginAs(p.leaver.employeeCode);
      expect(await eligibility(p.leaver, leaverTok, "2026-09-17")).toMatchObject({ ok: false, code: "ON_LEAVE" });
      expect(await eligibility(p.dev, tok.dev, "2026-09-18")).toMatchObject({ ok: false, code: "LOCKED" });
      expect(await eligibility(p.manual, tok.manual, "2026-09-15")).toMatchObject({ ok: false, code: "MANUAL_CAPTURE" });
      expect(await eligibility(p.dev, tok.dev, TODAY)).toMatchObject({ ok: false, code: "NOT_OVER" });
      expect(await eligibility(p.dev, tok.dev, "2026-09-15")).toMatchObject({ ok: false, code: "ALREADY_CORRECTED" });
      expect((await raise(tok.dev, { date: "2026-09-20", status: "P", note: "x" })).status).toBe(409);
    });

    it("an approval is refused if the day has since been finalised or put on leave (the correction would have no effect)", async () => {
      const day = "2026-09-22";
      const res = await raise(tok.dev, { date: day, inTime: "10:00", outTime: "19:00" });
      expect(res.status).toBe(201);
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.dev.employeeId, date: d(day) } }, data: { isLocked: true } });
      const refused = await decide(tok.hr, res.body.id, "approve");
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("LOCKED");
      expect((await prisma.regularizationRequest.findUniqueOrThrow({ where: { id: res.body.id } })).status).toBe("PENDING");
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.dev.employeeId, date: d(day) } }, data: { isLocked: false } });
      expect((await decide(tok.hr, res.body.id, "reject", "not needed")).status).toBe(200);
    });

    it("backdating reaches the current and the previous cycle (a setting), never further, never into a finalised period", async () => {
      const get = (date: string) => as(tok.dev).get(`/me/regularizations/eligibility?date=${date}`).then((r) => r.body);
      expect(await get("2026-08-12")).toMatchObject({ ok: true, earliest: "2026-08-01" });
      expect(await get("2026-07-31")).toMatchObject({ ok: false, code: "TOO_OLD" });
      await setSetting(REGULARIZATION_SETTING_KEY, { ...DEFAULT_REGULARIZATION_SETTINGS, backdateCycles: 0 }, p.hr.userId);
      expect(await get("2026-08-12")).toMatchObject({ ok: false, code: "TOO_OLD" });
      expect(await get("2026-09-23")).toMatchObject({ ok: true, earliest: "2026-09-01" });
      await setSetting(REGULARIZATION_SETTING_KEY, { ...DEFAULT_REGULARIZATION_SETTINGS, backdateCycles: 2 }, p.hr.userId);
      expect(await get("2026-07-31")).toMatchObject({ ok: true, earliest: "2026-07-01" });
      await setSetting(REGULARIZATION_SETTING_KEY, DEFAULT_REGULARIZATION_SETTINGS, p.hr.userId);
    });
  });

  describe("finalisation and settings", () => {
    it("a pending request blocks finalising its period, and says which day", async () => {
      const res = await raise(tok.dev, { date: "2026-09-23", status: "P", note: "On a site visit" });
      expect(res.status).toBe(201);
      const blockers = await finalisationBlockers("2026-09-01", "2026-09-30");
      expect(blockers.find((b) => b.code === "PENDING_REGULARIZATIONS")).toMatchObject({ count: expect.any(Number) });
      await decide(tok.hr, res.body.id, "reject", "Not needed");
    });

    it("the Regularization settings are read and changed by settings.manage only, and rejected when nonsense", async () => {
      const get = (t: string) => request(app).get("/api/settings/regularization").set(...authHeader(t));
      const put = (t: string, b: object) => request(app).put("/api/settings/regularization").set(...authHeader(t)).send(b);
      expect((await get(tok.emp)).status).toBe(403);
      expect((await put(tok.emp, { backdateCycles: 2 })).status).toBe(403);
      expect((await get(tok.hr)).body).toEqual(DEFAULT_REGULARIZATION_SETTINGS);
      expect((await put(tok.hr, { backdateCycles: 9 })).status).toBe(400);
      expect((await put(tok.hr, { bulkMaxEmployeeDays: 0 })).status).toBe(400);
      const ok = await put(tok.hr, { bulkMaxRangeDays: 14 });
      expect(ok.body).toEqual({ ...DEFAULT_REGULARIZATION_SETTINGS, bulkMaxRangeDays: 14 });
      expect((await put(tok.hr, { bulkMaxRangeDays: 31 })).status).toBe(200);
    });
  });
});
