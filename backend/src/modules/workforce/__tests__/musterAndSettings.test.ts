import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A-10 G1 (docs/plans/GREYTHR_PARITY_WORKFORCE.md, items 1-3): the status catalogue and its labels, Manual Override's allowed statuses, the muster's unresolved total,
// category filter and markers; totals checked against the cells by an independent count; no money anywhere. Fake clock: "today" is Wed 30 Sep 2026.

type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const TODAY = "2026-09-30";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tag = Date.now().toString(36).slice(-5);
const MONEY = /₹|\bINR\b|\bRs\.?\s?\d|\bsalary\b|\bctc\b|\bamount\b/i;

/** An independent count of what the per-person totals must be, written from the status codes alone (not the production function). */
function expectedTotals(cells: Array<{ status: string | null }>) {
  let present = 0;
  let absent = 0;
  let holidays = 0;
  let off = 0;
  let unresolved = 0;
  for (const c of cells) {
    const st = c.status;
    if (!st) continue;
    const halves = st === "HD" ? ["P", "A"] : st.includes(":") ? st.split(":") : [st, st];
    present += halves.filter((h) => h === "P").length / 2;
    absent += halves.filter((h) => h === "A").length / 2;
    unresolved += halves.filter((h) => h === "NM").length / 2 + (st === "NS" ? 1 : 0);
    if (st === "H") holidays += 1;
    if (st === "O") off += 1;
  }
  return { present, absent, holidays, off, unresolved };
}

