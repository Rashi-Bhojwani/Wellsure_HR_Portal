import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { unpackBytes } from "../../lib/bytesJson";
import { createEmployeeInTx } from "../employee/service";
import { parseUpload } from "./parse";
import { buildTemplate } from "./templates";
import { loadReferenceData, newBatchTracker, validateBankRow, validateEmployeeRow, validateOrgMasterRow, validateStatutoryRow } from "./rowValidators";
import { DATASET_COLUMNS, DATASET_TO_ENUM, ENUM_TO_DATASET, type ActorMeta, type ImportDatasetKey, type RowResult } from "./types";
import type { ParsedRow } from "./parse";

export { buildTemplate };

function validatorFor(dataset: ImportDatasetKey) {
  return { "org-masters": validateOrgMasterRow, employees: validateEmployeeRow, statutory: validateStatutoryRow, bank: validateBankRow }[dataset];
}

// What HR actually sees in the preview / error report for one row — the
// original column values, with any sensitive field swapped for its last4
// (never the encrypted bytes or hash, and never the plaintext).
function toDisplayRow(dataset: ImportDatasetKey, data: Record<string, unknown>): Record<string, string> {
  const display: Record<string, string> = {};
  for (const col of DATASET_COLUMNS[dataset]) {
    display[col] = data[col] !== undefined && data[col] !== null ? String(data[col]) : "";
  }
  if (dataset === "bank" && data.accountNumberLast4) display.accountNumber = `••••${String(data.accountNumberLast4)}`;
  if (dataset === "statutory") {
    if (data.panLast4) display.pan = `•••••${String(data.panLast4)}`;
    if (data.aadhaarLast4) display.aadhaar = `••••••••${String(data.aadhaarLast4)}`;
    if (data.uanLast4) display.uan = `••••••••${String(data.uanLast4)}`;
  }
  return display;
}

// ── Upload + validate ────────────────────────────────────────────────────

export async function uploadAndValidate(dataset: ImportDatasetKey, fileBuffer: Buffer, fileName: string, meta: ActorMeta, viewerPermissions: Set<string>) {
  if (dataset === "bank" && !viewerPermissions.has("employee.bank.edit")) {
    throw new HttpError(403, "Missing permission: employee.bank.edit", "FORBIDDEN");
  }
  const parsedRows = await parseUpload(dataset, fileBuffer);
  if (parsedRows.length === 0) {
    throw new HttpError(400, "No data rows found in this file.", "EMPTY_FILE");
  }

  const refs = await loadReferenceData();
  const tracker = newBatchTracker();
  const validator = validatorFor(dataset);
  const results: { row: ParsedRow; result: RowResult }[] = parsedRows.map((row) => ({ row, result: validator(row, refs, tracker) }));

  const validRows = results.filter((r) => r.result.errors.length === 0).length;
  const errorRows = results.length - validRows;

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.importBatch.create({
      data: {
        dataset: DATASET_TO_ENUM[dataset],
        fileName,
        totalRows: results.length,
        validRows,
        errorRows,
        uploadedByUserId: meta.actorUserId,
      },
    });
    await tx.importStagingRow.createMany({
      data: results.map(({ row, result }) => ({
        batchId: created.id,
        rowNumber: row.rowNumber,
        data: result.data as Prisma.InputJsonValue,
        errors: result.errors as Prisma.InputJsonValue,
        warnings: result.warnings as Prisma.InputJsonValue,
      })),
    });
    return created;
  });

  await writeAuditLog({
    ...meta,
    action: "import.uploaded",
    entityType: "ImportBatch",
    entityId: batch.id,
    after: { dataset, fileName, totalRows: results.length, validRows, errorRows },
  });

  return {
    batchId: batch.id,
    dataset,
    fileName,
    totalRows: results.length,
    validRows,
    errorRows,
    rows: results.map(({ row, result }) => ({
      rowNumber: row.rowNumber,
      errors: result.errors,
      warnings: result.warnings,
      data: toDisplayRow(dataset, result.data),
    })),
  };
}

// ── Batches ──────────────────────────────────────────────────────────────

