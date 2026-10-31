import { createHash } from "node:crypto";
import { z } from "zod";
import { writeAuditLog, writeAuditLogs } from "../../../lib/audit";
import { authorityFor, requireDirector } from "../../../lib/directorAuthority";
import { bankAccountsOn, namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { storageService } from "../../../integrations/storage";
import { adapterFor, authorise, availabilityFrom, consume, decide, liveApproval, registerSubject, submit, voidApproval } from "../approvals";
import { recordEvent } from "../events";
import { payrollHash } from "../hash";
import { canonicalDecimal, dec, sum, ZERO } from "../money";
import { activeUsersHoldingPermission } from "../../../lib/permissions";
import { namesOfUsers } from "../names";
import { requireHolds } from "./closing";
import { accountNumbersForRepayment } from "./release";
import { formatDate, renderLayout, type LayoutRow } from "./layout";
import { currentLayout, debitAccountOf, layoutReady } from "./layouts";
import type { Layout } from "./layout";

// Rows the bank rejected, and paying them again (docs/plans/STAGE_5B_PLAN.md, B3, changed by decision D-34: bank payments are manual, no file comes back). A director enters by hand which rows of a
// bank batch the bank rejected, one row per payment with a reason. A rejected row stays unpaid. A repayment plan collects rejected rows, takes each person's bank
// account in force on the new payment date, and needs the same approvals as a bank file (the BANK_REPAYMENT subject, the BANK_FILE director step) before a file is written.
// Nothing is paid twice: a rejected row can be in one repayment batch only, which the database holds whatever this code does.

type Actor = { userId: string; ip?: string | null };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const NOTE_MIN = 3;
const MAX_ROWS = 500;
const SIGNED_SECONDS = 200;

async function batchOf(batchId: string) {
  const b = await prisma.bankTransferBatch.findUnique({ where: { id: batchId }, include: { run: { select: { cycleLabel: true, cycleEnd: true } }, rows: { include: { employee: { select: { employeeCode: true } } }, orderBy: { serial: "asc" } } } });
  if (!b) throw new HttpError(404, "There is no such bank batch.", "NOT_FOUND");
  return b;
}

// ── Recording rejections ──

export const rejectionsSchema = z.object({ rows: z.array(z.object({ employeeCode: z.string().trim().min(1).max(64), reason: z.string().trim().min(NOTE_MIN, "Say why the bank rejected it").max(200) }).strict()).min(1).max(MAX_ROWS) }).strict();

export async function recordRejections(batchId: string, raw: unknown, actor: Actor) {
  const parsed = rejectionsSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await requireDirector(actor.userId, "record a bank rejection");
  const batch = await batchOf(batchId);
  const byCode = new Map(batch.rows.map((r) => [r.employee.employeeCode.toLowerCase(), r]));
  const unknown = parsed.data.rows.filter((r) => !byCode.has(r.employeeCode.toLowerCase())).map((r) => r.employeeCode);
  if (unknown.length > 0) throw new HttpError(400, `Nothing was saved: ${unknown.slice(0, 5).join(", ")} ${unknown.length === 1 ? "is" : "are"} not in this bank batch.`, "VALIDATION_ERROR", { unknown });
  const already = new Set((await prisma.bankRowRejection.findMany({ where: { batchId }, select: { rowId: true } })).map((r) => r.rowId));
  const fresh = [...new Map(parsed.data.rows.map((r) => [r.employeeCode.toLowerCase(), r])).values()].filter((r) => !already.has(byCode.get(r.employeeCode.toLowerCase())!.id));
  await prisma.bankRowRejection.createMany({ data: fresh.map((r) => ({ batchId, rowId: byCode.get(r.employeeCode.toLowerCase())!.id, reason: r.reason, recordedByUserId: actor.userId })) });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.rejections_recorded", entityType: "BankTransferBatch", entityId: batchId, after: { rows: fresh.length, alreadyRecorded: parsed.data.rows.length - fresh.length }, ipAddress: actor.ip ?? null });
  return { recorded: fresh.length, alreadyRecorded: parsed.data.rows.length - fresh.length };
}

export async function listRejections(batchId: string, actor: Actor) {
  await requireDirector(actor.userId, "see bank rejections");
  const batch = await batchOf(batchId);
  const rejections = await prisma.bankRowRejection.findMany({ where: { batchId }, include: { row: { include: { employee: { select: { employeeCode: true } }, repayment: { select: { batchId: true } } } } }, orderBy: { createdAt: "asc" } });
  const names = await namesOn(rejections.map((r) => r.row.employeeId), batch.run.cycleEnd);
  return {
    batchId,
    cycle: batch.run.cycleLabel,
    rows: rejections.map((r) => ({ rowId: r.rowId, serial: r.row.serial, employeeCode: r.row.employee.employeeCode, name: names.get(r.row.employeeId) ?? r.row.employee.employeeCode, accountLast4: r.row.accountLast4, amount: canonicalDecimal(dec(r.row.amount.toString())), reason: r.reason, at: r.createdAt.toISOString(), repaidInBatch: r.row.repayment?.batchId ?? null })),
  };
}

// ── The repayment plan ──

export const planSchema = z.object({ paymentDate: z.iso.date(), rowIds: z.array(z.string().min(1).max(64)).min(1).max(MAX_ROWS).optional() }).strict();

interface PlanRow { sourceRowId: string; employeeId: string; employeeCode: string; name: string; bankAccountId: string; accountHash: string; accountLast4: string; ifsc: string; bankName: string; amount: string; serial: number }
interface PlanExcluded { sourceRowId: string; employeeCode: string; reason: string }

async function planOf(planId: string) {
  const plan = await prisma.bankRepaymentPlan.findUnique({ where: { id: planId }, include: { originalBatch: { include: { run: { select: { cycleLabel: true, cycleEnd: true } } } }, batch: { select: { id: true } } } });
  if (!plan) throw new HttpError(404, "There is no such repayment plan.", "NOT_FOUND");
  const rowIds = plan.rowIds as string[];
  const rows = await prisma.bankTransferRow.findMany({ where: { id: { in: rowIds }, batchId: plan.originalBatchId }, include: { employee: { select: { employeeCode: true } }, rejection: { select: { id: true } }, repayment: { select: { id: true } } }, orderBy: { serial: "asc" } });
  const accounts = await bankAccountsOn(rows.map((r) => r.employeeId), plan.paymentDate);
  const names = await namesOn(rows.map((r) => r.employeeId), plan.originalBatch.run.cycleEnd);
  const out: PlanRow[] = [];
  const excluded: PlanExcluded[] = [];
  for (const r of rows) {
    if (!r.rejection) {
      excluded.push({ sourceRowId: r.id, employeeCode: r.employee.employeeCode, reason: "The bank did not reject this row" });
      continue;
    }
    if (r.repayment) {
      excluded.push({ sourceRowId: r.id, employeeCode: r.employee.employeeCode, reason: "Already paid again in a repayment batch" });
      continue;
    }
    const account = accounts.get(r.employeeId);
    if (!account) {
      excluded.push({ sourceRowId: r.id, employeeCode: r.employee.employeeCode, reason: `No bank account in force on ${iso(plan.paymentDate)}` });
      continue;
    }
    out.push({ sourceRowId: r.id, employeeId: r.employeeId, employeeCode: r.employee.employeeCode, name: names.get(r.employeeId) ?? r.employee.employeeCode, bankAccountId: account.id, accountHash: account.accountNumberHash, accountLast4: account.accountNumberLast4, ifsc: account.ifsc, bankName: account.bankName, amount: canonicalDecimal(dec(r.amount.toString())), serial: out.length + 1 });
  }
  return { plan, rows: out, excluded, total: canonicalDecimal(sum(out.map((r) => dec(r.amount))).plus(ZERO)), template: await layoutReady("BANK_TEMPLATE") };
}

const hashOfPlan = async (planId: string): Promise<string> => {
  const p = await planOf(planId);
  return payrollHash({ plan: planId, date: iso(p.plan.paymentDate), template: [p.template.version, p.template.valueHash], rows: p.rows.map((r) => [r.sourceRowId, r.accountHash, r.ifsc, r.amount]), excluded: p.excluded.map((e) => [e.sourceRowId, e.reason]) });
};

registerSubject({
  subject: "BANK_REPAYMENT",
  makerPermission: "payroll.run",
  checkerPermission: "payroll.approve",
  async describe(subjectId) {
    return `the repayment plan ${subjectId}`;
  },
  hash: hashOfPlan,
});

export async function createPlan(batchId: string, raw: unknown, actor: Actor) {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await requireDirector(actor.userId, "plan a repayment");
  await requireHolds(actor.userId, "payroll.run");
  await batchOf(batchId);
  const rejected = await prisma.bankRowRejection.findMany({ where: { batchId, row: { repayment: null } }, select: { rowId: true } });
  const wanted = parsed.data.rowIds ?? rejected.map((r) => r.rowId);
  if (wanted.length === 0) throw new HttpError(409, "No rejected row is waiting to be paid again in this batch.", "NOTHING_TO_REPAY");
  const plan = await prisma.bankRepaymentPlan.create({ data: { originalBatchId: batchId, paymentDate: new Date(`${parsed.data.paymentDate}T00:00:00Z`), rowIds: wanted, createdByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.repayment_planned", entityType: "BankRepaymentPlan", entityId: plan.id, after: { batchId, rows: wanted.length, paymentDate: parsed.data.paymentDate }, ipAddress: actor.ip ?? null });
  return getPlan(plan.id, actor);
}

export async function getPlan(planId: string, actor: Actor) {
  await requireDirector(actor.userId, "see a repayment plan");
  const p = await planOf(planId);
  const approval = await liveApproval("BANK_REPAYMENT", planId);
  const holders = await activeUsersHoldingPermission(adapterFor("BANK_REPAYMENT").checkerPermission);
  const nm = await namesOfUsers(holders.map((h) => h.userId));
  return {
    id: planId,
    batchId: p.plan.originalBatchId,
    cycle: p.plan.originalBatch.run.cycleLabel,
    paymentDate: iso(p.plan.paymentDate),
    rows: p.rows.map((r) => ({ serial: r.serial, employeeCode: r.employeeCode, name: r.name, accountLast4: r.accountLast4, ifsc: r.ifsc, amount: r.amount })),
    excluded: p.excluded,
    total: p.total,
    layoutReady: p.template.ready,
    hash: await hashOfPlan(planId),
    generated: p.plan.batch?.id ?? null,
    approval: approval ? { status: approval.status, authority: approval.authority } : null,
    checkers: availabilityFrom(holders.map((h) => ({ userId: h.userId, name: nm.get(h.userId) ?? "Someone" })), { makerUserId: approval?.makerUserId ?? actor.userId }),
  };
}

export const requestSchema = z.object({ hash: z.string().min(10).max(200), note: z.string().trim().max(200).optional() }).strict();
export const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), hash: z.string().min(10).max(200), note: z.string().trim().max(200).optional() }).strict();

export async function requestRepayment(planId: string, raw: unknown, actor: Actor) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await requireDirector(actor.userId, "request a repayment file");
  const p = await planOf(planId);
  if (p.plan.batch) throw new HttpError(409, "A file has already been written for this plan.", "ALREADY_GENERATED");
  if (!p.template.ready) throw new HttpError(409, "The bank file layout is not confirmed by a second person, so no file can be made.", "BANK_TEMPLATE_PLACEHOLDER");
  if (p.rows.length === 0) throw new HttpError(409, "Nothing in this plan can be paid (see what was left out).", "NOTHING_TO_REPAY");
  const hash = await hashOfPlan(planId);
  if (hash !== parsed.data.hash) throw new HttpError(409, "The plan changed since you looked at it. Look again.", "PREVIEW_STALE");
  const label = `a repayment of ${p.rows.length} rejected bank ${p.rows.length === 1 ? "row" : "rows"}`;
  if ((await authorityFor("BANK_FILE")) === "DIRECTOR_AUTHORITY") return authorise({ subject: "BANK_REPAYMENT", subjectId: planId, actorUserId: actor.userId, previewFingerprint: hash, step: "BANK_FILE", subjectLabel: label, itemCount: p.rows.length, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null });
  return submit({ subject: "BANK_REPAYMENT", subjectId: planId, makerUserId: actor.userId, previewFingerprint: hash, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null, notify: { step: "BANK_FILE", subjectLabel: label, itemCount: p.rows.length } });
}

