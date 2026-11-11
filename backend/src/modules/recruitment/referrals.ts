import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { decryptField, encryptField } from "../../lib/encryption";
import { HttpError } from "../../middleware/errorHandler";
import { absent, context, requireManagement, type Actor, type Meta } from "./access";
import { fingerprint, normalizeEmail, normalizeName, normalizePhone } from "./candidates";
import { getSetting, required, version, SETTING_SCHEMAS } from "./settings";

// C-4B referrals: optional, OFF by default behind the director setting `referrals` (Not set = off). An employee refers someone
// with recorded consent to an open job; the recruiting team accepts it (creating the candidate) or closes it. The referrer sees
// basic status only: SUBMITTED, IN_REVIEW or CLOSED — never the stage, interviews, feedback, offer or pay.

export const referralInput = z.object({
  jobId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  email: z.email().max(320).nullable(),
  phone: z.string().trim().max(40).regex(/^[+()\d -]+$/, "Enter a valid phone number.").nullable(),
  consentConfirmed: z.literal(true),
}).strict().refine(v => Boolean(v.email || v.phone), "Enter email or phone.");
export const acceptInput = z.object({ source: z.string().min(1).max(60) }).strict();

async function enabled() {
  return (await getSetting("referrals"))?.enabled === true;
}
const off = () => new HttpError(403, "Referrals are switched off.", "FEATURE_OFF");

export async function referralStatus(actor: Actor) {
  const c = await context(actor);
  return { enabled: await enabled(), canReview: c.manage };
}

export async function openJobs(actor: Actor) {
  await context(actor);
  if (!(await enabled())) throw off();
  return prisma.recruitmentJob.findMany({ where: { status: "OPEN" }, select: { id: true, title: true }, orderBy: { title: "asc" } });
}

export async function submit(actor: Actor, input: z.infer<typeof referralInput>, meta: Meta) {
  const c = await context(actor);
  if (!(await enabled())) throw off();
  const retention = await version("retention");
  if (retention?.value == null) throw new HttpError(409, "Recruitment retention is Not set.", "RECRUITMENT_NOT_SET");
  const job = await prisma.recruitmentJob.findFirst({ where: { id: input.jobId, status: "OPEN" } });
  if (!job) throw new HttpError(400, "Choose an open job.", "VALIDATION_ERROR");
  const now = new Date();
  const until = new Date(now.getTime() + SETTING_SCHEMAS.retention.parse(retention.value).days * 86400000);
  const row = await prisma.$transaction(async tx => {
    const r = await tx.recruitmentReferral.create({ data: { referrerEmployeeId: c.employeeId, jobId: job.id, nameEncrypted: encryptField(input.name), emailEncrypted: input.email ? encryptField(input.email) : null, phoneEncrypted: input.phone ? encryptField(input.phone) : null, consentRecordedAt: now, retentionUntil: until, changedByUserId: c.userId } });
    await writeAuditLogs([{ ...meta, action: "recruitment.referral.submitted", entityType: "RecruitmentReferral", entityId: r.id }], tx);
    return r;
  });
  return { id: row.id, status: "SUBMITTED" as const };
}

/** The referrer's own referrals: job title and a basic status only. */
export async function mine(actor: Actor) {
  const c = await context(actor);
  const rows = await prisma.recruitmentReferral.findMany({ where: { referrerEmployeeId: c.employeeId }, include: { job: { select: { title: true } }, candidate: { select: { anonymizedAt: true, applications: { select: { status: true } } } } }, orderBy: { createdAt: "desc" } });
  return {
    enabled: await enabled(),
    items: rows.map(r => {
      const live = r.candidate && !r.candidate.anonymizedAt && r.candidate.applications.some(a => a.status === "ACTIVE");
      return { id: r.id, jobTitle: r.job.title, createdAt: r.createdAt.toISOString(), status: r.status === "SUBMITTED" ? "SUBMITTED" : live ? "IN_REVIEW" : "CLOSED" };
    }),
  };
}

