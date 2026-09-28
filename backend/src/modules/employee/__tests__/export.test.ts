import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request, { type Response } from "supertest";
import ExcelJS from "exceljs";
import { prisma } from "../../../lib/prisma";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "./employeeTestHelpers";

// superagent (which supertest wraps) only auto-parses content types it
// recognises (json/text/form) — an .xlsx response needs an explicit binary
// parser or `res.body` comes back as `{}`, not the actual file bytes.
function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

describe("GET /api/employees/export", () => {
  const exporterRole = `TEST_EXPORT_${Date.now()}`; // employee.export + employee.bank.view + employee.statutory.view
  const noSensitiveRole = `TEST_EXPORT_PLAIN_${Date.now()}`; // employee.export only
  let org: TestOrgMasters;
  let exporterToken: string;
  let plainExporterToken: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(exporterRole, ["employee.view", "employee.export", "employee.bank.view", "employee.statutory.view"]);
    await grantPermissions(noSensitiveRole, ["employee.view", "employee.export"]);

    const exporter = await createFullTestEmployee(org, { roleCode: exporterRole });
    employeeIds.push(exporter.employeeId);
    exporterToken = await loginAs(exporter.employeeCode);

    const plain = await createFullTestEmployee(org, { roleCode: noSensitiveRole });
    employeeIds.push(plain.employeeId);
    plainExporterToken = await loginAs(plain.employeeCode);
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(exporterRole);
    await cleanupTestRole(noSensitiveRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  async function headerRow(buffer: Buffer): Promise<string[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0]!;
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    return headers;
  }

  it('a plain "?includeSensitive=false" export excludes sensitive columns and audit-logs as the non-sensitive action', async () => {
    // Regression test — z.coerce.boolean() used to parse the string
    // "false" as `true` (any non-empty string is truthy in JS), and axios
    // serialises a JS `false` query param as the literal string "false".
    // That meant the plain Export button — which explicitly sends
    // includeSensitive: false — could silently produce a sensitive export
    // for anyone holding bank/statutory view permission, bypassing the
    // typed confirmation modal this flag is supposed to gate.
    const res = await request(app)
      .get("/api/employees/export")
      .query({ includeSensitive: "false", sortBy: "employeeCode", sortDir: "asc" })
      .set(...authHeader(exporterToken))
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);

    const headers = await headerRow(res.body as Buffer);
    expect(headers).not.toContain("Bank Account (last 4)");
    expect(headers).not.toContain("PAN (last 4)");

    const audit = await prisma.auditLog.findFirst({ where: { action: { startsWith: "employee.export" } }, orderBy: { createdAt: "desc" } });
    expect(audit?.action).toBe("employee.export");
    const after = audit?.after as { includeSensitive: boolean; columns: string[]; rowCount: number };
    expect(after.includeSensitive).toBe(false);
    expect(after.columns).toEqual(headers);
    expect(after.columns).not.toContain("Bank Account (last 4)");
  });

  it('"?includeSensitive=true" includes sensitive columns for a viewer with bank/statutory view, and audit-logs the sensitive action with the full column set', async () => {
    const res = await request(app)
      .get("/api/employees/export")
      .query({ includeSensitive: "true", sortBy: "employeeCode", sortDir: "asc" })
      .set(...authHeader(exporterToken))
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);

    const headers = await headerRow(res.body as Buffer);
    expect(headers).toContain("Bank Account (last 4)");
    expect(headers).toContain("PAN (last 4)");

    const audit = await prisma.auditLog.findFirst({ where: { action: "employee.export.sensitive" }, orderBy: { createdAt: "desc" } });
    const after = audit?.after as { includeSensitive: boolean; columns: string[] };
    expect(after.includeSensitive).toBe(true);
    expect(after.columns).toEqual(headers);
  });

  it("blocks includeSensitive=true outright for a viewer with neither bank nor statutory view permission", async () => {
    const res = await request(app)
      .get("/api/employees/export")
      .query({ includeSensitive: "true", sortBy: "employeeCode", sortDir: "asc" })
      .set(...authHeader(plainExporterToken));
    expect(res.status).toBe(403);
  });

  it("requires employee.export", async () => {
    const noPermRole = `TEST_EXPORT_NONE_${Date.now()}`;
    await grantPermissions(noPermRole, []);
    const noPerm = await createFullTestEmployee(org, { roleCode: noPermRole });
    employeeIds.push(noPerm.employeeId);
    const token = await loginAs(noPerm.employeeCode);

    const res = await request(app).get("/api/employees/export").set(...authHeader(token));
    expect(res.status).toBe(403);
    await cleanupTestRole(noPermRole);
  });
});
