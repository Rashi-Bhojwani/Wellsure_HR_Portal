import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { buildEmployeeScopeWhere, type DataScope } from "../../lib/dataScope";
import type { RequestMetaInput } from "./types";

export interface EmployeeListQuery {
  search?: string;
  departmentId?: string;
  designationId?: string;
  locationId?: string;
  cityId?: string;
  status?: "ACTIVE" | "INACTIVE" | "SEPARATED";
  employmentType?: "PERMANENT" | "CONTRACT" | "INTERN" | "CONSULTANT" | "PROBATION";
  sortBy: "employeeCode" | "fullName" | "dateOfJoining" | "status";
  sortDir: "asc" | "desc";
}

interface GridRow {
  id: string;
  employeeCode: string;
  fullName: string;
  photoStorageKey: string | null;
  department: string;
  designation: string;
  location: string;
  city: string | null;
  manager: string | null;
  dateOfJoining: string;
  status: string;
  employmentType: string;
  mobile: string;
  officialEmail: string | null;
  personalEmail: string;
  bankLast4?: string | null;
  panLast4?: string | null;
  aadhaarLast4?: string | null;
}

async function buildWhere(query: EmployeeListQuery, viewerEmployeeId: string, scope: DataScope): Promise<Prisma.EmployeeWhereInput> {
  const scopeWhere = await buildEmployeeScopeWhere(viewerEmployeeId, scope);
  const filters: Prisma.EmployeeWhereInput[] = [scopeWhere];

  if (query.search) {
    filters.push({
      OR: [
        { employeeCode: { contains: query.search, mode: "insensitive" } },
        { nameHistory: { some: { effectiveTo: null, fullName: { contains: query.search, mode: "insensitive" } } } },
        { personal: { personalEmail: { contains: query.search, mode: "insensitive" } } },
        { personal: { mobile: { contains: query.search } } },
      ],
    });
  }
  if (query.status) filters.push({ status: query.status });
  if (query.employmentType) filters.push({ employmentType: query.employmentType });
  if (query.departmentId || query.designationId || query.locationId || query.cityId) {
    filters.push({
      jobHistory: {
        some: {
          effectiveTo: null,
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
          ...(query.designationId ? { designationId: query.designationId } : {}),
          ...(query.locationId ? { locationId: query.locationId } : {}),
          ...(query.cityId ? { location: { cityId: query.cityId } } : {}),
        },
      },
    });
  }

  return { AND: filters };
}

async function loadRows(where: Prisma.EmployeeWhereInput, includeSensitive: { bank: boolean; statutory: boolean }): Promise<GridRow[]> {
  const employees = await prisma.employee.findMany({
    where,
    include: {
      nameHistory: { where: { effectiveTo: null } },
      personal: true,
      jobHistory: {
        where: { effectiveTo: null },
        include: { department: true, designation: true, location: { include: { cityMaster: true } }, reportingManager: { include: { nameHistory: { where: { effectiveTo: null } } } } },
      },
      ...(includeSensitive.bank ? { bankAccounts: { where: { effectiveTo: null } } } : {}),
      ...(includeSensitive.statutory ? { statutory: true } : {}),
    },
  });

  return employees.map((employee) => {
    const job = employee.jobHistory[0];
    const bank = includeSensitive.bank ? (employee as unknown as { bankAccounts: { accountNumberLast4: string }[] }).bankAccounts?.[0] : undefined;
    const statutory = includeSensitive.statutory ? (employee as unknown as { statutory: { panLast4: string | null; aadhaarLast4: string | null } | null }).statutory : undefined;
    return {
      id: employee.id,
      employeeCode: employee.employeeCode,
      fullName: employee.nameHistory[0]?.fullName ?? employee.employeeCode,
      photoStorageKey: employee.personal?.photoStorageKey ?? null,
      department: job?.department.name ?? "—",
      designation: job?.designation.name ?? "—",
      location: job?.location.name ?? "—",
      city: job?.location.cityMaster?.name ?? null,
      manager: job?.reportingManager ? job.reportingManager.nameHistory[0]?.fullName ?? job.reportingManager.employeeCode : null,
      dateOfJoining: employee.dateOfJoining.toISOString().slice(0, 10),
      status: employee.status,
      employmentType: employee.employmentType,
      mobile: employee.personal?.mobile ?? "",
      officialEmail: employee.officialEmail,
      personalEmail: employee.personal?.personalEmail ?? "",
      ...(includeSensitive.bank ? { bankLast4: bank?.accountNumberLast4 ?? null } : {}),
      ...(includeSensitive.statutory ? { panLast4: statutory?.panLast4 ?? null, aadhaarLast4: statutory?.aadhaarLast4 ?? null } : {}),
    };
  });
}

