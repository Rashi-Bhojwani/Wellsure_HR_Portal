import type { DataScope } from "@shared/constants/roles";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Prisma, type DocumentCategoryScope } from "@prisma/client";
import { storageService } from "../../integrations/storage";
import { writeAuditLog } from "../../lib/audit";
import { audienceWhere, getCurrentPlacement, isInAudience } from "../../lib/audience";
import { getPeopleDocumentsSettings } from "../../lib/peopleDocumentsSettings";
import { prisma } from "../../lib/prisma";
import { prepareDocumentUpload } from "../../lib/uploads";
import { HttpError } from "../../middleware/errorHandler";
import { findScopedEmployee } from "../employee/service";
import { notifyEmployee } from "../notifications/notifyEmployee";
import type { z } from "zod";
import type {
  createCategorySchema,
  updateCategorySchema,
  updateCompanyDocumentSchema,
  updateEmployeeDocumentSchema,
  uploadCompanyDocumentSchema,
  uploadEmployeeDocumentSchema,
} from "./validators";

// Document Center (spec §6) + HR-held employee documents (spec §7.2),
// Phase 5 commit C. Files live behind StorageService and are only ever
// handed out as 60-second signed URLs carrying the original filename.
// Nothing is deleted: documents are archived (hidden), per this codebase's
// append-only convention.

export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface DocumentViewer {
  userId: string;
  employeeId: string;
  roleCodes: string[];
  dataScope: DataScope; // resolved per request (lib/permissions.ts)
  permissions: Set<string>;
}

const DOWNLOAD_URL_TTL_SECONDS = 60;
const notFound = (what = "Document") => new HttpError(404, `${what} not found.`, "NOT_FOUND");

function storageKey(prefix: string, fileName: string): string {
  // The user's filename never becomes part of the key (it's kept only as
  // download metadata) — keys are random, so they can't be guessed or
  // collide, and a crafted name can't influence the storage path.
  return `${prefix}/${randomUUID()}${path.extname(fileName).toLowerCase()}`;
}