export async function list(actor: Actor) {
  await requireManagement(actor);
  const now = new Date();
  const rows = await prisma.recruitmentReferral.findMany({ where: { status: "SUBMITTED" }, include: { job: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return { items: rows.map(r => { const live = r.retentionUntil > now; return { id: r.id, job: r.job, createdAt: r.createdAt.toISOString(), name: live && r.nameEncrypted ? decryptField(r.nameEncrypted) : "Details removed", email: live && r.emailEncrypted ? decryptField(r.emailEncrypted) : null, phone: live && r.phoneEncrypted ? decryptField(r.phoneEncrypted) : null }; }) };
}

export async function accept(id: string, actor: Actor, input: z.infer<typeof acceptInput>, meta: Meta) {
  const c = await requireManagement(actor);
  const sources = await required("sources");
  if (!sources.some(s => s.code === input.source)) throw new HttpError(400, "Choose a configured candidate source.", "VALIDATION_ERROR");
  const retention = await version("retention");
  if (retention?.value == null) throw new HttpError(409, "Recruitment retention is Not set.", "RECRUITMENT_NOT_SET");
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM recruitment_referrals WHERE id=${id} FOR UPDATE`;
      const r = await tx.recruitmentReferral.findUnique({ where: { id } });
      if (!r) throw absent();
      if (r.status !== "SUBMITTED") return { id, status: r.status, candidateId: r.candidateId };
      if (r.retentionUntil <= new Date() || !r.nameEncrypted) throw new HttpError(409, "This referral's details have expired.", "CONFLICT");
      const name = decryptField(r.nameEncrypted), email = r.emailEncrypted ? decryptField(r.emailEncrypted) : null, phone = r.phoneEncrypted ? decryptField(r.phoneEncrypted) : null;
      const emailHash = email ? fingerprint(normalizeEmail(email)) : null, phoneHash = phone ? fingerprint(normalizePhone(phone)) : null;
      if (await tx.candidate.count({ where: { OR: [...(emailHash ? [{ emailHash }] : []), ...(phoneHash ? [{ phoneHash }] : [])] } })) throw new HttpError(409, "A candidate may already be recorded. Review the existing records.", "DUPLICATE_CANDIDATE");
      const days = SETTING_SCHEMAS.retention.parse(retention.value).days;
      const candidate = await tx.candidate.create({ data: { nameEncrypted: encryptField(name), nameHash: fingerprint(normalizeName(name)), emailEncrypted: email ? encryptField(email) : null, emailHash, phoneEncrypted: phone ? encryptField(phone) : null, phoneHash, source: input.source, consentRecordedAt: r.consentRecordedAt, retentionUntil: new Date(r.consentRecordedAt.getTime() + days * 86400000), retentionVersionId: retention.id, createdByUserId: c.userId } });
      // The identity moves into the candidate record; the referral keeps only the link and the status.
      await tx.recruitmentReferral.update({ where: { id }, data: { status: "ACCEPTED", candidateId: candidate.id, nameEncrypted: null, emailEncrypted: null, phoneEncrypted: null, changedByUserId: c.userId } });
      await writeAuditLogs([{ ...meta, action: "recruitment.referral.accepted", entityType: "RecruitmentReferral", entityId: id, after: { candidateId: candidate.id } }, { ...meta, action: "recruitment.candidate.created", entityType: "Candidate", entityId: candidate.id }], tx);
      return { id, status: "ACCEPTED", candidateId: candidate.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "A candidate may already be recorded. Review the existing records.", "DUPLICATE_CANDIDATE");
    throw error;
  }
}

export async function close(id: string, actor: Actor, meta: Meta) {
  const c = await requireManagement(actor);
  const r = await prisma.recruitmentReferral.findUnique({ where: { id } });
  if (!r) throw absent();
  if (r.status === "SUBMITTED") {
    await prisma.recruitmentReferral.update({ where: { id }, data: { status: "CLOSED", nameEncrypted: null, emailEncrypted: null, phoneEncrypted: null, changedByUserId: c.userId } });
    await writeAuditLogs([{ ...meta, action: "recruitment.referral.closed", entityType: "RecruitmentReferral", entityId: id }]);
  }
  return { id, status: r.status === "SUBMITTED" ? "CLOSED" : r.status };
}

/** Retention for referrals never accepted: identity removed once the retention period ends. */
export async function purgeExpiredReferrals(now = new Date()) {
  const { count } = await prisma.recruitmentReferral.updateMany({ where: { retentionUntil: { lte: now }, OR: [{ nameEncrypted: { not: null } }, { emailEncrypted: { not: null } }, { phoneEncrypted: { not: null } }] }, data: { nameEncrypted: null, emailEncrypted: null, phoneEncrypted: null, status: "CLOSED" } });
  return { removed: count };
}
