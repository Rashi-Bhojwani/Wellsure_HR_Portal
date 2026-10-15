import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { DEFAULT_REGULARIZATION_SETTINGS, REGULARIZATION_SETTING_KEY } from "../../../lib/regularizationSettings";
import { setSetting } from "../../../lib/settings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { consumeCompOffFifo } from "../../leave/compOff";
import { getLeaveBalance, writeLedgerEntry } from "../../leave/ledger";
import { cancelLeaveRequest } from "../../leave/requests";
import { computeAttendance } from "../compute";

// Manual Override (Phase 3 commit 2): HR sets a day directly after a preview, and — the case the user asked for — a day of
// approved leave that the person actually worked can be corrected with the leave released and the balance returned,
// as one explicit action. "Today" is Wed 30 Sep 2026.
type Person = { employeeId: string; employeeCode: string; userId: string };
const TODAY = "2026-09-30";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);
const LEAVE_DAY = "2026-09-15"; // Tue
const TWO_DAYS = ["2026-09-21", "2026-09-22"]; // Mon, Tue
const COF_DAY = "2026-09-23"; // Wed
const SUPERSEDE_DAY = "2026-09-24"; // Thu
const HOLIDAY = "2026-09-08"; // Tue
const FOLLOW_DAY = "2026-09-18"; // Fri

