import { randomBytes } from "node:crypto";
import { isPeepsLeaveTypeCode } from "@shared/constants/peepsLeave";
import { DOCUMENT_MIME_TYPES, type DocumentMimeType } from "@shared/constants/peopleDocuments";
import { storageService } from "../../integrations/storage";
import { writeAuditLog } from "../../lib/audit";
import { getPeopleDocumentsSettings } from "../../lib/peopleDocumentsSettings";
import { prisma } from "../../lib/prisma";
import { prepareDocumentUpload } from "../../lib/uploads";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "../peeps/types";

// Supporting documents of the new leave types (medical certificates and the like). The employee attaches one to their own request; only HR
// (leave.documents.view) and the directors list or open them, and every open is audited (D-28: a director's open too). They are kept in their own
// table and storage prefix, never with the employee's ordinary documents, carry no original file name, and never appear in manager views, emails,
// exports, task previews, logs or socket events. The employee sees only that a document is attached.

export interface DocViewer {
  userId: string;
  employeeId: string;
  canOpen: boolean; // leave.documents.view (HR) or a director
}

const NOT_FOUND = () => new HttpError(404, "Leave request not found.", "NOT_FOUND");

async function newTypeRequest(requestId: string) {
  const r = await prisma.leaveRequest.findUnique({ where: { id: requestId }, select: { id: true, employeeId: true, status: true, leaveType: { select: { code: true } } } });
  if (!r || !isPeepsLeaveTypeCode(r.leaveType.code)) throw NOT_FOUND();
  return r;
}

export async function attachDocument(requestId: string, file: Express.Multer.File, viewer: DocViewer, meta: ActorMeta) {
  const r = await newTypeRequest(requestId);
  if (r.employeeId !== viewer.employeeId) throw NOT_FOUND(); // only the employee attaches to their own request
  if (r.status !== "PENDING" && r.status !== "APPROVED") throw new HttpError(409, "A document can be attached only to a pending or approved request.", "CONFLICT");
  const prepared = await prepareDocumentUpload(file, await getPeopleDocumentsSettings());
  const ext = DOCUMENT_MIME_TYPES[prepared.mimeType].extensions[0];
  const key = `leave-documents/${requestId}/${randomBytes(12).toString("hex")}${ext}`;
  await storageService.putObject(key, prepared.buffer, prepared.mimeType);
  const doc = await prisma.leaveRequestDocument.create({ data: { leaveRequestId: requestId, storageKey: key, contentType: prepared.mimeType, sizeBytes: prepared.sizeBytes, uploadedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "leave.document.attached", entityType: "LeaveRequestDocument", entityId: doc.id, after: { leaveRequestId: requestId, sizeBytes: prepared.sizeBytes } });
  return { id: doc.id, uploadedAt: doc.uploadedAt.toISOString() };
}

/** HR and the directors: the documents on a request (opening one is a separate, audited call). The employee: how many are attached, nothing more. */
export async function listDocuments(requestId: string, viewer: DocViewer) {
  const r = await newTypeRequest(requestId);
  const docs = await prisma.leaveRequestDocument.findMany({ where: { leaveRequestId: requestId }, orderBy: { uploadedAt: "asc" } });
  if (viewer.canOpen) return { attached: docs.length, documents: docs.map((d, i) => ({ id: d.id, label: `Document ${i + 1}`, contentType: d.contentType, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt.toISOString() })) };
  if (r.employeeId === viewer.employeeId) return { attached: docs.length, documents: [] };
  throw NOT_FOUND();
}

/** HR and the directors open a document; every open is written to the audit log (who, which document, when). */
export async function openDocument(documentId: string, viewer: DocViewer, meta: ActorMeta): Promise<{ body: Buffer; contentType: DocumentMimeType; fileName: string }> {
  if (!viewer.canOpen) throw new HttpError(404, "Document not found.", "NOT_FOUND");
  const doc = await prisma.leaveRequestDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new HttpError(404, "Document not found.", "NOT_FOUND");
  const object = await storageService.getObject(doc.storageKey);
  await writeAuditLog({ ...meta, action: "leave.document.opened", entityType: "LeaveRequestDocument", entityId: doc.id, after: { leaveRequestId: doc.leaveRequestId } });
  const contentType = doc.contentType as DocumentMimeType;
  return { body: object.body, contentType, fileName: `leave-document${DOCUMENT_MIME_TYPES[contentType].extensions[0]}` };
}
