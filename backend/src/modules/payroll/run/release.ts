import { createHash } from "node:crypto";
import type { PayrollRun } from "@prisma/client";
import { bankAccountsOn } from "../../../lib/effectiveDating";
import { decryptField } from "../../../lib/encryption";
import { blindIndex, normalizeAccountNumber } from "../../../lib/fieldHash";
import { writeAuditLog, writeAuditLogs } from "../../../lib/audit";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { storageService } from "../../../integrations/storage";
import { getSocketServer, permissionRoom } from "../../../realtime/emit";
import { enqueuePayslipJob } from "../../../jobs/payrollQueues";
import { logger } from "../../../lib/logger";
import { adapterFor, consume, voidApproval } from "../approvals";
import { recordEvent } from "../events";
import { assertRunIsReal } from "../rules/context";
import { isDemoCompany } from "../setup/status";
import { planBank } from "./bank";
import { requireHolds } from "./closing";
import { formatDate, renderLayout, type LayoutRow } from "./layout";
import { currentLayout, debitAccountOf } from "./layouts";
import { buildPayslips } from "./payslip";
import { computeRun } from "./engine";

// The acts that release a final run's results, and the only code allowed to write payslips, bank batches and release rows (docs/plans/PHASE_6.md §14H; a source scan in
// payrollGuards.test.ts keeps it to this file). Like finalising, each is carried out by somebody other than the person who decided, re-checks everything from scratch, and
// writes what it releases together with the release row in ONE transaction: from that commit the period can no longer be unlocked.
//
//   publishPayslips   one immutable payslip per payable person; the PDFs and the notices follow in the background.
//   generateBankFile  the bank file, written from the encrypted accounts only for as long as it takes to write it; one audit row per account read.
//
// The app never talks to a bank. The file is for a person to upload.

type Actor = { userId: string; ip?: string | null };

function emit(event: string, payload: Record<string, unknown>): void {
  getSocketServer()?.to(["payroll.run", "payroll.approve"].map(permissionRoom)).emit(event, payload);
}

async function finalRun(runId: string): Promise<PayrollRun> {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  if (run.status !== "FINALISED") throw new HttpError(409, "This run is not final, so nothing can be released from it.", "RUN_STATE");
  const computed = await computeRun({ start: run.cycleStart, end: run.cycleEnd, label: run.cycleLabel });
  void computed; // a final run never changes; the approval's own hash (below) is what is checked
  await assertRunIsReal(((run.pins as unknown as Parameters<typeof assertRunIsReal>[0]) ?? []), "released");
  return run;
}

async function decidedBy(subject: "PAYSLIP_PUBLISH" | "BANK_FILE", runId: string, actor: Actor): Promise<void> {
  const approval = await prisma.payrollApproval.findFirst({ where: { subject, subjectId: runId, status: "APPROVED" } });
  if (!approval) throw new HttpError(409, `${subject === "BANK_FILE" ? "The bank file" : "Publishing"} has not been approved yet.`, "APPROVAL_REQUIRED");
  if (approval.authority !== "DIRECTOR_AUTHORITY" && approval.checkerUserId === actor.userId) throw new HttpError(403, "You approved this, so somebody else carries it out. The person who decides is never the person who does.", "CHECKER_IS_EXECUTOR");
  // What was approved must still be what would be written. Checked first, so a change (a bank account, a layout) voids the approval in words before anything is prepared.
  if ((await adapterFor(subject).hash(runId)) !== approval.hashAtDecision) {
    await voidApproval(approval, "What was approved no longer matches what would be written (a bank account, a name or the layout changed).", actor.userId);
    throw new HttpError(409, "Something changed after this was approved (a bank account, a name or the layout), so the approval is void. It needs to be requested and approved again.", "APPROVAL_VOIDED");
  }
}

// ── Payslips ──

