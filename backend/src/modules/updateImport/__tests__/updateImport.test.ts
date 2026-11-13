import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { inForceOn } from "../../../lib/effectiveDating";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { COLUMNS } from "../service";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  cleanupTestRole,
  grantPermissions,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

async function xlsx(rows: Array<Record<string, string>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Update employees");
  ws.addRow([...COLUMNS]);
  for (const r of rows) ws.addRow(COLUMNS.map((c) => r[c] ?? ""));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// IE-07 / IE-08 (M session block 2): HR updates existing employees from a file; job changes wait for a director by default.
describe("update import", () => {
  let orgA: TestOrgMasters;
  let orgB: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, { employeeId: string; employeeCode: string }> = {};
  const upload = (who: string, buf: Buffer) => request(app).post("/api/update-import/preview").set(...authHeader(t[who]!)).attach("file", buf, "update.xlsx");
  beforeAll(async () => {
    orgA = await createEmployeeTestOrgMasters();
    orgB = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["dir", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["a", undefined], ["b", undefined], ["emp", undefined], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      const x = await createFullTestEmployee(orgA, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x;
      t[k] = await loginAs(x.employeeCode);
    }
  });
  const teamRole = `TEST_UPDATE_IMPORT_TEAM_${Date.now()}`;
  afterAll(async () => {
    const batches = await prisma.updateImportBatch.findMany({ where: { uploadedByUserId: { in: (await prisma.user.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((u) => u.id) } }, select: { id: true } });
    await deleteWithDependents("UpdateImportBatch", batches.map((b) => b.id));
    for (const id of [...ids].reverse()) await cleanupFullTestEmployee(id);
    await cleanupTestRole(teamRole);
    await cleanupEmployeeTestOrgMasters(orgA);
    await cleanupEmployeeTestOrgMasters(orgB);
  });

  it("the template has the columns and no bank or statutory column", async () => {
    const res = await request(app).get("/api/update-import/template").set(...authHeader(t.hr!)).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on("data", (x: Buffer) => c.push(x)); r.on("end", () => cb(null, Buffer.concat(c))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const headers = (wb.worksheets[0]!.getRow(1).values as unknown[]).filter(Boolean).map(String);
    expect(headers).toEqual([...COLUMNS]);
    for (const h of headers) expect(h, h).not.toMatch(/^(account|bank|ifsc|pan|aadhaar|uan|esi)/i);
  });

  it("preview checks every row; HR applies contact details; a job change waits for a director, who applies it", async () => {
    const deptB = await prisma.department.findUniqueOrThrow({ where: { id: orgB.departmentId } });
    const buf = await xlsx([
      { employeeCode: e.a!.employeeCode, mobile: "9876500011", emergencyContactName: "A contact" },
      { employeeCode: e.b!.employeeCode, departmentCode: deptB.code, effectiveFrom: "2026-11-01", changeReason: "Moved teams" },
      { employeeCode: "NOBODY-HERE", mobile: "9876500012" },
      { employeeCode: e.hr!.employeeCode, mobile: "9876500013" },
      { employeeCode: e.a!.employeeCode, mobile: "x" },
    ]);
    const p = await upload("hr", buf);
    expect(p.status).toBe(201);
    const byRow = Object.fromEntries(p.body.rows.map((r: { rowNumber: number }) => [r.rowNumber, r]));
    expect(byRow[2].errors).toEqual([]);
    expect(byRow[3].errors).toEqual([]);
    expect(byRow[4].errors.join()).toMatch(/No employee/);
    expect(byRow[5].errors.join()).toMatch(/own record/);
    expect(byRow[6].errors.join()).toMatch(/twice|mobile/);
    const applied = await request(app).post(`/api/update-import/${p.body.id}/apply`).set(...authHeader(t.hr!));
    expect(applied.body.applied).toEqual({ personal: 1, jobs: 0, waitingForDirector: 1 });
    expect((await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: e.a!.employeeId } })).mobile).toBe("9876500011");
    expect((await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: e.hr!.employeeId } })).mobile).not.toBe("9876500013");
    expect((await request(app).get("/api/update-import/waiting").set(...authHeader(t.dir!))).body.batches.map((b: { id: string }) => b.id)).toContain(p.body.id);
    const byDir = await request(app).post(`/api/update-import/${p.body.id}/apply`).set(...authHeader(t.dir!));
    expect(byDir.body.applied).toEqual({ personal: 0, jobs: 1, waitingForDirector: 0 });
    const job = await prisma.employeeJobHistory.findFirstOrThrow({ where: { employeeId: e.b!.employeeId, ...inForceOn() } });
    expect(job.departmentId).toBe(orgB.departmentId);
    expect(await prisma.auditLog.count({ where: { entityId: p.body.id, action: { startsWith: "employee.update_import." } } })).toBe(3);
  });

  it("someone with employee.edit and a team scope imports for their team only", async () => {
    await grantPermissions(teamRole, ["employee.edit"]);
    await prisma.role.update({ where: { code: teamRole }, data: { dataScope: "TEAM" } });
    const lead = await createFullTestEmployee(orgA, { roleCode: teamRole });
    const report = await createFullTestEmployee(orgA, { managerId: lead.employeeId });
    ids.push(lead.employeeId, report.employeeId);
    t.lead = await loginAs(lead.employeeCode);
    const p = await upload("lead", await xlsx([{ employeeCode: report.employeeCode, mobile: "9876500021" }, { employeeCode: e.a!.employeeCode, mobile: "9876500022" }]));
    expect(p.status).toBe(201);
    expect(p.body.rows[0].errors).toEqual([]);
    expect(p.body.rows[1].errors.join()).toMatch(/in your scope/);
  });

  it("an employee, a manager and the Developer cannot import; nobody reads another uploader's batch", async () => {
    const buf = await xlsx([{ employeeCode: e.a!.employeeCode, mobile: "9876500014" }]);
    for (const who of ["emp", "mgr", "dev"]) expect((await upload(who, buf)).status, who).toBe(403);
    const mine = await upload("hr", buf);
    expect((await request(app).get(`/api/update-import/${mine.body.id}`).set(...authHeader(t.emp!))).status).toBe(403);
  });
});
