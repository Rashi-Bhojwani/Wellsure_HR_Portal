import { createHash, randomUUID } from "node:crypto";
import { storageService } from "../../../integrations/storage";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { requireDirector } from "../../../lib/directorAuthority";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { parseFinancialYearLabel } from "@shared/utils/financialYear";

// ST-25 (docs/plans/A_PARITY_ROWS.md part 2): Form 16 Part A pairing. A director uploads each person's Part A (the PDF the tax portal issued) for a closed year;
// the person downloads it beside their Part B. Nothing is read from the file (it is checked to be a PDF and kept as it came). Every upload and download is audited.

type Actor = { userId: string; ip?: string | null };
const MAX_BYTES = 5 * 1024 * 1024; // allow-number: 5 MB, a form limit
const iso = (d: Date) => d.toISOString().slice(0, 10);

function closedYear(raw: string) {
  let fy;
  try {
    fy = parseFinancialYearLabel(raw);
  } catch (err) {
    throw new HttpError(400, (err as Error).message, "VALIDATION_ERROR");
  }
  if (iso(businessToday()) <= fy.end) throw new HttpError(409, `Part A is uploaded after the financial year ends (after ${fy.end}).`, "YEAR_NOT_CLOSED");
  return fy;
}

export async function upload(fyRaw: string, employeeId: string, file: { buffer: Buffer; originalname: string } | undefined, actor: Actor) {
  await requireDirector(actor.userId, "upload a Form 16 Part A");
  const fy = closedYear(fyRaw);
  if (!file) throw new HttpError(400, "Choose the PDF.", "VALIDATION_ERROR");
  if (file.buffer.length > MAX_BYTES) throw new HttpError(400, "The file is larger than 5 MB.", "VALIDATION_ERROR");
  if (file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(400, "That is not a PDF.", "VALIDATION_ERROR");
  if (!(await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const fileKey = `form16-part-a/${fy.label}/${employeeId}/${randomUUID()}.pdf`;
  await storageService.putObject(fileKey, file.buffer, "application/pdf");
  const row = await prisma.form16PartAFile.create({ data: { financialYear: fy.label, employeeId, fileKey, fileName: file.originalname.slice(0, 120), sha256: createHash("sha256").update(file.buffer).digest("hex"), uploadedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.form16.part_a_uploaded", entityType: "Employee", entityId: employeeId, after: { year: fy.label, sha256: row.sha256 } });
  return { id: row.id };
}

/** Directors: who has a Part A for the year (the newest per person). */
export async function listYear(fyRaw: string, actor: Actor) {
  await requireDirector(actor.userId, "see Form 16 Part A uploads");
  const fy = closedYear(fyRaw);
  const rows = await prisma.form16PartAFile.findMany({ where: { financialYear: fy.label }, orderBy: { createdAt: "asc" } });
  const newest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) newest.set(r.employeeId, r);
  const names = await namesOn([...newest.keys()], businessToday());
  return { year: fy.label, files: [...newest.values()].map((r) => ({ employeeId: r.employeeId, name: names.get(r.employeeId) ?? "", fileName: r.fileName, uploadedAt: r.createdAt.toISOString() })) };
}

async function serve(fyLabel: string, employeeId: string) {
  const row = await prisma.form16PartAFile.findFirst({ where: { financialYear: fyLabel, employeeId }, orderBy: { createdAt: "desc" } });
  if (!row) throw new HttpError(404, "No Part A has been uploaded for this year yet.", "NOT_FOUND");
  const obj = await storageService.getObject(row.fileKey);
  return { pdf: obj.body, fileName: `form16-part-a-${fyLabel}.pdf`, sha256: row.sha256 };
}

/** The person's own Part A. */
export async function myPartA(employeeId: string, fyRaw: string, actor: Actor) {
  const fy = closedYear(fyRaw);
  const out = await serve(fy.label, employeeId);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.form16.part_a_downloaded", entityType: "Employee", entityId: employeeId, after: { year: fy.label, own: true } });
  return out;
}

/** A director's copy of anyone's Part A. */
export async function directorPartA(fyRaw: string, employeeId: string, actor: Actor) {
  await requireDirector(actor.userId, "download a Form 16 Part A");
  const fy = closedYear(fyRaw);
  const out = await serve(fy.label, employeeId);
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.form16.part_a_downloaded", entityType: "Employee", entityId: employeeId, after: { year: fy.label, own: false } });
  return out;
}
