import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { requireDirector } from "../../lib/directorAuthority";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { storageService } from "../../integrations/storage";
import { HttpError } from "../../middleware/errorHandler";
import { policyInForce } from "../policySettings/service";

// M session block 2, AD-07: data retention for former employees (DPDP). The periods are the owners' (policy.retention, Not set: nothing is ever
// due). Once a period is set, the due list shows former employees whose leaving date is older than it. Erasing needs one director to propose it and
// a different director to confirm it (the database refuses the same person). CONTACT replaces contact and personal details with a marker and
// removes the photo; DOCUMENTS removes the files of GENERAL documents shared with the person (pay and statutory documents are kept: their periods
// follow the law and payroll). Payroll and tax records are never touched here.

type Retention = { contactMonths?: number | null; documentsMonths?: number | null };
export const CATEGORIES = ["CONTACT", "DOCUMENTS"] as const;
export type Category = (typeof CATEGORIES)[number];
export const proposeBody = z.object({ employeeId: z.string().min(1).max(64), category: z.enum(CATEGORIES) }).strict();
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}
const ERASED = "Erased";
const iso = (d: Date) => d.toISOString().slice(0, 10);

function cutoff(months: number): Date {
  const t = businessToday();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - months, t.getUTCDate()));
}

export async function due(actorUserId: string) {
  await requireDirector(actorUserId, "see data due for erasure");
  const r = (await policyInForce<Retention>("policy.retention")) ?? {};
  const out: Array<{ employeeId: string; employeeCode: string; fullName: string; lastWorkingDate: string; category: Category; proposal: { id: string; mine: boolean } | null }> = [];
  for (const [category, months] of [["CONTACT", r.contactMonths], ["DOCUMENTS", r.documentsMonths]] as Array<[Category, number | null | undefined]>) {
    if (!months) continue;
    const people = await prisma.employee.findMany({
      where: { status: { not: "ACTIVE" }, lastWorkingDate: { lt: cutoff(months) }, dataErasures: { none: { category, status: "DONE" } } },
      select: { id: true, employeeCode: true, lastWorkingDate: true, nameHistory: { where: inForceOn(), select: { fullName: true } }, dataErasures: { where: { category, status: "PROPOSED" }, select: { id: true, proposedByUserId: true } } },
      orderBy: { lastWorkingDate: "asc" },
      take: 500,
    });
    for (const p of people) out.push({ employeeId: p.id, employeeCode: p.employeeCode, fullName: p.nameHistory[0]?.fullName ?? p.employeeCode, lastWorkingDate: iso(p.lastWorkingDate!), category, proposal: p.dataErasures[0] ? { id: p.dataErasures[0].id, mine: p.dataErasures[0].proposedByUserId === actorUserId } : null });
  }
  return { periods: { contactMonths: r.contactMonths ?? null, documentsMonths: r.documentsMonths ?? null }, due: out };
}

async function assertDue(employeeId: string, category: Category) {
  const r = (await policyInForce<Retention>("policy.retention")) ?? {};
  const months = category === "CONTACT" ? r.contactMonths : r.documentsMonths;
  if (!months) throw new HttpError(409, "No retention period is set for this kind of record.", "NOT_SET");
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { status: true, lastWorkingDate: true } });
  if (!e || e.status === "ACTIVE" || !e.lastWorkingDate || e.lastWorkingDate >= cutoff(months)) throw new HttpError(409, "This person's records are not past the retention period.", "NOT_DUE");
}

export async function propose(input: z.infer<typeof proposeBody>, meta: ActorMeta) {
  await requireDirector(meta.actorUserId, "propose an erasure");
  await assertDue(input.employeeId, input.category);
  try {
    const row = await prisma.dataErasure.create({ data: { employeeId: input.employeeId, category: input.category, proposedByUserId: meta.actorUserId } });
    await writeAuditLog({ ...meta, action: "retention.erasure.proposed", entityType: "DataErasure", entityId: row.id, after: { category: input.category } });
    return { id: row.id };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "Already proposed.", "ALREADY_PROPOSED");
    throw e;
  }
}

export async function confirm(id: string, meta: ActorMeta) {
  await requireDirector(meta.actorUserId, "confirm an erasure");
  const row = await prisma.dataErasure.findUnique({ where: { id } });
  if (!row || row.status !== "PROPOSED") throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (row.proposedByUserId === meta.actorUserId) throw new HttpError(403, "You proposed this, so a different director confirms it.", "CHECKER_IS_MAKER");
  await assertDue(row.employeeId, row.category as Category);
  let items = 0;
  if (row.category === "CONTACT") {
    const p = await prisma.employeePersonal.findUnique({ where: { employeeId: row.employeeId } });
    if (p) {
      for (const key of [p.photoStorageKey, p.photoThumbStorageKey]) if (key) await storageService.deleteObject(key);
      await prisma.employeePersonal.update({ where: { employeeId: row.employeeId }, data: { personalEmail: ERASED, mobile: ERASED, currentAddress: ERASED, permanentAddress: ERASED, emergencyContactName: ERASED, emergencyContactPhone: ERASED, emergencyContactRelation: ERASED, bloodGroup: null, photoStorageKey: null, photoThumbStorageKey: null, photoVersion: null } });
      items = 1;
    }
  } else {
    const docs = await prisma.employeeDocument.findMany({ where: { employeeId: row.employeeId, category: { sensitivity: "GENERAL" } }, select: { id: true, fileKey: true } });
    for (const d of docs) {
      await storageService.deleteObject(d.fileKey);
      await prisma.employeeDocument.update({ where: { id: d.id }, data: { title: "Erased document", archivedAt: new Date() } });
    }
    items = docs.length;
  }
  await prisma.dataErasure.update({ where: { id }, data: { status: "DONE", confirmedByUserId: meta.actorUserId, doneAt: new Date(), items } });
  await writeAuditLog({ ...meta, action: "retention.erasure.done", entityType: "DataErasure", entityId: id, after: { category: row.category, items } });
  return { id, status: "DONE" as const, items };
}
