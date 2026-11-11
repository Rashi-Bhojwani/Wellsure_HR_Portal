import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/redis";
import { writeAuditLogs } from "../../lib/audit";
import { inForceOn } from "../../lib/effectiveDating";
import { prepareDocumentUpload, requireFile } from "../../lib/uploads";
import { storageService } from "../../integrations/storage";
import { HttpError } from "../../middleware/errorHandler";
import { absent, type Actor, type Meta } from "./access";
import { candidateName, retained } from "./candidates";
import { getSetting, required } from "./settings";
import { offerContext, requireOnboarding } from "./offerAccess";
import { noPayReason } from "./offerText";

// C-4B joiner document links. A link is single-purpose (upload the director-listed joining documents, nothing else),
// expiring (lifetime: a director setting, Not set → no link can be created), unguessable (32 random bytes; only a SHA-256 hash
// is stored), revocable, rate-limited and needs no login. Uploading every listed type spends it. The public page sees the
// document types and the expiry only: no name, company, offer or job.

export const exceptionInput = z.object({ typeCode: z.string().min(1).max(60), reason: noPayReason(500) }).strict();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const tokenParams = z.object({ token: z.string().regex(TOKEN) }).strict();
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Technical abuse limits for the public endpoints (not a business value): per address and per link, ten-minute windows. */
export const PUBLIC_LIMITS = { perIp: 60, perLink: 20, windowSeconds: 600 } as const;
async function hit(key: string, max: number) {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, PUBLIC_LIMITS.windowSeconds);
  if (n > max) throw new HttpError(429, "Too many requests. Please try again later.", "RATE_LIMITED");
}
export async function limitPublic(req: Request, tokenHash: string) {
  await hit(`ratelimit:joiner:ip:${req.ip ?? "unknown"}`, PUBLIC_LIMITS.perIp);
  await hit(`ratelimit:joiner:link:${tokenHash}`, PUBLIC_LIMITS.perLink);
}

async function acceptedOffer(candidateId: string) {
  return prisma.recruitmentOffer.findFirst({ where: { candidateId, state: "ACCEPTED" }, include: { conversion: true }, orderBy: { createdAt: "desc" } });
}

async function approverState(userId: string) {
  const choice = await getSetting("joiningExceptionApprover");
  if (!choice) return { set: false, isApprover: false };
  const user = await prisma.user.findFirst({ where: { employeeId: choice.employeeId, status: "ACTIVE", employee: { status: "ACTIVE" }, roles: { none: { role: { code: "DEVELOPER" } } } } });
  return { set: Boolean(user), isApprover: Boolean(user) && user!.id === userId };
}

/** What the signed-in person may do on the offer and joining screens (no values). */
export async function offerStatus(actor: Actor) {
  const c = await offerContext(actor);
  return { offerManage: c.offerManage, onboarding: c.onboarding, isDirector: c.payDirector, isApprover: (await approverState(actor.userId)).isApprover };
}

/** Joining checklist: onboarding (HR, default ON) and directors; the chosen exception approver may read it to decide. */
export async function joiningStatus(candidateId: string, actor: Actor) {
  const c = await offerContext(actor);
  const approver = await approverState(actor.userId);
  if (!c.onboarding && !approver.isApprover) throw new HttpError(403, "Joining is handled by HR onboarding and the directors.", "FORBIDDEN");
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  const offer = candidate ? await acceptedOffer(candidateId) : null;
  if (!candidate || !offer) throw absent();
  const [types, lifetime, links, docs, exceptions] = await Promise.all([
    getSetting("joinerDocumentTypes"), getSetting("joinerLinkLifetime"),
    prisma.recruitmentJoinerLink.findMany({ where: { candidateId }, orderBy: { createdAt: "desc" } }),
    prisma.recruitmentJoinerDocument.findMany({ where: { candidateId, storageKey: { not: null } }, orderBy: { uploadedAt: "desc" } }),
    prisma.recruitmentJoiningException.findMany({ where: { candidateId } }),
  ]);
  const approvers = await prisma.user.findMany({ where: { id: { in: exceptions.map(e => e.approvedByUserId) } }, select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } } });
  const nameOf = (id: string) => { const u = approvers.find(a => a.id === id); return u ? (u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode) : "Approver"; };
  const now = new Date();
  const required = (types ?? []).map(t => {
    const doc = docs.find(d => d.typeCode === t.code);
    const ex = exceptions.find(e => e.typeCode === t.code);
    return { code: t.code, label: t.label, kind: t.kind, uploaded: doc ? { id: doc.id, uploadedAt: doc.uploadedAt.toISOString(), mimeType: doc.mimeType, sizeBytes: doc.sizeBytes } : null, exception: ex ? { approvedBy: nameOf(ex.approvedByUserId), createdAt: ex.createdAt.toISOString(), reason: ex.reason } : null };
  });
  return {
    candidate: { id: candidate.id, name: candidateName(candidate), live: retained(candidate) },
    offer: { id: offer.id, joiningDate: offer.joiningDate.toISOString().slice(0, 10), title: offer.title, convertedEmployeeId: offer.conversion?.employeeId ?? null },
    required,
    complete: types !== null && required.every(r => r.uploaded || r.exception),
    links: links.map(l => ({ id: l.id, createdAt: l.createdAt.toISOString(), expiresAt: l.expiresAt.toISOString(), revokedAt: l.revokedAt?.toISOString() ?? null, completedAt: l.completedAt?.toISOString() ?? null, active: !l.revokedAt && !l.completedAt && l.expiresAt > now })),
    settings: { lifetimeSet: lifetime !== null, typesSet: types !== null, approverSet: approver.set },
    canManage: c.onboarding, isApprover: approver.isApprover,
  };
}