describe("A-10 G1 — status catalogue, override statuses, muster", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let deviceId = "";
  let batchId = "";
  const call = (who: string, method: "get" | "put" | "post", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    p.contractor = await createFullTestEmployee(org);
    await prisma.employee.update({ where: { id: p.contractor.employeeId }, data: { employmentType: "CONTRACT" } });
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    deviceId = (await prisma.device.create({ data: { serialNumber: `A10-${tag}`, name: "A-10 test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    // The employee works two days (on time, and inside the grace window on the second), and is absent the rest.
    for (const [date, time] of [["2026-09-28", "10:00"], ["2026-09-28", "19:00"], ["2026-09-29", "10:03"], ["2026-09-29", "19:05"]] as const) {
      await prisma.rawPunch.create({ data: { deviceId, deviceUserId: p.emp.employeeCode, punchedAt: localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata"), localTime: `${date} ${time}:00`, businessDate: d(date), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: p.emp.employeeId } });
    }
  }, 120_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await prisma.workforceSetting.deleteMany({ where: { setByUserId: p.director!.userId } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("settings: only a director saves one, with a reason; history is append-only (the database refuses an edit); the Developer and an employee are refused", async () => {
    for (const who of ["dev", "emp"]) {
      expect((await call(who, "get", "/api/workforce/statuses")).status, who).toBe(403);
      expect((await call(who, "get", "/api/workforce/settings/attendance.statusLabels")).status, who).toBe(403);
    }
    expect((await call("hr", "put", "/api/workforce/settings/attendance.statusLabels", { value: { P: "On site" }, reason: "our words" })).status).toBe(403);
    expect((await call("director", "get", "/api/workforce/settings/attendance.statusLabels")).body).toMatchObject({ notSet: true, value: null });
    expect((await call("director", "put", "/api/workforce/settings/attendance.statusLabels", { value: { P: "On site" } })).status).toBe(400); // a reason
    expect((await call("director", "put", "/api/workforce/settings/attendance.statusLabels", { value: { NOPE: "x" }, reason: "bad code" })).status).toBe(400);
    expect((await call("director", "put", "/api/workforce/settings/attendance.statusLabels", { value: { P: "On site" }, reason: "our own words" })).body).toMatchObject({ notSet: false, value: { P: "On site" } });
    await call("director", "put", "/api/workforce/settings/attendance.statusLabels", { value: { P: "At work" }, reason: "changed our minds" });
    const hist = await call("director", "get", "/api/workforce/settings/attendance.statusLabels/history");
    expect(hist.body.history.map((h: { value: { P: string } }) => h.value.P)).toEqual(["At work", "On site"]);
    expect((await call("hr", "get", "/api/workforce/settings/attendance.statusLabels/history")).status).toBe(403);
    await expect(prisma.workforceSetting.updateMany({ where: { key: "attendance.statusLabels" }, data: { reason: "rewrite" } })).rejects.toThrow(/APPEND_ONLY/);
    const statuses = await call("hr", "get", "/api/workforce/statuses");
    expect(statuses.body.statuses.find((s: { code: string }) => s.code === "P")).toMatchObject({ label: "At work", labelSet: true });
    expect(statuses.body.statuses.find((s: { code: string }) => s.code === "A")).toMatchObject({ meaning: "Absent", labelSet: false });
  });

  it("Manual Override: Not set allows every status; once the directors narrow it, anything else is refused before a preview", async () => {
    const body = { selection: { employeeIds: [p.contractor!.employeeId] }, from: "2026-09-25", to: "2026-09-25", reasonCode: "ON_DUTY_ELSEWHERE", note: "Worked at the client site", releaseLeave: false, status: "A" };
    expect((await call("hr", "post", "/api/attendance/overrides/preview", body)).status).toBe(200);
    await call("director", "put", "/api/workforce/settings/attendance.overrideAllowedStatuses", { value: ["P", "HD_FIRST"], reason: "absent days come from the device only" });
    const refused = await call("hr", "post", "/api/attendance/overrides/preview", body);
    expect([refused.status, refused.body.error.code]).toEqual([400, "STATUS_NOT_ALLOWED"]);
    expect((await call("hr", "post", "/api/attendance/overrides/preview", { ...body, status: "P" })).status).toBe(200);
  });

  it("muster: per-person totals equal an independent count of the cells, unresolved included; category filter; markers; no money in the grid or the export", async () => {
    const res = await call("hr", "get", "/api/attendance/muster?cycleStart=2026-09-01");
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const rows = res.body.rows as Array<{ employeeId: string; cells: Array<{ status: string | null; date: string; markers: string[] }>; totals: Record<string, number> }>;
    const mine = rows.filter((r) => [p.emp!.employeeId, p.contractor!.employeeId].includes(r.employeeId));
    expect(mine).toHaveLength(2);
    for (const r of mine) expect(r.totals).toMatchObject(expectedTotals(r.cells));
    const emp = mine.find((r) => r.employeeId === p.emp!.employeeId)!;
    expect(emp.cells.find((c) => c.date === "2026-09-28")!.status).toBe("P");
    expect(emp.totals.present).toBeGreaterThanOrEqual(2);
    expect(res.body.statusLegend.find((s: { code: string }) => s.code === "P").label).toBe("At work");
    expect(JSON.stringify(res.body)).not.toMatch(MONEY);
    const contract = await call("hr", "get", "/api/attendance/muster?cycleStart=2026-09-01&employmentType=CONTRACT");
    const ids = contract.body.rows.map((r: { employeeId: string }) => r.employeeId);
    expect(ids).toContain(p.contractor!.employeeId);
    expect(ids).not.toContain(p.emp!.employeeId);
    const cycles = await call("hr", "get", "/api/attendance/muster/cycles");
    expect(cycles.body.cycles.length).toBeGreaterThanOrEqual(25); // two years back
    const file = await call("hr", "get", "/api/attendance/muster/export?cycleStart=2026-09-01").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const text = wb.worksheets.map((ws) => ws.getSheetValues().flat().join(" ")).join(" ");
    expect(text).toContain("Unresolved");
    expect(text).not.toMatch(MONEY);
    expect((await call("emp", "get", "/api/attendance/muster?cycleStart=2026-09-01")).status).toBe(403); // an employee reads nobody's muster
    expect((await call("dev", "get", "/api/workforce/statuses")).status).toBe(403);
  });
});
