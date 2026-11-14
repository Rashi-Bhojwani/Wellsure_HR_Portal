import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { writeXls } from "../../../lib/__tests__/xlsWriter";
import { prisma } from "../../../lib/prisma";
import { setRecomputeHandler } from "../../attendance/recompute";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { swipeTime } from "../swipesImport";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): the device log (.dat) and greytHR's Attendance Swipes file through Import Center → Punches. Only the synthetic samples and
// files generated in the sample's own layout; made-up people. Punches go through the one ingestion: duplicates skipped, unknown codes listed, never guessed.
const SAMPLES = path.join(__dirname, "..", "..", "..", "..", "..", "docs", "samples");
const suffix = Date.now().toString(36).slice(-5);

describe("Stage 8 — greytHR punch files", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"hr" | "alice" | "bob" | "dev" | "emp", { employeeId: string; employeeCode: string; userId: string }>;
  const tok: Record<string, string> = {};
  let deviceId = "";
  const batchIds: string[] = [];
  const preview = (file: Buffer, name: string, t = tok.hr!) => request(app).post("/api/biometric/import/preview").set(...authHeader(t)).field("deviceId", deviceId).attach("file", file, name);

  /** The synthetic swipes sample with its rows replaced: the layout (headers, footer note) is the sample's own. */
  async function swipesFile(rows: Array<[string, string, string, string, string | Date]>): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(SAMPLES, "Attendance_Swipes_template.xlsx"));
    const sheet = wb.worksheets[0]!;
    const footer = sheet.getRow(4).getCell(1).value;
    for (let r = 2; r <= sheet.rowCount; r++) sheet.getRow(r).values = [];
    rows.forEach((row, i) => (sheet.getRow(i + 2).values = row));
    sheet.getRow(rows.length + 3).getCell(1).value = footer;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.alice = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" }); // device user ID = her code
    p.bob = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.bob.employeeId } }); // bob: no device user ID
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k as keyof typeof p].employeeCode);
    setRecomputeHandler(async () => undefined);
    const d = await request(app).post("/api/biometric/devices").set(...authHeader(tok.hr!)).send({ serialNumber: `S8-${suffix}`, name: "Stage 8 test device", locationId: org.locationId, route: "PUSH" });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    deviceId = d.body.id;
  });

  afterAll(async () => {
    setRecomputeHandler(null);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", [deviceId]);
    await purgeAppendOnly("AuditLog", { entityId: { in: [deviceId, ...batchIds] } });
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the synthetic device log: every line read, blank lines and odd spacing tolerated, repeats counted as duplicates, unknown device user IDs listed (never guessed)", async () => {
    const sample = readFileSync(path.join(SAMPLES, "attlog_sample.dat"), "utf8");
    const firstLine = sample.split("\n").find((l) => l.trim())!;
    const messy = `\n${sample}\n\n   ${firstLine.trim()}   \n\t\n`;
    const r = await preview(Buffer.from(messy), "attlog_sample.dat");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    batchIds.push(r.body.batchId);
    expect(r.body.source).toBe("ATTLOG");
    expect(r.body.rejectedCount).toBe(0);
    expect(r.body.duplicateCount).toBe(1); // the repeated first line
    expect(r.body.newCount).toBe(18);
    const ids = [...new Set(sample.split("\n").filter((l) => l.trim()).map((l) => l.trim().split("\t")[0]))].sort();
    expect(r.body.unknownIds).toEqual(ids);
    expect(r.body.unmappedCount).toBe(18);
  });

  it("greytHR's swipes file (the sample's layout): rows become punches for the mapped people; unknown numbers and people with no device user ID are rejected with reasons", async () => {
    const file = await swipesFile([
      [p.alice.employeeCode, "Alice", "In", "Main Door", "05/01/2026 09:58"],
      [p.alice.employeeCode, "Alice", "Out", "Main Door", "05/01/2026 19:03"],
      [p.alice.employeeCode, "Alice", "Out", "Main Door", "05/01/2026 19:03"], // the same swipe twice
      [`NOBODY${suffix}`, "Nobody", "In", "Main Door", "05/01/2026 10:00"],
      [p.bob.employeeCode, "Bob", "In", "Main Door", "05/01/2026 10:00"],
      [p.alice.employeeCode, "Alice", "In", "Main Door", "31/02/2026 09:00"], // no such day
      [p.alice.employeeCode, "Alice", "Sideways", "Main Door", "06/01/2026 09:00"],
    ]);
    const r = await preview(file, "Attendance_Swipes.xlsx");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    batchIds.push(r.body.batchId);
    expect(r.body.source).toBe("SWIPES");
    expect(r.body.unknownNumbers).toEqual([`NOBODY${suffix}`]);
    expect([r.body.newCount, r.body.duplicateCount]).toEqual([2, 1]);
    const reasons = r.body.rejected.map((x: { reason: string }) => x.reason).join(" | ");
    expect(reasons).toMatch(/No employee has the number "NOBODY/);
    expect(reasons).toMatch(/has no device user ID on 2026-01-05/);
    expect(reasons).toMatch(/"31\/02\/2026 09:00" is not a date/);
    expect(reasons).toMatch(/neither In nor Out/);
    expect(r.body.rejected.map((x: { lineNumber: number }) => x.lineNumber)).toEqual([5, 6, 7, 8]); // the sheet's own row numbers
    expect(await prisma.rawPunch.count({ where: { deviceId } })).toBe(0); // nothing stored before the commit
    const c = await request(app).post(`/api/biometric/import/${r.body.batchId}/commit`).set(...authHeader(tok.hr!)).send({ reason: "Swipes loaded from greytHR in the test" });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const stored = await prisma.rawPunch.findMany({ where: { deviceId }, orderBy: { punchedAt: "asc" } });
    expect(stored.map((x) => [x.deviceUserId, x.localTime, x.employeeId])).toEqual([
      [p.alice.employeeCode, "2026-01-05 09:58:00", p.alice.employeeId],
      [p.alice.employeeCode, "2026-01-05 19:03:00", p.alice.employeeId],
    ]);
    const again = await preview(file, "Attendance_Swipes.xlsx");
    batchIds.push(again.body.batchId);
    expect([again.body.newCount, again.body.duplicateCount]).toEqual([0, 3]); // stored punches are never stored twice
  });

  it("the same swipes in a legacy .xls (as greytHR may export) read the same way", async () => {
    const xls = writeXls([{ name: "Sheet", rows: [["Access Card number/Employee Number", "Employee Name", "In/Out Status", "Door Name", "Date & Time"], [p.alice.employeeCode, "Alice", "In", "Main Door", "07/01/2026 09:15"], ["Columns in red are mandatory"]] }], { sst: true });
    const r = await preview(xls, "Attendance_Swipes.xls");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    batchIds.push(r.body.batchId);
    expect([r.body.source, r.body.newCount, r.body.rejectedCount]).toEqual(["SWIPES", 1, 0]);
  });

  it("refuses the wrong file, an empty file, an oversize one, a damaged one and wrong columns, in plain words", async () => {
    const code = async (b: Buffer, name: string) => (await preview(b, name)).body.error?.code;
    expect(await code(readFileSync(path.join(SAMPLES, "Salary_Statement_template.xls")), "Salary_Statement.xls")).toBe("WRONG_COLUMNS");
    expect(await code(Buffer.alloc(0), "empty.dat")).toBe("EMPTY_FILE");
    expect(await code(Buffer.from("\n\n  \n"), "blank.dat")).toBe("EMPTY_FILE");
    expect(await code(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]), "scan.pdf")).toBe("WRONG_FILE_TYPE");
    expect(await code(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 7)]), "broken.xlsx")).toBe("UNREADABLE_FILE");
    expect(await code(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(11 * 1024 * 1024)]), "huge.xlsx")).toBe("FILE_TOO_LARGE");
    const wrong = new ExcelJS.Workbook();
    wrong.addWorksheet("S").addRow(["Name", "When"]);
    expect(await code(Buffer.from(await wrong.xlsx.writeBuffer()), "other.xlsx")).toBe("WRONG_COLUMNS");
  });

  it("reads greytHR's day-first date and time; refuses what is not a date", () => {
    expect(swipeTime("05/01/2026 09:58")).toBe("2026-01-05 09:58:00");
    expect(swipeTime("2026-01-05 09:58:07")).toBe("2026-01-05 09:58:07");
    expect(swipeTime(new Date(Date.UTC(2026, 0, 5, 9, 58)))).toBe("2026-01-05 09:58:00");
    expect(swipeTime(46027.415277777778)).toBe("2026-01-05 09:58:00"); // an Excel day number
    expect([swipeTime("31/02/2026 09:00"), swipeTime("05/01/2026"), swipeTime("soon"), swipeTime(null)]).toEqual([null, null, null, null]);
  });

  it("an employee is refused; the Developer role may not load greytHR's swipes file (people's attendance), and the device's own log stays as before", async () => {
    expect((await preview(Buffer.from("x"), "a.dat", tok.emp!)).status).toBe(403);
    const swipes = await swipesFile([[p.alice.employeeCode, "Alice", "In", "Main Door", "08/01/2026 09:00"]]);
    const dev = await preview(swipes, "Attendance_Swipes.xlsx", tok.dev!);
    expect([dev.status, dev.body.error?.code]).toEqual([403, "DEVELOPER_CEILING"]);
  });
});
