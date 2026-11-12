import type { DataScope } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit";
import { audienceWhere, getCurrentPlacement, isInAudience } from "../../lib/audience";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";

// M session block 2, ER-18: policy acknowledgement. Whoever manages company documents (documents.manage) marks a document "to be acknowledged";
// the people in its audience see it in Document Center and acknowledge it once (append-only, time recorded). The manager side sees who has and who
// has not, within their own data scope. Off for every document unless asked.

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

async function requiredNow(documentId: string): Promise<boolean> {
  const latest = await prisma.companyDocumentAckRequirement.findFirst({ where: { documentId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { required: true } });
  return latest?.required === true;
}

/** Live documents that currently require acknowledgement. */
async function requiredDocumentIds(): Promise<string[]> {
  const rows = await prisma.companyDocumentAckRequirement.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { documentId: true, required: true } });
  const seen = new Map<string, boolean>();
  for (const r of rows) if (!seen.has(r.documentId)) seen.set(r.documentId, r.required);
  return [...seen].filter(([, req]) => req).map(([id]) => id);
}

const peopleInAudience = (doc: { scopeLocationId: string | null; scopeDepartmentId: string | null }) => ({
  status: "ACTIVE" as const,
  jobHistory: { some: { ...inForceOn(), ...(doc.scopeLocationId && { locationId: doc.scopeLocationId }), ...(doc.scopeDepartmentId && { departmentId: doc.scopeDepartmentId }) } },
});

export async function setRequired(documentId: string, required: boolean, meta: ActorMeta) {
  const doc = await prisma.companyDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.archivedAt) throw new HttpError(404, "Document not found.", "NOT_FOUND");
  if ((await requiredNow(documentId)) === required) return { documentId, required };
  await prisma.companyDocumentAckRequirement.create({ data: { documentId, required, setByUserId: meta.actorUserId } });
  await writeAuditLog({ ...meta, action: required ? "documents.ack.required" : "documents.ack.not_required", entityType: "CompanyDocument", entityId: documentId, after: { required } });
  if (required) {
    const done = new Set((await prisma.companyDocumentAcknowledgement.findMany({ where: { documentId }, select: { employeeId: true } })).map((a) => a.employeeId));
    const people = await prisma.employee.findMany({ where: peopleInAudience(doc), select: { id: true } });
    for (const p of people) if (!done.has(p.id)) await notifyEmployee(p.id, { type: "documents.ack.required", title: `Please read and acknowledge "${doc.title}"`, body: "Open it in Document Center, then acknowledge it.", link: "/app/document-center" });
  }
  return { documentId, required };
}

/** The documents the signed-in person is asked to acknowledge, with whether they have. */
export async function mine(employeeId: string) {
  const ids = await requiredDocumentIds();
  if (!ids.length) return [];
  const placement = await getCurrentPlacement(employeeId);
  const docs = await prisma.companyDocument.findMany({ where: { id: { in: ids }, archivedAt: null, ...audienceWhere(placement) }, select: { id: true, title: true, uploadedAt: true }, orderBy: { uploadedAt: "desc" } });
  const acks = await prisma.companyDocumentAcknowledgement.findMany({ where: { employeeId, documentId: { in: docs.map((d) => d.id) } }, select: { documentId: true, createdAt: true } });
  const at = new Map(acks.map((a) => [a.documentId, a.createdAt.toISOString()]));
  return docs.map((d) => ({ id: d.id, title: d.title, acknowledgedAt: at.get(d.id) ?? null }));
}

export async function acknowledge(documentId: string, viewer: Viewer, meta: ActorMeta) {
  const doc = await prisma.companyDocument.findUnique({ where: { id: documentId } });
  // Outside the audience, archived or not asked for: the same 404 (never confirm a document exists).
  if (!doc || doc.archivedAt || !isInAudience(doc, await getCurrentPlacement(viewer.employeeId)) || !(await requiredNow(documentId))) throw new HttpError(404, "Document not found.", "NOT_FOUND");
  const existing = await prisma.companyDocumentAcknowledgement.findUnique({ where: { documentId_employeeId: { documentId, employeeId: viewer.employeeId } } });
  if (existing) return { documentId, acknowledgedAt: existing.createdAt.toISOString() };
  const row = await prisma.companyDocumentAcknowledgement.create({ data: { documentId, employeeId: viewer.employeeId } });
  await writeAuditLog({ ...meta, action: "documents.ack.acknowledged", entityType: "CompanyDocument", entityId: documentId });
  return { documentId, acknowledgedAt: row.createdAt.toISOString() };
}

/** Who in the document's audience (and the viewer's data scope) has acknowledged it, and who has not. */
export async function status(documentId: string, viewer: Viewer) {
  const doc = await prisma.companyDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new HttpError(404, "Document not found.", "NOT_FOUND");
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const people = await prisma.employee.findMany({
    where: { AND: [peopleInAudience(doc), scope] },
    select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } },
    orderBy: { employeeCode: "asc" },
  });
  const acks = await prisma.companyDocumentAcknowledgement.findMany({ where: { documentId, employeeId: { in: people.map((p) => p.id) } }, select: { employeeId: true, createdAt: true } });
  const at = new Map(acks.map((a) => [a.employeeId, a.createdAt.toISOString()]));
  const rows = people.map((p) => ({ employeeId: p.id, employeeCode: p.employeeCode, fullName: p.nameHistory[0]?.fullName ?? p.employeeCode, acknowledgedAt: at.get(p.id) ?? null }));
  return { required: await requiredNow(documentId), acknowledged: rows.filter((r) => r.acknowledgedAt).length, waiting: rows.filter((r) => !r.acknowledgedAt).length, people: rows };
}

/** For the management list: which documents require acknowledgement. */
export async function requiredSet(): Promise<string[]> {
  return requiredDocumentIds();
}
