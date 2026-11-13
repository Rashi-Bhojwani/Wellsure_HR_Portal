import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import type { DataScope } from "../../lib/dataScope";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { writeAuditLog } from "../../lib/audit";
import { isDirector } from "../../lib/directorAuthority";
import { prisma } from "../../lib/prisma";
import { buildXlsx } from "../../lib/xlsx";
import { HttpError } from "../../middleware/errorHandler";
import { updateJob, updatePersonal } from "../employee/service";
import { personalUpdateSchema } from "../employee/validators";
import { policyInForce } from "../policySettings/service";

// M session block 2, IE-07 / IE-08: HR updates existing employees from an Excel file. Rules (policy.importRules, a conventional default): HR may
// change contact and personal details; job changes (department, designation, location, reporting manager, with an effective date) are applied by a
// director when the setting says so; at most N rows. Bank and statutory numbers have no column: they go through their own screens (and wait for a
// director, task 1). Each row is checked first (preview): the person must be in the uploader's data scope and never the uploader; an empty cell
// leaves a value as it is. Applying writes through the employee service, so history, audit and live updates are as for a single edit.

export const PERSONAL_COLUMNS = ["mobile", "personalEmail", "bloodGroup", "currentAddress", "permanentAddress", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation"] as const;
export const JOB_COLUMNS = ["departmentCode", "designationCode", "locationCode", "managerCode", "effectiveFrom", "changeReason"] as const;
export const COLUMNS = ["employeeCode", ...PERSONAL_COLUMNS, ...JOB_COLUMNS] as const;

type Rules = { contactAndPersonal: boolean; jobNeedsDirector: boolean; maxRows: number };
interface StagedRow {
  rowNumber: number;
  employeeCode: string;
  employeeId: string | null;
  personal: Record<string, string>;
  job: { departmentId?: string; designationId?: string; locationId?: string; reportingManagerId?: string; effectiveFrom: string; changeReason?: string } | null;
  errors: string[];
  personalApplied: boolean;
  jobApplied: boolean;
}
export interface Viewer {
  userId: string;
  employeeId: string;
  dataScope: DataScope;
}
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const rules = async () => (await policyInForce<Rules>("policy.importRules"))!;

export async function template(): Promise<Buffer> {
  // Notes on a sheet of their own: only the first sheet is read back.
  return buildXlsx([
    { name: "Update employees", columns: COLUMNS.map((c) => ({ key: c, header: c, width: 22 })), rows: [] },
    { name: "Notes", columns: [{ key: "note", header: "How to fill it", width: 100 }], rows: [{ note: "One row per employee. Leave a cell empty to keep the value." }, { note: "Bank and statutory numbers are not changed here: use the profile (they wait for a director)." }, { note: "Job changes need effectiveFrom (YYYY-MM-DD) and the master codes; they may wait for a director." }] },
  ]);
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "").trim();
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "").trim();
  return String(v).trim();
}

async function readRows(buffer: Buffer): Promise<Array<{ rowNumber: number; values: Record<string, string> }>> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new HttpError(400, "Could not read this file. Upload the .xlsx template.", "INVALID_FILE");
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new HttpError(400, "The file has no sheet.", "EMPTY_FILE");
  const index = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const h = cellText(cell);
    const known = COLUMNS.find((c) => c.toLowerCase() === h.toLowerCase());
    if (known) index.set(known, col);
  });
  if (!index.has("employeeCode")) throw new HttpError(400, "The file needs an employeeCode column: use the template.", "UNRECOGNISED_HEADERS");
  const out: Array<{ rowNumber: number; values: Record<string, string> }> = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const values = Object.fromEntries([...index].map(([k, col]) => [k, cellText(row.getCell(col))]));
    if (Object.values(values).some((x) => x)) out.push({ rowNumber: n, values });
  });
  return out;
}

