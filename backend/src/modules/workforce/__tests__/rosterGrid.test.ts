import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { cellOf, cellText } from "../../attendance/roster/grid";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A-10 G2 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 4): the roster month grid. Fake clock: "today" is Wed 30 Sep 2026.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tag = Date.now().toString(36).slice(-5);
const MONEY = /₹|\bINR\b|\bsalary\b|\bctc\b|\bamount\b/i;

describe("A-10 G2 — the pure cell", () => {
  const sun = [{ weekday: 0 }];
  it("follows the engine's order: not employed, no assignment, holiday before week-off, then work; an override's shift wins", () => {
    expect(cellOf({ date: "2026-09-06", employed: false, holiday: true, assignment: { shiftCode: "G", weekOffRules: sun }, overrideShiftCode: "N" }).kind).toBe("NOT_EMPLOYED");
    expect(cellOf({ date: "2026-09-07", employed: true, holiday: false, assignment: null, overrideShiftCode: null }).kind).toBe("NO_ASSIGNMENT");
    expect(cellOf({ date: "2026-09-06", employed: true, holiday: true, assignment: { shiftCode: "G", weekOffRules: sun }, overrideShiftCode: null })).toMatchObject({ kind: "HOLIDAY", shiftCode: "G" });
    expect(cellOf({ date: "2026-09-06", employed: true, holiday: false, assignment: { shiftCode: "G", weekOffRules: sun }, overrideShiftCode: null })).toMatchObject({ kind: "OFF" });
    const o = cellOf({ date: "2026-09-07", employed: true, holiday: false, assignment: { shiftCode: "G", weekOffRules: sun }, overrideShiftCode: "N" });
    expect(o).toMatchObject({ kind: "WORK", shiftCode: "N", overridden: true });
    expect(cellText(o)).toBe("N*");
  });
  it("agrees with an independent model over every weekday of a year (Sunday off pattern)", () => {
    for (let i = 0; i < 365; i += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const independent = new Date(`${date}T12:00:00Z`).getUTCDay() === 0 ? "OFF" : "WORK";
      expect(cellOf({ date, employed: true, holiday: false, assignment: { shiftCode: "G", weekOffRules: [{ weekday: 0 }] }, overrideShiftCode: null }).kind, date).toBe(independent);
    }
  });
});

describe("A-10 G2 — the roster grid over the routes", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let shiftId = "";
  const get = (who: string, path: string) => request(app).get(path).set(...authHeader(tok[who]!));

  beforeAll(async () => {
    setBusinessTodayForTests(d("2026-09-30"));
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    p.other = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    shiftId = (await prisma.shift.create({ data: { code: `G2${tag}`, name: "A-10 G2 test shift", startTime: "22:00", endTime: "06:00" } })).id;
    await prisma.shiftOverride.create({ data: { employeeId: p.emp.employeeId, date: d("2026-09-15"), shiftId, reason: "test", createdByUserId: p.director.userId } });
  }, 120_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Shift", [shiftId]);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("refuses the Developer role, an ordinary employee and no sign-in", async () => {
    for (const who of ["dev", "emp"]) {
      expect((await get(who, "/api/workforce/roster/grid")).status, who).toBe(403);
      expect((await get(who, "/api/workforce/roster/grid/export")).status, who).toBe(403);
    }
    expect((await request(app).get("/api/workforce/roster/grid")).status).toBe(401);
  });

  it("shows each day's shift (an override marked), week-offs, totals counted independently, and no money", async () => {
    const res = await get("director", "/api/workforce/roster/grid?cycleStart=2026-09-01");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(MONEY);
    const row = res.body.rows.find((r: { employeeId: string }) => r.employeeId === p.emp!.employeeId);
    expect(row).toBeTruthy();
    const byDate = new Map(row.cells.map((c: { date: string }) => [c.date, c]));
    expect(byDate.get("2026-09-15")).toMatchObject({ kind: "WORK", shiftCode: `G2${tag}`, overridden: true });
    expect(byDate.get("2026-09-14")).toMatchObject({ kind: "WORK", shiftCode: "GEN", overridden: false });
    expect(byDate.get("2026-09-13")).toMatchObject({ kind: "OFF" }); // a Sunday
    const sundays = res.body.days.filter((x: string) => new Date(`${x}T12:00:00Z`).getUTCDay() === 0).length;
    const holidays = row.cells.filter((c: { kind: string }) => c.kind === "HOLIDAY").length;
    expect(row.offDays + row.workDays + holidays).toBe(res.body.days.length);
    expect(row.offDays).toBeLessThanOrEqual(sundays);
    expect(res.body.legend.map((l: { code: string }) => l.code)).toContain(`G2${tag}`);
  });

  it("exports the same grid as a spreadsheet", async () => {
    const res = await get("director", "/api/workforce/roster/grid/export?cycleStart=2026-09-01").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("roster-2026-09-01.xlsx");
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
  });

  it("a cycle start that is not a cycle start is refused", async () => {
    expect((await get("director", "/api/workforce/roster/grid?cycleStart=2026-09-05")).status).toBe(400);
  });
});
