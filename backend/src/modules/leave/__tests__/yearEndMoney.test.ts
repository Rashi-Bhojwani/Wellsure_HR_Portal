import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, cleanupTestRole, createEmployeeTestOrgMasters, createFullTestEmployee, grantPermissions, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { SettingsBasedEncashmentRateProvider, setEncashmentRateProvider } from "../encashmentRate";

// Stage 1.5: encashment is money, so whoever runs the year-end process without pay access works on days alone. A director sees the rupees; that person ("hr" below, a custom role holding the
// year-end key and no salary key) gets nulls in the screens, no money columns in the download, and none in the audit viewer. (Since the HR hard lock grew, the HR roles themselves cannot reach
// the year-end at all: the first test says so. The days-only rule stays as the second line for any other role given the key.) The year used here is one no other test touches.

const YEAR = 2078;

describe("year-end encashment amounts are not HR's", () => {
  const dayOnlyRole = `TEST_YE_DAYS_${Date.now()}`;
  let org: TestOrgMasters;
  let hrAdmin: { employeeId: string; employeeCode: string; userId: string };
  const p = {} as Record<"director" | "hr" | "dev", { employeeId: string; employeeCode: string; userId: string }>;
  const tok = {} as Record<keyof typeof p, string>;
  const runIds: string[] = [];
  let runId = "";
  const as = (who: keyof typeof p) => ({ get: (path: string) => request(app).get(path).set(...authHeader(tok[who])), post: (path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body) });

  beforeAll(async () => {
    setEncashmentRateProvider({ getDailyRate: async () => ({ amount: new Prisma.Decimal(500), source: "MANUAL_SETTING", isFinal: false }) });
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    await grantPermissions(dayOnlyRole, ["leave.yearend.manage", "leave.view", "employee.view"]);
    p.hr = await createFullTestEmployee(org, { roleCode: dayOnlyRole });
    hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: "DEVELOPER" }); // holds the audit viewer and no salary: the person the audit viewer must not leak to
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
    const pl = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    await prisma.leaveLedger.create({ data: { employeeId: p.hr.employeeId, leaveTypeId: pl.id, leaveYear: YEAR, entryDate: new Date(`${YEAR}-03-01T00:00:00Z`), entryType: "GRANT", days: 4, createdByUserId: p.director.userId, remarks: "test" } as never }).catch(() => undefined);
    const created = await as("hr").post("/api/leave/year-end/preview", { leaveYear: YEAR });
    runId = created.body.id;
    runIds.push(runId);
    expect(created.status).toBe(201);
  });
  afterAll(async () => {
    setEncashmentRateProvider(new SettingsBasedEncashmentRateProvider());
    for (const id of runIds) await prisma.yearEndRun.deleteMany({ where: { id } });
    await prisma.leaveLedger.deleteMany({ where: { employeeId: p.hr.employeeId } });
    for (const k of Object.keys(p) as Array<keyof typeof p>) await cleanupFullTestEmployee(p[k].employeeId);
    await cleanupFullTestEmployee(hrAdmin.employeeId);
    await cleanupTestRole(dayOnlyRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("neither HR role can reach the year-end at all (the key is hard-locked), so there are no amounts to hide from them", async () => {
    const token = await loginAs(hrAdmin.employeeCode);
    for (const path of ["/api/leave/year-end", `/api/leave/year-end/${runId}`, `/api/leave/year-end/${runId}/report`]) expect((await request(app).get(path).set(...authHeader(token))).status, path).toBe(403);
  });

  it("HR's own preview, the run, the list and an item carry days but no rupees; a director gets the rupees", async () => {
    const preview = await as("hr").get(`/api/leave/year-end/${runId}`);
    expect(preview.status).toBe(200);
    expect(preview.body.totalEncashedAmount).toBeNull();
    expect(preview.body.totalEmployees).toBeGreaterThan(0);
    expect(preview.body.totalEncashedDays).not.toBeNull();
    for (const item of preview.body.items) expect([item.dailyRate, item.rateSource, item.encashedAmount]).toEqual([null, null, null]);
    const list = await as("hr").get(`/api/leave/year-end?year=${YEAR}`);
    for (const run of list.body.runs) expect(run.totalEncashedAmount).toBeNull();
    const dir = await as("director").get(`/api/leave/year-end/${runId}`);
    expect(dir.body.totalEncashedAmount).not.toBeNull();
    expect(dir.body.items.some((i: { dailyRate: number | null }) => i.dailyRate === 500)).toBe(true);
  });

  it("the download: HR's workbook has no rate, source or amount column; a director's has them", async () => {
    const headers = async (who: keyof typeof p) => {
      const res = await request(app).get(`/api/leave/year-end/${runId}/report`).set(...authHeader(tok[who])).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      const sheet = wb.worksheets[0]!;
      const all: string[] = [];
      sheet.eachRow((row) => row.eachCell((c) => all.push(String(c.value ?? ""))));
      return all;
    };
    const hr = await headers("hr");
    for (const word of ["Daily Rate", "Rate Source", "Encashed Amount", "500", "provisional flat"]) expect(hr.join("|"), word).not.toContain(word);
    expect(hr).toContain("Encashed Days");
    const dir = await headers("director");
    for (const word of ["Daily Rate", "Rate Source", "Encashed Amount"]) expect(dir, word).toContain(word);
  });

  it("the audit viewer: HR does not open it at all (Stage 1); someone who may open it but not see salary does not get the year-end total; a director does", async () => {
    const read = (who: keyof typeof p) => as(who).get("/api/audit-logs?pageSize=100&action=leave.yearend.preview");
    expect((await read("hr")).status).toBe(403);
    const devRow = (await read("dev")).body.rows.find((r: { entityId: string }) => r.entityId === runId);
    expect(devRow).toBeDefined();
    expect(JSON.stringify(devRow.after)).not.toContain("totalEncashedAmount");
    expect(devRow.after.totalEmployees).toBeGreaterThan(0); // the rest of the row is intact
    const dirRow = (await read("director")).body.rows.find((r: { entityId: string }) => r.entityId === runId);
    expect(dirRow.after.totalEncashedAmount).toBeDefined();
  });
});
