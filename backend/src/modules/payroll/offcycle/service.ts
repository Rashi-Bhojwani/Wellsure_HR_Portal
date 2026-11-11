import { createHash } from "node:crypto";
import { z } from "zod";
import { storageService } from "../../../integrations/storage";
import { writeAuditLog, writeAuditLogs } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { authorityFor } from "../../../lib/directorAuthority";
import { bankAccountsOn, namesOn } from "../../../lib/effectiveDating";
import { decryptField } from "../../../lib/encryption";
import { blindIndex, normalizeAccountNumber } from "../../../lib/fieldHash";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { authorise, consume, decide, liveApproval, registerSubject, submit, voidApproval } from "../approvals";
import { payrollHash } from "../hash";
import { canonicalDecimal, dec, fixed, sum, ZERO, type Money } from "../money";
import { formatDate, renderLayout, type Layout, type LayoutRow } from "../run/layout";
import { currentLayout, debitAccountOf, layoutReady } from "../run/layouts";
import { DEMO_WATERMARK, layoutSaysDemo } from "../run/release";
import { buildSetupReport, isDemoCompany, readinessOf } from "../setup/status";
import type { SettlementLine } from "../settlements/service";
import { unpaidHeldItems } from "./held";

// P7-6b (docs/plans/P7_6_SETTLEMENTS.md): off-cycle runs. Their own pipeline over figures that are already exact and confirmed; the regular run engine is untouched.
// Same rules as a regular run: two directors (or the owners' run-approval choice), the executor is not the approver, the real company only when ready, the same
// bank layout and DEMO rules, nothing paid twice (unique keys in the database), never for one's own pay.

