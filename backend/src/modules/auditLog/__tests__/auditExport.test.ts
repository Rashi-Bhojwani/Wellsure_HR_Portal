import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { prisma } from "../../../lib/prisma";
import { writeAuditLog } from "../../../lib/audit";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// AU-04 (M session): the audit log as an Excel file, directors only, payroll rows still kept from anyone who may not see salary, itself audited.
describe("audit log export", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  let directorUserId = "";
  const marker = `m-audit-export-${Date.now()}`;

  async function sheetText(buf: Buffer): Promise<string> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const out: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => out.push(JSON.stringify(row.values))));
    return out.join("\n");
  }
  const get = (who: string, q = "") => request(app).get(`/api/audit-logs/export${q}`).set(...authHeader(t[who]!)).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["dir", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["emp", undefined], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      t[k] = await loginAs(e.employeeCode);
      if (k === "dir") directorUserId = e.userId;
    }
    await writeAuditLog({ action: `${marker}.plain`, entityType: "Test", entityId: "x1", after: { note: "visible" } });
  });
  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("gives a director the filtered entries as Excel and records the export", async () => {
    const res = await get("dir", `?action=${marker}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    const text = await sheetText(res.body as Buffer);
    expect(text).toContain(`${marker}.plain`);
    expect(text).toContain("1 of 1 matching entries");
    expect(await prisma.auditLog.count({ where: { action: "audit.exported", actorUserId: directorUserId } })).toBe(1);
  });

  it("refuses HR, an employee and the Developer role (which may read the screen but not take a file of it)", async () => {
    for (const who of ["hr", "emp", "dev"]) expect((await get(who)).status, who).toBe(403);
    expect((await request(app).get("/api/audit-logs").set(...authHeader(t.dev!))).status).toBe(200);
  });

  it("rejects an unknown filter", async () => {
    expect((await get("dir", "?page=2")).status).toBe(400);
  });
});
