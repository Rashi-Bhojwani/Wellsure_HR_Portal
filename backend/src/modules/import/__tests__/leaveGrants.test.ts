import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, createEmployeeTestOrgMasters, grantPermissions, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { cleanupLoginableTestEmployee, createLoginableTestEmployee } from "../../leave/__tests__/leaveTestHelpers";
import { writeLedgerEntry } from "../../leave/ledger";
import { DATASET_COLUMNS } from "../types";
import { buildXlsx } from "./importTestHelpers";

describe("Import Center — leave-grants dataset (/api/import/leave-grants)", () => {
  const managerRole = `TEST_LEAVEGRANTS_MGR_${Date.now()}`; // import.manage + leave.grant, matching HR_EXECUTIVE_PERMS
  let org: TestOrgMasters;
  let managerToken: string;
  let plTypeId: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(managerRole, ["import.manage", "leave.grant"]);

    const manager = await createLoginableTestEmployee(org, { roleCode: managerRole });
    employeeIds.push(manager.employeeId);
    managerToken = await loginAs(manager.employeeCode);

    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    plTypeId = plType.id;
  });

  afterAll(async () => {
    for (const id of [...employeeIds].reverse()) await cleanupLoginableTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("rejects a COF row, pointing to the Comp-Off Grant action instead", async () => {
    const employee = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(employee.employeeId);

    const file = await buildXlsx(DATASET_COLUMNS["leave-grants"], [
      { employeeCode: employee.employeeCode, leaveTypeCode: "COF", days: "1", entryDate: "2026-06-01", remarks: "" },
    ]);
    const res = await request(app)
      .post("/api/import/leave-grants/upload")
      .set(...authHeader(managerToken))
      .attach("file", file, "leave-grants.xlsx");
    expect(res.status).toBe(201);
    expect(res.body.errorRows).toBe(1);
    expect(res.body.rows[0].errors.join(" ")).toMatch(/Comp-Off Grant/);
  });

  it("validates unknown employee/leave type and a malformed days value", async () => {
    const file = await buildXlsx(DATASET_COLUMNS["leave-grants"], [
      { employeeCode: "NONEXISTENT-CODE", leaveTypeCode: "PL", days: "1", entryDate: "2026-06-01", remarks: "" },
      { employeeCode: "NONEXISTENT-CODE", leaveTypeCode: "NOPE", days: "1", entryDate: "2026-06-01", remarks: "" },
      { employeeCode: "NONEXISTENT-CODE", leaveTypeCode: "PL", days: "not-a-number", entryDate: "2026-06-01", remarks: "" },
      { employeeCode: "NONEXISTENT-CODE", leaveTypeCode: "PL", days: "0", entryDate: "2026-06-01", remarks: "" },
    ]);
    const res = await request(app)
      .post("/api/import/leave-grants/upload")
      .set(...authHeader(managerToken))
      .attach("file", file, "leave-grants.xlsx");
    expect(res.body.errorRows).toBe(4);
    expect(res.body.rows[0].errors.join(" ")).toMatch(/Unknown employee code/);
    expect(res.body.rows[1].errors.join(" ")).toMatch(/Unknown or inactive leave type/);
    expect(res.body.rows[2].errors.join(" ")).toMatch(/whole or half number/);
    expect(res.body.rows[3].errors.join(" ")).toMatch(/must not be zero/);
  });

  it("commits a batch of grants and debits, writing GRANT/DEBIT ledger rows", async () => {
    const employee = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(employee.employeeId);
    // Starting balance so the debit row below has something to draw down.
    await writeLedgerEntry(prisma, { employeeId: employee.employeeId, leaveTypeId: plTypeId, leaveYear: 2026, entryDate: new Date("2026-01-01"), entryType: "ACCRUAL", days: 5 });

    const file = await buildXlsx(DATASET_COLUMNS["leave-grants"], [
      { employeeCode: employee.employeeCode, leaveTypeCode: "PL", days: "2", entryDate: "2026-06-01", remarks: "Correction" },
      { employeeCode: employee.employeeCode, leaveTypeCode: "PL", days: "-1", entryDate: "2026-06-02", remarks: "Correction" },
    ]);
    const upload = await request(app)
      .post("/api/import/leave-grants/upload")
      .set(...authHeader(managerToken))
      .attach("file", file, "leave-grants.xlsx");
    expect(upload.body.errorRows).toBe(0);

    const commitRes = await request(app)
      .post(`/api/import/batches/${upload.body.batchId}/commit`)
      .set(...authHeader(managerToken))
      .send({});
    expect(commitRes.status).toBe(200);
    expect(commitRes.body.committedRows).toBe(2);

    const entries = await prisma.leaveLedger.findMany({ where: { employeeId: employee.employeeId, leaveTypeId: plTypeId, referenceType: "MANUAL_GRANT" }, orderBy: { entryDate: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.entryType).toBe("GRANT");
    expect(entries[0]!.days.toNumber()).toBe(2);
    expect(entries[1]!.entryType).toBe("DEBIT");
    expect(entries[1]!.days.toNumber()).toBe(-1);
  });

  it("aborts the whole batch (no partial commit) when a debit would take a no-negative-balance type negative", async () => {
    const employee = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
    employeeIds.push(employee.employeeId);
    // No starting balance at all — PL has negativeBalanceAllowed=false by default.
    const suffix = randomUUID().slice(0, 6);

    const file = await buildXlsx(DATASET_COLUMNS["leave-grants"], [
      { employeeCode: employee.employeeCode, leaveTypeCode: "PL", days: "-3", entryDate: "2026-07-01", remarks: `abort-test-${suffix}` },
    ]);
    const upload = await request(app)
      .post("/api/import/leave-grants/upload")
      .set(...authHeader(managerToken))
      .attach("file", file, "leave-grants.xlsx");
    expect(upload.body.errorRows).toBe(0); // format-valid; balance isn't checked until commit

    const commitRes = await request(app)
      .post(`/api/import/batches/${upload.body.batchId}/commit`)
      .set(...authHeader(managerToken))
      .send({});
    expect(commitRes.status).toBe(400);
    expect(commitRes.body.error.code).toBe("INSUFFICIENT_BALANCE");

    const entries = await prisma.leaveLedger.findMany({ where: { employeeId: employee.employeeId, referenceType: "MANUAL_GRANT", remarks: `abort-test-${suffix}` } });
    expect(entries).toHaveLength(0); // nothing was committed — the transaction rolled back
  });
});