export async function createLink(candidateId: string, actor: Actor, meta: Meta) {
  const c = await requireOnboarding(actor);
  const lifetime = await required("joinerLinkLifetime");
  await required("joinerDocumentTypes");
  const token = randomBytes(32).toString("base64url");
  const row = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM candidates WHERE id=${candidateId} FOR UPDATE`;
    const candidate = await tx.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate || !retained(candidate)) throw absent();
    const offer = await tx.recruitmentOffer.findFirst({ where: { candidateId, state: "ACCEPTED" }, include: { conversion: true } });
    if (!offer) throw new HttpError(409, "A joining link needs an accepted offer.", "CONFLICT");
    if (offer.conversion) throw new HttpError(409, "This candidate has already joined.", "CONFLICT");
    const now = new Date();
    // One active link at a time: a new link revokes the earlier ones.
    await tx.recruitmentJoinerLink.updateMany({ where: { candidateId, revokedAt: null, completedAt: null }, data: { revokedAt: now, revokedByUserId: c.userId } });
    const link = await tx.recruitmentJoinerLink.create({ data: { candidateId, offerId: offer.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + lifetime.hours * 3_600_000), createdByUserId: c.userId } });
    await writeAuditLogs([{ ...meta, action: "recruitment.joiner_link.created", entityType: "RecruitmentJoinerLink", entityId: link.id, after: { candidateId, expiresAt: link.expiresAt.toISOString() } }], tx);
    return link;
  });
  // The token is shown once, to the person who created it; it is never stored, logged or returned again.
  return { id: row.id, expiresAt: row.expiresAt.toISOString(), url: `${env.WEB_BASE_URL.replace(/\/$/, "")}/joining/${token}`, token };
}

export async function revokeLink(linkId: string, actor: Actor, meta: Meta) {
  const c = await requireOnboarding(actor);
  const row = await prisma.recruitmentJoinerLink.findUnique({ where: { id: linkId } });
  if (!row) throw absent();
  if (!row.revokedAt) {
    await prisma.recruitmentJoinerLink.updateMany({ where: { id: linkId, revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: c.userId } });
    await writeAuditLogs([{ ...meta, action: "recruitment.joiner_link.revoked", entityType: "RecruitmentJoinerLink", entityId: linkId }]);
  }
  return { id: linkId, revoked: true };
}

/** HR onboarding and directors may review identity and bank documents; every open is audited. */
export async function downloadDocument(docId: string, actor: Actor, meta: Meta) {
  await requireOnboarding(actor);
  const row = await prisma.recruitmentJoinerDocument.findUnique({ where: { id: docId }, include: { candidate: true } });
  if (!row?.storageKey || !retained(row.candidate)) throw absent();
  let object: { body: Buffer; contentType: string };
  try { object = await storageService.getObject(row.storageKey); } catch { throw absent(); }
  await writeAuditLogs([{ ...meta, action: "recruitment.joining_document.opened", entityType: "RecruitmentJoinerDocument", entityId: docId, after: { candidateId: row.candidateId, typeCode: row.typeCode } }]);
  return object;
}

export async function grantException(candidateId: string, actor: Actor, input: z.infer<typeof exceptionInput>, meta: Meta) {
  await offerContext(actor); // Developer refused
  const approver = await approverState(actor.userId);
  if (!approver.set) throw new HttpError(409, "Recruitment: joiningExceptionApprover is Not set. A director must choose it first.", "RECRUITMENT_NOT_SET");
  if (!approver.isApprover) throw new HttpError(403, "Only the exception approver a director chose can do this.", "FORBIDDEN");
  const types = await required("joinerDocumentTypes");
  if (!types.some(t => t.code === input.typeCode)) throw new HttpError(400, "Choose one of the required joining documents.", "VALIDATION_ERROR");
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!candidate || !retained(candidate) || !(await acceptedOffer(candidateId))) throw absent();
  const prior = await prisma.recruitmentJoiningException.findUnique({ where: { candidateId_typeCode: { candidateId, typeCode: input.typeCode } } });
  if (!prior) {
    try {
      await prisma.$transaction(async tx => {
        const row = await tx.recruitmentJoiningException.create({ data: { candidateId, typeCode: input.typeCode, reason: input.reason, approvedByUserId: actor.userId } });
        await writeAuditLogs([{ ...meta, action: "recruitment.joining_exception.granted", entityType: "RecruitmentJoiningException", entityId: row.id, after: { candidateId, typeCode: input.typeCode } }], tx);
      });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002")) throw error;
    }
  }
  return joiningStatus(candidateId, actor);
}

// ── Public (no login) ──
async function resolve(token: string) {
  const link = await prisma.recruitmentJoinerLink.findUnique({ where: { tokenHash: hashToken(token) }, include: { candidate: true, offer: { include: { conversion: true } } } });
  if (!link) throw new HttpError(404, "This link is not valid.", "NOT_FOUND");
  const now = new Date();
  if (link.revokedAt || link.completedAt || link.expiresAt <= now || !retained(link.candidate, now) || link.offer.state !== "ACCEPTED" || link.offer.conversion) throw new HttpError(410, "This link is no longer valid. Ask the company for a new one.", "LINK_GONE");
  return link;
}

export async function publicView(token: string) {
  const link = await resolve(token);
  const types = (await getSetting("joinerDocumentTypes")) ?? [];
  const done = await prisma.recruitmentJoinerDocument.findMany({ where: { linkId: link.id }, select: { typeCode: true } });
  return { expiresAt: link.expiresAt.toISOString(), documents: types.map(t => ({ code: t.code, label: t.label, allowedMimeTypes: t.allowedMimeTypes, maxMb: t.maxMb, uploaded: done.some(d => d.typeCode === t.code) })) };
}

export async function publicUpload(token: string, typeCode: string, file: Express.Multer.File | undefined, meta: { ipAddress?: string | null; userAgent?: string | null }) {
  const link = await resolve(token);
  const types = (await getSetting("joinerDocumentTypes")) ?? [];
  const type = types.find(t => t.code === typeCode);
  if (!type) throw new HttpError(404, "This document is not requested.", "NOT_FOUND");
  // The platform's checks: declared type allowed, extension matches, magic bytes match, size cap; images re-encoded.
  const prepared = await prepareDocumentUpload(requireFile(file), { documentMaxUploadMb: type.maxMb, documentAllowedMimeTypes: type.allowedMimeTypes });
  const key = `recruitment/joining/${link.candidateId}/${randomUUID()}`;
  await storageService.putObject(key, prepared.buffer, prepared.mimeType);
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM recruitment_joiner_links WHERE id=${link.id} FOR UPDATE`;
      const fresh = await tx.recruitmentJoinerLink.findUniqueOrThrow({ where: { id: link.id } });
      if (fresh.revokedAt || fresh.completedAt || fresh.expiresAt <= new Date()) throw new HttpError(410, "This link is no longer valid. Ask the company for a new one.", "LINK_GONE");
      if (await tx.recruitmentJoinerDocument.findUnique({ where: { linkId_typeCode: { linkId: link.id, typeCode } } })) throw new HttpError(409, "This document was already uploaded through this link.", "ALREADY_UPLOADED");
      const doc = await tx.recruitmentJoinerDocument.create({ data: { candidateId: link.candidateId, linkId: link.id, typeCode, storageKey: key, mimeType: prepared.mimeType, sizeBytes: prepared.sizeBytes } });
      const uploaded = await tx.recruitmentJoinerDocument.findMany({ where: { linkId: link.id }, select: { typeCode: true } });
      if (types.every(t => uploaded.some(u => u.typeCode === t.code))) await tx.recruitmentJoinerLink.update({ where: { id: link.id }, data: { completedAt: new Date() } });
      await writeAuditLogs([{ actorUserId: null, ...meta, action: "recruitment.joining_document.uploaded", entityType: "RecruitmentJoinerDocument", entityId: doc.id, after: { candidateId: link.candidateId, typeCode } }], tx);
    });
  } catch (error) {
    await storageService.deleteObject(key).catch(() => undefined);
    throw error;
  }
  return publicView(token).catch(() => ({ expiresAt: link.expiresAt.toISOString(), documents: [], complete: true }));
}