export async function publishPayslips(runId: string, actor: Actor) {
  await requireHolds(actor.userId, "payroll.run");
  const run = await finalRun(runId);
  if (await prisma.payrollRunRelease.findFirst({ where: { runId, kind: "PAYSLIPS_PUBLISHED" } })) throw new HttpError(409, "The payslips for this period have already been published.", "ALREADY_RELEASED");
  await decidedBy("PAYSLIP_PUBLISH", runId, actor);
  const slips = await buildPayslips(run);
  if (slips.size === 0) throw new HttpError(409, "Nobody in this run is payable, so there are no payslips to publish.", "NOTHING_TO_PAY");

  await prisma.$transaction(
    async (tx) => {
      await consume("PAYSLIP_PUBLISH", runId, actor.userId, actor.ip ?? null, tx); // re-checks the hash, which covers every payslip's content
      await tx.payslip.createMany({
        data: [...slips].map(([employeeId, s]) => ({ runId, runItemId: s.runItemId, employeeId, cycleLabel: run.cycleLabel, cycleStart: run.cycleStart, cycleEnd: run.cycleEnd, content: s.content as unknown as object, contentHash: s.contentHash, publishedByUserId: actor.userId })),
      });
      await tx.payrollRunRelease.create({ data: { runId, kind: "PAYSLIPS_PUBLISHED", reference: `${slips.size} payslips`, actorUserId: actor.userId } });
      await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "PAYSLIPS_PUBLISHED", actorUserId: actor.userId, payload: { count: slips.size } }, tx);
    },
    { timeout: 120000 },
  );
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.payslips.published", entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, count: slips.size }, ipAddress: actor.ip ?? null });
  await startDelivery(runId);
  emit("payroll.payslips.published", { runId, cycle: run.cycleLabel, count: slips.size });
  return { runId, published: slips.size };
}

/** Hands the run's payslips to the worker (PDF, notice, email). Safe to call again: the job does only what is not yet done. A failure to queue is not a failure to publish. */
export async function startDelivery(runId: string): Promise<{ queued: boolean }> {
  try {
    await enqueuePayslipJob(runId);
    return { queued: true };
  } catch (err) {
    logger.error({ err, runId }, "could not queue the payslip delivery job; use Prepare again on the run page");
    return { queued: false };
  }
}

// ── The bank file ──

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export const DEMO_WATERMARK = "DEMO COMPANY: FICTIONAL PEOPLE AND ACCOUNTS. NOT FOR ANY BANK.";
const layoutSaysDemo = (layout: import("./layout").Layout): boolean => [...layout.header.flat(), ...layout.trailer.flat(), ...layout.columns].some((c) => c.source === "CONSTANT" && /\bDEMO\b/.test(c.value));

