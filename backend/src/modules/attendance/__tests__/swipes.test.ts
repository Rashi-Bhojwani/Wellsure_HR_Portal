import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";

// Employee Swipes (Phase 3 commit 2): the raw punch log exactly as received, with whether a computed day used each
// punch. "Today" is Wed 30 Sep 2026.
type Person = { employeeId: string; employeeCode: string; userId: string };
const TODAY = "2026-09-30";
const DAY = "2026-09-14";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);

describe("Employee Swipes (Phase 3 commit 2)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"a" | "hr" | "emp", Person>;
  const tok = {} as Record<"hr" | "emp", string>;
  let deviceId = "";
  let batchId = "";
  const ids: Record<string, string> = {};

  const hr = () => ({ get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(tok.hr)) });
  const q = (extra = "") => `/swipes?from=${DAY}&to=${DAY}&deviceId=${deviceId}${extra}`;
  const binary = (r: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  };
  const punch = async (name: string, time: string, opts: { employeeId?: string | null; deviceUserId?: string; flag?: "TOO_OLD" | "FUTURE"; route?: "AGENT" | "PUSH" | "IMPORT" } = {}) => {
    const row = await prisma.rawPunch.create({
      data: {
        deviceId,
        deviceUserId: opts.deviceUserId ?? p.a.employeeCode,
        punchedAt: ist(DAY, time),
        localTime: `${DAY} ${time}`,
        businessDate: d(DAY),
        status: "1",
        verifyMode: "255",
        workcode: "1",
        reserved: "0",
        rawLine: "test",
        route: opts.route ?? "IMPORT",
        batchId,
        employeeId: opts.employeeId === undefined ? p.a.employeeId : opts.employeeId,
        flag: opts.flag ?? null,
      },
    });
    ids[name] = row.id;
    return row;
  };

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    p.a = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    for (const k of ["hr", "emp"] as const) tok[k] = await loginAs(p[k].employeeCode);
    deviceId = (await prisma.device.create({ data: { serialNumber: `SWP-${tag}`, name: "Swipes test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    await punch("in", "10:00:00", { route: "AGENT" });
    await punch("dup", "10:00:40"); // a near-duplicate: kept on record, not used
    await punch("accepted", "14:00:00", { flag: "TOO_OLD" });
    await punch("out", "19:00:00", { route: "PUSH" });
    await punch("pending", "15:00:00", { flag: "FUTURE" }); // flagged, no decision yet: not used
    await punch("discarded", "16:00:00", { flag: "TOO_OLD" });
    await punch("nobody", "10:05:00", { employeeId: null, deviceUserId: "7777" });
    await prisma.punchFlagResolution.create({ data: { punchId: ids.accepted!, decision: "ACCEPTED", decidedByUserId: p.hr.userId } });
    await prisma.punchFlagResolution.create({ data: { punchId: ids.discarded!, decision: "DISCARDED", reason: "Not a real punch", decidedByUserId: p.hr.userId } });
    await computeAttendance([p.a.employeeId], DAY, DAY);
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await purgeAppendOnly("AuditLog", { action: "attendance.swipes.exported", entityId: "export", actorUserId: p.hr.userId });
    await prisma.punchFlagResolution.deleteMany({ where: { punchId: { in: Object.values(ids) } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("RawPunch", Object.values(ids));
    await deleteWithDependents("IngestionBatch", [batchId]);
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("is for holders of attendance.swipes.view only", async () => {
    for (const path of [q(), "/swipes/options", `/swipes/export?from=${DAY}&to=${DAY}`]) {
      expect((await request(app).get(`/api/attendance${path}`).set(...authHeader(tok.emp))).status).toBe(403);
    }
  });

  it("shows every punch exactly as received: duplicates, flagged ones with their decision, and the one matching nobody", async () => {
    const res = await hr().get(q());
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(7);
    const by = Object.fromEntries(res.body.entries.map((e: { id: string }) => [e.id, e]));
    expect(by[ids.in!]).toMatchObject({ deviceTime: `${DAY} 10:00:00`, device: "Swipes test device", deviceUserId: p.a.employeeCode, employeeCode: p.a.employeeCode, route: "AGENT", flag: null, used: true });
    expect(by[ids.in!].time).toBe(`${DAY} 10:00:00`);
    expect(by[ids.dup!]).toMatchObject({ used: false, flag: null }); // there, verbatim, but the engine counted the pair once
    expect(by[ids.accepted!]).toMatchObject({ flag: "TOO_OLD", decision: "ACCEPTED", used: true });
    expect(by[ids.pending!]).toMatchObject({ flag: "FUTURE", decision: null, used: false });
    expect(by[ids.discarded!]).toMatchObject({ flag: "TOO_OLD", decision: "DISCARDED", decisionReason: "Not a real punch", used: false });
    expect(by[ids.nobody!]).toMatchObject({ employeeId: null, employeeCode: null, deviceUserId: "7777", used: false });
    expect(by[ids.out!]).toMatchObject({ route: "PUSH", used: true });
    // Newest first.
    expect(res.body.entries.map((e: { punchedAt: string }) => e.punchedAt)).toEqual([...res.body.entries.map((e: { punchedAt: string }) => e.punchedAt)].sort().reverse());
  });

  it("'used' agrees with what the day was computed from", async () => {
    const day = await prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: p.a.employeeId, date: d(DAY) } } });
    const used = ((day.computedFrom as { punchIds: string[] }).punchIds ?? []).sort();
    const listed = (await hr().get(q("&used=yes"))).body.entries.map((e: { id: string }) => e.id).sort();
    expect(listed).toEqual(used);
    expect((await hr().get(q("&used=no"))).body.total).toBe(7 - used.length);
  });

  it("filters by flag state, unmapped, route and employee, and pages on the server", async () => {
    expect((await hr().get(q("&flagged=any"))).body.total).toBe(3);
    expect((await hr().get(q("&flagged=pending"))).body.entries.map((e: { id: string }) => e.id)).toEqual([ids.pending]);
    expect((await hr().get(q("&flagged=accepted"))).body.entries.map((e: { id: string }) => e.id)).toEqual([ids.accepted]);
    expect((await hr().get(q("&flagged=discarded"))).body.entries.map((e: { id: string }) => e.id)).toEqual([ids.discarded]);
    expect((await hr().get(q("&flagged=none"))).body.total).toBe(4);
    expect((await hr().get(q("&unmapped=true"))).body.entries.map((e: { id: string }) => e.id)).toEqual([ids.nobody]);
    expect((await hr().get(q("&route=AGENT"))).body.entries.map((e: { id: string }) => e.id)).toEqual([ids.in]);
    expect((await hr().get(q(`&employeeId=${p.a.employeeId}`))).body.total).toBe(6);
    const page2 = await hr().get(q("&pageSize=3&page=2"));
    expect(page2.body).toMatchObject({ total: 7, page: 2, pageSize: 3 });
    expect(page2.body.entries).toHaveLength(3);
  });

  it("covers at most 31 days at a time and refuses an end date before the start", async () => {
    const wide = await hr().get(`/swipes?from=2026-08-01&to=2026-09-29`);
    expect(wide.status).toBe(400);
    expect(wide.body.error.code).toBe("TOO_WIDE");
    expect((await hr().get(`/swipes?from=2026-09-20&to=2026-09-10`)).status).toBe(400);
  });

  it("lists devices for the filter", async () => {
    const res = await hr().get("/swipes/options");
    expect(res.body.devices.map((x: { id: string }) => x.id)).toContain(deviceId);
    expect(res.body.routes).toEqual(["AGENT", "PUSH", "IMPORT"]);
  });

  it("exports to Excel with the same filters, says what it holds, and the export is on record", async () => {
    const res = await hr().get(`/swipes/export?from=${DAY}&to=${DAY}&deviceId=${deviceId}&flagged=any`).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(`employee-swipes-${DAY}-to-${DAY}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const sheet = wb.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual(expect.arrayContaining(["Time as the device recorded it", "Arrived by", "Used in a computed day"]));
    const times = sheet.getColumn(2).values.map(String);
    expect(times).toEqual(expect.arrayContaining([`${DAY} 14:00:00`, `${DAY} 15:00:00`, `${DAY} 16:00:00`]));
    expect(times).not.toContain(`${DAY} 10:00:00`); // not flagged: filtered out
    const text = sheet.getColumn(1).values.map(String).join("\n");
    expect(text).toContain("Raw punches exactly as received, 3 rows");
    expect(text).toContain("flagged: any");
    expect(text).toContain("Company-wide, including punches that match no employee.");
    const audit = await prisma.auditLog.findFirst({ where: { action: "attendance.swipes.exported", actorUserId: p.hr.userId }, orderBy: { createdAt: "desc" } });
    expect(audit).not.toBeNull();
    expect(audit!.after).toMatchObject({ capped: false });
  });
});