describe("Manual Override (Phase 3 commit 2)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"lv" | "two" | "cof" | "fd" | "w" | "hr" | "exec" | "emp", Person>;
  const tok = {} as Record<"hr" | "exec" | "emp", string>;
  let deviceId = "";
  let batchId = "";
  let savedSettings: unknown = null;
  let holidayId: string | null = null;
  let weekOffDay = "";
  const requestIds: Record<string, string> = {};
  let plId = "";

  const hr = () => ({
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(tok.hr)).send(b),
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(tok.hr)),
  });
  const body = (who: Person[], date: string, over: object = {}) => ({
    selection: { employeeIds: who.map((x) => x.employeeId) },
    from: date,
    to: date,
    reasonCode: "ON_DUTY_ELSEWHERE",
    note: "Worked at the client site that day",
    releaseLeave: false,
    status: "P",
    ...over,
  });
  const confirm = async (b: ReturnType<typeof body>) => {
    const preview = await hr().post("/overrides/preview", b);
    expect(preview.status).toBe(200);
    return hr().post("/overrides", { ...b, fingerprint: preview.body.fingerprint, confirm: true });
  };
  const dayRow = (who: Person, date: string) => prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: who.employeeId, date: d(date) } } });
  const balance = async (who: Person) => Number(await getLeaveBalance(prisma, who.employeeId, plId, d(TODAY)));
  const punch = (who: Person, date: string, time: string) =>
    prisma.rawPunch.create({
      data: { deviceId, deviceUserId: who.employeeCode, punchedAt: ist(date, time), localTime: `${date} ${time}:00`, businessDate: d(date), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: who.employeeId },
    });
  /** An approved PL request and the ledger line its approval writes. */
  const approvedLeave = async (who: Person, from: string, to: string, totalDays: number, typeId = plId) => {
    const r = await prisma.leaveRequest.create({ data: { employeeId: who.employeeId, leaveTypeId: typeId, fromDate: d(from), toDate: d(to), totalDays, status: "APPROVED", appliedByUserId: who.userId } });
    return r;
  };

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    for (const k of ["lv", "two", "cof", "fd", "w"] as const) p[k] = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.exec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    for (const k of ["hr", "exec", "emp"] as const) tok[k] = await loginAs(p[k].employeeCode);
    savedSettings = (await prisma.systemSetting.findUnique({ where: { key: REGULARIZATION_SETTING_KEY } }))?.value ?? null;
    await setSetting(REGULARIZATION_SETTING_KEY, DEFAULT_REGULARIZATION_SETTINGS, p.hr.userId);

    deviceId = (await prisma.device.create({ data: { serialNumber: `OVR-${tag}`, name: "Override test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    plId = (await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } })).id;
    const cofId = (await prisma.leaveType.findFirstOrThrow({ where: { code: "COF" } })).id;

    // A holiday to work on.
    const existing = await prisma.holiday.findUnique({ where: { date: d(HOLIDAY) } });
    if (!existing) holidayId = (await prisma.holiday.create({ data: { date: d(HOLIDAY), name: `Override test holiday ${tag}` } })).id;

    // Everyone has 5 days of PL in the ledger; leave requests are approved and consumed.
    for (const x of [p.lv, p.two, p.fd]) await writeLedgerEntry(prisma, { employeeId: x.employeeId, leaveTypeId: plId, leaveYear: 2026, entryDate: d("2026-01-01"), entryType: "GRANT", days: 5, referenceType: "MANUAL_GRANT" });
    const single = await approvedLeave(p.lv, LEAVE_DAY, LEAVE_DAY, 1);
    await writeLedgerEntry(prisma, { employeeId: p.lv.employeeId, leaveTypeId: plId, leaveYear: 2026, entryDate: d(LEAVE_DAY), entryType: "CONSUMED", days: -1, referenceType: "LEAVE_REQUEST", referenceId: single.id });
    requestIds.single = single.id;
    const two = await approvedLeave(p.two, TWO_DAYS[0]!, TWO_DAYS[1]!, 2);
    await writeLedgerEntry(prisma, { employeeId: p.two.employeeId, leaveTypeId: plId, leaveYear: 2026, entryDate: d(TWO_DAYS[0]!), entryType: "CONSUMED", days: -2, referenceType: "LEAVE_REQUEST", referenceId: two.id });
    requestIds.two = two.id;

    const follow = await approvedLeave(p.fd, FOLLOW_DAY, FOLLOW_DAY, 1);
    await writeLedgerEntry(prisma, { employeeId: p.fd.employeeId, leaveTypeId: plId, leaveYear: 2026, entryDate: d(FOLLOW_DAY), entryType: "CONSUMED", days: -1, referenceType: "LEAVE_REQUEST", referenceId: follow.id });
    requestIds.follow = follow.id;
    await punch(p.fd, FOLLOW_DAY, "10:04");
    await punch(p.fd, FOLLOW_DAY, "19:10");

    // Comp-off: one lot of 2 days earned on a holiday, 1 day of it used on COF_DAY.
    const grant = await writeLedgerEntry(prisma, { employeeId: p.cof.employeeId, leaveTypeId: cofId, leaveYear: 2026, entryDate: d("2026-09-01"), entryType: "GRANT", days: 2, referenceType: "MANUAL_GRANT" });
    const lot = await prisma.compOffCredit.create({ data: { employeeId: p.cof.employeeId, earnedDate: d("2026-09-01"), earnedDays: 2, remainingDays: 2, expiresOn: d("2026-12-31"), source: "MANUAL_GRANT", ledgerEntryId: grant.id } });
    const cofReq = await approvedLeave(p.cof, COF_DAY, COF_DAY, 1, cofId);
    await prisma.$transaction((tx) => consumeCompOffFifo(tx, p.cof.employeeId, cofReq.id, 1, 2026, d(COF_DAY)));
    requestIds.cof = cofReq.id;
    requestIds.cofLot = lot.id;

    // Everyone worked (device punches) on the days the tests look at, except where noted.
    for (const date of [LEAVE_DAY, ...TWO_DAYS, COF_DAY]) {
      for (const x of [p.lv, p.two, p.cof]) {
        await punch(x, date, "10:00");
        await punch(x, date, "19:00");
      }
    }
    for (const date of [SUPERSEDE_DAY, HOLIDAY]) {
      await punch(p.w, date, "10:00");
      await punch(p.w, date, "19:00");
    }
    await computeAttendance([p.lv, p.two, p.cof, p.fd, p.w, p.hr].map((x) => x.employeeId), "2026-09-01", TODAY);
    const week = await prisma.dailyAttendance.findFirstOrThrow({ where: { employeeId: p.w.employeeId, source: "WEEK_OFF", date: { gte: d("2026-09-09"), lte: d("2026-09-29") } } });
    weekOffDay = week.date.toISOString().slice(0, 10);
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    if (savedSettings === null) await prisma.systemSetting.deleteMany({ where: { key: REGULARIZATION_SETTING_KEY } });
    else await prisma.systemSetting.update({ where: { key: REGULARIZATION_SETTING_KEY }, data: { value: savedSettings as never } });
    const ids = Object.values(p).map((x) => x.employeeId);
    const overrideIds = (await prisma.attendanceOverride.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    const releaseIds = (await prisma.leaveDayRelease.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...overrideIds, ...releaseIds, ...Object.values(requestIds)] } });
    await deleteWithDependents("LeaveDayRelease", releaseIds);
    await deleteWithDependents("AttendanceOverride", overrideIds);
    await prisma.leaveLedger.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.compOffCredit.deleteMany({ where: { employeeId: { in: ids } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    if (holidayId) await prisma.holiday.delete({ where: { id: holidayId } });
    await deleteWithDependents("RawPunch", (await prisma.rawPunch.findMany({ where: { deviceId }, select: { id: true } })).map((r) => r.id));
    await deleteWithDependents("IngestionBatch", [batchId]);
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("who can, and the preview", () => {
    it("is for HR with attendance.override.manage only", async () => {
      for (const t of [tok.exec, tok.emp]) {
        expect((await request(app).post("/api/attendance/overrides/preview").set(...authHeader(t)).send(body([p.w], SUPERSEDE_DAY))).status).toBe(403);
        expect((await request(app).get("/api/attendance/overrides").set(...authHeader(t))).status).toBe(403);
      }
    });

    it("leaves a day of approved leave out unless the release is ticked, and says what to do", async () => {
      const res = await hr().post("/overrides/preview", body([p.lv], LEAVE_DAY));
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.cannotOverride).toEqual([expect.objectContaining({ code: "ON_LEAVE", count: 1, label: expect.stringContaining("tick") })]);
    });

    it("with the release ticked shows the day becoming Present and the leave days that would go back", async () => {
      const res = await hr().post("/overrides/preview", body([p.lv], LEAVE_DAY, { releaseLeave: true }));
      expect(res.body).toMatchObject({ count: 1, leaveDaysReleased: 1 });
      expect(res.body.rows[0]).toMatchObject({ employeeCode: p.lv.employeeCode, date: LEAVE_DAY, before: "PL", after: "P", leave: [{ type: "PL", days: 1 }] });
      expect(await balance(p.lv)).toBe(4); // a preview changes nothing
      expect(await prisma.leaveDayRelease.count({ where: { employeeId: p.lv.employeeId } })).toBe(0);
    });

    it("leaves the actor's own days out, counted", async () => {
      const res = await hr().post("/overrides/preview", body([p.hr, p.w], SUPERSEDE_DAY));
      expect(res.body.ownLeftOut).toBe(1);
      expect(res.body.rows.map((r: { employeeCode: string }) => r.employeeCode)).toEqual([p.w.employeeCode]);
    });

    it("refuses to touch a day that isn't over or is older than corrections reach, and a range that is too wide", async () => {
      expect((await hr().post("/overrides/preview", body([p.w], TODAY))).body.cannotOverride[0].code).toBe("NOT_OVER");
      expect((await hr().post("/overrides/preview", body([p.w], "2026-07-01"))).body.cannotOverride[0].code).toBe("TOO_OLD");
      const wide = await hr().post("/overrides/preview", body([p.w], "2026-08-01", { to: "2026-09-29" }));
      expect(wide.status).toBe(400);
      expect(wide.body.error.code).toBe("TOO_WIDE");
    });
  });

  describe("leave day worked: one explicit action, both sides", () => {
    it("writes the override, the release and the ledger reversal together; the day reads worked and the balance comes back", async () => {
      const before = await balance(p.lv);
      const res = await confirm(body([p.lv], LEAVE_DAY, { releaseLeave: true }));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ days: 1, employees: 1, leaveDaysReleased: 1 });

      const row = await dayRow(p.lv, LEAVE_DAY);
      expect(row).toMatchObject({ status: "P", overrideKind: "MANUAL_OVERRIDE", leaveTypeCode: null });
      expect(row.source).toBe("OVERRIDE");

      const release = await prisma.leaveDayRelease.findFirstOrThrow({ where: { employeeId: p.lv.employeeId, date: d(LEAVE_DAY) } });
      expect(release).toMatchObject({ leaveRequestId: requestIds.single, dayPart: "FULL", reason: "Worked at the client site that day" });
      expect(Number(release.days)).toBe(1);
      expect(release.overrideId).toBe(row.overrideRef);

      const reversal = await prisma.leaveLedger.findFirstOrThrow({ where: { employeeId: p.lv.employeeId, entryType: "REVERSAL" } });
      expect(reversal).toMatchObject({ referenceType: "LEAVE_DAY_RELEASE", referenceId: release.id });
      expect(Number(reversal.days)).toBe(1);
      expect(reversal.remarks).toContain(LEAVE_DAY);
      expect(await balance(p.lv)).toBe(before + 1);

      // One audit row per employee-day, and one for the release in the leave trail.
      expect(await prisma.auditLog.count({ where: { action: "attendance.override.manual", entityId: release.overrideId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: "leave.day_released", entityId: release.id } })).toBe(1);
    });

    it("shows in the leave ledger the employee reads, with the date and the reason", async () => {
      const t = await loginAs(p.lv.employeeCode);
      const res = await request(app).get("/api/leave/ledger").set(...authHeader(t));
      expect(res.status).toBe(200);
      const line = res.body.entries.find((e: { entryType: string }) => e.entryType === "REVERSAL");
      expect(line).toMatchObject({ days: 1, leaveTypeCode: "PL", releasedDate: LEAVE_DAY, description: expect.stringContaining("worked on a day of approved leave") });
      expect(line.remarks).toContain("Worked at the client site that day");
    });

    it("shows on the attendance day as corrected by hand, with the leave released", async () => {
      const t = await loginAs(p.lv.employeeCode);
      const res = await request(app).get(`/api/attendance/me/day/${LEAVE_DAY}`).set(...authHeader(t));
      expect(res.body.override).toMatchObject({ origin: "MANUAL_OVERRIDE", reason: "Worked at the client site that day" });
      expect(res.body.leaveReleased).toEqual([expect.objectContaining({ type: "PL", days: 1 })]);
    });

    it("a second override of that day can change it again but never un-releases the leave; clearing is refused", async () => {
      const again = await confirm(body([p.lv], LEAVE_DAY, { status: "HD_FIRST", note: "Actually only the first half" }));
      expect(again.status).toBe(200);
      expect((await dayRow(p.lv, LEAVE_DAY)).status).toBe("P:A");
      const clear = await hr().post("/overrides/clear", { employeeId: p.lv.employeeId, date: LEAVE_DAY, note: "Take it back to the device" });
      expect(clear.status).toBe(409);
      expect(clear.body.error.code).toBe("RELEASE_STANDS");
      expect(await prisma.leaveDayRelease.count({ where: { employeeId: p.lv.employeeId } })).toBe(1);
    });

    it("a released leave day can't be set to Absent, and a refused day writes nothing", async () => {
      const res = await hr().post("/overrides/preview", body([p.two], TWO_DAYS[1]!, { releaseLeave: true, status: "A" }));
      expect(res.body.count).toBe(0);
      expect(res.body.cannotOverride[0].code).toBe("LEAVE_NOT_ABSENT");
    });

    it("cancelling the whole request afterwards returns only what is still consumed (not the released day twice)", async () => {
      // Two-day request: release the first day, then cancel the request.
      await confirm(body([p.two], TWO_DAYS[0]!, { releaseLeave: true }));
      expect(await balance(p.two)).toBe(4); // 5 - 2 + 1
      const hrViewer = { userId: p.hr.userId, employeeId: p.hr.employeeId, permissions: new Set(["leave.approve"]), dataScope: "ALL" as const };
      await cancelLeaveRequest(requestIds.two!, hrViewer as never, "Plans changed", { actorUserId: p.hr.userId, ipAddress: null, userAgent: null });
      expect(await balance(p.two)).toBe(5); // 4 + the one day still consumed, not +2
    });

    it("'follow the device' releases the leave but keeps the person's real punches as the day's times", async () => {
      // It only makes sense with the release, and only on a day that has leave.
      const alone = await hr().post("/overrides/preview", { selection: { employeeIds: [p.fd.employeeId] }, from: FOLLOW_DAY, to: FOLLOW_DAY, reasonCode: "OTHER", note: "Came in all day", releaseLeave: false, followDevice: true });
      expect(alone.status).toBe(400);
      const none = await hr().post("/overrides/preview", { selection: { employeeIds: [p.w.employeeId] }, from: SUPERSEDE_DAY, to: SUPERSEDE_DAY, reasonCode: "OTHER", note: "Nothing to release here", releaseLeave: true, followDevice: true });
      expect(none.body.cannotOverride[0].code).toBe("NOTHING_TO_RELEASE");

      const before = await balance(p.fd);
      const res = await confirm(body([p.fd], FOLLOW_DAY, { releaseLeave: true, followDevice: true, status: undefined }));
      expect(res.status).toBe(200);
      const row = await dayRow(p.fd, FOLLOW_DAY);
      expect(row).toMatchObject({ status: "P", overrideKind: "MANUAL_OVERRIDE", leaveTypeCode: null, source: "DEVICE", punchCount: 2 });
      expect(row.firstIn!.toISOString()).toBe(ist(FOLLOW_DAY, "10:04").toISOString()); // the device's own times, not a status
      expect(await prisma.attendanceOverride.count({ where: { employeeId: p.fd.employeeId, kind: "RELEASE_ONLY" } })).toBe(1);
      expect(await balance(p.fd)).toBe(before + 1);
      // Still marked as not purely the device's, and removal is refused like any release.
      expect((await hr().post("/overrides/clear", { employeeId: p.fd.employeeId, date: FOLLOW_DAY, note: "Take it back" })).body.error.code).toBe("RELEASE_STANDS");
      const t = await loginAs(p.fd.employeeCode);
      const detail = await request(app).get(`/api/attendance/me/day/${FOLLOW_DAY}`).set(...authHeader(t));
      expect(detail.body.override).toMatchObject({ origin: "MANUAL_OVERRIDE", text: expect.stringContaining("As the device recorded") });
    });

    it("restores comp-off to the very lot it was taken from", async () => {
      await confirm(body([p.cof], COF_DAY, { releaseLeave: true }));
      const lot = await prisma.compOffCredit.findUniqueOrThrow({ where: { id: requestIds.cofLot! } });
      expect(Number(lot.remainingDays)).toBe(2);
      expect(lot.status).toBe("AVAILABLE");
      const reversal = await prisma.leaveLedger.findFirstOrThrow({ where: { employeeId: p.cof.employeeId, entryType: "REVERSAL" } });
      expect(reversal).toMatchObject({ compOffCreditId: lot.id, referenceType: "LEAVE_DAY_RELEASE" });
    });

    it("is all or nothing: if the leave changes between the preview and the confirmation, nothing is written", async () => {
      const x = p.w;
      const req = await approvedLeave(x, "2026-09-17", "2026-09-17", 1);
      await writeLedgerEntry(prisma, { employeeId: x.employeeId, leaveTypeId: plId, leaveYear: 2026, entryDate: d("2026-09-17"), entryType: "CONSUMED", days: -1, referenceType: "LEAVE_REQUEST", referenceId: req.id });
      requestIds.race = req.id;
      await punch(x, "2026-09-17", "10:00");
      await punch(x, "2026-09-17", "19:00");
      await computeAttendance([x.employeeId], "2026-09-17", "2026-09-17");
      const b = body([x], "2026-09-17", { releaseLeave: true });
      const preview = await hr().post("/overrides/preview", b);
      expect(preview.body.count).toBe(1);
      await prisma.leaveRequest.update({ where: { id: req.id }, data: { status: "CANCELLED" } }); // leave cancelled by someone else
      const res = await hr().post("/overrides", { ...b, fingerprint: preview.body.fingerprint, confirm: true });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SELECTION_CHANGED");
      expect(await prisma.leaveDayRelease.count({ where: { employeeId: x.employeeId } })).toBe(0);
      expect(await prisma.attendanceOverride.count({ where: { employeeId: x.employeeId, date: d("2026-09-17") } })).toBe(0);
    });
  });

  describe("holidays, week-offs, supersede, clear", () => {
    it("a holiday or week-off accepts only 'worked' and stays H or O with the work recorded", async () => {
      expect((await hr().post("/overrides/preview", body([p.w], HOLIDAY))).body.cannotOverride[0].code).toBe("OFF_DAY_WORKED_ONLY");
      expect((await hr().post("/overrides/preview", body([p.w], SUPERSEDE_DAY, { status: "WORKED" }))).body.cannotOverride[0].code).toBe("WORKED_ON_WORKING_DAY");
      for (const date of [HOLIDAY, weekOffDay]) {
        const res = await confirm(body([p.w], date, { status: "WORKED" }));
        expect(res.status).toBe(200);
        const row = await dayRow(p.w, date);
        expect(row.status).toMatch(/^[HO]$/);
        expect(row).toMatchObject({ workedOnOffDay: true, overrideKind: "MANUAL_OVERRIDE" });
      }
    });

    it("supersedes an earlier correction: the newer row is the one in force and the history keeps both", async () => {
      expect((await confirm(body([p.w], SUPERSEDE_DAY, { status: "A", reasonCode: "OTHER", note: "Marked absent by mistake first" }))).status).toBe(200);
      const preview = await hr().post("/overrides/preview", body([p.w], SUPERSEDE_DAY));
      expect(preview.body.rows[0]).toMatchObject({ before: "A", after: "P", replaces: "MANUAL_OVERRIDE" });
      expect((await hr().post("/overrides", { ...body([p.w], SUPERSEDE_DAY), fingerprint: preview.body.fingerprint, confirm: true })).status).toBe(200);
      expect((await dayRow(p.w, SUPERSEDE_DAY)).status).toBe("P");
      const history = await hr().get(`/overrides?employeeId=${p.w.employeeId}&from=${SUPERSEDE_DAY}&to=${SUPERSEDE_DAY}`);
      expect(history.body.total).toBe(2);
      expect(history.body.entries.map((e: { inForce: boolean }) => e.inForce)).toEqual([true, false]); // newest first
    });

    it("clearing takes the day back to the device and is itself on record", async () => {
      const res = await hr().post("/overrides/clear", { employeeId: p.w.employeeId, date: SUPERSEDE_DAY, note: "Back to what the device recorded" });
      expect(res.status).toBe(200);
      const row = await dayRow(p.w, SUPERSEDE_DAY);
      expect(row).toMatchObject({ status: "P", overrideKind: null, source: "DEVICE" });
      expect(await prisma.attendanceOverride.count({ where: { employeeId: p.w.employeeId, date: d(SUPERSEDE_DAY), kind: "CLEARED" } })).toBe(1);
      expect((await hr().post("/overrides/clear", { employeeId: p.w.employeeId, date: SUPERSEDE_DAY, note: "Again, for nothing" })).status).toBe(409);
      expect((await hr().post("/overrides/clear", { employeeId: p.hr.employeeId, date: SUPERSEDE_DAY, note: "My own day, no" })).status).toBe(403);
    });

    it("a finalised day and a day with a request waiting are not overridden", async () => {
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.w.employeeId, date: d(SUPERSEDE_DAY) } }, data: { isLocked: true } });
      expect((await hr().post("/overrides/preview", body([p.w], SUPERSEDE_DAY))).body.cannotOverride[0].code).toBe("LOCKED");
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.w.employeeId, date: d(SUPERSEDE_DAY) } }, data: { isLocked: false } });
      const r = await prisma.regularizationRequest.create({ data: { employeeId: p.w.employeeId, date: d(SUPERSEDE_DAY), reasonCode: "FORGOT_TO_PUNCH", inTime: "09:50", outTime: "19:05", raisedByUserId: p.w.userId } });
      try {
        expect((await hr().post("/overrides/preview", body([p.w], SUPERSEDE_DAY))).body.cannotOverride[0].code).toBe("PENDING_EXISTS");
      } finally {
        await deleteWithDependents("RegularizationRequest", [r.id]);
      }
    });

    it("a changed set is refused at confirmation (fingerprint)", async () => {
      const b = body([p.w], SUPERSEDE_DAY);
      const preview = await hr().post("/overrides/preview", b);
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.w.employeeId, date: d(SUPERSEDE_DAY) } }, data: { isLocked: true } });
      try {
        const res = await hr().post("/overrides", { ...b, fingerprint: preview.body.fingerprint, confirm: true });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("SELECTION_CHANGED");
      } finally {
        await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.w.employeeId, date: d(SUPERSEDE_DAY) } }, data: { isLocked: false } });
      }
    });

    it("the muster export tells corrected days from device days: a marker in the cell and a sheet of what was set, why and by whom", async () => {
      const cycle = (await hr().get("/muster/cycles")).body;
      const start = (cycle.cycles?.[0] ?? cycle.current ?? cycle[0]).start as string;
      const res = await request(app)
        .get(`/api/attendance/muster/export?cycleStart=${start}`)
        .set(...authHeader(tok.hr))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual([expect.stringContaining("Muster"), "Corrected days"]);
      const grid = wb.worksheets[0]!;
      const header = grid.getRow(1).values as unknown[];
      const rowOf = (code: string) => {
        let found: ExcelJS.Row | null = null;
        grid.eachRow((row) => {
          if (String(row.getCell(1).value) === code) found = row;
        });
        return found as ExcelJS.Row | null;
      };
      const cellText = (code: string, date: string) => String(rowOf(code)!.getCell(header.findIndex((h) => String(h).startsWith(`${Number(date.slice(8))} `))).value);
      expect(cellText(p.lv.employeeCode, LEAVE_DAY)).toContain("#"); // HR's Manual Override
      expect(cellText(p.lv.employeeCode, "2026-09-16")).not.toMatch(/[#~^]/); // a plain device day carries no marker
      const sheet = wb.worksheets[1]!;
      const lines: Record<string, string>[] = [];
      sheet.eachRow((row, n) => {
        if (n > 1) lines.push({ code: String(row.getCell(1).value), how: String(row.getCell(6).value), reason: String(row.getCell(8).value), leave: String(row.getCell(11).value) });
      });
      const mine = lines.find((l) => l.code === p.lv.employeeCode && l.how?.includes("Manual override"));
      expect(mine).toBeDefined();
      expect(mine!.reason).toContain("Actually only the first half"); // the override in force; the earlier one is in the history
      expect(mine!.leave).toContain("PL 1 day returned");
    });

    it("the override rows themselves can't be edited or deleted", async () => {
      await expect(prisma.attendanceOverride.updateMany({ where: { employeeId: p.w.employeeId }, data: { reason: "changed" } })).rejects.toThrow(/APPEND_ONLY/);
      await expect(prisma.leaveDayRelease.updateMany({ where: { employeeId: p.lv.employeeId }, data: { reason: "changed" } })).rejects.toThrow(/APPEND_ONLY/);
    });
  });
});
void Prisma;