function sortRows(rows: GridRow[], sortBy: EmployeeListQuery["sortBy"], sortDir: "asc" | "desc"): GridRow[] {
  const factor = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortBy] ?? "";
    const bv = b[sortBy] ?? "";
    return av < bv ? -factor : av > bv ? factor : 0;
  });
}

export async function listEmployeesGrid(
  query: EmployeeListQuery & { page: number; pageSize: number },
  viewer: { employeeId: string; permissions: Set<string> },
  scope: DataScope,
) {
  const where = await buildWhere(query, viewer.employeeId, scope);
  const includeSensitive = { bank: viewer.permissions.has("employee.bank.view"), statutory: viewer.permissions.has("employee.statutory.view") };
  const rows = sortRows(await loadRows(where, includeSensitive), query.sortBy, query.sortDir);
  const start = (query.page - 1) * query.pageSize;
  return { rows: rows.slice(start, start + query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize };
}

const EXPORT_COLUMNS: { header: string; key: keyof GridRow; sensitive?: boolean }[] = [
  { header: "Employee Code", key: "employeeCode" },
  { header: "Name", key: "fullName" },
  { header: "Department", key: "department" },
  { header: "Designation", key: "designation" },
  { header: "Location", key: "location" },
  { header: "City", key: "city" },
  { header: "Manager", key: "manager" },
  { header: "Date of Joining", key: "dateOfJoining" },
  { header: "Status", key: "status" },
  { header: "Employment Type", key: "employmentType" },
  { header: "Mobile", key: "mobile" },
  { header: "Official Email", key: "officialEmail" },
  { header: "Personal Email", key: "personalEmail" },
  { header: "Bank Account (last 4)", key: "bankLast4", sensitive: true },
  { header: "PAN (last 4)", key: "panLast4", sensitive: true },
  { header: "Aadhaar (last 4)", key: "aadhaarLast4", sensitive: true },
];

// Grids and exports use last4/masked fields only — spec §9: "never live
// decryption". includeSensitive requires both the export permission and
// the relevant view permission(s), and is separately audit-logged since
// bank/PAN/Aadhaar leaving the system as a file is exactly the kind of
// action spec §9 calls out for its own audit trail (distinct from the
// plain, non-sensitive export, which is still audited but with a
// different action name so the two are easy to tell apart in the log).
export async function exportEmployeesExcel(
  query: EmployeeListQuery,
  viewer: { employeeId: string; permissions: Set<string> },
  scope: DataScope,
  includeSensitive: boolean,
  meta: RequestMetaInput,
): Promise<Buffer> {
  if (includeSensitive && !viewer.permissions.has("employee.bank.view") && !viewer.permissions.has("employee.statutory.view")) {
    throw new HttpError(403, "You don't have permission to export bank or statutory details.", "FORBIDDEN");
  }
  const sensitiveFlags = {
    bank: includeSensitive && viewer.permissions.has("employee.bank.view"),
    statutory: includeSensitive && viewer.permissions.has("employee.statutory.view"),
  };

  const where = await buildWhere(query, viewer.employeeId, scope);
  const rows = sortRows(await loadRows(where, sensitiveFlags), query.sortBy, query.sortDir);
  const columns = EXPORT_COLUMNS.filter((col) => !col.sensitive || sensitiveFlags.bank || sensitiveFlags.statutory);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("All Employees");
  sheet.columns = columns.map((col) => ({ header: col.header, key: col.key, width: 20 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(Object.fromEntries(columns.map((col) => [col.key, row[col.key] ?? ""])));
  }

  await writeAuditLog({
    ...meta,
    action: includeSensitive ? "employee.export.sensitive" : "employee.export",
    entityType: "Employee",
    entityId: "grid",
    after: { rowCount: rows.length, includeSensitive, columns: columns.map((col) => col.header) },
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ── Saved views ──────────────────────────────────────────────────────────

export async function listSavedViews(userId: string, gridKey: string) {
  return prisma.savedView.findMany({ where: { userId, gridKey }, orderBy: { name: "asc" } });
}

export async function createSavedView(userId: string, input: { gridKey: string; name: string; config: unknown }) {
  try {
    return await prisma.savedView.create({ data: { userId, gridKey: input.gridKey, name: input.name, config: input.config as Prisma.InputJsonValue } });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      throw new HttpError(409, `A saved view named "${input.name}" already exists.`, "CONFLICT");
    }
    throw err;
  }
}

export async function deleteSavedView(userId: string, id: string): Promise<void> {
  const row = await prisma.savedView.findUnique({ where: { id } });
  if (!row || row.userId !== userId) {
    throw new HttpError(404, "Saved view not found.", "NOT_FOUND");
  }
  await prisma.savedView.delete({ where: { id } });
}
