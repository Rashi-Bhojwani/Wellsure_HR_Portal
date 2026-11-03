import { canReadSensitivity } from "@shared/constants/peopleDocuments";
import { writeAuditLog } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { uploadEmployeeDocument } from "../documents/service";
import { setPhoto } from "../people/photos";
import type { ParityMeta, ParityViewer } from "./types";

// A-9 G4 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 13): many files at once, each named by the person's employee number — "<code>.<ext>" or
// "<code>__<anything>.<ext>" (two underscores; codes may themselves contain a dash or one underscore). A preview matches every file and says what will happen;
// the upload re-checks everything and files each matched one through the SAME single-file path as one at a time (documents: uploadEmployeeDocument, which
// checks the type, size and category; photos: setPhoto, which re-encodes and strips metadata), so a bulk upload can do nothing a single upload cannot.
// Unmatched, outside the viewer's scope (said the same way, never confirming a number exists), duplicated in the batch, badly named or of the wrong type:
// left out, with the reason. One audit row for the batch besides each file's own.

export type BulkKind = "documents" | "photos";
export type FileOutcome = "READY" | "UPLOADED" | "UNMATCHED" | "BAD_NAME" | "DUPLICATE" | "WRONG_TYPE" | "ALREADY_UPLOADED" | "FAILED";
export interface FileRow {
  fileName: string;
  employeeCode: string | null;
  employeeId: string | null;
  outcome: FileOutcome;
  reason: string | null;
}

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOC_EXT = /\.(pdf|png|jpe?g|webp|docx?|xlsx?)$/i;
const NAME = /^([A-Za-z0-9][A-Za-z0-9_-]{0,39}?)(?:__.*)?\.[A-Za-z0-9]{1,5}$/;

/** "EMP-001.pdf" → "EMP-001"; "EMP-001__offer scan.pdf" → "EMP-001"; anything else → null. */
export function codeFromFileName(name: string): string | null {
  const m = NAME.exec(name.trim());
  return m ? m[1]! : null;
}

async function match(files: Express.Multer.File[], kind: BulkKind, viewer: ParityViewer): Promise<FileRow[]> {
  const codes = files.map((f) => codeFromFileName(f.originalname));
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const found = await prisma.employee.findMany({
    where: { AND: [scope, { employeeCode: { in: codes.filter((c): c is string => Boolean(c)), mode: "insensitive" } }] },
    select: { id: true, employeeCode: true },
  });
  const byCode = new Map(found.map((e) => [e.employeeCode.toLowerCase(), e]));
  const seen = new Map<string, number>();
  const rows: FileRow[] = files.map((f, i) => {
    const code = codes[i] ?? null;
    if (!code) return { fileName: f.originalname, employeeCode: null, employeeId: null, outcome: "BAD_NAME", reason: 'Name the file after the employee number, for example "EMP-001.pdf" or "EMP-001__any words.pdf".' };
    const e = byCode.get(code.toLowerCase());
    if (!e) return { fileName: f.originalname, employeeCode: code, employeeId: null, outcome: "UNMATCHED", reason: "No employee with that number that you can see." };
    if (kind === "photos" ? !PHOTO_TYPES.has(f.mimetype) : !DOC_EXT.test(f.originalname)) return { fileName: f.originalname, employeeCode: e.employeeCode, employeeId: e.id, outcome: "WRONG_TYPE", reason: kind === "photos" ? "A photo must be a JPEG, PNG or WebP image." : "Not a document type that can be filed." };
    // Two photos for one person, or the same document name twice for one person, in one batch: neither is filed (which one was meant?).
    const key = kind === "photos" ? e.id : `${e.id}:${f.originalname.toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    return { fileName: f.originalname, employeeCode: e.employeeCode, employeeId: e.id, outcome: "READY", reason: null };
  });
  for (const r of rows) {
    if (r.outcome !== "READY" || !r.employeeId) continue;
    const key = kind === "photos" ? r.employeeId : `${r.employeeId}:${r.fileName.toLowerCase()}`;
    if ((seen.get(key) ?? 0) > 1) Object.assign(r, { outcome: "DUPLICATE", reason: kind === "photos" ? "More than one photo for this person in the batch." : "The same file name twice for this person in the batch." });
  }
  return rows;
}

async function checkCategory(categoryId: string, viewer: ParityViewer) {
  const category = await prisma.documentCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.appliesTo !== "EMPLOYEE" || !category.isActive) throw new HttpError(400, "Choose an active category for employee documents.", "VALIDATION_ERROR");
  if (!canReadSensitivity(category.sensitivity, viewer.permissions)) throw new HttpError(403, `You can't file documents under "${category.name}".`, "CATEGORY_RESTRICTED");
  return category;
}

/** The same file already filed for this person (same category, name and size, not archived): uploading the batch again files nothing twice. */
async function alreadyFiled(employeeId: string, categoryId: string, file: Express.Multer.File) {
  return (await prisma.employeeDocument.count({ where: { employeeId, categoryId, sizeBytes: file.size, fileName: file.originalname, archivedAt: null } })) > 0;
}

export async function previewBulk(kind: BulkKind, files: Express.Multer.File[], input: { categoryId?: string }, viewer: ParityViewer) {
  if (files.length === 0) throw new HttpError(400, "Choose at least one file.", "VALIDATION_ERROR");
  if (kind === "documents") await checkCategory(input.categoryId ?? "", viewer);
  const rows = await match(files, kind, viewer);
  if (kind === "documents") for (const r of rows) if (r.outcome === "READY" && (await alreadyFiled(r.employeeId!, input.categoryId!, files.find((f) => f.originalname === r.fileName)!))) Object.assign(r, { outcome: "ALREADY_UPLOADED", reason: "This file is already filed for this person." });
  return summarise(rows);
}

function summarise(rows: FileRow[]) {
  const count = (o: FileOutcome) => rows.filter((r) => r.outcome === o).length;
  return { rows, ready: count("READY"), uploaded: count("UPLOADED"), skipped: rows.length - count("READY") - count("UPLOADED"), total: rows.length };
}

export async function commitBulk(kind: BulkKind, files: Express.Multer.File[], input: { categoryId?: string; title?: string; visibleToEmployee?: boolean }, viewer: ParityViewer, meta: ParityMeta) {
  const preview = await previewBulk(kind, files, input, viewer); // everything is checked again: nothing from the preview is trusted
  for (const [i, r] of preview.rows.entries()) {
    if (r.outcome !== "READY") continue;
    const file = files[i]!;
    try {
      if (kind === "documents") {
        await uploadEmployeeDocument(r.employeeId!, file, { categoryId: input.categoryId!, title: input.title?.trim() || file.originalname.replace(/\.[^.]+$/, ""), visibleToEmployee: input.visibleToEmployee ?? false }, viewer, meta);
      } else {
        await setPhoto(r.employeeId!, file, meta, "employee.photo.updated");
      }
      Object.assign(r, { outcome: "UPLOADED", reason: null });
    } catch (err) {
      Object.assign(r, { outcome: "FAILED", reason: err instanceof HttpError ? err.message : "Could not be saved." });
    }
  }
  const out = summarise(preview.rows);
  await writeAuditLog({ ...meta, action: kind === "documents" ? "employee.document.bulk_uploaded" : "employee.photo.bulk_uploaded", entityType: "BulkUpload", entityId: `${kind}:${Date.now()}`, after: { total: out.total, uploaded: out.uploaded, skipped: out.skipped, categoryId: input.categoryId ?? null, outcomes: out.rows.map((r) => ({ file: r.fileName, code: r.employeeCode, outcome: r.outcome })) } });
  return out;
}