export async function decideRepayment(planId: string, raw: unknown, actor: Actor) {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const approval = await liveApproval("BANK_REPAYMENT", planId);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision for this plan.", "NOT_PENDING");
  return decide({ approvalId: approval.id, checkerUserId: actor.userId, decision: parsed.data.decision, ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}), expectedHash: parsed.data.hash, ip: actor.ip ?? null });
}

// ── Writing the repayment file ──

export async function generateRepayment(planId: string, actor: Actor) {
  await requireDirector(actor.userId, "write a repayment file");
  await requireHolds(actor.userId, "payroll.run");
  const approval = await prisma.payrollApproval.findFirst({ where: { subject: "BANK_REPAYMENT", subjectId: planId, status: "APPROVED" } });
  if (!approval) throw new HttpError(409, "This repayment has not been approved yet.", "APPROVAL_REQUIRED");
  if (approval.authority !== "DIRECTOR_AUTHORITY" && approval.checkerUserId === actor.userId) throw new HttpError(403, "You approved this, so somebody else carries it out.", "CHECKER_IS_EXECUTOR");
  if ((await hashOfPlan(planId)) !== approval.hashAtDecision) {
    await voidApproval(approval, "What was approved no longer matches what would be written (a bank account or the layout changed).", actor.userId);
    throw new HttpError(409, "Something changed after this was approved (a bank account or the layout), so the approval is void. It needs to be requested and approved again.", "APPROVAL_VOIDED");
  }
  const p = await planOf(planId);
  if (p.plan.batch) throw new HttpError(409, "A file has already been written for this plan.", "ALREADY_GENERATED");
  if (!p.template.ready || p.rows.length === 0) throw new HttpError(409, "The layout is not confirmed, or nothing can be paid.", "NOT_READY");
  const stored = await currentLayout("BANK_TEMPLATE");
  const layout = stored!.value as Layout;
  const numbers = await accountNumbersForRepayment(p.rows, p.plan.paymentDate);
  const rows: LayoutRow[] = p.rows.map((r) => {
    const number = numbers.get(r.employeeId)!;
    const narration = (layout.narrationPattern ?? "").replace(/\{([A-Z_]+)\}/g, (_, t: string) => ({ PERIOD: `${p.plan.originalBatch.run.cycleLabel} (repayment)`, EMPLOYEE_CODE: r.employeeCode, NAME: r.name, PAYMENT_DATE: formatDate(iso(p.plan.paymentDate), layout.dateFormat) })[t] ?? "");
    return { SERIAL: String(r.serial), EMPLOYEE_CODE: r.employeeCode, NAME: r.name, ACCOUNT_NUMBER: number, IFSC: r.ifsc, BANK_NAME: r.bankName, AMOUNT: r.amount, NARRATION: narration, PAYMENT_DATE: iso(p.plan.paymentDate), DEBIT_ACCOUNT: debitAccountOf(layout) ?? "" };
  });
  const file = await renderLayout("BANK", layout, rows, { count: rows.length, total: p.total, paymentDate: iso(p.plan.paymentDate), period: `${p.plan.originalBatch.run.cycleLabel} (repayment)`, debitAccount: debitAccountOf(layout) });
  const hash = createHash("sha256").update(file.bytes).digest("hex");
  const fileName = `bank-repayment-${p.plan.originalBatch.run.cycleLabel.replace(/[^A-Za-z0-9]+/g, "-")}.${file.extension}`;
  const fileKey = `payroll/bank/repayment/${planId}/${hash.slice(0, 16)}.${file.extension}`;
  await storageService.putObject(fileKey, file.bytes, file.contentType);
  try {
    const batch = await prisma.$transaction(
      async (tx) => {
        await consume("BANK_REPAYMENT", planId, actor.userId, actor.ip ?? null, tx);
        const created = await tx.bankRepaymentBatch.create({
          data: {
            planId,
            originalBatchId: p.plan.originalBatchId,
            paymentDate: p.plan.paymentDate,
            templateVersion: p.template.version!,
            templateHash: p.template.valueHash!,
            rowCount: p.rows.length,
            total: p.total,
            fileKey,
            fileName,
            fileSha256: hash,
            generatedByUserId: actor.userId,
            rows: { create: p.rows.map((r) => ({ sourceRowId: r.sourceRowId, employeeId: r.employeeId, bankAccountId: r.bankAccountId, accountHash: r.accountHash, accountLast4: r.accountLast4, ifsc: r.ifsc, amount: r.amount, narration: "Repayment", serial: r.serial })) },
          },
        });
        await writeAuditLogs(p.rows.map((r) => ({ actorUserId: actor.userId, action: "payroll.bank.account_read", entityType: "Employee", entityId: r.employeeId, after: { repaymentBatchId: created.id, last4: r.accountLast4 }, ipAddress: actor.ip ?? null })), tx);
        await recordEvent({ subjectType: "BANK_REPAYMENT", subjectId: planId, type: "GENERATED", actorUserId: actor.userId, payload: { batchId: created.id, rows: p.rows.length, total: p.total, sha256: hash } }, tx);
        return created;
      },
      { timeout: 100 * 1000 },
    );
    await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.repayment_generated", entityType: "BankRepaymentBatch", entityId: batch.id, after: { rows: p.rows.length, total: p.total, sha256: hash }, ipAddress: actor.ip ?? null });
    return { batchId: batch.id, rows: p.rows.length, total: p.total, fileName, sha256: hash };
  } catch (err) {
    if (err instanceof Error && /Unique constraint|source_row_id|plan_id|REPAYMENT_NOT_REJECTED/.test(err.message)) throw new HttpError(409, "A row in this plan has already been paid again, or a file was already written for it. Nothing was written.", "ALREADY_REPAID");
    throw err;
  }
}

export async function downloadRepayment(batchId: string, actor: Actor) {
  await requireDirector(actor.userId, "download a repayment file");
  const b = await prisma.bankRepaymentBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new HttpError(404, "There is no such repayment batch.", "NOT_FOUND");
  const url = await storageService.getObjectSignedUrl(b.fileKey, SIGNED_SECONDS, { downloadFileName: b.fileName });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.repayment_downloaded", entityType: "BankRepaymentBatch", entityId: batchId, after: { sha256: b.fileSha256 }, ipAddress: actor.ip ?? null });
  return { url, expiresInSeconds: SIGNED_SECONDS, fileName: b.fileName, sha256: b.fileSha256 };
}