export async function generateBankFile(runId: string, actor: Actor) {
  await requireHolds(actor.userId, "payroll.run");
  const run = await finalRun(runId);
  if (await prisma.payrollRunRelease.findFirst({ where: { runId, kind: "BANK_FILE_GENERATED" } })) throw new HttpError(409, "A bank file has already been generated for this period.", "ALREADY_RELEASED");
  await decidedBy("BANK_FILE", runId, actor);

  const plan = await planBank(run);
  if (!plan.template.ready) throw new HttpError(409, "The bank file layout is not confirmed by a second person, so no file can be made.", "BANK_TEMPLATE_PLACEHOLDER");
  if (plan.paymentDate === null) throw new HttpError(409, "The payment date rule has no value, so it is not known which bank account applies.", "PAYMENT_DATE_UNSET");
  if (plan.rows.length === 0) throw new HttpError(409, "Nobody has a bank account in force on the payment date, so the file would be empty.", "NOTHING_TO_PAY");
  const stored = await currentLayout("BANK_TEMPLATE");
  if (!stored || stored.version !== plan.template.version || stored.valueHash !== plan.template.valueHash) throw new HttpError(409, "The layout changed while this was being prepared. Look at it again.", "PREVIEW_STALE");
  const layout = stored.value as import("./layout").Layout;

  // Decrypt only here, only the accounts in the plan, and check each is the account that was approved (its blind-index hash).
  const inForce = await bankAccountsOn(plan.rows.map((r) => r.employeeId), new Date(`${plan.paymentDate}T00:00:00Z`));
  const accounts = new Map([...inForce.values()].map((a) => [a.id, a]));
  const rows: LayoutRow[] = plan.rows.map((r) => {
    const account = accounts.get(r.bankAccountId);
    if (!account) throw new HttpError(409, "A bank account in the plan no longer exists. Look at it again.", "PREVIEW_STALE");
    const number = decryptField(account.accountNumberEncrypted);
    if (blindIndex(normalizeAccountNumber(number)) !== r.accountHash) throw new HttpError(409, "A bank account changed while this was being prepared. Look at it again.", "PREVIEW_STALE");
    const narration = (layout.narrationPattern ?? "").replace(/\{([A-Z_]+)\}/g, (_, t: string) => ({ PERIOD: run.cycleLabel, EMPLOYEE_CODE: r.employeeCode, NAME: r.name, PAYMENT_DATE: formatDate(plan.paymentDate!, layout.dateFormat) })[t] ?? "");
    return { SERIAL: String(r.serial), EMPLOYEE_CODE: r.employeeCode, NAME: r.name, ACCOUNT_NUMBER: number, IFSC: r.ifsc, BANK_NAME: r.bankName, AMOUNT: r.amount, NARRATION: narration, PAYMENT_DATE: plan.paymentDate!, DEBIT_ACCOUNT: debitAccountOf(layout) ?? "" };
  });
  // The demo company's file is named and marked DEMO, and only a layout the directors labelled DEMO (a cell that says so) may produce it: a real-looking layout never makes a demo file.
  // The real company's file is never marked or named DEMO, and it can only come from a final run on confirmed rules (assertRunIsReal, and the approvals above).
  const demo = await isDemoCompany();
  if (demo && !layoutSaysDemo(layout)) throw new HttpError(409, "This is the demo company, and its bank layout does not say DEMO anywhere, so no file is made. Use the demo layout.", "DEMO_LAYOUT_NOT_LABELLED");
  const file = await renderLayout("BANK", layout, rows, { count: rows.length, total: plan.total, paymentDate: plan.paymentDate, period: run.cycleLabel, debitAccount: debitAccountOf(layout), ...(demo ? { watermark: DEMO_WATERMARK } : {}) });
  const hash = sha256(file.bytes);
  const fileName = `${demo ? "DEMO-" : ""}bank-file-${run.cycleLabel.replace(/[^A-Za-z0-9]+/g, "-")}.${file.extension}`;
  const fileKey = `payroll/bank/${runId}/${hash.slice(0, 16)}.${file.extension}`;
  await storageService.putObject(fileKey, file.bytes, file.contentType);

  const batch = await prisma.$transaction(
    async (tx) => {
      await consume("BANK_FILE", runId, actor.userId, actor.ip ?? null, tx);
      const created = await tx.bankTransferBatch.create({
        data: {
          runId,
          runHash: run.runHash ?? "",
          paymentDate: new Date(`${plan.paymentDate}T00:00:00Z`),
          templateVersion: plan.template.version!,
          templateHash: plan.template.valueHash!,
          rowCount: plan.rows.length,
          total: plan.total,
          excluded: plan.excluded as unknown as object,
          fileKey,
          fileName,
          fileSha256: hash,
          generatedByUserId: actor.userId,
          rows: { create: plan.rows.map((r) => ({ employeeId: r.employeeId, bankAccountId: r.bankAccountId, accountHash: r.accountHash, accountLast4: r.accountLast4, ifsc: r.ifsc, amount: r.amount, narration: rows[r.serial - 1]!.NARRATION ?? "", serial: r.serial })) },
        },
      });
      // One audit row for each person whose account number was read, in the same transaction, in one statement.
      await writeAuditLogs(plan.rows.map((r) => ({ actorUserId: actor.userId, action: "payroll.bank.account_read", entityType: "Employee", entityId: r.employeeId, after: { runId, batchId: created.id, last4: r.accountLast4 }, ipAddress: actor.ip ?? null })), tx);
      await tx.payrollRunRelease.create({ data: { runId, kind: "BANK_FILE_GENERATED", reference: created.id, actorUserId: actor.userId } });
      await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: "BANK_FILE_GENERATED", actorUserId: actor.userId, payload: { batchId: created.id, rows: plan.rows.length, total: plan.total, sha256: hash } }, tx);
      return created;
    },
    { timeout: 120000 },
  );
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.file_generated", entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, batchId: batch.id, rows: plan.rows.length, total: plan.total, excluded: plan.excluded.length, sha256: hash }, ipAddress: actor.ip ?? null });
  emit("payroll.bank.generated", { runId, cycle: run.cycleLabel, rows: plan.rows.length });
  return { batchId: batch.id, rows: plan.rows.length, total: plan.total, excluded: plan.excluded.length, fileName, sha256: hash };
}

/**
 * The account numbers of a repayment plan, decrypted for the length of the file's writing and nowhere else (the one other place in payroll that reads an account number besides
 * the bank file above). Each must still be the account that was approved (its blind-index hash) and the one in force on the payment date.
 */
export async function accountNumbersForRepayment(rows: Array<{ employeeId: string; bankAccountId: string; accountHash: string }>, paymentDate: Date): Promise<Map<string, string>> {
  const inForce = await bankAccountsOn(rows.map((r) => r.employeeId), paymentDate);
  const out = new Map<string, string>();
  for (const r of rows) {
    const account = inForce.get(r.employeeId);
    if (!account || account.id !== r.bankAccountId) throw new HttpError(409, "A bank account changed while this was being prepared. Look again.", "PREVIEW_STALE");
    const number = decryptField(account.accountNumberEncrypted);
    if (blindIndex(normalizeAccountNumber(number)) !== r.accountHash) throw new HttpError(409, "A bank account changed while this was being prepared. Look again.", "PREVIEW_STALE");
    out.set(r.employeeId, number);
  }
  return out;
}
