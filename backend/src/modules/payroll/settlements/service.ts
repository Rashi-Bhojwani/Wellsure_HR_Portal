import { createHash } from "node:crypto";
import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { businessToday } from "../../../lib/businessDate";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { decide, liveApproval, registerSubject, submit } from "../approvals";
import { payrollHash } from "../hash";
import { unpaidHeldItems } from "../offcycle/held";
import { outstandingLoans } from "../loans/service";
import { exitEncashment, exitGratuity, exitNoticeRecovery } from "../payPolicies/service";
import { canonicalDecimal, dec, fixed, sum, ZERO, type Money } from "../money";

// P7-6 (docs/plans/P7_6_SETTLEMENTS.md): full and final settlement, prepared and confirmed. Paying it needs an off-cycle run (P7-6b, not built): nothing here moves money.

export interface Actor {
  userId: string;
  ip?: string | null;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONEY = /^-?\d+(\.\d{1,2})?$/;

export interface SettlementLine {
  kind: "HELD_PAY" | "PENDING_ADJUSTMENT" | "LOAN_OWED" | "LEAVE_BALANCE" | "GRATUITY" | "NOTICE_RECOVERY" | "DIRECTOR"; // GRATUITY, NOTICE_RECOVERY: part 4
  label: string;
  /** Signed: a positive amount is paid to the person, a negative one recovered. Null for the leave balance's days (no amount without the owners' formula). */
  amount: string | null;
  days?: string;
  source: string;
}

/** The automatic lines, read from their sources. Exported so the tests can check each against its source. */
export async function automaticLines(employeeId: string, lastWorkingDate: Date, noticeGiven?: Date): Promise<SettlementLine[]> {
  const lines: SettlementLine[] = [];
  // Pay held in a final run and not yet paid (by a director's release or an off-cycle run): one reader shared with the off-cycle run (P7-6b).
  for (const h of await unpaidHeldItems({ employeeId })) lines.push({ kind: "HELD_PAY", label: `Pay held in ${h.run.cycleLabel}`, amount: fixed(dec(h.netPay.toString()), 2), source: `run item ${h.id}` });
  // Everything pending for the person (approved reimbursements, arrears, loan instalments not yet recovered, other adjustments).
  const pending = await prisma.payrollAdjustment.findMany({ where: { employeeId, status: "PENDING" }, orderBy: { createdAt: "asc" } });
  for (const a of pending) {
    const v = dec(a.amount.toString());
    lines.push({ kind: "PENDING_ADJUSTMENT", label: a.reason, amount: fixed(a.direction === "EARNING" ? v : v.negated(), 2), source: `adjustment ${a.id} (${a.source})` });
  }
  // Loans: what is still owed beyond the instalments already pending above.
  for (const l of await outstandingLoans(employeeId)) {
    const owed = l.balance.minus(l.pendingPrincipal);
    if (owed.gt(ZERO)) lines.push({ kind: "LOAN_OWED", label: `Loan still owed (${l.typeKey})`, amount: fixed(owed.negated(), 2), source: `loan ${l.loanId}` });
  }
  // Leave balance in days at the last working day (no amount: the encashment formula is the owners').
  const ledger = await prisma.leaveLedger.groupBy({ by: ["leaveTypeId"], where: { employeeId, entryDate: { lte: lastWorkingDate } }, _sum: { days: true } });
  const types = new Map((await prisma.leaveType.findMany({ where: { id: { in: ledger.map((l) => l.leaveTypeId) } }, select: { id: true, code: true } })).map((t) => [t.id, t.code]));
  for (const l of ledger) {
    const days = dec((l._sum.days ?? 0).toString());
    if (days.isZero()) continue;
    // Part 3 A3: an amount only once the leave encashment setting is confirmed and names this type for exit; until then days only, exactly as before.
    const code = types.get(l.leaveTypeId) ?? "leave";
    const enc = days.gt(ZERO) ? await exitEncashment(employeeId, code, canonicalDecimal(days), lastWorkingDate) : null;
    lines.push(enc ? { kind: "LEAVE_BALANCE", label: `Leave encashment (${code})`, amount: enc.amount, days: canonicalDecimal(days), source: `leave ledger; ${enc.source}` } : { kind: "LEAVE_BALANCE", label: `Leave balance (${code}), days only`, amount: null, days: canonicalDecimal(days), source: "leave ledger" });
  }
  // Part 4: gratuity and notice recovery, each only once its setting is confirmed and in force on the last working day; until then no line, exactly as before.
  const gratuity = await exitGratuity(employeeId, lastWorkingDate);
  if (gratuity) lines.push({ kind: "GRATUITY", label: "Gratuity", amount: gratuity.amount, source: gratuity.source });
  if (noticeGiven) {
    const notice = await exitNoticeRecovery(employeeId, noticeGiven, lastWorkingDate);
    if (notice) lines.push({ kind: "NOTICE_RECOVERY", label: `Notice not served (${notice.shortfall} days)`, amount: fixed(dec(notice.amount).negated(), 2), source: notice.source });
  }
  return lines;
}

/** Pure: a settlement's total, exact, and what it means (paid only when positive; a negative total is recovered outside payroll). Exported for the independent-model test. */
export function settlementTotals(lines: readonly Pick<SettlementLine, "amount">[]): { total: Money; payable: boolean; recoverOutsidePayroll: Money | null } {
  const total = sum(lines.filter((l) => l.amount !== null).map((l) => dec(l.amount!)));
  return { total, payable: total.gt(ZERO), recoverOutsidePayroll: total.lt(ZERO) ? total.negated() : null };
}

export const prepareSchema = z
  .object({
    separationId: z.string().min(1).max(64),
    directorLines: z.array(z.object({ label: z.string().trim().min(3).max(120), amount: z.string().regex(MONEY, "A signed amount with up to two decimals"), source: z.string().trim().min(3, "Say where the figure comes from").max(300) }).strict()).max(50),
  })
  .strict();

export async function prepare(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "prepare a settlement");
  const parsed = prepareSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const sep = await prisma.separation.findUnique({ where: { id: parsed.data.separationId } });
  if (!sep || sep.status === "CANCELLED") throw new HttpError(404, "Separation not found.", "NOT_FOUND");
  await refuseOwn(sep.employeeId, actor.userId);
  const pendingApproval = await latestFor(sep.id).then((s) => (s ? liveApproval("FNF_SETTLEMENT", s.id) : null));
  if (pendingApproval?.status === "PENDING") throw new HttpError(409, "A settlement for this person is waiting for the other director. Ask them to decide it first.", "WAITING_FOR_DECISION");
  const latestId = (await latestFor(sep.id))?.id;
  if (latestId && (await prisma.offCycleFinalisation.findUnique({ where: { kind_sourceRef: { kind: "SETTLEMENT", sourceRef: latestId } } }))) throw new HttpError(409, "This person's settlement has been paid. Anything more goes through an adjustment.", "ALREADY_PAID");
  const lines: SettlementLine[] = [...(await automaticLines(sep.employeeId, sep.lastWorkingDate, sep.initiatedAt)), ...parsed.data.directorLines.map((l) => ({ kind: "DIRECTOR" as const, label: l.label, amount: fixed(dec(l.amount), 2), source: l.source }))];
  const { total } = settlementTotals(lines);
  const row = await prisma.fnfSettlement.create({ data: { separationId: sep.id, employeeId: sep.employeeId, lines: lines as unknown as object, total: total.toFixed(2), createdByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.settlement.prepared", entityType: "FnfSettlement", entityId: row.id, after: { separationId: sep.id, lines: lines.length } });
  return view(row);
}

async function latestFor(separationId: string) {
  return prisma.fnfSettlement.findFirst({ where: { separationId }, orderBy: { createdAt: "desc" } });
}

async function refuseOwn(employeeId: string, userId: string) {
  const u = await prisma.user.findUnique({ where: { employeeId }, select: { id: true } });
  if (u?.id === userId) throw new HttpError(403, "This is your own settlement: another director prepares and confirms it.", "OWN_SETTLEMENT");
}

export async function hashOf(id: string) {
  const s = await prisma.fnfSettlement.findUniqueOrThrow({ where: { id } });
  return payrollHash({ id, separationId: s.separationId, lines: s.lines, total: canonicalDecimal(dec(s.total.toString())) });
}
const fingerprintOf = (id: string, hash: string) => createHash("sha256").update(`${id}|${hash}`).digest("hex");

type Row = Awaited<ReturnType<typeof prisma.fnfSettlement.findFirstOrThrow>>;
async function view(s: Row) {
  const [approval, latest, paid] = await Promise.all([liveApproval("FNF_SETTLEMENT", s.id), latestFor(s.separationId), prisma.offCycleFinalisation.findUnique({ where: { kind_sourceRef: { kind: "SETTLEMENT", sourceRef: s.id } }, select: { runId: true } })]);
  const total: Money = dec(s.total.toString());
  const state = paid ? "PAID" : latest?.id !== s.id ? "REPLACED" : approval?.status === "APPROVED" ? "CONFIRMED" : approval?.status === "PENDING" ? "WAITING" : approval?.status === "REJECTED" ? "REJECTED" : "PREPARED";
  return {
    id: s.id,
    separationId: s.separationId,
    employeeId: s.employeeId,
    lines: s.lines as unknown as SettlementLine[],
    total: fixed(total, 2),
    payable: total.gt(ZERO),
    recoverOutsidePayroll: total.lt(ZERO) ? fixed(total.negated(), 2) : null,
    state,
    payment: state === "PAID" ? "Paid by an off-cycle run." : state === "CONFIRMED" ? (total.gt(ZERO) ? "Waiting for an off-cycle run: nothing has been paid yet." : "Nothing is paid: the total is not positive.") : null,
    offCycleRunId: paid?.runId ?? null,
    fingerprint: fingerprintOf(s.id, await hashOf(s.id)),
    createdAt: s.createdAt.toISOString(),
  };
}

export async function list(actor: Actor) {
  await requireDirector(actor.userId, "see settlements");
  const seps = await prisma.separation.findMany({ where: { status: { not: "CANCELLED" } }, include: { employee: { select: { employeeCode: true } } }, orderBy: { lastWorkingDate: "desc" }, take: 300 });
  const names = await namesOn(seps.map((s) => s.employeeId), businessToday());
  return {
    separations: await Promise.all(
      seps.map(async (s) => {
        const latest = await latestFor(s.id);
        return { separationId: s.id, employeeId: s.employeeId, employeeCode: s.employee.employeeCode, name: names.get(s.employeeId) ?? s.employee.employeeCode, lastWorkingDate: iso(s.lastWorkingDate), settlement: latest ? await view(latest) : null };
      }),
    ),
  };
}

export const requestSchema = z.object({ fingerprint: z.string().length(64) }).strict();
export const decisionSchema = z.object({ fingerprint: z.string().length(64), decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(300).optional() }).strict();

export async function requestConfirmation(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "ask for a settlement to be confirmed");
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Look at the settlement first.", "VALIDATION_ERROR");
  const s = await prisma.fnfSettlement.findUnique({ where: { id } });
  if (!s) throw new HttpError(404, "Settlement not found.", "NOT_FOUND");
  await refuseOwn(s.employeeId, actor.userId);
  if ((await latestFor(s.separationId))?.id !== id) throw new HttpError(409, "A newer settlement replaces this one.", "REPLACED");
  if (fingerprintOf(id, await hashOf(id)) !== parsed.data.fingerprint) throw new HttpError(409, "The settlement changed since you looked at it.", "PREVIEW_STALE");
  return submit({ subject: "FNF_SETTLEMENT", subjectId: id, makerUserId: actor.userId, previewFingerprint: parsed.data.fingerprint, ip: actor.ip ?? null, notify: { step: "SALARY_REVISION", subjectLabel: "a full and final settlement", itemCount: 1 } });
}

export async function decideConfirmation(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "confirm a settlement");
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const s = await prisma.fnfSettlement.findUnique({ where: { id } });
  if (!s) throw new HttpError(404, "Settlement not found.", "NOT_FOUND");
  await refuseOwn(s.employeeId, actor.userId);
  const approval = await liveApproval("FNF_SETTLEMENT", id);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision on this settlement.", "NOT_PENDING");
  const hash = await hashOf(id);
  if (fingerprintOf(id, hash) !== parsed.data.fingerprint) throw new HttpError(409, "What you were looking at is not what is there now.", "PREVIEW_STALE");
  return decide({ approvalId: approval.id, checkerUserId: actor.userId, decision: parsed.data.decision, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null, expectedHash: hash });
}

registerSubject({
  subject: "FNF_SETTLEMENT",
  makerPermission: "payroll.salary.edit",
  checkerPermission: "payroll.approve",
  async describe() {
    return "a full and final settlement";
  },
  hash: (id) => hashOf(id),
});