export interface Actor {
  userId: string;
  ip?: string | null;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export interface OffCycleLine {
  label: string;
  /** Signed: positive paid, negative recovered. */
  amount: string;
  source: string;
  ref?: { type: "ADJUSTMENT" | "HELD_ITEM" | "LOAN"; id: string };
}

/** Pure: the net of the lines, exact. Exported for the independent-model test. */
export function netOf(lines: readonly Pick<OffCycleLine, "amount">[]): Money {
  return sum(lines.map((l) => dec(l.amount)));
}

async function refuseOwn(employeeId: string, userId: string) {
  const u = await prisma.user.findUnique({ where: { employeeId }, select: { id: true } });
  if (u?.id === userId) throw new HttpError(403, "This is your own pay: another director prepares and decides it.", "OWN_PAY");
}

/** The real company pays off-cycle only when the Ready-for-first-run list is green; the demo company may rehearse. */
async function assertMayPay(): Promise<{ demo: boolean }> {
  const demo = await isDemoCompany();
  if (demo) return { demo };
  const readiness = readinessOf(await buildSetupReport());
  if (!readiness.ready) throw new HttpError(409, `Off-cycle runs are refused until every required setting is confirmed: ${readiness.blockers.slice(0, 5).map((b) => b.title).join("; ")}${readiness.blockers.length > 5 ? "…" : ""}.`, "NOT_READY");
  return { demo };
}

async function heldItemUnpaid(itemId: string) {
  return (await unpaidHeldItems({ itemId }))[0] ?? null;
}

/** The lines a source pays now, checked against its source: every referenced adjustment still pending, every held item still unpaid. */
async function linesOf(kind: "SETTLEMENT" | "HELD_PAY", sourceRef: string): Promise<{ employeeId: string; lines: OffCycleLine[] }> {
  if (kind === "HELD_PAY") {
    const item = await heldItemUnpaid(sourceRef);
    if (!item) throw new HttpError(409, "That held pay is not a held item of a final run, or it has already been paid.", "NOT_PAYABLE");
    return { employeeId: item.employeeId, lines: [{ label: `Pay held in ${item.run.cycleLabel}`, amount: fixed(dec(item.netPay.toString()), 2), source: `run item ${item.id}`, ref: { type: "HELD_ITEM", id: item.id } }] };
  }
  const s = await prisma.fnfSettlement.findUnique({ where: { id: sourceRef } });
  if (!s) throw new HttpError(404, "Settlement not found.", "NOT_FOUND");
  const latest = await prisma.fnfSettlement.findFirst({ where: { separationId: s.separationId }, orderBy: { createdAt: "desc" } });
  const approval = await liveApproval("FNF_SETTLEMENT", s.id);
  if (latest?.id !== s.id || approval?.status !== "APPROVED") throw new HttpError(409, "Only the latest settlement, confirmed by a different director, can be paid.", "SETTLEMENT_NOT_CONFIRMED");
  const out: OffCycleLine[] = [];
  for (const l of s.lines as unknown as SettlementLine[]) {
    if (l.amount === null) continue; // the leave balance in days carries no amount
    const ref = l.source.match(/^(adjustment|run item|loan) (\S+)/);
    const line: OffCycleLine = { label: l.label, amount: l.amount, source: l.source };
    if (ref?.[1] === "adjustment") {
      const a = await prisma.payrollAdjustment.findUnique({ where: { id: ref[2]! } });
      if (!a || a.status !== "PENDING") throw new HttpError(409, "Something in the settlement has been paid or cancelled since it was confirmed. Prepare it again.", "SETTLEMENT_STALE");
      line.ref = { type: "ADJUSTMENT", id: a.id };
    } else if (ref?.[1] === "run item") {
      if (!(await heldItemUnpaid(ref[2]!))) throw new HttpError(409, "Held pay in the settlement has been paid since it was confirmed. Prepare it again.", "SETTLEMENT_STALE");
      line.ref = { type: "HELD_ITEM", id: ref[2]! };
    } else if (ref?.[1] === "loan") line.ref = { type: "LOAN", id: ref[2]! };
    out.push(line);
  }
  return { employeeId: s.employeeId, lines: out };
}

export const prepareSchema = z.object({ kind: z.enum(["SETTLEMENT", "HELD_PAY"]), sourceRef: z.string().min(1).max(64), paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export async function prepare(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "prepare an off-cycle run");
  const parsed = prepareSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const v = parsed.data;
  if (v.paymentDate < iso(businessToday())) throw new HttpError(400, "The payment date cannot be in the past.", "VALIDATION_ERROR");
  await assertMayPay();
  const { employeeId, lines } = await linesOf(v.kind, v.sourceRef);
  await refuseOwn(employeeId, actor.userId);
  if (await prisma.offCycleFinalisation.findUnique({ where: { kind_sourceRef: { kind: v.kind, sourceRef: v.sourceRef } } })) throw new HttpError(409, "This has already been paid by an off-cycle run.", "ALREADY_PAID");
  const net = netOf(lines);
  if (net.lte(ZERO)) throw new HttpError(409, "Nothing is payable: the total is zero or less (a negative total is recovered outside payroll).", "NOTHING_PAYABLE");
  const run = await prisma.offCycleRun.create({ data: { kind: v.kind, sourceRef: v.sourceRef, employeeId, paymentDate: day(v.paymentDate), lines: lines as unknown as object, net: net.toFixed(2), createdByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.off_cycle.prepared", entityType: "OffCycleRun", entityId: run.id, after: { kind: v.kind, lines: lines.length } }); // no figure in the audit row
  return view(run.id, actor.userId);
}

export async function hashOfRun(id: string) {
  const r = await prisma.offCycleRun.findUniqueOrThrow({ where: { id } });
  return payrollHash({ id, kind: r.kind, sourceRef: r.sourceRef, employeeId: r.employeeId, paymentDate: iso(r.paymentDate), lines: r.lines, net: canonicalDecimal(dec(r.net.toString())) });
}
const fingerprintOf = (id: string, hash: string) => createHash("sha256").update(`${id}|${hash}`).digest("hex");

async function bankPlan(runId: string) {
  const r = await prisma.offCycleRun.findUniqueOrThrow({ where: { id: runId } });
  const account = (await bankAccountsOn([r.employeeId], r.paymentDate)).get(r.employeeId) ?? null;
  return { run: r, account, template: await layoutReady("BANK_TEMPLATE") };
}
export async function hashOfBank(runId: string) {
  const p = await bankPlan(runId);
  return payrollHash({ runId, net: canonicalDecimal(dec(p.run.net.toString())), account: p.account ? [p.account.id, p.account.accountNumberHash, p.account.ifsc] : null, template: [p.template.version, p.template.valueHash] });
}

export async function view(id: string, viewerUserId: string) {
  const r = await prisma.offCycleRun.findUnique({ where: { id }, include: { finalisation: true, bankBatch: { include: { sentMark: true } } } });
  if (!r) throw new HttpError(404, "Off-cycle run not found.", "NOT_FOUND");
  const [approval, bankApproval, names] = await Promise.all([liveApproval("OFF_CYCLE_RUN", id), liveApproval("OFF_CYCLE_BANK", id), namesOn([r.employeeId], businessToday())]);
  const state = r.bankBatch ? "FILE_WRITTEN" : r.finalisation ? "FINALISED" : approval?.status === "APPROVED" ? "APPROVED" : approval?.status === "PENDING" ? "WAITING" : approval?.status === "REJECTED" ? "REJECTED" : "PREPARED";
  return {
    id,
    kind: r.kind,
    sourceRef: r.sourceRef,
    employeeId: r.employeeId,
    name: names.get(r.employeeId) ?? "",
    paymentDate: iso(r.paymentDate),
    lines: r.lines as unknown as OffCycleLine[],
    net: fixed(dec(r.net.toString()), 2),
    state,
    approval: approval ? { status: approval.status, mine: approval.makerUserId === viewerUserId, checkerIsMe: approval.checkerUserId === viewerUserId, authority: approval.authority } : null,
    bankApproval: bankApproval ? { status: bankApproval.status, mine: bankApproval.makerUserId === viewerUserId, checkerIsMe: bankApproval.checkerUserId === viewerUserId } : null,
    file: r.bankBatch ? { id: r.bankBatch.id, fileName: r.bankBatch.fileName, sentToBank: !!r.bankBatch.sentMark } : null,
    fingerprint: fingerprintOf(id, await hashOfRun(id)),
    bankFingerprint: fingerprintOf(`${id}:bank`, await hashOfBank(id)),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function list(actor: Actor) {
  await requireDirector(actor.userId, "see off-cycle runs");
  const rows = await prisma.offCycleRun.findMany({ orderBy: { createdAt: "desc" }, take: 300, select: { id: true } });
  return { runs: await Promise.all(rows.map((r) => view(r.id, actor.userId))) };
}

/** What can be paid off-cycle now: confirmed settlements with a positive total, and held items of final runs not yet released. */
export async function candidates(actor: Actor) {
  await requireDirector(actor.userId, "see what can be paid off-cycle");
  const held = await unpaidHeldItems();
  const settlements = await prisma.fnfSettlement.findMany({ orderBy: { createdAt: "desc" }, include: { employee: { select: { employeeCode: true } } } });
  const latestBySep = new Map<string, (typeof settlements)[number]>();
  for (const s of settlements) if (!latestBySep.has(s.separationId)) latestBySep.set(s.separationId, s);
  const paid = new Set((await prisma.offCycleFinalisation.findMany({ select: { kind: true, sourceRef: true } })).map((f) => `${f.kind}|${f.sourceRef}`));
  const confirmedSettlements = [];
  for (const s of latestBySep.values()) {
    if (paid.has(`SETTLEMENT|${s.id}`) || dec(s.total.toString()).lte(ZERO)) continue;
    if ((await liveApproval("FNF_SETTLEMENT", s.id))?.status === "APPROVED") confirmedSettlements.push({ kind: "SETTLEMENT" as const, sourceRef: s.id, employeeCode: s.employee.employeeCode, label: "Full and final settlement", amount: fixed(dec(s.total.toString()), 2) });
  }
  return {
    candidates: [
      ...confirmedSettlements,
      ...held.map((h) => ({ kind: "HELD_PAY" as const, sourceRef: h.id, employeeCode: h.employee.employeeCode, label: `Pay held in ${h.run.cycleLabel}`, amount: fixed(dec(h.netPay.toString()), 2) })),
    ],
  };
}

// ── Approval (the same choice as a regular run) ───────────────────────────────────────────────────────────────────────────

export const requestSchema = z.object({ fingerprint: z.string().length(64), note: z.string().trim().max(300).optional() }).strict();
export const decisionSchema = z.object({ fingerprint: z.string().length(64), decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(300).optional() }).strict();

export async function requestApproval(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "ask for an off-cycle run to be approved");
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Look at the run first.", "VALIDATION_ERROR");
  const r = await prisma.offCycleRun.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, "Off-cycle run not found.", "NOT_FOUND");
  await refuseOwn(r.employeeId, actor.userId);
  const hash = await hashOfRun(id);
  if (fingerprintOf(id, hash) !== parsed.data.fingerprint) throw new HttpError(409, "The run changed since you looked at it.", "PREVIEW_STALE");
  const label = "an off-cycle payroll run";
  if ((await authorityFor("RUN_APPROVAL")) === "DIRECTOR_AUTHORITY") return authorise({ subject: "OFF_CYCLE_RUN", subjectId: id, actorUserId: actor.userId, previewFingerprint: parsed.data.fingerprint, step: "RUN_APPROVAL", subjectLabel: label, itemCount: 1, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null });
  return submit({ subject: "OFF_CYCLE_RUN", subjectId: id, makerUserId: actor.userId, previewFingerprint: parsed.data.fingerprint, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null, notify: { step: "RUN_APPROVAL", subjectLabel: label, itemCount: 1 } });
}

export async function decideApproval(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "decide an off-cycle run");
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const r = await prisma.offCycleRun.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, "Off-cycle run not found.", "NOT_FOUND");
  await refuseOwn(r.employeeId, actor.userId);
  const approval = await liveApproval("OFF_CYCLE_RUN", id);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision on this run.", "NOT_PENDING");
  const hash = await hashOfRun(id);
  if (fingerprintOf(id, hash) !== parsed.data.fingerprint) throw new HttpError(409, "What you were looking at is not what is there now.", "PREVIEW_STALE");
  return decide({ approvalId: approval.id, checkerUserId: actor.userId, decision: parsed.data.decision, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null, expectedHash: hash });
}

// ── Finalise: exactly once per source ──────────────────────────────────────────────────────────────────────────────────

export async function finalise(id: string, actor: Actor) {
  await requireDirector(actor.userId, "finalise an off-cycle run");
  const r = await prisma.offCycleRun.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, "Off-cycle run not found.", "NOT_FOUND");
  await refuseOwn(r.employeeId, actor.userId);
  const approval = await liveApproval("OFF_CYCLE_RUN", id);
  if (!approval || approval.status !== "APPROVED") throw new HttpError(409, "This run has not been approved.", "APPROVAL_REQUIRED");
  if (approval.authority !== "DIRECTOR_AUTHORITY" && approval.checkerUserId === actor.userId) throw new HttpError(403, "You approved this, so somebody else carries it out.", "CHECKER_IS_EXECUTOR");
  if (approval.contentHash !== (await hashOfRun(id))) {
    await voidApproval(approval, "The run changed after the approval.", actor.userId);
    throw new HttpError(409, "The run no longer matches what was approved. Ask for it again.", "APPROVAL_VOIDED");
  }
  await assertMayPay();
  // Every source is checked again now: something paid by a regular run or another off-cycle run since makes this stale.
  const fresh = await linesOf(r.kind, r.sourceRef);
  if (payrollHash(fresh.lines) !== payrollHash(r.lines)) throw new HttpError(409, "Something this run pays has changed or been paid since it was prepared. Prepare it again.", "SOURCE_CHANGED");
  const lines = r.lines as unknown as OffCycleLine[];
  const statement = { kind: r.kind, paymentDate: iso(r.paymentDate), lines: lines.map((l) => ({ label: l.label, amount: l.amount })), net: fixed(dec(r.net.toString()), 2) };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('payroll.finalising', 'yes', true)`;
      await consume("OFF_CYCLE_RUN", id, actor.userId, actor.ip ?? null, tx);
      await tx.offCycleFinalisation.create({ data: { runId: id, kind: r.kind, sourceRef: r.sourceRef, statement, finalisedByUserId: actor.userId } });
      for (const l of lines) {
        if (l.ref?.type === "HELD_ITEM") await tx.offCycleHeldRelease.create({ data: { itemId: l.ref.id, runId: id } });
        if (l.ref?.type === "ADJUSTMENT") {
          const { count } = await tx.payrollAdjustment.updateMany({ where: { id: l.ref.id, status: "PENDING" }, data: { status: "CONSUMED", consumedByOffCycleRunId: id } });
          if (count !== 1) throw new HttpError(409, "An adjustment in this run was paid by something else. Nothing was finalised.", "SOURCE_CHANGED");
        }
        if (l.ref?.type === "LOAN" && dec(l.amount).lt(ZERO)) await tx.offCycleLoanRecovery.create({ data: { loanId: l.ref.id, runId: id, amount: dec(l.amount).negated().toFixed(2) } });
      }
    });
  } catch (err) {
    if (err instanceof Error && /Unique constraint/.test(err.message)) throw new HttpError(409, "This has already been paid. Nothing was finalised again.", "ALREADY_PAID");
    throw err;
  }
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.off_cycle.finalised", entityType: "OffCycleRun", entityId: id, after: { kind: r.kind } });
  return view(id, actor.userId);
}

// ── The bank file (the same choice and rules as a regular bank file) ───────────────────────────────────────────────────────

export async function requestBank(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "ask for an off-cycle bank file");
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Look at it first.", "VALIDATION_ERROR");
  const r = await prisma.offCycleRun.findUnique({ where: { id }, include: { finalisation: true } });
  if (!r) throw new HttpError(404, "Off-cycle run not found.", "NOT_FOUND");
  if (!r.finalisation) throw new HttpError(409, "Finalise the run first.", "NOT_FINAL");
  await refuseOwn(r.employeeId, actor.userId);
  const hash = await hashOfBank(id);
  if (fingerprintOf(`${id}:bank`, hash) !== parsed.data.fingerprint) throw new HttpError(409, "Something changed since you looked (the bank account or the layout).", "PREVIEW_STALE");
  const label = "an off-cycle bank file";
  if ((await authorityFor("BANK_FILE")) === "DIRECTOR_AUTHORITY") return authorise({ subject: "OFF_CYCLE_BANK", subjectId: id, actorUserId: actor.userId, previewFingerprint: parsed.data.fingerprint, step: "BANK_FILE", subjectLabel: label, itemCount: 1, ip: actor.ip ?? null });
  return submit({ subject: "OFF_CYCLE_BANK", subjectId: id, makerUserId: actor.userId, previewFingerprint: parsed.data.fingerprint, ip: actor.ip ?? null, notify: { step: "BANK_FILE", subjectLabel: label, itemCount: 1 } });
}

export async function decideBank(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "decide an off-cycle bank file");
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const r = await prisma.offCycleRun.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, "Off-cycle run not found.", "NOT_FOUND");
  await refuseOwn(r.employeeId, actor.userId);
  const approval = await liveApproval("OFF_CYCLE_BANK", id);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision.", "NOT_PENDING");
  const hash = await hashOfBank(id);
  if (fingerprintOf(`${id}:bank`, hash) !== parsed.data.fingerprint) throw new HttpError(409, "What you were looking at is not what is there now.", "PREVIEW_STALE");
  return decide({ approvalId: approval.id, checkerUserId: actor.userId, decision: parsed.data.decision, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null, expectedHash: hash });
}

export async function generateBank(id: string, actor: Actor) {
  await requireDirector(actor.userId, "write an off-cycle bank file");
  const approval = await liveApproval("OFF_CYCLE_BANK", id);
  if (!approval || approval.status !== "APPROVED") throw new HttpError(409, "This bank file has not been approved.", "APPROVAL_REQUIRED");
  if (approval.authority !== "DIRECTOR_AUTHORITY" && approval.checkerUserId === actor.userId) throw new HttpError(403, "You approved this, so somebody else carries it out.", "CHECKER_IS_EXECUTOR");
  if (approval.contentHash !== (await hashOfBank(id))) {
    await voidApproval(approval, "The bank account or the layout changed after the approval.", actor.userId);
    throw new HttpError(409, "Something changed after this was approved (the bank account or the layout). Ask for it again.", "APPROVAL_VOIDED");
  }
  const { demo } = await assertMayPay();
  const p = await bankPlan(id);
  if (!p.template.ready) throw new HttpError(409, "The bank file layout is not confirmed by a second person, so no file can be made.", "BANK_TEMPLATE_PLACEHOLDER");
  if (!p.account) throw new HttpError(409, "This person has no bank account in force on the payment date.", "NO_BANK_ACCOUNT");
  const stored = await currentLayout("BANK_TEMPLATE");
  if (!stored || stored.version !== p.template.version || stored.valueHash !== p.template.valueHash) throw new HttpError(409, "The layout changed. Look at it again.", "PREVIEW_STALE");
  const layout = stored.value as Layout;
  if (demo && !layoutSaysDemo(layout)) throw new HttpError(409, "This is the demo company, and its bank layout does not say DEMO anywhere, so no file is made. Use the demo layout.", "DEMO_LAYOUT_NOT_LABELLED");
  const number = decryptField(p.account.accountNumberEncrypted);
  if (blindIndex(normalizeAccountNumber(number)) !== p.account.accountNumberHash) throw new HttpError(409, "The bank account changed. Look at it again.", "PREVIEW_STALE");
  const [names, emp] = await Promise.all([namesOn([p.run.employeeId], businessToday()), prisma.employee.findUniqueOrThrow({ where: { id: p.run.employeeId }, select: { employeeCode: true } })]);
  const amount = fixed(dec(p.run.net.toString()), 2);
  const paymentDate = iso(p.run.paymentDate);
  const period = p.run.kind === "SETTLEMENT" ? "Full and final settlement" : "Held pay";
  const narration = (layout.narrationPattern ?? "").replace(/\{([A-Z_]+)\}/g, (_, t: string) => ({ PERIOD: period, EMPLOYEE_CODE: emp.employeeCode, NAME: names.get(p.run.employeeId) ?? "", PAYMENT_DATE: formatDate(paymentDate, layout.dateFormat) })[t] ?? "");
  const row: LayoutRow = { SERIAL: "1", EMPLOYEE_CODE: emp.employeeCode, NAME: names.get(p.run.employeeId) ?? "", ACCOUNT_NUMBER: number, IFSC: p.account.ifsc, BANK_NAME: p.account.bankName, AMOUNT: amount, NARRATION: narration, PAYMENT_DATE: paymentDate, DEBIT_ACCOUNT: debitAccountOf(layout) ?? "" };
  const file = await renderLayout("BANK", layout, [row], { count: 1, total: amount, paymentDate, period, debitAccount: debitAccountOf(layout), ...(demo ? { watermark: DEMO_WATERMARK } : {}) });
  const sha = createHash("sha256").update(file.bytes).digest("hex");
  const fileName = `${demo ? "DEMO-" : ""}bank-file-off-cycle-${emp.employeeCode.replace(/[^A-Za-z0-9]+/g, "-")}-${paymentDate}.${file.extension}`;
  const fileKey = `payroll/bank/off-cycle/${id}/${sha.slice(0, 16)}.${file.extension}`;
  await storageService.putObject(fileKey, file.bytes, file.contentType);
  try {
    const batch = await prisma.$transaction(async (tx) => {
      await consume("OFF_CYCLE_BANK", id, actor.userId, actor.ip ?? null, tx);
      const created = await tx.offCycleBankBatch.create({ data: { runId: id, paymentDate: p.run.paymentDate, templateVersion: p.template.version!, templateHash: p.template.valueHash!, amount, bankAccountId: p.account!.id, accountHash: p.account!.accountNumberHash, accountLast4: p.account!.accountNumberLast4, ifsc: p.account!.ifsc, fileKey, fileName, fileSha256: sha, generatedByUserId: actor.userId } });
      await writeAuditLogs([{ actorUserId: actor.userId, action: "payroll.bank.account_read", entityType: "Employee", entityId: p.run.employeeId, after: { offCycleBatchId: created.id, last4: p.account!.accountNumberLast4 }, ipAddress: actor.ip ?? null }], tx);
      return created;
    });
    await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.bank.off_cycle_generated", entityType: "OffCycleBankBatch", entityId: batch.id, after: { sha256: sha } });
    return { batchId: batch.id, fileName, sha256: sha };
  } catch (err) {
    if (err instanceof Error && /Unique constraint/.test(err.message)) throw new HttpError(409, "A file has already been written for this run.", "ALREADY_GENERATED");
    throw err;
  }
}

export async function downloadBank(batchId: string, actor: Actor) {
  await requireDirector(actor.userId, "download an off-cycle bank file");
  const b = await prisma.offCycleBankBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new HttpError(404, "There is no such file.", "NOT_FOUND");
  const url = await storageService.getObjectSignedUrl(b.fileKey, 300, { downloadFileName: b.fileName }); // allow-number: seconds a download link lives
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.bank.off_cycle_downloaded", entityType: "OffCycleBankBatch", entityId: batchId, after: { sha256: b.fileSha256 }, ipAddress: actor.ip ?? null });
  return { url, fileName: b.fileName, sha256: b.fileSha256 };
}

registerSubject({ subject: "OFF_CYCLE_RUN", makerPermission: "payroll.run", checkerPermission: "payroll.approve", describe: async () => "an off-cycle payroll run", hash: (id) => hashOfRun(id) });
registerSubject({ subject: "OFF_CYCLE_BANK", makerPermission: "payroll.run", checkerPermission: "payroll.approve", describe: async () => "an off-cycle bank file", hash: (id) => hashOfBank(id) });
