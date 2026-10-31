import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";

// "Sent to bank" (decision D-34: bank payments are manual, the app never talks to a bank). A director notes that a bank file they downloaded was sent to the bank:
// who and when, once per file, never changed or removed (the database holds all three). It moves no money and changes no status.

type Actor = { userId: string; ip?: string | null };
export type SentFile = "batch" | "repayment";

export const sentSchema = z.object({ note: z.string().trim().max(200).optional() }).strict();

const DOWNLOAD_ACTION: Record<SentFile, string> = { batch: "payroll.bank.file_downloaded", repayment: "payroll.bank.repayment_downloaded" };
const ENTITY: Record<SentFile, string> = { batch: "BankTransferBatch", repayment: "BankRepaymentBatch" };

export async function markSentToBank(kind: SentFile, id: string, raw: unknown, actor: Actor) {
  const parsed = sentSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await requireDirector(actor.userId, "note that a bank file was sent to the bank");
  const exists = kind === "batch" ? await prisma.bankTransferBatch.findUnique({ where: { id }, select: { id: true } }) : await prisma.bankRepaymentBatch.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new HttpError(404, "There is no such bank file.", "NOT_FOUND");
  const downloaded = await prisma.auditLog.findFirst({ where: { action: DOWNLOAD_ACTION[kind], entityType: ENTITY[kind], entityId: id }, select: { id: true } });
  if (!downloaded) throw new HttpError(409, "The file has not been downloaded yet, so it cannot be marked as sent.", "NOT_DOWNLOADED");
  const where = kind === "batch" ? { batchId: id } : { repaymentBatchId: id };
  if (await prisma.bankFileSentMark.findFirst({ where, select: { id: true } })) throw new HttpError(409, "This file was already marked as sent to the bank.", "ALREADY_SENT");
  const mark = await prisma.bankFileSentMark.create({ data: { ...where, sentByUserId: actor.userId, note: parsed.data.note ?? null } });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.marked_sent", entityType: ENTITY[kind], entityId: id, after: { sentAt: mark.sentAt.toISOString() }, ipAddress: actor.ip ?? null });
  return { sentAt: mark.sentAt.toISOString(), sentByUserId: mark.sentByUserId, note: mark.note };
}
