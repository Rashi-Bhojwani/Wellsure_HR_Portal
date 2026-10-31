import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { env } from "../../../config/env";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { getSetting, setSetting } from "../../../lib/settings";
import { HttpError } from "../../../middleware/errorHandler";

// The link in a payslip email (docs/plans/STAGE_5B_PLAN.md, B4). The email carries no figure, only a link. The link is a random token of which only the hash is stored; it is for one
// payslip and one person, it expires after the number of days a director sets (Not set: no link is put in the email, which then only says to sign in), it needs a signed-in session, and
// it is checked again each time it is opened: the signed-in person must be its owner, the payslip must exist, and the link must be neither expired nor revoked. Anything wrong
// answers the same way, so a link tells a stranger nothing.
// A password-protected PDF is a separate decision that needs the owners' approval: it stays off, and this module refuses to switch it on.

export const LINK_EXPIRY_KEY = "payroll.payslipLinkExpiryDays";
const MAX_DAYS = 100;
const invalid = () => new HttpError(404, "This link is not valid. Sign in and open your payslip from Salary.", "LINK_INVALID");
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export async function linkExpiryDays(): Promise<number | null> {
  return getSetting<number | null>(LINK_EXPIRY_KEY, null);
}

/** Makes a link for a payslip and returns its address, or null when the lifetime is Not set. The token is shown here, once; only its hash is kept. */
export async function createLink(payslip: { id: string; employeeId: string }, now: Date = new Date()): Promise<string | null> { // allow-clock: an instant
  const days = await linkExpiryDays();
  if (days === null) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime());
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days);
  await prisma.payslipLink.create({ data: { payslipId: payslip.id, employeeId: payslip.employeeId, tokenHash: hashOf(token), expiresAt } });
  return `${env.WEB_BASE_URL}/app/salary/payslip-link/${token}`;
}

export const openSchema = z.object({ token: z.string().min(16).max(200) }).strict();

/** Opens a link for the signed-in person. Returns the payslip to show, or the same refusal whatever is wrong. */
export async function openLink(employeeId: string, raw: unknown, now: Date = new Date()): Promise<{ payslipId: string }> { // allow-clock: an instant
  const parsed = openSchema.safeParse(raw);
  if (!parsed.success) throw invalid();
  const link = await prisma.payslipLink.findUnique({ where: { tokenHash: hashOf(parsed.data.token) } });
  if (!link || link.employeeId !== employeeId || link.revokedAt !== null || link.expiresAt <= now) throw invalid();
  const slip = await prisma.payslip.findFirst({ where: { id: link.payslipId, employeeId }, select: { id: true, run: { select: { status: true } } } });
  if (!slip || slip.run.status !== "FINALISED") throw invalid();
  if (link.openedAt === null) await prisma.payslipLink.update({ where: { id: link.id }, data: { openedAt: now } });
  await writeAuditLog({ actorUserId: null, action: "payroll.payslip.link_opened", entityType: "Payslip", entityId: slip.id, after: { employeeId } });
  return { payslipId: slip.id };
}

/** Revokes every link of a run's payslips (a director's act, audited). */
export async function revokeRunLinks(runId: string, actor: { userId: string; ip?: string | null }): Promise<{ revoked: number }> {
  await requireDirector(actor.userId, "revoke payslip links");
  const { count } = await prisma.payslipLink.updateMany({ where: { payslip: { runId }, revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: actor.userId } }); // allow-clock: an instant
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.payslip.links_revoked", entityType: "PayrollRun", entityId: runId, after: { revoked: count }, ipAddress: actor.ip ?? null });
  return { revoked: count };
}

export const settingsSchema = z.object({ expiryDays: z.number().int().min(1).max(MAX_DAYS).nullable(), passwordProtectedPdf: z.boolean().optional() }).strict();

export async function getLinkSettings(actor: { userId: string }) {
  await requireDirector(actor.userId, "see the payslip link settings");
  return { expiryDays: await linkExpiryDays(), passwordProtectedPdf: { enabled: false, status: "NEEDS_OWNER_APPROVAL" as const } };
}

export async function putLinkSettings(raw: unknown, actor: { userId: string; ip?: string | null }) {
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await requireDirector(actor.userId, "change the payslip link settings");
  if (parsed.data.passwordProtectedPdf === true) throw new HttpError(409, "A password-protected PDF needs the owners' approval and is not available.", "NEEDS_OWNER_APPROVAL");
  await setSetting(LINK_EXPIRY_KEY, parsed.data.expiryDays, actor.userId);
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.payslip.link_settings_changed", entityType: "SystemSetting", entityId: LINK_EXPIRY_KEY, after: { expiryDays: parsed.data.expiryDays }, ipAddress: actor.ip ?? null });
  return getLinkSettings(actor);
}
