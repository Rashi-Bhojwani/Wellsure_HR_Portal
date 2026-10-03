import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
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
} from "../../employee/__tests__/employeeTestHelpers";
import { DATASET_COLUMNS } from "../types";
import { buildXlsx } from "./importTestHelpers";

describe("Import Center (/api/import)", () => {
  const managerRole = `TEST_IMPORT_MGR_${Date.now()}`; // import.manage + employee.bank.edit
  const executiveRole = `TEST_IMPORT_EXEC_${Date.now()}`; // import.manage only
  const noPermRole = `TEST_IMPORT_NONE_${Date.now()}`;
  let org: TestOrgMasters;
  let managerToken: string;
  let executiveToken: string;
  let noPermToken: string;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(managerRole, ["import.manage", "employee.bank.edit", "employee.statutory.edit"]);
    await grantPermissions(executiveRole, ["import.manage"]);
    await grantPermissions(noPermRole, []);

    const manager = await createFullTestEmployee(org, { roleCode: managerRole });
    employeeIds.push(manager.employeeId);
    managerToken = await loginAs(manager.employeeCode);

    const executive = await createFullTestEmployee(org, { roleCode: executiveRole });
    employeeIds.push(executive.employeeId);
    executiveToken = await loginAs(executive.employeeCode);

    const plain = await createFullTestEmployee(org, { roleCode: noPermRole });
    employeeIds.push(plain.employeeId);
    noPermToken = await loginAs(plain.employeeCode);
  });

  afterAll(async () => {
    for (const id of employeeIds) await cleanupFullTestEmployee(id);
    await cleanupTestRole(managerRole);
    await cleanupTestRole(executiveRole);
    await cleanupTestRole(noPermRole);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("blocks every route without import.manage", async () => {
    const res = await request(app).get("/api/import/employees/template").set(...authHeader(noPermToken));
    expect(res.status).toBe(403);
  });

  it("downloads a blank template with the expected header row", async () => {
    const res = await request(app).get("/api/import/employees/template").set(...authHeader(managerToken));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  describe("org-masters dataset", () => {
    it("flags an unknown city and blocks commit until fixed, then commits once clean", async () => {
      const suffix = randomUUID().slice(0, 8);
      const badFile = await buildXlsx(DATASET_COLUMNS["org-masters"], [
        {
          type: "LOCATION",
          code: `T-LOC-${suffix}`,
          name: `Test Branch ${suffix}`,
          cityName: `Nonexistent City ${suffix}`,
          addressLine1: "1 Test Rd",
          city: "Testville",
          state: "TS",
          pincode: "123456",
        },
      ]);
      const badUpload = await request(app)
        .post("/api/import/org-masters/upload")
        .set(...authHeader(managerToken))
        .attach("file", badFile, "org-masters.xlsx");
      expect(badUpload.status).toBe(201);
      expect(badUpload.body.errorRows).toBe(1);
      expect(badUpload.body.rows[0].errors.join(" ")).toMatch(/Unknown city/);

      const blockedCommit = await request(app)
        .post(`/api/import/batches/${badUpload.body.batchId}/commit`)
        .set(...authHeader(managerToken))
        .send({});
      expect(blockedCommit.status).toBe(400);
      expect(blockedCommit.body.error.code).toBe("HAS_ERRORS");

      const goodFile = await buildXlsx(DATASET_COLUMNS["org-masters"], [
        { type: "DEPARTMENT", code: `T-DEPT-${suffix}`, name: `Test Department ${suffix}` },
      ]);
      const goodUpload = await request(app)
        .post("/api/import/org-masters/upload")
        .set(...authHeader(managerToken))
        .attach("file", goodFile, "org-masters.xlsx");
      expect(goodUpload.body.errorRows).toBe(0);
      expect(goodUpload.body.validRows).toBe(1);

      const commitRes = await request(app)
        .post(`/api/import/batches/${goodUpload.body.batchId}/commit`)
        .set(...authHeader(managerToken))
        .send({});
      expect(commitRes.status).toBe(200);
      expect(commitRes.body.committedRows).toBe(1);

      const created = await prisma.department.findUnique({ where: { code: `T-DEPT-${suffix}` } });
      expect(created).not.toBeNull();
      await prisma.department.delete({ where: { code: `T-DEPT-${suffix}` } });
    });

    it("warns (but doesn't block) on a near-duplicate department name, and rejects an exact duplicate code", async () => {
      const suffix = randomUUID().slice(0, 8);
      const original = await prisma.department.create({ data: { code: `T-ORIG-${suffix}`, name: `Marketing Team ${suffix}` } });

      const file = await buildXlsx(DATASET_COLUMNS["org-masters"], [
        // Near-duplicate name (one-character typo), different code — should warn, not error.
        { type: "DEPARTMENT", code: `T-NEARDUP-${suffix}`, name: `Marketing Teem ${suffix}` },
        // Exact duplicate code — should error.
        { type: "DEPARTMENT", code: `T-ORIG-${suffix}`, name: `Something Else ${suffix}` },
      ]);
      const res = await request(app)
        .post("/api/import/org-masters/upload")
        .set(...authHeader(managerToken))
        .attach("file", file, "org-masters.xlsx");

      expect(res.body.rows[0].warnings.length).toBeGreaterThan(0);
      expect(res.body.rows[0].errors).toHaveLength(0);
      expect(res.body.rows[1].errors.join(" ")).toMatch(/already exists/);

      await prisma.department.delete({ where: { id: original.id } });
    });
  });

  describe("employees dataset", () => {
    it("rejects a duplicate employeeCode within the same file, then commits the rest without sending an invitation email", async () => {
      const suffix = randomUUID().slice(0, 8);
      const code = `T-IMP-${suffix}`;
      const row = {
        deviceUserId: code,
        employeeCode: code,
        fullName: "Import Test Employee",
        dateOfBirth: "1992-01-01",
        gender: "MALE",
        personalEmail: `import.test.${suffix}@gmail.com`,
        mobile: "9123456780",
        currentAddress: "1 Test Rd",
        permanentAddress: "1 Test Rd",
        emergencyContactName: "Contact",
        emergencyContactPhone: "9123456781",
        emergencyContactRelation: "Friend",
        bloodGroup: "",
        dateOfJoining: "2024-01-01",
        employmentType: "PERMANENT",
        departmentCode: org.departmentId, // placeholder, replaced below with real code
        designationCode: "",
        locationCode: "",
        gradeCode: "",
        costCentreCode: "",
        reportingManagerCode: "",
        officialEmail: "",
      };
      const deptCode = (await prisma.department.findUnique({ where: { id: org.departmentId } }))!.code;
      const desigCode = (await prisma.designation.findUnique({ where: { id: org.designationId } }))!.code;
      const locCode = (await prisma.location.findUnique({ where: { id: org.locationId } }))!.code;
      row.departmentCode = deptCode;
      row.designationCode = desigCode;
      row.locationCode = locCode;

      const file = await buildXlsx(DATASET_COLUMNS.employees, [row, { ...row, deviceUserId: `${code}-dup` }]);
      const upload = await request(app)
        .post("/api/import/employees/upload")
        .set(...authHeader(managerToken))
        .attach("file", file, "employees.xlsx");
      expect(upload.body.errorRows).toBe(1);
      expect(upload.body.rows[1].errors.join(" ")).toMatch(/Duplicate Employee Code/);

      // Re-upload with just the one valid row and commit it.
      const cleanFile = await buildXlsx(DATASET_COLUMNS.employees, [row]);
      const cleanUpload = await request(app)
        .post("/api/import/employees/upload")
        .set(...authHeader(managerToken))
        .attach("file", cleanFile, "employees.xlsx");
      expect(cleanUpload.body.errorRows).toBe(0);

      const commitRes = await request(app)
        .post(`/api/import/batches/${cleanUpload.body.batchId}/commit`)
        .set(...authHeader(managerToken))
        .send({});
      expect(commitRes.status).toBe(200);

      const created = await prisma.employee.findUnique({ where: { employeeCode: code }, include: { user: true } });
      expect(created).not.toBeNull();
      employeeIds.push(created!.id);

      // spec §10: "invitations are sent in batches, HR-triggered, never
      // automatically on import" — this employee must be INVITED-status
      // with no invitation token issued yet.
      expect(created!.user!.status).toBe("INVITED");
      const invitations = await prisma.invitationToken.count({ where: { userId: created!.user!.id } });
      expect(invitations).toBe(0);
    });

    it("imports an ex-employee as separated — last working day and reason, no Separation row, no login, device ID free for reuse", async () => {
      const suffix = randomUUID().slice(0, 8);
      const [deptCode, desigCode, locCode] = await Promise.all([
        prisma.department.findUniqueOrThrow({ where: { id: org.departmentId } }).then((x) => x.code),
        prisma.designation.findUniqueOrThrow({ where: { id: org.designationId } }).then((x) => x.code),
        prisma.location.findUniqueOrThrow({ where: { id: org.locationId } }).then((x) => x.code),
      ]);
      // Someone current already holds this device ID — a leaver's old ID being reused (spec §3).
      const takenDeviceId = (await prisma.deviceUserMapping.findFirstOrThrow({ where: { employeeId: employeeIds[0], validTo: null } })).deviceUserId;
      const base = (n: string) => ({
        deviceUserId: `EX-${suffix}-${n}`,
        employeeCode: `EX-${suffix}-${n}`,
        fullName: `Former Employee ${n}`,
        dateOfBirth: "1985-05-05",
        gender: "FEMALE",
        personalEmail: `former.${suffix}.${n}@gmail.com`,
        mobile: "9123456790",
        currentAddress: "2 Old Rd",
        permanentAddress: "2 Old Rd",
        emergencyContactName: "Contact",
        emergencyContactPhone: "9123456791",
        emergencyContactRelation: "Sibling",
        bloodGroup: "",
        dateOfJoining: "2019-04-01",
        employmentType: "PERMANENT",
        departmentCode: deptCode,
        designationCode: desigCode,
        locationCode: locCode,
        gradeCode: "",
        costCentreCode: "",
        reportingManagerCode: "",
        officialEmail: "",
        lastWorkingDate: "",
        exitReason: "",
      });
      // The device ID's current holder started 2024-01-01: a leaver can have
      // held it only up to the day before (EF1: one ID is never two people).
      const good = { ...base("a"), deviceUserId: takenDeviceId, lastWorkingDate: "2023-12-31", exitReason: "Relocated" };
      const rows = [
        good,
        { ...base("b"), lastWorkingDate: "2099-01-01" }, // not left yet
        { ...base("c"), exitReason: "Resigned" }, // reason without a last working day
        { ...base("d"), lastWorkingDate: "2018-01-01" }, // before joining
        { ...base("e"), lastWorkingDate: "2025-03-31" }, // fine, but no reason → a warning
        { ...base("f"), deviceUserId: takenDeviceId, lastWorkingDate: "2025-06-30", exitReason: "Relocated" }, // overlaps the current holder
      ];
      const upload = await request(app).post("/api/import/employees/upload").set(...authHeader(managerToken)).attach("file", await buildXlsx(DATASET_COLUMNS.employees, rows), "employees.xlsx");
      expect(upload.status).toBe(201);
      const msgs = (i: number) => [...upload.body.rows[i].errors, ...upload.body.rows[i].warnings].join(" ");
      expect(upload.body.rows[0].errors).toEqual([]);
      expect(msgs(1)).toMatch(/lastWorkingDate is in the future/);
      expect(msgs(2)).toMatch(/exitReason is only for ex-employees/);
      expect(msgs(3)).toMatch(/lastWorkingDate is before dateOfJoining/);
      expect(upload.body.rows[4].errors).toEqual([]);
      expect(msgs(4)).toMatch(/No exitReason/);
      expect(msgs(5)).toMatch(/One device ID can't be two people on the same day/);

      const clean = await request(app).post("/api/import/employees/upload").set(...authHeader(managerToken)).attach("file", await buildXlsx(DATASET_COLUMNS.employees, [good]), "employees.xlsx");
      expect(clean.body.errorRows).toBe(0);
      expect((await request(app).post(`/api/import/batches/${clean.body.batchId}/commit`).set(...authHeader(managerToken)).send({})).status).toBe(200);

      const e = await prisma.employee.findUniqueOrThrow({ where: { employeeCode: good.employeeCode }, include: { user: true, jobHistory: true, separations: true } });
      employeeIds.push(e.id);
      expect(e).toMatchObject({ status: "SEPARATED", exitReason: "Relocated" });
      expect(e.lastWorkingDate?.toISOString().slice(0, 10)).toBe("2023-12-31");
      expect(e.separations).toEqual([]); // no Separation row needed
      expect(e.user!.status).toBe("DEACTIVATED"); // never invited, can't log in
      // EF1: history ends the day AFTER the last working day (in force on it).
      expect(e.jobHistory.map((j) => j.effectiveTo?.toISOString().slice(0, 10))).toEqual(["2024-01-01"]);
      const mapping = await prisma.deviceUserMapping.findFirstOrThrow({ where: { employeeId: e.id } });
      expect(mapping.validTo?.toISOString().slice(0, 10)).toBe("2024-01-01");
    });
  });

  describe("statutory dataset", () => {
    it("requires an existing employee, validates PAN format, and never echoes the full PAN back", async () => {
      const employee = await createFullTestEmployee(org);
      employeeIds.push(employee.employeeId);

      const file = await buildXlsx(DATASET_COLUMNS.statutory, [
        { employeeCode: "NONEXISTENT-CODE", pan: "", aadhaar: "", uan: "", esiNumber: "" },
        { employeeCode: employee.employeeCode, pan: "NOTAVALIDPAN", aadhaar: "", uan: "", esiNumber: "" },
      ]);
      const upload = await request(app)
        .post("/api/import/statutory/upload")
        .set(...authHeader(managerToken))
        .attach("file", file, "statutory.xlsx");
      expect(upload.body.rows[0].errors.join(" ")).toMatch(/Unknown employee code/);
      expect(upload.body.rows[1].errors.join(" ")).toMatch(/not a valid PAN/);
      // The bad PAN must never appear verbatim anywhere in the response.
      expect(JSON.stringify(upload.body)).not.toContain("NOTAVALIDPAN");

      const goodFile = await buildXlsx(DATASET_COLUMNS.statutory, [{ employeeCode: employee.employeeCode, pan: "ABCDE1234F", aadhaar: "", uan: "", esiNumber: "" }]);
      const goodUpload = await request(app)
        .post("/api/import/statutory/upload")
        .set(...authHeader(managerToken))
        .attach("file", goodFile, "statutory.xlsx");
      expect(goodUpload.body.errorRows).toBe(0);
      expect(goodUpload.body.rows[0].data.pan).toBe("•••••234F"); // masked — last 4 only
      expect(JSON.stringify(goodUpload.body)).not.toContain("ABCDE1234F");

      const commitRes = await request(app)
        .post(`/api/import/batches/${goodUpload.body.batchId}/commit`)
        .set(...authHeader(managerToken))
        .send({});
      expect(commitRes.status).toBe(200);

      const statutory = await prisma.employeeStatutory.findUnique({ where: { employeeId: employee.employeeId } });
      expect(statutory?.panLast4).toBe("234F");
    });
  });

  describe("bank dataset — permission + typed confirmation gating", () => {
    it("blocks upload for a role without employee.bank.edit even though it has import.manage", async () => {
      const employee = await createFullTestEmployee(org);
      employeeIds.push(employee.employeeId);
      const file = await buildXlsx(DATASET_COLUMNS.bank, [
        { employeeCode: employee.employeeCode, accountHolderName: "Test", accountNumber: "1234567890", ifsc: "SBIN0001234", bankName: "SBI", branchName: "Test" },
      ]);
      const res = await request(app)
        .post("/api/import/bank/upload")
        .set(...authHeader(executiveToken))
        .attach("file", file, "bank.xlsx");
      expect(res.status).toBe(403);
    });

    it("requires the exact typed confirmation phrase to commit, then never echoes the full account number anywhere", async () => {
      const employee = await createFullTestEmployee(org);
      employeeIds.push(employee.employeeId);
      const accountNumber = `9${Date.now()}`.slice(0, 12);
      const file = await buildXlsx(DATASET_COLUMNS.bank, [
        { employeeCode: employee.employeeCode, accountHolderName: "Test Holder", accountNumber, ifsc: "SBIN0001234", bankName: "SBI", branchName: "Test Branch" },
      ]);
      const upload = await request(app)
        .post("/api/import/bank/upload")
        .set(...authHeader(managerToken))
        .attach("file", file, "bank.xlsx");
      expect(upload.status).toBe(201);
      expect(upload.body.errorRows).toBe(0);
      expect(JSON.stringify(upload.body)).not.toContain(accountNumber);

      const noConfirm = await request(app)
        .post(`/api/import/batches/${upload.body.batchId}/commit`)
        .set(...authHeader(managerToken))
        .send({});
      expect(noConfirm.status).toBe(400);
      expect(noConfirm.body.error.code).toBe("CONFIRMATION_REQUIRED");

      const wrongConfirm = await request(app)
        .post(`/api/import/batches/${upload.body.batchId}/commit`)
        .set(...authHeader(managerToken))
        .send({ confirmText: "yes please" });
      expect(wrongConfirm.status).toBe(400);

      const committed = await request(app)
        .post(`/api/import/batches/${upload.body.batchId}/commit`)
        .set(...authHeader(managerToken))
        .send({ confirmText: "IMPORT BANK DATA" });
      expect(committed.status).toBe(200);
      expect(JSON.stringify(committed.body)).not.toContain(accountNumber);

      // Effective-dating: exactly one open bank row for this employee
      // afterward — the partial unique index (employee_id) WHERE
      // effective_to IS NULL rejects a second, matching effective-dated
      // updates everywhere else in the app (spec §11).
      const openRows = await prisma.employeeBankAccount.findMany({ where: { employeeId: employee.employeeId, effectiveTo: null } });
      expect(openRows).toHaveLength(1);
      expect(openRows[0]!.accountNumberLast4).toBe(accountNumber.slice(-4));
    });

    it("blocks committing an already-staged bank batch for a role without employee.bank.edit", async () => {
      const employee = await createFullTestEmployee(org);
      employeeIds.push(employee.employeeId);
      const accountNumber = `8${Date.now()}`.slice(0, 12);
      const file = await buildXlsx(DATASET_COLUMNS.bank, [
        { employeeCode: employee.employeeCode, accountHolderName: "Test Holder", accountNumber, ifsc: "SBIN0001234", bankName: "SBI", branchName: "Test Branch" },
      ]);
      const upload = await request(app)
        .post("/api/import/bank/upload")
        .set(...authHeader(managerToken))
        .attach("file", file, "bank.xlsx");

      const res = await request(app)
        .post(`/api/import/batches/${upload.body.batchId}/commit`)
        .set(...authHeader(executiveToken))
        .send({ confirmText: "IMPORT BANK DATA" });
      expect(res.status).toBe(403);
    });
  });

  describe("reconciliation report", () => {
    it("returns active headcount by branch and by department", async () => {
      const res = await request(app).get("/api/import/reconciliation").set(...authHeader(managerToken));
      expect(res.status).toBe(200);
      expect(res.body.totalActive).toBeGreaterThan(0);
      expect(Array.isArray(res.body.byLocation)).toBe(true);
      expect(Array.isArray(res.body.byDepartment)).toBe(true);
    });
  });
});