export async function listBatches(dataset?: ImportDatasetKey) {
  const batches = await prisma.importBatch.findMany({
    where: dataset ? { dataset: DATASET_TO_ENUM[dataset] } : undefined,
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });
  return batches.map((b) => ({
    id: b.id,
    dataset: ENUM_TO_DATASET[b.dataset],
    fileName: b.fileName,
    status: b.status,
    totalRows: b.totalRows,
    validRows: b.validRows,
    errorRows: b.errorRows,
    uploadedAt: b.uploadedAt.toISOString(),
    committedAt: b.committedAt?.toISOString() ?? null,
  }));
}

// ── Reconciliation report (spec §10: "compare with greytHR before sending
// invites") — active headcount by branch and by department, computed live
// off employee_job_history's current (effective_to IS NULL) rows, not
// anything import-specific. Lives here because spec ties it directly to
// the Import Center workflow, not a separate Reports screen (Phase 5).

export interface HeadcountRow {
  id: string;
  code: string;
  name: string;
  count: number;
}

export async function reconciliationReport(): Promise<{ totalActive: number; byLocation: HeadcountRow[]; byDepartment: HeadcountRow[] }> {
  const [locations, departments, totalActive] = await Promise.all([
    prisma.location.findMany({
      select: { id: true, code: true, name: true, _count: { select: { jobHistory: { where: { effectiveTo: null, employee: { status: "ACTIVE" } } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({
      select: { id: true, code: true, name: true, _count: { select: { jobHistory: { where: { effectiveTo: null, employee: { status: "ACTIVE" } } } } } },
      orderBy: { name: "asc" },
    }),
    prisma.employee.count({ where: { status: "ACTIVE" } }),
  ]);

  return {
    totalActive,
    byLocation: locations.map((l) => ({ id: l.id, code: l.code, name: l.name, count: l._count.jobHistory })),
    byDepartment: departments.map((d) => ({ id: d.id, code: d.code, name: d.name, count: d._count.jobHistory })),
  };
}

async function requireBatch(id: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) throw new HttpError(404, "Import batch not found.", "NOT_FOUND");
  return batch;
}

export async function getBatch(id: string) {
  const batch = await requireBatch(id);
  const rows = await prisma.importStagingRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" } });
  const dataset = ENUM_TO_DATASET[batch.dataset];
  return {
    id: batch.id,
    dataset,
    fileName: batch.fileName,
    status: batch.status,
    totalRows: batch.totalRows,
    validRows: batch.validRows,
    errorRows: batch.errorRows,
    uploadedAt: batch.uploadedAt.toISOString(),
    committedAt: batch.committedAt?.toISOString() ?? null,
    rows: rows.map((r) => ({
      rowNumber: r.rowNumber,
      errors: r.errors as string[],
      warnings: r.warnings as string[],
      data: toDisplayRow(dataset, r.data as Record<string, unknown>),
    })),
  };
}

// ── Error report (downloadable xlsx) ────────────────────────────────────

export async function buildErrorReport(id: string): Promise<{ buffer: Buffer; fileName: string }> {
  const batch = await requireBatch(id);
  const dataset = ENUM_TO_DATASET[batch.dataset];
  const rows = await prisma.importStagingRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" } });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Rows");
  const columns = [...DATASET_COLUMNS[dataset], "Errors", "Warnings"];
  sheet.columns = columns.map((header) => ({ header, key: header, width: header === "Errors" || header === "Warnings" ? 50 : 22 }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const display = toDisplayRow(dataset, row.data as Record<string, unknown>);
    const errors = row.errors as string[];
    const warnings = row.warnings as string[];
    const excelRow = sheet.addRow({ ...display, Errors: errors.join(" · "), Warnings: warnings.join(" · ") });
    if (errors.length > 0) excelRow.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE0E0" } }));
  }

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), fileName: `${dataset}-errors-${new Date().toISOString().slice(0, 10)}.xlsx` };
}

// ── Commit ───────────────────────────────────────────────────────────────

async function commitOrgMasters(tx: Prisma.TransactionClient, rows: { data: Record<string, unknown> }[]): Promise<void> {
  const cities = await tx.city.findMany({ select: { id: true, name: true } });
  const cityIdByName = new Map(cities.map((c) => [c.name.toLowerCase(), c.id]));

  for (const { data } of rows) {
    const type = data.type as string;
    const code = data.code as string;
    const name = data.name as string;
    if (type === "LOCATION") {
      await tx.location.create({
        data: {
          code,
          name,
          cityId: data.cityName ? (cityIdByName.get(String(data.cityName).toLowerCase()) ?? null) : null,
          addressLine1: String(data.addressLine1 ?? ""),
          addressLine2: data.addressLine2 ? String(data.addressLine2) : null,
          city: String(data.city ?? ""),
          state: String(data.state ?? ""),
          pincode: String(data.pincode ?? ""),
        },
      });
    } else if (type === "DEPARTMENT") {
      await tx.department.create({ data: { code, name } });
    } else if (type === "DESIGNATION") {
      await tx.designation.create({ data: { code, name } });
    } else if (type === "GRADE") {
      await tx.grade.create({ data: { code, name, rank: data.rank ? Number(data.rank) : null } });
    } else if (type === "COST_CENTRE") {
      await tx.costCentre.create({ data: { code, name } });
    }
  }
}

async function commitEmployees(tx: Prisma.TransactionClient, rows: { data: Record<string, unknown> }[], meta: ActorMeta): Promise<string[]> {
  // Reference-code -> id lookups are re-resolved here (not reused from
  // upload-time ReferenceData) since committing may happen a while after
  // validating, and this is the version that must actually be correct.
  const [departments, designations, locations, grades, costCentres, employees] = await Promise.all([
    tx.department.findMany({ select: { id: true, code: true } }),
    tx.designation.findMany({ select: { id: true, code: true } }),
    tx.location.findMany({ select: { id: true, code: true } }),
    tx.grade.findMany({ select: { id: true, code: true } }),
    tx.costCentre.findMany({ select: { id: true, code: true } }),
    tx.employee.findMany({ select: { id: true, employeeCode: true } }),
  ]);
  const byCode = (list: { id: string; code: string }[]) => new Map(list.map((x) => [x.code.toLowerCase(), x.id]));
  const deptMap = byCode(departments);
  const desigMap = byCode(designations);
  const locMap = byCode(locations);
  const gradeMap = byCode(grades);
  const ccMap = byCode(costCentres);
  const empByCode = new Map(employees.map((e) => [e.employeeCode.toLowerCase(), e.id]));

  const createdIds: string[] = [];
  for (const { data } of rows) {
    const d = data as Record<string, string>;
    const input = {
      official: {
        deviceUserId: d.deviceUserId!,
        employeeCode: d.employeeCode!,
        dateOfJoining: d.dateOfJoining!,
        departmentId: deptMap.get(d.departmentCode!.toLowerCase())!,
        designationId: desigMap.get(d.designationCode!.toLowerCase())!,
        locationId: locMap.get(d.locationCode!.toLowerCase())!,
        gradeId: d.gradeCode ? (gradeMap.get(d.gradeCode.toLowerCase()) ?? null) : null,
        costCentreId: d.costCentreCode ? (ccMap.get(d.costCentreCode.toLowerCase()) ?? null) : null,
        reportingManagerId: d.reportingManagerCode ? (empByCode.get(d.reportingManagerCode.toLowerCase()) ?? null) : null,
        employmentType: d.employmentType as "PERMANENT" | "CONTRACT" | "INTERN" | "CONSULTANT" | "PROBATION",
        officialEmail: d.officialEmail || null,
      },
      personal: {
        fullName: d.fullName!,
        dateOfBirth: d.dateOfBirth!,
        gender: d.gender!.toUpperCase() as "MALE" | "FEMALE" | "OTHER",
        personalEmail: d.personalEmail!,
        mobile: d.mobile!,
        currentAddress: d.currentAddress!,
        permanentAddress: d.permanentAddress!,
        emergencyContactName: d.emergencyContactName!,
        emergencyContactPhone: d.emergencyContactPhone!,
        emergencyContactRelation: d.emergencyContactRelation!,
        bloodGroup: d.bloodGroup || null,
        photoStorageKey: null,
      },
    };
    const { employee } = await createEmployeeInTx(tx, input, { actorUserId: meta.actorUserId });
    empByCode.set(input.official.employeeCode.toLowerCase(), employee.id);
    createdIds.push(employee.id);
  }
  return createdIds;
}

async function commitStatutory(tx: Prisma.TransactionClient, rows: { data: Record<string, unknown> }[]): Promise<void> {
  const employees = await tx.employee.findMany({ select: { id: true, employeeCode: true } });
  const empByCode = new Map(employees.map((e) => [e.employeeCode.toLowerCase(), e.id]));

  for (const { data } of rows) {
    const d = data as Record<string, string>;
    const employeeId = empByCode.get(d.employeeCode!.toLowerCase());
    if (!employeeId) continue; // re-validated at commit time below; belt-and-braces
    const update: Record<string, unknown> = {};
    if (d.panEncrypted) {
      update.panEncrypted = unpackBytes(d.panEncrypted);
      update.panLast4 = d.panLast4;
      update.panHash = d.panHash;
    }
    if (d.aadhaarEncrypted) {
      update.aadhaarEncrypted = unpackBytes(d.aadhaarEncrypted);
      update.aadhaarLast4 = d.aadhaarLast4;
      update.aadhaarHash = d.aadhaarHash;
    }
    if (d.uanEncrypted) {
      update.uanEncrypted = unpackBytes(d.uanEncrypted);
      update.uanLast4 = d.uanLast4;
    }
    if (d.esiNumber) update.esiNumber = d.esiNumber;
    if (Object.keys(update).length === 0) continue;
    await tx.employeeStatutory.upsert({ where: { employeeId }, create: { employeeId, ...update }, update });
  }
}

async function commitBank(tx: Prisma.TransactionClient, rows: { data: Record<string, unknown> }[], meta: ActorMeta): Promise<void> {
  const employees = await tx.employee.findMany({ select: { id: true, employeeCode: true } });
  const empByCode = new Map(employees.map((e) => [e.employeeCode.toLowerCase(), e.id]));

  for (const { data } of rows) {
    const d = data as Record<string, string>;
    const employeeId = empByCode.get(d.employeeCode!.toLowerCase());
    if (!employeeId || !d.accountNumberEncrypted) continue;

    const current = await tx.employeeBankAccount.findFirst({ where: { employeeId, effectiveTo: null } });
    const effectiveFrom = new Date();
    if (current) {
      await tx.employeeBankAccount.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
    }
    await tx.employeeBankAccount.create({
      data: {
        employeeId,
        accountHolderName: d.accountHolderName!,
        accountNumberEncrypted: unpackBytes(d.accountNumberEncrypted),
        accountNumberLast4: d.accountNumberLast4!,
        accountNumberHash: d.accountNumberHash!,
        ifsc: d.ifsc!,
        bankName: d.bankName!,
        branchName: d.branchName!,
        effectiveFrom,
        createdByUserId: meta.actorUserId,
      },
    });
  }
}

export async function commitBatch(
  id: string,
  meta: ActorMeta,
  viewerPermissions: Set<string>,
  options?: { confirmText?: string },
): Promise<{ committedRows: number }> {
  const batch = await requireBatch(id);
  if (batch.status === "COMMITTED") {
    throw new HttpError(400, "This batch has already been committed.", "ALREADY_COMMITTED");
  }
  if (batch.errorRows > 0) {
    throw new HttpError(400, "This batch still has rows with errors. Fix and re-upload before committing.", "HAS_ERRORS");
  }
  const dataset = ENUM_TO_DATASET[batch.dataset];
  if (dataset === "bank") {
    // Not a route-level requirePermission() — this batch's dataset is only
    // known once loaded (the commit route is /batches/:id/commit, no
    // :dataset param), so the extra bank-specific gate lives here instead.
    if (!viewerPermissions.has("employee.bank.edit")) {
      throw new HttpError(403, "Missing permission: employee.bank.edit", "FORBIDDEN");
    }
    if (options?.confirmText !== "IMPORT BANK DATA") {
      throw new HttpError(400, 'Type "IMPORT BANK DATA" to confirm committing bank account details.', "CONFIRMATION_REQUIRED");
    }
  }

  const rows = await prisma.importStagingRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" } });
  const rowInputs = rows.map((r) => ({ data: r.data as Record<string, unknown> }));

  await prisma.$transaction(
    async (tx) => {
      if (dataset === "org-masters") await commitOrgMasters(tx, rowInputs);
      else if (dataset === "employees") await commitEmployees(tx, rowInputs, meta);
      else if (dataset === "statutory") await commitStatutory(tx, rowInputs);
      else await commitBank(tx, rowInputs, meta);

      await tx.importBatch.update({ where: { id }, data: { status: "COMMITTED", committedByUserId: meta.actorUserId, committedAt: new Date() } });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  await writeAuditLog({
    ...meta,
    action: "import.committed",
    entityType: "ImportBatch",
    entityId: id,
    after: { dataset, rowCount: rows.length },
  });

  return { committedRows: rows.length };
}