async function signedDownload(fileKey: string, fileName: string) {
  const url = await storageService.getObjectSignedUrl(fileKey, DOWNLOAD_URL_TTL_SECONDS, { downloadFileName: fileName });
  return { url, fileName, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
}

// ── Categories ────────────────────────────────────────────────────────

export async function listCategories(query: { appliesTo?: DocumentCategoryScope; includeInactive?: boolean }) {
  return prisma.documentCategory.findMany({
    where: { ...(query.appliesTo && { appliesTo: query.appliesTo }), ...(!query.includeInactive && { isActive: true }) },
    orderBy: [{ appliesTo: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createCategory(input: z.infer<typeof createCategorySchema>, meta: ActorMeta) {
  try {
    const after = await prisma.documentCategory.create({ data: input });
    await writeAuditLog({ ...meta, action: "documents.category.created", entityType: "DocumentCategory", entityId: after.id, after });
    return after;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, `A category with code "${input.code}" already exists.`, "CONFLICT");
    }
    throw err;
  }
}

// No delete: a category is deactivated once in use, so documents filed
// under it keep their history. Code and appliesTo are fixed after creation.
export async function updateCategory(id: string, input: z.infer<typeof updateCategorySchema>, meta: ActorMeta) {
  const before = await prisma.documentCategory.findUnique({ where: { id } });
  if (!before) throw notFound("Category");
  const after = await prisma.documentCategory.update({ where: { id }, data: input });
  await writeAuditLog({ ...meta, action: "documents.category.updated", entityType: "DocumentCategory", entityId: id, before, after });
  return after;
}

async function requireActiveCategory(categoryId: string, appliesTo: DocumentCategoryScope) {
  const category = await prisma.documentCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.appliesTo !== appliesTo || !category.isActive) {
    throw new HttpError(400, "Choose an active category for this kind of document.", "VALIDATION_ERROR");
  }
  return category;
}

// ── Company documents ─────────────────────────────────────────────────

const companyInclude = {
  category: { select: { id: true, name: true, code: true } },
  scopeLocation: { select: { id: true, name: true } },
  scopeDepartment: { select: { id: true, name: true } },
} as const;

type CompanyRow = Prisma.CompanyDocumentGetPayload<{ include: typeof companyInclude }>;

function formatCompany(row: CompanyRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    scopeLocation: row.scopeLocation,
    scopeDepartment: row.scopeDepartment,
    uploadedAt: row.uploadedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

async function assertScopeTargetsExist(scope: { scopeLocationId?: string | null; scopeDepartmentId?: string | null }) {
  if (scope.scopeLocationId && !(await prisma.location.findUnique({ where: { id: scope.scopeLocationId } }))) {
    throw new HttpError(400, "That branch doesn't exist.", "VALIDATION_ERROR");
  }
  if (scope.scopeDepartmentId && !(await prisma.department.findUnique({ where: { id: scope.scopeDepartmentId } }))) {
    throw new HttpError(400, "That department doesn't exist.", "VALIDATION_ERROR");
  }
}

// What an employee sees in Document Center: live documents in their audience.
export async function listCompanyDocumentsForEmployee(employeeId: string) {
  const placement = await getCurrentPlacement(employeeId);
  const rows = await prisma.companyDocument.findMany({
    where: { archivedAt: null, ...audienceWhere(placement) },
    include: companyInclude,
    orderBy: [{ category: { sortOrder: "asc" } }, { uploadedAt: "desc" }],
  });
  return rows.map(formatCompany);
}

export async function listCompanyDocumentsForManagement(query: { includeArchived?: boolean }) {
  const rows = await prisma.companyDocument.findMany({
    where: query.includeArchived ? {} : { archivedAt: null },
    include: { ...companyInclude, _count: { select: { downloads: true } } },
    orderBy: { uploadedAt: "desc" },
  });
  return rows.map((row) => ({ ...formatCompany(row), downloadedByCount: row._count.downloads }));
}

export async function uploadCompanyDocument(
  file: Express.Multer.File,
  input: z.infer<typeof uploadCompanyDocumentSchema>,
  meta: ActorMeta,
) {
  const settings = await getPeopleDocumentsSettings();
  const { buffer, mimeType, fileName, sizeBytes } = await prepareDocumentUpload(file, settings);
  await requireActiveCategory(input.categoryId, "COMPANY");
  await assertScopeTargetsExist(input);
  const fileKey = storageKey("company-documents", fileName);
  await storageService.putObject(fileKey, buffer, mimeType);
  try {
    const row = await prisma.companyDocument.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        categoryId: input.categoryId,
        scopeLocationId: input.scopeLocationId ?? null,
        scopeDepartmentId: input.scopeDepartmentId ?? null,
        fileKey,
        fileName,
        mimeType,
        sizeBytes,
        uploadedByUserId: meta.actorUserId,
      },
      include: companyInclude,
    });
    await writeAuditLog({ ...meta, action: "documents.company.uploaded", entityType: "CompanyDocument", entityId: row.id, after: formatCompany(row) });
    return formatCompany(row);
  } catch (err) {
    await storageService.deleteObject(fileKey).catch(() => undefined); // orphaned object only; the DB error is what matters
    throw err;
  }
}

export async function updateCompanyDocument(id: string, input: z.infer<typeof updateCompanyDocumentSchema>, meta: ActorMeta) {
  const before = await prisma.companyDocument.findUnique({ where: { id }, include: companyInclude });
  if (!before) throw notFound();
  if (input.categoryId && input.categoryId !== before.categoryId) await requireActiveCategory(input.categoryId, "COMPANY");
  await assertScopeTargetsExist(input);
  const after = await prisma.companyDocument.update({ where: { id }, data: input, include: companyInclude });
  await writeAuditLog({ ...meta, action: "documents.company.updated", entityType: "CompanyDocument", entityId: id, before: formatCompany(before), after: formatCompany(after) });
  return formatCompany(after);
}

export async function setCompanyDocumentArchived(id: string, archived: boolean, meta: ActorMeta) {
  const before = await prisma.companyDocument.findUnique({ where: { id }, include: companyInclude });
  if (!before) throw notFound();
  if (Boolean(before.archivedAt) === archived) {
    throw new HttpError(409, archived ? "This document is already archived." : "This document isn't archived.", "CONFLICT");
  }
  const after = await prisma.companyDocument.update({
    where: { id },
    data: archived ? { archivedAt: new Date(), archivedByUserId: meta.actorUserId } : { archivedAt: null, archivedByUserId: null },
    include: companyInclude,
  });
  await writeAuditLog({
    ...meta,
    action: archived ? "documents.company.archived" : "documents.company.unarchived",
    entityType: "CompanyDocument",
    entityId: id,
    before: formatCompany(before),
    after: formatCompany(after),
  });
  return formatCompany(after);
}

// Employees download live documents in their audience; document managers
// can download anything (including archived) — but only an employee's own
// download is recorded, since "who has read the policy" is about the
// audience, not HR previewing a file.
export async function downloadCompanyDocument(id: string, viewer: DocumentViewer) {
  const doc = await prisma.companyDocument.findUnique({ where: { id } });
  const isManager = viewer.permissions.has("documents.manage");
  if (!doc) throw notFound();
  const inAudience = !doc.archivedAt && isInAudience(doc, await getCurrentPlacement(viewer.employeeId));
  if (!inAudience && !isManager) throw notFound(); // never confirm a document outside your audience exists
  if (inAudience) {
    const now = new Date();
    await prisma.companyDocumentDownload.upsert({
      where: { documentId_employeeId: { documentId: id, employeeId: viewer.employeeId } },
      create: { documentId: id, employeeId: viewer.employeeId, firstDownloadedAt: now, lastDownloadedAt: now },
      update: { lastDownloadedAt: now, downloadCount: { increment: 1 } },
    });
  }
  return signedDownload(doc.fileKey, doc.fileName);
}

// "Who has read the new policy?" — every recorded download plus the size of
// the document's current audience (active employees it's visible to).
export async function getCompanyDocumentDownloads(id: string) {
  const doc = await prisma.companyDocument.findUnique({ where: { id } });
  if (!doc) throw notFound();
  const [downloads, audienceSize] = await Promise.all([
    prisma.companyDocumentDownload.findMany({
      where: { documentId: id },
      orderBy: { lastDownloadedAt: "desc" },
      include: {
        employee: { select: { id: true, employeeCode: true, nameHistory: { where: { effectiveTo: null }, select: { fullName: true } } } },
      },
    }),
    prisma.employee.count({
      where: {
        status: "ACTIVE",
        jobHistory: {
          some: {
            effectiveTo: null,
            ...(doc.scopeLocationId && { locationId: doc.scopeLocationId }),
            ...(doc.scopeDepartmentId && { departmentId: doc.scopeDepartmentId }),
          },
        },
      },
    }),
  ]);
  return {
    audienceSize,
    downloadedByCount: downloads.length,
    downloads: downloads.map((d) => ({
      employeeId: d.employee.id,
      employeeCode: d.employee.employeeCode,
      name: d.employee.nameHistory[0]?.fullName ?? d.employee.employeeCode,
      firstDownloadedAt: d.firstDownloadedAt.toISOString(),
      lastDownloadedAt: d.lastDownloadedAt.toISOString(),
      downloadCount: d.downloadCount,
    })),
  };
}

// ── Employee documents ────────────────────────────────────────────────

const employeeDocInclude = { category: { select: { id: true, name: true, code: true } } } as const;
type EmployeeDocRow = Prisma.EmployeeDocumentGetPayload<{ include: typeof employeeDocInclude }>;

function formatEmployeeDoc(row: EmployeeDocRow) {
  return {
    id: row.id,
    employeeId: row.employeeId,
    title: row.title,
    category: row.category,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    visibleToEmployee: row.visibleToEmployee,
    uploadedAt: row.uploadedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

// Permission alone isn't enough: the target employee must also be inside
// the viewer's data scope (spec §2/§9 IDOR rule). Out of scope reads as 404.
async function assertEmployeeInScope(employeeId: string, viewer: DocumentViewer) {
  await findScopedEmployee(employeeId, viewer.employeeId, viewer.dataScope);
}

async function loadEmployeeDocInScope(id: string, viewer: DocumentViewer) {
  const doc = await prisma.employeeDocument.findUnique({ where: { id }, include: employeeDocInclude });
  if (!doc) throw notFound();
  try {
    await assertEmployeeInScope(doc.employeeId, viewer);
  } catch {
    throw notFound();
  }
  return doc;
}

export async function listMyDocuments(employeeId: string) {
  const rows = await prisma.employeeDocument.findMany({
    where: { employeeId, visibleToEmployee: true, archivedAt: null },
    include: employeeDocInclude,
    orderBy: { uploadedAt: "desc" },
  });
  return rows.map(formatEmployeeDoc);
}

export async function downloadMyDocument(id: string, employeeId: string) {
  const doc = await prisma.employeeDocument.findUnique({ where: { id } });
  // Someone else's, hidden from me, or archived — all indistinguishable from absent.
  if (!doc || doc.employeeId !== employeeId || !doc.visibleToEmployee || doc.archivedAt) throw notFound();
  return signedDownload(doc.fileKey, doc.fileName);
}

export async function listEmployeeDocuments(employeeId: string, viewer: DocumentViewer) {
  await assertEmployeeInScope(employeeId, viewer);
  const rows = await prisma.employeeDocument.findMany({ where: { employeeId }, include: employeeDocInclude, orderBy: { uploadedAt: "desc" } });
  return rows.map(formatEmployeeDoc);
}

async function notifyIfNewlyVisible(doc: EmployeeDocRow, wasVisible: boolean) {
  if (!doc.visibleToEmployee || wasVisible || doc.archivedAt) return;
  await notifyEmployee(doc.employeeId, {
    type: "document.added",
    title: "New document",
    body: `HR added "${doc.title}" to your documents.`,
    link: "/app/document-center?tab=mine",
    payload: { documentId: doc.id },
  });
}

export async function uploadEmployeeDocument(
  employeeId: string,
  file: Express.Multer.File,
  input: z.infer<typeof uploadEmployeeDocumentSchema>,
  viewer: DocumentViewer,
  meta: ActorMeta,
) {
  await assertEmployeeInScope(employeeId, viewer);
  const settings = await getPeopleDocumentsSettings();
  const { buffer, mimeType, fileName, sizeBytes } = await prepareDocumentUpload(file, settings);
  await requireActiveCategory(input.categoryId, "EMPLOYEE");
  const fileKey = storageKey(`employees/${employeeId}/documents`, fileName);
  await storageService.putObject(fileKey, buffer, mimeType);
  let row: EmployeeDocRow;
  try {
    row = await prisma.employeeDocument.create({
      data: {
        employeeId,
        categoryId: input.categoryId,
        title: input.title,
        visibleToEmployee: input.visibleToEmployee,
        fileKey,
        fileName,
        mimeType,
        sizeBytes,
        uploadedByUserId: meta.actorUserId,
      },
      include: employeeDocInclude,
    });
  } catch (err) {
    await storageService.deleteObject(fileKey).catch(() => undefined);
    throw err;
  }
  await writeAuditLog({ ...meta, action: "employee.document.uploaded", entityType: "Employee", entityId: employeeId, after: formatEmployeeDoc(row) });
  await notifyIfNewlyVisible(row, false);
  return formatEmployeeDoc(row);
}

export async function updateEmployeeDocument(id: string, input: z.infer<typeof updateEmployeeDocumentSchema>, viewer: DocumentViewer, meta: ActorMeta) {
  const before = await loadEmployeeDocInScope(id, viewer);
  // An issued letter (D2) is a legal document: its title and category are
  // what was issued. Visibility and archive stay editable (reversible,
  // audited); a correction is a reissue, never an edit.
  if ((input.title !== undefined && input.title !== before.title) || (input.categoryId !== undefined && input.categoryId !== before.categoryId)) {
    const letter = await prisma.generatedLetter.findUnique({ where: { employeeDocumentId: id }, select: { id: true } });
    if (letter) throw new HttpError(409, "This is an issued letter, so its title and category can't change. Reissue the letter instead.", "LETTER_IMMUTABLE");
  }
  if (input.categoryId && input.categoryId !== before.categoryId) await requireActiveCategory(input.categoryId, "EMPLOYEE");
  const after = await prisma.employeeDocument.update({ where: { id }, data: input, include: employeeDocInclude });
  await writeAuditLog({
    ...meta,
    action: "employee.document.updated",
    entityType: "Employee",
    entityId: before.employeeId,
    before: formatEmployeeDoc(before),
    after: formatEmployeeDoc(after),
  });
  await notifyIfNewlyVisible(after, before.visibleToEmployee);
  return formatEmployeeDoc(after);
}

export async function setEmployeeDocumentArchived(id: string, archived: boolean, viewer: DocumentViewer, meta: ActorMeta) {
  const before = await loadEmployeeDocInScope(id, viewer);
  if (Boolean(before.archivedAt) === archived) {
    throw new HttpError(409, archived ? "This document is already archived." : "This document isn't archived.", "CONFLICT");
  }
  const after = await prisma.employeeDocument.update({
    where: { id },
    data: archived ? { archivedAt: new Date(), archivedByUserId: meta.actorUserId } : { archivedAt: null, archivedByUserId: null },
    include: employeeDocInclude,
  });
  await writeAuditLog({
    ...meta,
    action: archived ? "employee.document.archived" : "employee.document.unarchived",
    entityType: "Employee",
    entityId: before.employeeId,
    before: formatEmployeeDoc(before),
    after: formatEmployeeDoc(after),
  });
  return formatEmployeeDoc(after);
}

// HR downloading an employee's document (an ID proof, say) is always
// audit-logged — the approved plan's requirement.
export async function downloadEmployeeDocument(id: string, viewer: DocumentViewer, meta: ActorMeta) {
  const doc = await loadEmployeeDocInScope(id, viewer);
  await writeAuditLog({
    ...meta,
    action: "employee.document.downloaded",
    entityType: "Employee",
    entityId: doc.employeeId,
    after: { documentId: doc.id, title: doc.title, fileName: doc.fileName, category: doc.category.code },
  });
  return signedDownload(doc.fileKey, doc.fileName);
}
