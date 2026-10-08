import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { getSetting, setSetting } from "../../../lib/settings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance, setManualEntryLoader } from "../compute";
import { NIGHTLY_LAST_RUN_KEY, runNightly } from "../jobs";
import { EngineAttendanceLeaveSink } from "../leaveSink";
import { executeProcessRun } from "../processService";
import { setRecomputeHandler, type DayRef } from "../recompute";

// The engine end to end against the database (docs/plans/PHASE_2.md §4):
// loader → engine → writer, for one past week (Mon 14 – Sun 20 Sep 2026).
type Person = { employeeId: string; employeeCode: string; userId: string };
const MON = "2026-09-14";
const WEEK = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"];
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time.length === 5 ? `${time}:00` : time}`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);

describe("rules engine against the database (P2-C)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"dev" | "manual" | "leaver" | "joiner" | "hr" | "exec" | "emp", Person>;
  let deviceId = "";
  let batchId = "";
  const holidayIds: string[] = [];
  const shiftIds: string[] = [];
  const policyIds: string[] = [];
  const runIds: string[] = [];
  let nightlyBefore: string | null = null;

  const punch = async (who: Person, date: string, time: string, extra: { flag?: "FUTURE" | "TOO_OLD" } = {}) => {
    const at = ist(date, time);
    return prisma.rawPunch.create({
      data: { deviceId, deviceUserId: who.employeeCode, punchedAt: at, localTime: `${date} ${time.length === 5 ? `${time}:00` : time}`, businessDate: new Date(`${date}T00:00:00Z`), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: who.employeeId, flag: extra.flag ?? null },
    });
  };
  const days = async (who: Person) => {
    const rows = await prisma.dailyAttendance.findMany({ where: { employeeId: who.employeeId, date: { gte: new Date(`${WEEK[0]}T00:00:00Z`), lte: new Date(`${WEEK[6]}T00:00:00Z`) } }, orderBy: { date: "asc" } });
    return Object.fromEntries(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  };
  const statuses = async (who: Person) => Object.fromEntries(Object.entries(await days(who)).map(([d, r]) => [d, r.status]));

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const k of ["dev", "manual", "leaver", "joiner"] as const) p[k] = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.exec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.manual.employeeId } }); // manual capture
    await prisma.employee.update({ where: { id: p.leaver.employeeId }, data: { lastWorkingDate: new Date("2026-09-16T00:00:00Z") } });
    await prisma.employee.update({ where: { id: p.joiner.employeeId }, data: { dateOfJoining: new Date("2026-09-16T00:00:00Z") } });
    const device = await prisma.device.create({ data: { serialNumber: `ENG-${tag}`, name: "Engine test device", locationId: org.locationId } });
    deviceId = device.id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    holidayIds.push((await prisma.holiday.create({ data: { date: new Date("2026-09-16T00:00:00Z"), name: `Test holiday ${tag}` } })).id);
    nightlyBefore = await getSetting<string | null>(NIGHTLY_LAST_RUN_KEY, null);

    // dev's week
    await punch(p.dev, "2026-09-14", "10:00");
    await punch(p.dev, "2026-09-14", "19:00");
    await punch(p.dev, "2026-09-15", "10:03"); // one punch only
    await punch(p.dev, "2026-09-16", "11:00"); // holiday, worked
    await punch(p.dev, "2026-09-16", "15:00");
    await punch(p.dev, "2026-09-18", "14:45"); // first-half leave, worked second half
    await punch(p.dev, "2026-09-18", "19:00");
    await punch(p.dev, "2026-09-19", "10:00:00"); // with the sample's 113 pattern: a second punch 3 s later
    await punch(p.dev, "2026-09-19", "10:00:03");
    await punch(p.dev, "2026-09-19", "19:02:25");
    await punch(p.dev, "2026-09-19", "19:02:28");
    const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
    await prisma.leaveRequest.create({ data: { employeeId: p.dev.employeeId, leaveTypeId: pl.id, fromDate: new Date("2026-09-18T00:00:00Z"), toDate: new Date("2026-09-18T00:00:00Z"), fromDayPart: "FIRST_HALF", toDayPart: "FIRST_HALF", totalDays: 0.5, status: "APPROVED", appliedByUserId: p.dev.userId } });
  });

  beforeEach(() => setRecomputeHandler(null));

  afterAll(async () => {
    setRecomputeHandler(null);
    setManualEntryLoader(null);
    await setSetting(NIGHTLY_LAST_RUN_KEY, nightlyBefore, null);
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: Object.values(p).map((x) => x.employeeId) } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", [deviceId]);
    await deleteWithDependents("Holiday", holidayIds);
    await deleteWithDependents("AttendanceProcessRun", runIds);
    await purgeAppendOnly("AuditLog", { entityId: { in: runIds } });
    await deleteWithDependents("Shift", shiftIds);
    await deleteWithDependents("AttendancePolicy", policyIds);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("a week, device capture", () => {
    it("every day computed in the spec's order of precedence, each with its source", async () => {
      const r = await computeAttendance([p.dev.employeeId], WEEK[0]!, WEEK[6]!);
      expect(r.processed).toBe(7);
      const d = await days(p.dev);
      expect(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, [v.status, v.source]]))).toEqual({
        "2026-09-14": ["P", "DEVICE"],
        "2026-09-15": ["A", "DEVICE"],
        "2026-09-16": ["H", "HOLIDAY"],
        "2026-09-17": ["A", "DEVICE"],
        "2026-09-18": ["PL:P", "DEVICE"],
        "2026-09-19": ["P", "DEVICE"],
        "2026-09-20": ["O", "WEEK_OFF"],
      });
      expect(d["2026-09-14"]).toMatchObject({ actualMinutes: 495, breakMinutes: 45, shiftCode: "GEN", exceptionFlags: [], provisional: false, capture: "DEVICE" });
      expect(d["2026-09-15"]!.exceptionFlags).toEqual(["MISSING_PUNCH"]);
      expect(d["2026-09-16"]).toMatchObject({ workedOnOffDay: true, holidayName: `Test holiday ${tag}`, exceptionFlags: [] });
      expect(Number(d["2026-09-17"]!.lopDays)).toBe(1);
      expect(d["2026-09-18"]).toMatchObject({ leaveTypeCode: "PL", firstHalfStatus: "PL", secondHalfStatus: "P" });
      // two near-duplicate pairs collapsed, as the sample's user 113
      expect(d["2026-09-19"]).toMatchObject({ punchCount: 2, computedFrom: expect.objectContaining({ collapsedPunches: 2 }) });
    });

    it("re-running with nothing changed writes nothing", async () => {
      const again = await computeAttendance([p.dev.employeeId], WEEK[0]!, WEEK[6]!);
      expect(again).toMatchObject({ processed: 7, changed: 0, deleted: 0 });
    });
  });

  describe("manual capture (no device mapping)", () => {
    it("working days are NM — never absent, never an exception, no LOP; holidays and week-offs still apply", async () => {
      await computeAttendance([p.manual.employeeId], WEEK[0]!, WEEK[6]!);
      const d = await days(p.manual);
      expect(Object.values(d).map((x) => x.status)).toEqual(["NM", "NM", "H", "NM", "NM", "NM", "O"]);
      expect(Object.values(d).every((x) => x.exceptionFlags.length === 0 && Number(x.lopDays) === 0)).toBe(true);
      expect(d["2026-09-14"]).toMatchObject({ source: "MANUAL", capture: "MANUAL" });
    });

    it("a TIMED entry from the loader goes through the punch rules (late, hours, sessions)", async () => {
      setManualEntryLoader(async () => new Map([[`${p.manual.employeeId}|2026-09-14`, { kind: "TIMED", id: "m-1", inTime: "10:45", outTime: "19:00" }]]));
      await computeAttendance([p.manual.employeeId], "2026-09-14", "2026-09-14");
      setManualEntryLoader(null);
      // late, as a punched 10:45 would be — and, under the fail-safe 6 h placeholder, still a full day
      expect((await days(p.manual))["2026-09-14"]).toMatchObject({ source: "MANUAL", status: "P", lateInMinutes: 45, exceptionFlags: ["LATE_IN"], computedFrom: expect.objectContaining({ manualEntryId: "m-1" }) });
    });

    it("a mapping starting mid-week switches those days to device capture", async () => {
      await prisma.deviceUserMapping.create({ data: { employeeId: p.manual.employeeId, deviceUserId: p.manual.employeeCode, validFrom: new Date("2026-09-17T00:00:00Z"), createdByUserId: p.manual.userId } });
      await computeAttendance([p.manual.employeeId], WEEK[0]!, WEEK[6]!);
      expect(await statuses(p.manual)).toMatchObject({ "2026-09-15": "NM", "2026-09-17": "A", "2026-09-18": "A" });
      await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.manual.employeeId } });
    });
  });

  describe("employment dates", () => {
    it("a leaver is computed on their last working day and has no record after it (an old one is removed)", async () => {
      await prisma.employee.update({ where: { id: p.leaver.employeeId }, data: { lastWorkingDate: null } });
      await computeAttendance([p.leaver.employeeId], WEEK[0]!, WEEK[6]!);
      expect(Object.keys(await days(p.leaver))).toHaveLength(7);
      await prisma.employee.update({ where: { id: p.leaver.employeeId }, data: { lastWorkingDate: new Date("2026-09-16T00:00:00Z") } });
      const r = await computeAttendance([p.leaver.employeeId], WEEK[0]!, WEEK[6]!);
      expect(r.deleted).toBe(4);
      expect(Object.keys(await days(p.leaver))).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"]);
    });

    it("a joiner has no record before the date of joining", async () => {
      await computeAttendance([p.joiner.employeeId], WEEK[0]!, WEEK[6]!);
      expect(Object.keys(await days(p.joiner))[0]).toBe("2026-09-16");
    });
  });

  describe("placeholders: a wrong value is a recompute, never a data-entry exercise", () => {
    it("changing the thresholds and recomputing gives exactly what a fresh computation with the new values gives — and changing back restores every day", async () => {
      const policy = await prisma.attendancePolicy.create({ data: { code: `TP${tag}`, name: "Test policy", fullDayMinMinutes: 480, halfDayMinMinutes: 240 } });
      policyIds.push(policy.id);
      await prisma.attendanceAssignment.updateMany({ where: { employeeId: p.dev.employeeId }, data: { policyId: policy.id } });
      await punch(p.dev, "2026-09-17", "10:30"); // Thursday: 7 h 45 m of work — a half day at 8 h, a full day at 7 h 30 m
      await punch(p.dev, "2026-09-17", "19:00");
      await computeAttendance([p.dev.employeeId], WEEK[0]!, WEEK[6]!);
      const original = await days(p.dev);
      expect(original["2026-09-17"]!.status).toBe("A:P"); // late: the first half is the one partly missed

      await prisma.attendancePolicy.update({ where: { id: policy.id }, data: { fullDayMinMinutes: 450 } }); // HR's real value lands
      const recompute = await computeAttendance([p.dev.employeeId], WEEK[0]!, WEEK[6]!);
      expect(recompute.changes.map((c) => [c.date, c.before, c.after])).toEqual([["2026-09-17", "A:P", "P"]]);
      const recomputed = await days(p.dev);

      // the same days computed from nothing with the new value are identical
      await prisma.dailyAttendance.deleteMany({ where: { employeeId: p.dev.employeeId } });
      await computeAttendance([p.dev.employeeId], WEEK[0]!, WEEK[6]!);
      const fresh = await days(p.dev);
      const strip = (d: Record<string, { id: string; processedAt: Date }>) => Object.fromEntries(Object.entries(d).map(([k, { id: _i, processedAt: _p, ...rest }]) => [k, rest]));
      expect(strip(fresh)).toEqual(strip(recomputed));

      // and back again: every day is exactly as it was
      await prisma.attendancePolicy.update({ where: { id: policy.id }, data: { fullDayMinMinutes: 480 } });
      await computeAttendance([p.dev.employeeId], WEEK[0]!, WEEK[6]!);
      expect(strip(await days(p.dev))).toEqual(strip(original));
    });
  });

  describe("locked days and flagged punches", () => {
    it("a locked (finalised) day is never rewritten, and the leave sink reports it locked", async () => {
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.dev.employeeId, date: new Date(`${MON}T00:00:00Z`) } }, data: { isLocked: true } });
      await punch(p.dev, MON, "12:00");
      const r = await computeAttendance([p.dev.employeeId], MON, MON);
      expect(r).toMatchObject({ locked: 1, changed: 0 });
      expect((await days(p.dev))[MON]!.punchCount).toBe(2);
      const sink = new EngineAttendanceLeaveSink();
      expect(await sink.isPeriodLocked(p.dev.employeeId, new Date(`${MON}T00:00:00Z`))).toBe(true);
      expect(await sink.isPeriodLocked(p.dev.employeeId, new Date("2026-09-15T00:00:00Z"))).toBe(false);
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.dev.employeeId, date: new Date(`${MON}T00:00:00Z`) } }, data: { isLocked: false } });
      // unlocked again: the next recompute takes in the punch that arrived while it was locked
      expect((await computeAttendance([p.dev.employeeId], MON, MON)).changed).toBe(1);
      expect((await days(p.dev))[MON]!.punchCount).toBe(3);
    });

    it("a flagged punch is left out (CLOCK_FLAGGED) until HR accepts it", async () => {
      const flagged = await punch(p.dev, "2026-09-15", "19:00", { flag: "FUTURE" });
      await computeAttendance([p.dev.employeeId], "2026-09-15", "2026-09-15");
      expect((await days(p.dev))["2026-09-15"]).toMatchObject({ status: "A", exceptionFlags: ["MISSING_PUNCH", "CLOCK_FLAGGED"] });
      await prisma.punchFlagResolution.create({ data: { punchId: flagged.id, decision: "ACCEPTED", decidedByUserId: p.hr.userId } });
      await computeAttendance([p.dev.employeeId], "2026-09-15", "2026-09-15");
      expect((await days(p.dev))["2026-09-15"]!.punchCount).toBe(2);
    });
  });

  describe("a night shift crossing midnight", () => {
    it("the morning punch counts toward the shift's start date; changing the assignment mid-week takes effect from its date", async () => {
      const night = await prisma.shift.create({
        data: {
          code: `N${tag}`,
          name: "Night",
          startTime: "22:00",
          endTime: "06:00",
          sessions: { create: [
            { sortOrder: 1, kind: "WORK", label: "A", startTime: "22:00", endTime: "02:00" },
            { sortOrder: 2, kind: "BREAK", label: "Meal", startTime: "02:00", endTime: "02:30" },
            { sortOrder: 3, kind: "WORK", label: "B", startTime: "02:30", endTime: "06:00" },
          ] },
        },
      });
      shiftIds.push(night.id);
      const nightPolicy = await prisma.attendancePolicy.create({ data: { code: `NP${tag}`, name: "Night policy", fullDayMinMinutes: 420, halfDayMinMinutes: 210 } });
      policyIds.push(nightPolicy.id);
      // joiner works nights from Thursday 17th
      await prisma.attendanceAssignment.updateMany({ where: { employeeId: p.joiner.employeeId }, data: { effectiveTo: new Date("2026-09-17T00:00:00Z") } });
      await prisma.attendanceAssignment.create({ data: { employeeId: p.joiner.employeeId, shiftId: night.id, weekOffPatternId: "wop_sun", policyId: nightPolicy.id, effectiveFrom: new Date("2026-09-17T00:00:00Z"), createdByUserId: p.joiner.userId } });
      await punch(p.joiner, "2026-09-17", "21:55");
      await punch(p.joiner, "2026-09-18", "06:05");
      await computeAttendance([p.joiner.employeeId], WEEK[0]!, WEEK[6]!);
      const d = await days(p.joiner);
      expect(d["2026-09-16"]!.shiftCode).toBe("GEN");
      expect(d["2026-09-17"]).toMatchObject({ shiftCode: `N${tag}`, status: "P", punchCount: 2 });
      expect(d["2026-09-18"]).toMatchObject({ status: "A", punchCount: 0 });
    });
  });

  describe("Process Attendance", () => {
    it("HR runs it for a range with a reason; it reports what changed; refuses future days and ranges over a year; employees can't", async () => {
      const hr = await loginAs(p.hr.employeeCode);
      const exec = await loginAs(p.exec.employeeCode);
      const emp = await loginAs(p.emp.employeeCode);
      await prisma.dailyAttendance.deleteMany({ where: { employeeId: p.dev.employeeId, date: new Date("2026-09-17T00:00:00Z") } });
      const body = { fromDate: WEEK[0], toDate: WEEK[6], employeeIds: [p.dev.employeeId], reason: "HR confirmed the half-day hours" };
      expect((await request(app).post("/api/attendance/process").set(...authHeader(emp)).send(body)).status).toBe(403);
      const res = await request(app).post("/api/attendance/process").set(...authHeader(exec)).send(body);
      expect(res.status).toBe(202);
      runIds.push(res.body.id);
      expect(res.body).toMatchObject({ status: "QUEUED", totalDays: 7 });
      const done = await executeProcessRun(res.body.id);
      expect(done).toMatchObject({ status: "COMPLETED", processedDays: 7, changedDays: 1, lockedDays: 0 });
      const detail = await request(app).get(`/api/attendance/process/${res.body.id}`).set(...authHeader(hr));
      expect(detail.body.changes).toEqual([{ employeeId: p.dev.employeeId, employeeCode: p.dev.employeeCode, date: "2026-09-17", before: null, after: "A:P" }]);
      expect(await prisma.auditLog.findFirst({ where: { action: "attendance.process.requested", entityId: res.body.id } })).not.toBeNull();
      const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      expect((await request(app).post("/api/attendance/process").set(...authHeader(hr)).send({ ...body, toDate: future })).status).toBe(400);
      expect((await request(app).post("/api/attendance/process").set(...authHeader(hr)).send({ ...body, fromDate: "2025-01-01" })).status).toBe(400);
      expect((await request(app).post("/api/attendance/process").set(...authHeader(hr)).send({ ...body, reason: "" })).status).toBe(400);
    });
  });

  describe("recompute requests and the nightly run", () => {
    it("approved leave asks for those days to be recomputed", async () => {
      const asked: DayRef[] = [];
      setRecomputeHandler(async (d) => void asked.push(...d));
      await new EngineAttendanceLeaveSink().onLeaveApproved([{ employeeId: p.dev.employeeId, date: new Date("2026-09-15T00:00:00Z"), leaveTypeCode: "PL", dayPart: "FULL", leaveRequestId: "x" }]);
      expect(asked.map((a) => [a.employeeId, a.date.toISOString().slice(0, 10)])).toEqual([[p.dev.employeeId, "2026-09-15"]]);
    });

    it("the nightly finalises yesterday and catches up missed nights (from the day before the last run's end)", async () => {
      await setSetting(NIGHTLY_LAST_RUN_KEY, "2026-09-17", null);
      const r = await runNightly(new Date("2026-09-20T00:00:00Z"));
      expect(r).toMatchObject({ from: "2026-09-16", to: "2026-09-19" });
      expect(await getSetting(NIGHTLY_LAST_RUN_KEY, null)).toBe("2026-09-19");
    });
  });
});