export async function preview(buffer: Buffer, fileName: string, viewer: Viewer, meta: ActorMeta) {
  const r = await rules();
  const raw = await readRows(buffer);
  if (!raw.length) throw new HttpError(400, "The file has no rows.", "EMPTY_FILE");
  if (raw.length > r.maxRows) throw new HttpError(400, `At most ${r.maxRows} rows in one file.`, "TOO_MANY_ROWS");
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const [departments, designations, locations] = await Promise.all([prisma.department.findMany({ select: { id: true, code: true } }), prisma.designation.findMany({ select: { id: true, code: true } }), prisma.location.findMany({ select: { id: true, code: true } })]);
  const byCode = (list: Array<{ id: string; code: string }>, code: string) => list.find((x) => x.code.toLowerCase() === code.toLowerCase())?.id;
  const seen = new Set<string>();
  const rows: StagedRow[] = [];
  for (const { rowNumber, values } of raw) {
    const errors: string[] = [];
    const code = values.employeeCode ?? "";
    const emp = code ? await prisma.employee.findFirst({ where: { AND: [{ employeeCode: code }, scope] }, select: { id: true } }) : null;
    if (!emp) errors.push(`No employee ${code || "(empty code)"} in your scope`);
    else if (emp.id === viewer.employeeId) errors.push("Your own record is not changed by an import");
    if (seen.has(code)) errors.push("The same employee appears twice");
    seen.add(code);
    const personal = Object.fromEntries(PERSONAL_COLUMNS.filter((c) => values[c]).map((c) => [c, values[c]!]));
    if (Object.keys(personal).length) {
      if (!r.contactAndPersonal) errors.push("Contact and personal details are not updated by import (Policy settings)");
      const parsed = personalUpdateSchema.safeParse(personal);
      if (!parsed.success) for (const i of parsed.error.issues) errors.push(`${i.path.join(".")}: ${i.message}`);
    }
    let job: StagedRow["job"] = null;
    if (JOB_COLUMNS.some((c) => c !== "changeReason" && values[c])) {
      const effectiveFrom = values.effectiveFrom ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) errors.push("effectiveFrom: a date as YYYY-MM-DD is needed for a job change");
      const departmentId = values.departmentCode ? byCode(departments, values.departmentCode) : undefined;
      const designationId = values.designationCode ? byCode(designations, values.designationCode) : undefined;
      const locationId = values.locationCode ? byCode(locations, values.locationCode) : undefined;
      if (values.departmentCode && !departmentId) errors.push(`No department ${values.departmentCode}`);
      if (values.designationCode && !designationId) errors.push(`No designation ${values.designationCode}`);
      if (values.locationCode && !locationId) errors.push(`No location ${values.locationCode}`);
      let reportingManagerId: string | undefined;
      if (values.managerCode) {
        reportingManagerId = (await prisma.employee.findFirst({ where: { employeeCode: values.managerCode, status: "ACTIVE" }, select: { id: true } }))?.id;
        if (!reportingManagerId) errors.push(`No active employee ${values.managerCode} to report to`);
      }
      job = { effectiveFrom, ...(departmentId && { departmentId }), ...(designationId && { designationId }), ...(locationId && { locationId }), ...(reportingManagerId && { reportingManagerId }), ...(values.changeReason && { changeReason: values.changeReason }) };
    }
    if (!Object.keys(personal).length && !job) errors.push("Nothing to change on this row");
    rows.push({ rowNumber, employeeCode: code, employeeId: emp?.id ?? null, personal, job, errors, personalApplied: false, jobApplied: false });
  }
  const batch = await prisma.updateImportBatch.create({ data: { uploadedByUserId: viewer.userId, fileName, rows: rows as unknown as Prisma.InputJsonValue } });
  await writeAuditLog({ ...meta, action: "employee.update_import.previewed", entityType: "UpdateImportBatch", entityId: batch.id, after: { rows: rows.length, withErrors: rows.filter((x) => x.errors.length).length } });
  return view(batch.id, rows, r);
}

function view(id: string, rows: StagedRow[], r: Rules) {
  return {
    id,
    jobNeedsDirector: r.jobNeedsDirector,
    rows: rows.map((x) => ({ rowNumber: x.rowNumber, employeeCode: x.employeeCode, changes: [...Object.keys(x.personal), ...(x.job ? ["job"] : [])], errors: x.errors, personalApplied: x.personalApplied, jobApplied: x.jobApplied })),
  };
}

export async function get(id: string, viewer: Viewer) {
  const b = await prisma.updateImportBatch.findUnique({ where: { id } });
  if (!b || (b.uploadedByUserId !== viewer.userId && !(await isDirector(viewer.userId)))) throw new HttpError(404, "Not found.", "NOT_FOUND");
  return view(b.id, b.rows as unknown as StagedRow[], await rules());
}

/** Applies the rows without errors: personal details by HR; job changes by a director when the setting says so (else they wait). */
export async function apply(id: string, viewer: Viewer, meta: ActorMeta) {
  const b = await prisma.updateImportBatch.findUnique({ where: { id } });
  const director = await isDirector(viewer.userId);
  if (!b || (b.uploadedByUserId !== viewer.userId && !director)) throw new HttpError(404, "Not found.", "NOT_FOUND");
  const r = await rules();
  const rows = b.rows as unknown as StagedRow[];
  let personal = 0;
  let jobs = 0;
  let waiting = 0;
  for (const row of rows) {
    if (row.errors.length || !row.employeeId || row.employeeId === viewer.employeeId) continue;
    if (!row.personalApplied && Object.keys(row.personal).length && r.contactAndPersonal) {
      await updatePersonal(row.employeeId, row.personal, { ...meta, actorUserId: viewer.userId });
      row.personalApplied = true;
      personal += 1;
    }
    if (row.job && !row.jobApplied) {
      if (r.jobNeedsDirector && !director) {
        waiting += 1;
        continue;
      }
      await updateJob(row.employeeId, row.job, { ...meta, actorUserId: viewer.userId });
      row.jobApplied = true;
      jobs += 1;
    }
  }
  await prisma.updateImportBatch.update({ where: { id }, data: { rows: rows as unknown as Prisma.InputJsonValue } });
  await writeAuditLog({ ...meta, action: "employee.update_import.applied", entityType: "UpdateImportBatch", entityId: id, after: { personal, jobs, waitingForDirector: waiting } });
  return { ...view(id, rows, r), applied: { personal, jobs, waitingForDirector: waiting } };
}

/** Batches with job changes waiting for a director (directors only). */
export async function waitingForDirector(viewer: Viewer) {
  if (!(await isDirector(viewer.userId))) throw new HttpError(403, "Directors only.", "FORBIDDEN");
  const batches = await prisma.updateImportBatch.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return batches.filter((b) => (b.rows as unknown as StagedRow[]).some((x) => x.job && !x.jobApplied && !x.errors.length && x.employeeId !== viewer.employeeId)).map((b) => ({ id: b.id, fileName: b.fileName, createdAt: b.createdAt.toISOString(), jobRows: (b.rows as unknown as StagedRow[]).filter((x) => x.job && !x.jobApplied && !x.errors.length).length }));
}
