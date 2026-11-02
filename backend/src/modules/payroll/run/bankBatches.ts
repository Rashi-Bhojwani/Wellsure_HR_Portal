import { writeAuditLog } from "../../../lib/audit";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { storageService } from "../../../integrations/storage";
import { getSocketServer, permissionRoom } from "../../../realtime/emit";
import { recordEvent } from "../events";
import { namesOn } from "../../../lib/effectiveDating";
import { canonicalDecimal, dec } from "../money";

// After the bank file exists (docs/plans/PHASE_6.md §14H). The app never talks to a bank: HR downloads the file and uploads it to net banking, then says here what the
// bank's reference is. There is no state that means "sent". The batch holds no account number, only the last four digits.

const SIGNED_SECONDS = 300;

type Actor = { userId: string; ip?: string | null };

async function batchOf(id: string) {
  const b = await prisma.bankTransferBatch.findUnique({ where: { id }, include: { run: { select: { cycleLabel: true } }, sentMark: true } });
  if (!b) throw new HttpError(404, "There is no such bank batch.", "NOT_FOUND");
  return b;
}

const view = (b: Awaited<ReturnType<typeof batchOf>>) => ({
  id: b.id,
  runId: b.runId,
  cycle: b.run.cycleLabel,
  status: b.status,
  paymentDate: b.paymentDate.toISOString().slice(0, 10),
  rowCount: b.rowCount,
  total: canonicalDecimal(dec(b.total.toString())),
  excluded: b.excluded as Array<{ employeeId: string; employeeCode: string; name: string; reason: string; detail: string }>,
  fileName: b.fileName,
  fileSha256: b.fileSha256,
  generatedAt: b.generatedAt.toISOString(),
  paid: b.status === "PAID" ? { at: b.paidAt?.toISOString() ?? null, on: b.paidOn?.toISOString().slice(0, 10) ?? null, reference: b.bankReference } : null,
  sentToBank: b.sentMark ? { at: b.sentMark.sentAt.toISOString(), byUserId: b.sentMark.sentByUserId, note: b.sentMark.note } : null,
});

export async function batchForRun(runId: string) {
  const b = await prisma.bankTransferBatch.findUnique({ where: { runId }, include: { run: { select: { cycleLabel: true } }, sentMark: true } });
  return { batch: b ? view(b) : null };
}

export async function getBatch(id: string) {
  const b = await batchOf(id);
  const rows = await prisma.bankTransferRow.findMany({ where: { batchId: id }, orderBy: { serial: "asc" }, include: { employee: { select: { employeeCode: true } } } });
  const names = await namesOn(rows.map((r) => r.employeeId), (await prisma.payrollRun.findUniqueOrThrow({ where: { id: b.runId }, select: { cycleEnd: true } })).cycleEnd);
  return { ...view(b), rows: rows.map((r) => ({ serial: r.serial, employeeCode: r.employee.employeeCode, name: names.get(r.employeeId) ?? r.employee.employeeCode, accountLast4: r.accountLast4, ifsc: r.ifsc, amount: canonicalDecimal(dec(r.amount.toString())), narration: r.narration })) };
}

/** A short-lived link to the file. Every download is audited, and the file holds full account numbers, so the route needs payroll.bank.view. */
export async function downloadBatchFile(id: string, actor: Actor) {
  const b = await batchOf(id);
  const url = await storageService.getObjectSignedUrl(b.fileKey, SIGNED_SECONDS, { downloadFileName: b.fileName });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.file_downloaded", entityType: "BankTransferBatch", entityId: id, after: { cycle: b.run.cycleLabel, sha256: b.fileSha256 }, ipAddress: actor.ip ?? null });
  return { url, expiresInSeconds: SIGNED_SECONDS, fileName: b.fileName, sha256: b.fileSha256 };
}

/** HR's own statement that the file was uploaded and the bank gave this reference. Moves nothing; recorded as that person's statement, once. */
export async function markPaid(id: string, input: { reference: string; paidOn: string; confirm: string }, actor: Actor) {
  const b = await batchOf(id);
  if (b.status === "PAID") throw new HttpError(409, "This batch was already marked paid.", "ALREADY_PAID");
  if (input.confirm.trim().toUpperCase() !== "PAID") throw new HttpError(400, "Type PAID to confirm you are recording that the bank has paid this batch.", "VALIDATION_ERROR");
  const reference = input.reference.trim();
  if (reference.length < 3) throw new HttpError(400, "Enter the bank's reference for this batch.", "VALIDATION_ERROR");
  const { count } = await prisma.bankTransferBatch.updateMany({ where: { id, status: "GENERATED" }, data: { status: "PAID", paidAt: new Date(), paidOn: new Date(`${input.paidOn}T00:00:00Z`), paidByUserId: actor.userId, bankReference: reference } }); // allow-clock: an instant
  if (count !== 1) throw new HttpError(409, "This batch was just changed by somebody else.", "CONFLICT");
  await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: b.runId, type: "BANK_BATCH_MARKED_PAID", actorUserId: actor.userId, payload: { batchId: id, reference, paidOn: input.paidOn } });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.marked_paid", entityType: "BankTransferBatch", entityId: id, after: { cycle: b.run.cycleLabel, reference, paidOn: input.paidOn }, ipAddress: actor.ip ?? null });
  getSocketServer()?.to(["payroll.run", "payroll.approve"].map(permissionRoom)).emit("payroll.bank.paid", { runId: b.runId, cycle: b.run.cycleLabel });
  return getBatch(id);
}
