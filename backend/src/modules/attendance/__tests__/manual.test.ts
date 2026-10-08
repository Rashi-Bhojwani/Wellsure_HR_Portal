import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { parseMusterCell } from "@shared/attendance/muster";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";
import { runManualReminder } from "../manual/reminder";

// Manual entry and the editable muster (P2-D, docs/plans/PHASE_2.md §5 and
// "P2-D build design"), against the database: one past week, Mon 14 – Sun
// 20 Sep 2026, in the September cycle.
type Person = { employeeId: string; employeeCode: string; userId: string };
const CYCLE = "2026-09-01";
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("manual entry and the attendance muster (P2-D)", () => {
  let org: TestOrgMasters; // branch X: the marker's
  let otherOrg: TestOrgMasters; // branch Y: not the marker's
  const p = {} as Record<"mA" | "mB" | "mC" | "dev" | "other" | "marker" | "hr" | "emp", Person>;
  const tok = {} as Record<"marker" | "hr" | "emp", string>;
  let deviceId = "";
  const uploadIds: string[] = [];

  const as = (t: string) => ({
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(t)).send(b),
  });
  const save = (t: string, entries: Array<{ who: Person; date: string; text: string; remark?: string }>) =>
    as(t).post("/muster/entries", { entries: entries.map((e) => ({ employeeId: e.who.employeeId, date: e.date, text: e.text, remark: e.remark })) });
  const dayRow = (who: Person, date: string) => prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: who.employeeId, date: d(date) } } });
  const muster = async (t: string, q = "") => (await as(t).get(`/muster?cycleStart=${CYCLE}${q}`)).body;
  const cell = (m: { rows: Array<{ employeeId: string; cells: Array<{ date: string }> }> }, who: Person, date: string) =>
    m.rows.find((r) => r.employeeId === who.employeeId)!.cells.find((c) => c.date === date) as Record<string, unknown>;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    for (const k of ["mA", "mB", "mC", "dev"] as const) p[k] = await createFullTestEmployee(org);
    p.other = await createFullTestEmployee(otherOrg);
    p.marker = await createFullTestEmployee(otherOrg, { roleCode: "MANAGER" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    // manual capture: no device mapping
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: { in: [p.mA, p.mB, p.mC, p.other].map((x) => x.employeeId) } } });
    // mC worked one week only
    await prisma.employee.update({ where: { id: p.mC.employeeId }, data: { dateOfJoining: d("2026-09-14"), lastWorkingDate: d("2026-09-20") } });
    // the marker: a manager granted attendance.manual.enter, marking branch X only
    const perm = await prisma.permission.findUniqueOrThrow({ where: { key: "attendance.manual.enter" } });
    await prisma.userPermissionOverride.create({ data: { userId: p.marker.userId, permissionId: perm.id, effect: "GRANT", reason: "manual test", createdByUserId: p.hr.userId } });
    await prisma.attendanceManualBranch.create({ data: { userId: p.marker.userId, locationId: org.locationId, assignedByUserId: p.hr.userId } });
    for (const k of ["marker", "hr", "emp"] as const) tok[k] = await loginAs(p[k].employeeCode);

    const device = await prisma.device.create({ data: { serialNumber: `MAN-${tag}`, name: "Manual test device", locationId: org.locationId } });
    deviceId = device.id;
    const batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    for (const time of ["10:45", "19:00"]) {
      await prisma.rawPunch.create({
        data: { deviceId, deviceUserId: p.dev.employeeCode, punchedAt: ist("2026-09-14", time), localTime: `2026-09-14 ${time}:00`, businessDate: d("2026-09-14"), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: p.dev.employeeId },
      });
    }
  });

  afterAll(async () => {
    await deleteWithDependents("ManualMusterUpload", uploadIds);
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: Object.values(p).map((x) => x.employeeId) } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  });

  describe("the cell language (shared parser)", () => {
    it("times in several spellings, status letters, clear; HD asks which half", () => {
      expect(parseMusterCell("10:05-19:10")).toEqual({ ok: true, value: { kind: "TIMED", inTime: "10:05", outTime: "19:10" } });
      expect(parseMusterCell("1005-1910")).toEqual({ ok: true, value: { kind: "TIMED", inTime: "10:05", outTime: "19:10" } });
      expect(parseMusterCell("9.30 18.45")).toEqual({ ok: true, value: { kind: "TIMED", inTime: "09:30", outTime: "18:45" } });
      expect(parseMusterCell("10:05-")).toEqual({ ok: true, value: { kind: "TIMED", inTime: "10:05", outTime: null } });
      expect(parseMusterCell("p")).toEqual({ ok: true, value: { kind: "STATUS_ONLY", status: "P" } });
      expect(parseMusterCell("A:P")).toEqual({ ok: true, value: { kind: "STATUS_ONLY", status: "HD_SECOND" } });
      expect(parseMusterCell("w")).toEqual({ ok: true, value: { kind: "STATUS_ONLY", status: "WORKED" } });
      expect(parseMusterCell("-")).toEqual({ ok: true, value: { kind: "CLEARED" } });
      expect(parseMusterCell("  ")).toEqual({ ok: true, value: null });
      expect(parseMusterCell("HD")).toMatchObject({ ok: false, error: expect.stringContaining("Which half?") });
      expect(parseMusterCell("25:00-19:00")).toMatchObject({ ok: false });
      expect(parseMusterCell("PL")).toMatchObject({ ok: false });
    });
  });

  describe("entries go through the engine", () => {
    it("a TIMED entry is computed exactly like device punches at the same times (10:45 is late)", async () => {
      const res = await save(tok.marker, [{ who: p.mA, date: "2026-09-14", text: "10:45-19:00" }]);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ saved: 1, unchanged: 0 });
      await computeAttendance([p.dev.employeeId], "2026-09-14", "2026-09-14");
      const manual = await dayRow(p.mA, "2026-09-14");
      const device = await dayRow(p.dev, "2026-09-14");
      expect(manual).toMatchObject({ source: "MANUAL", capture: "MANUAL", status: "P", lateInMinutes: 45, actualMinutes: 450, exceptionFlags: ["LATE_IN"] });
      const same = (r: typeof manual) => [r.status, r.firstHalfStatus, r.secondHalfStatus, Number(r.lopDays), r.lateInMinutes, r.earlyOutMinutes, r.totalMinutes, r.breakMinutes, r.actualMinutes, r.shortfallMinutes, r.exceptionFlags, r.firstIn?.toISOString(), r.lastOut?.toISOString()];
      expect(same(manual)).toEqual(same(device));
    });

    it("status-only entries: P, A and halves, with no times or lateness — and the muster marks them as status only", async () => {
      const res = await save(tok.marker, [
        { who: p.mA, date: "2026-09-15", text: "P" },
        { who: p.mA, date: "2026-09-16", text: "A" },
        { who: p.mA, date: "2026-09-17", text: "P:A" },
      ]);
      expect(res.body).toEqual({ saved: 3, unchanged: 0 });
      expect(await dayRow(p.mA, "2026-09-15")).toMatchObject({ status: "P", source: "MANUAL", lateInMinutes: null, actualMinutes: null, firstIn: null });
      expect(await dayRow(p.mA, "2026-09-16")).toMatchObject({ status: "A" });
      expect(Number((await dayRow(p.mA, "2026-09-16")).lopDays)).toBe(1);
      expect(await dayRow(p.mA, "2026-09-17")).toMatchObject({ status: "P:A", firstHalfStatus: "P", secondHalfStatus: "A" });
      const m = await muster(tok.marker);
      expect(cell(m, p.mA, "2026-09-15")).toMatchObject({ code: "P", statusOnly: true, entry: { kind: "STATUS_ONLY", text: "P", via: "SCREEN" } });
      expect(cell(m, p.mA, "2026-09-14")).toMatchObject({ code: "P", statusOnly: false, firstIn: "10:45", lastOut: "19:00", lateInMinutes: 45, entry: { text: "10:45-19:00" } });
    });

    it("an IN with no OUT is one punch: absent, MISSING_PUNCH, marked in the muster and counted", async () => {
      await save(tok.marker, [{ who: p.mA, date: "2026-09-18", text: "10:05-" }]);
      expect(await dayRow(p.mA, "2026-09-18")).toMatchObject({ status: "A", exceptionFlags: ["MISSING_PUNCH"] });
      const m = await muster(tok.marker);
      expect(cell(m, p.mA, "2026-09-18")).toMatchObject({ missingPunch: true, entry: { text: "10:05-" } });
    });

    it("a correction supersedes; '-' clears back to NM; history is kept and can't be edited or deleted", async () => {
      await save(tok.marker, [{ who: p.mA, date: "2026-09-18", text: "10:05-19:00", remark: "forgot to punch out; confirmed by phone" }]);
      expect(await dayRow(p.mA, "2026-09-18")).toMatchObject({ status: "P", exceptionFlags: ["LATE_IN"] }); // 10:05, grace 0
      await save(tok.marker, [{ who: p.mA, date: "2026-09-18", text: "-" }]);
      expect(await dayRow(p.mA, "2026-09-18")).toMatchObject({ status: "NM", lopDays: expect.anything() });
      const history = await prisma.manualAttendanceEntry.findMany({ where: { employeeId: p.mA.employeeId, date: d("2026-09-18") }, orderBy: { seq: "asc" } });
      expect(history.map((h) => [h.kind, h.inTime, h.outTime, h.remark])).toEqual([
        ["TIMED", "10:05", null, null],
        ["TIMED", "10:05", "19:00", "forgot to punch out; confirmed by phone"],
        ["CLEARED", null, null, null],
      ]);
      await expect(prisma.manualAttendanceEntry.update({ where: { id: history[0]!.id }, data: { inTime: "09:00" } })).rejects.toThrow(/MANUAL_ENTRY_APPEND_ONLY/);
      await expect(prisma.manualAttendanceEntry.delete({ where: { id: history[0]!.id } })).rejects.toThrow(/MANUAL_ENTRY_APPEND_ONLY/);
    });

    it("saving the same thing again writes nothing (no duplicates)", async () => {
      const res = await save(tok.marker, [{ who: p.mA, date: "2026-09-15", text: "p" }]);
      expect(res.body).toEqual({ saved: 0, unchanged: 1 });
      expect(await prisma.manualAttendanceEntry.count({ where: { employeeId: p.mA.employeeId, date: d("2026-09-15") } })).toBe(1);
    });
  });

  describe("what may be entered where", () => {
    it("week-off: only W or times (W records work on the off day); a device day, the future and leave are refused — and one bad cell saves nothing", async () => {
      const off = await save(tok.marker, [{ who: p.mB, date: "2026-09-20", text: "P" }]);
      expect(off.status).toBe(400);
      expect(off.body.error.code).toBe("MUSTER_INVALID");
      expect(off.body.error.details.cells[0].error).toMatch(/week-off: type W/);
      const worked = await save(tok.marker, [{ who: p.mB, date: "2026-09-20", text: "W" }]);
      expect(worked.status).toBe(200);
      expect(await dayRow(p.mB, "2026-09-20")).toMatchObject({ status: "O", workedOnOffDay: true });
      expect((await save(tok.marker, [{ who: p.mB, date: "2026-09-14", text: "W" }])).body.error.details.cells[0].error).toMatch(/W is for work on a holiday or week-off/);

      const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
      await prisma.leaveRequest.create({ data: { employeeId: p.mB.employeeId, leaveTypeId: pl.id, fromDate: d("2026-09-17"), toDate: d("2026-09-17"), totalDays: 1, status: "APPROVED", appliedByUserId: p.mB.userId } });
      const mixed = await save(tok.hr, [
        { who: p.mB, date: "2026-09-16", text: "P" }, // fine on its own
        { who: p.mB, date: "2026-09-17", text: "P" }, // approved leave
        { who: p.dev, date: "2026-09-15", text: "P" }, // device capture
        { who: p.mB, date: "2099-01-01", text: "P" }, // future
        { who: p.mB, date: "2026-09-19", text: "PL" }, // not a muster letter
      ]);
      expect(mixed.status).toBe(400);
      const errs = Object.fromEntries((mixed.body.error.details.cells as Array<{ employeeId: string; date: string; error: string }>).map((c) => [`${c.employeeId === p.dev.employeeId ? "dev" : "mB"} ${c.date}`, c.error]));
      expect(errs["mB 2026-09-17"]).toMatch(/approved leave/);
      expect(errs["dev 2026-09-15"]).toMatch(/biometric-device day/);
      expect(errs["mB 2099-01-01"]).toMatch(/hasn't happened yet/);
      expect(errs["mB 2026-09-19"]).toMatch(/isn't something the muster understands/);
      expect(errs["mB 2026-09-16"]).toBeUndefined();
      expect(await prisma.manualAttendanceEntry.count({ where: { employeeId: p.mB.employeeId, date: d("2026-09-16") } })).toBe(0); // nothing written
    });

    it("nobody marks their own attendance — not even HR", async () => {
      await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.hr.employeeId } }); // HR is manual capture at branch X now
      const res = await save(tok.hr, [{ who: p.hr, date: "2026-09-16", text: "P" }]);
      expect(res.status).toBe(400);
      expect(res.body.error.details.cells[0].error).toMatch(/Your own attendance is marked by someone else/);
      expect(cell(await muster(tok.hr, `&employeeId=${p.hr.employeeId}`), p.hr, "2026-09-16")).toMatchObject({ editable: false });
      await prisma.deviceUserMapping.create({ data: { employeeId: p.hr.employeeId, deviceUserId: p.hr.employeeCode, validFrom: d("2024-01-01"), createdByUserId: p.hr.userId } });
    });

    it("a finalised day is read-only", async () => {
      await computeAttendance([p.mB.employeeId], "2026-09-19", "2026-09-19");
      await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.mB.employeeId, date: d("2026-09-19") } }, data: { isLocked: true } });
      const res = await save(tok.hr, [{ who: p.mB, date: "2026-09-19", text: "P" }]);
      expect(res.body.error.details.cells[0].error).toMatch(/finalised/);
      expect(cell(await muster(tok.hr, `&employeeId=${p.mB.employeeId}`), p.mB, "2026-09-19")).toMatchObject({ editable: false, locked: true });
    });
  });

  describe("branch scope (IDOR)", () => {
    it("the marker sees only the manual-capture people of their branch; HR sees everyone; an employee is refused", async () => {
      const mine = await muster(tok.marker);
      const ids = mine.rows.map((r: { employeeId: string }) => r.employeeId);
      expect(ids).toEqual(expect.arrayContaining([p.mA.employeeId, p.mB.employeeId, p.mC.employeeId]));
      expect(ids).not.toContain(p.dev.employeeId); // device capture
      expect(ids).not.toContain(p.other.employeeId); // another branch
      expect(ids).not.toContain(p.hr.employeeId);
      expect(mine.canMark).toBe(true);
      const hrIds = (await muster(tok.hr)).rows.map((r: { employeeId: string }) => r.employeeId);
      expect(hrIds).toEqual(expect.arrayContaining([p.mA.employeeId, p.dev.employeeId, p.other.employeeId]));
      expect((await as(tok.emp).get(`/muster?cycleStart=${CYCLE}`)).status).toBe(403);
    });

    it("marking someone outside the marker's branches is a 404 for the whole batch, never confirming they exist", async () => {
      const res = await save(tok.marker, [
        { who: p.mA, date: "2026-09-16", text: "P" },
        { who: p.other, date: "2026-09-16", text: "P" },
      ]);
      expect(res.status).toBe(404);
      expect(await prisma.manualAttendanceEntry.count({ where: { employeeId: p.other.employeeId } })).toBe(0);
      const ghost = await as(tok.marker).post("/muster/entries", { entries: [{ employeeId: "no-such-employee", date: "2026-09-16", text: "P" }] });
      expect(ghost.status).toBe(404);
      expect(ghost.body.error.message).toBe(res.body.error.message);
      expect((await as(tok.marker).post("/muster/mark-present", { date: "2026-09-16", locationId: otherOrg.locationId })).status).toBe(404);
      expect((await as(tok.marker).get(`/muster/template?locationId=${otherOrg.locationId}&cycleStart=${CYCLE}`)).status).toBe(404);
    });
  });

  describe("totals, paid days, mark all present, export", () => {
    it("paid days = days so far less LOP, NM counting 0 until marked; P, A, HD, LOP, OFF, NM and missing-punch totals", async () => {
      // mC, employed Mon 14 – Sun 20 only: P(times), A, P:A, NM, IN only, P, OFF
      const res = await save(tok.marker, [
        { who: p.mC, date: "2026-09-14", text: "10:00-19:00" },
        { who: p.mC, date: "2026-09-15", text: "A" },
        { who: p.mC, date: "2026-09-16", text: "P:A" },
        { who: p.mC, date: "2026-09-18", text: "10:00-" },
        { who: p.mC, date: "2026-09-19", text: "P" },
      ]);
      expect(res.status).toBe(200);
      const m = await muster(tok.marker, `&employeeId=${p.mC.employeeId}`);
      expect(m.rows).toHaveLength(1);
      const row = m.rows[0];
      expect(row.cells.filter((c: { code: string | null }) => c.code).map((c: { code: string }) => c.code)).toEqual(["P", "A", "P:A", "NM", "A", "P", "OFF"]);
      expect(row.totals).toEqual({ paidDays: 3.5, present: 2.5, absent: 2.5, halfDays: 1, lop: 2.5, leave: 0, holidays: 0, off: 1, notMarked: 1, missingPunch: 1 });
      expect(m.days.find((x: { date: string }) => x.date === "2026-09-17").notMarked).toBeGreaterThanOrEqual(1);
      expect(m.legend.map((l: { code: string }) => l.code)).toContain("OFF");
      expect(m.filters.employees.map((e: { id: string }) => e.id)).toContain(p.mA.employeeId); // the picker lists everyone, not just the filtered row
    });

    it("mark all present fills only NM days at the shift's times (BULK), never overwriting an entry", async () => {
      // Mon 21 Sep: mA has an entry, mB and mC (left) don't
      await save(tok.marker, [{ who: p.mA, date: "2026-09-21", text: "A" }]);
      const res = await as(tok.marker).post("/muster/mark-present", { date: "2026-09-21", locationId: org.locationId });
      expect(res.status).toBe(200);
      expect(await dayRow(p.mB, "2026-09-21")).toMatchObject({ status: "P", firstIn: ist("2026-09-21", "10:00"), lastOut: ist("2026-09-21", "19:00") });
      expect(await dayRow(p.mA, "2026-09-21")).toMatchObject({ status: "A" });
      expect(await prisma.manualAttendanceEntry.findFirst({ where: { employeeId: p.mB.employeeId, date: d("2026-09-21") } })).toMatchObject({ via: "BULK", kind: "TIMED", inTime: "10:00", outTime: "19:00" });
      expect(res.body.marked).toBeGreaterThanOrEqual(1);
      expect((await as(tok.marker).post("/muster/mark-present", { date: "2026-09-21", locationId: org.locationId })).body.marked).toBe(0);
    });

    it("the Excel export is the same grid with markers, totals and the legend", async () => {
      const res = await as(tok.marker).get(`/muster/export?cycleStart=${CYCLE}`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      const ws = wb.worksheets[0]!;
      const header = (ws.getRow(1).values as unknown[]).map(String);
      expect(header).toEqual(expect.arrayContaining(["Code", "Name", "15 Tue", "Paid days", "NM", "Missing punch"]));
      const rowOf = (code: string) => ws.getRows(2, ws.rowCount)!.find((r) => r.getCell(1).value === code)!;
      const col = (h: string) => header.indexOf(h);
      expect(rowOf(p.mA.employeeCode).getCell(col("15 Tue")).value).toBe("P*");
      expect(rowOf(p.mC.employeeCode).getCell(col("18 Fri")).value).toBe("A!");
      expect(rowOf(p.mC.employeeCode).getCell(col("Paid days")).value).toBe(3.5);
      const text = ws.getColumn(1).values.map(String).join("\n");
      expect(text).toContain("* status only, no times");
      expect(rowOf(p.dev.employeeCode)).toBeUndefined(); // the marker's export holds only their rows
    });
  });

  describe("muster upload", () => {
    const download = async () => {
      const res = await as(tok.marker).get(`/muster/template?locationId=${org.locationId}&cycleStart=${CYCLE}`).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      return wb;
    };
    const upload = async (wb: ExcelJS.Workbook) => {
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      const res = await request(app).post("/api/attendance/muster/upload").set(...authHeader(tok.marker)).attach("file", buffer, "muster.xlsx");
      if (res.body.uploadId) uploadIds.push(res.body.uploadId);
      return res;
    };
    const colOf = (ws: ExcelJS.Worksheet, date: string, which: "IN" | "OUT") => (ws.getRow(3).values as unknown[]).findIndex((v) => typeof v === "string" && v.startsWith(date) && v.endsWith(which));
    const rowOf = (ws: ExcelJS.Worksheet, code: string) => ws.getRows(4, ws.rowCount)!.find((r) => r.getCell(1).value === code)!;

    it("the template round-trips the current entries; preview sorts every cell; commit writes only the changes", async () => {
      const wb = await download();
      const ws = wb.getWorksheet("Muster")!;
      expect(rowOf(ws, p.mA.employeeCode).getCell(colOf(ws, "2026-09-14", "IN")).value).toBe("10:45");
      expect(rowOf(ws, p.mA.employeeCode).getCell(colOf(ws, "2026-09-14", "OUT")).value).toBe("19:00");
      expect(rowOf(ws, p.mA.employeeCode).getCell(colOf(ws, "2026-09-15", "IN")).value).toBe("P");
      expect(rowOf(ws, p.mA.employeeCode).getCell(colOf(ws, "2026-09-20", "IN")).value).toBe("OFF");

      const mB = rowOf(ws, p.mB.employeeCode);
      mB.getCell(colOf(ws, "2026-09-22", "IN")).value = "10:10";
      mB.getCell(colOf(ws, "2026-09-22", "OUT")).value = "19:00";
      mB.getCell(colOf(ws, "2026-09-23", "IN")).value = "A";
      mB.getCell(colOf(ws, "2026-09-24", "IN")).value = 0.4375; // Excel turned "10:30" into a time value
      mB.getCell(colOf(ws, "2026-09-24", "OUT")).value = "18:00";
      mB.getCell(colOf(ws, "2026-09-25", "IN")).value = "25:00"; // invalid
      mB.getCell(colOf(ws, "2026-09-25", "OUT")).value = "19:00";
      mB.getCell(colOf(ws, "2026-09-17", "IN")).value = "P"; // approved leave: not markable
      rowOf(ws, p.mA.employeeCode).getCell(colOf(ws, "2026-09-27", "IN")).value = "P"; // a Sunday: W or times only
      const stray = ws.addRow([p.other.employeeCode, "Someone elsewhere"]);
      stray.getCell(colOf(ws, "2026-09-22", "IN")).value = "P";

      const res = await upload(wb);
      expect(res.status).toBe(200);
      expect(res.body.counts).toMatchObject({ timed: 2, statusOnly: 1, cleared: 0, issues: 4 });
      expect(res.body.counts.unchanged).toBeGreaterThanOrEqual(5);
      const issues = res.body.issues.map((i: { employeeCode: string; date: string | null; issue: string }) => `${i.employeeCode} ${i.date} ${i.issue}`).join("\n");
      expect(issues).toMatch(new RegExp(`${p.other.employeeCode} null Not a manual-attendance employee you mark`));
      expect(issues).toMatch(/2026-09-25 Times must be real 24-hour times/);
      expect(issues).toMatch(/2026-09-17 Not marked: On approved leave/);
      expect(issues).toMatch(/2026-09-27 This is a week-off: type W/);
      expect(await prisma.manualAttendanceEntry.count({ where: { employeeId: p.mB.employeeId, date: d("2026-09-22") } })).toBe(0); // preview writes nothing

      const commit = await as(tok.marker).post(`/muster/upload/${res.body.uploadId}/commit`);
      expect(commit.status).toBe(200);
      expect(commit.body.saved).toBe(3);
      expect(await prisma.manualAttendanceEntry.findFirst({ where: { employeeId: p.mB.employeeId, date: d("2026-09-24") } })).toMatchObject({ via: "MUSTER_UPLOAD", uploadId: res.body.uploadId, inTime: "10:30", outTime: "18:00" });
      expect(await dayRow(p.mB, "2026-09-22")).toMatchObject({ status: "P", lateInMinutes: 10 });
      expect((await as(tok.marker).post(`/muster/upload/${res.body.uploadId}/commit`)).status).toBe(409);
      expect((await as(tok.hr).post(`/muster/upload/${res.body.uploadId}/commit`)).status).toBe(404); // someone else's upload
    });

    it("re-uploading the corrected file supersedes, never duplicates", async () => {
      const wb = await download();
      const ws = wb.getWorksheet("Muster")!;
      const before = await prisma.manualAttendanceEntry.count({ where: { employeeId: { in: [p.mA.employeeId, p.mB.employeeId] } } });
      const same = await upload(wb);
      expect(same.body.counts).toMatchObject({ timed: 0, statusOnly: 0, cleared: 0 });
      rowOf(ws, p.mB.employeeCode).getCell(colOf(ws, "2026-09-23", "IN")).value = "P"; // was A
      const corrected = await upload(wb);
      expect(corrected.body.counts).toMatchObject({ timed: 0, statusOnly: 1, cleared: 0 });
      await as(tok.marker).post(`/muster/upload/${corrected.body.uploadId}/commit`);
      expect(await prisma.manualAttendanceEntry.count({ where: { employeeId: { in: [p.mA.employeeId, p.mB.employeeId] } } })).toBe(before + 1);
      expect(await dayRow(p.mB, "2026-09-23")).toMatchObject({ status: "P" });
    });

    it("a file that isn't the template is refused with a clear message", async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet("Sheet1").addRow(["hello"]);
      const res = await upload(wb);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Use the template downloaded from the Attendance Muster/);
    });
  });

  it("the daily reminder tells the marker how many of today's days are still not marked — and stays quiet on a Sunday", async () => {
    const branch = (await prisma.location.findUniqueOrThrow({ where: { id: org.locationId } })).name;
    try {
      setBusinessTodayForTests(d("2026-09-27")); // a Sunday: OFF for everyone, nothing to mark
      await runManualReminder();
      expect(await prisma.notification.count({ where: { userId: p.marker.userId, type: "attendance.manual.reminder" } })).toBe(0);
      setBusinessTodayForTests(d("2026-09-28")); // a Monday nobody has marked yet
      expect((await runManualReminder()).notified).toBeGreaterThanOrEqual(1);
    } finally {
      setBusinessTodayForTests(null);
    }
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: p.marker.userId, type: "attendance.manual.reminder" } });
    expect(note.title).toBe("2 people not marked today"); // mA and mB (mC has left)
    expect(note.body).toContain(`2 at ${branch}`);
    expect(note.link).toBe("/app/attendance/mark");
  });
});
