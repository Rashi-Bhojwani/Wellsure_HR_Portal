import { createHash } from "node:crypto";
import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { isDirector, requireDirector } from "../../../lib/directorAuthority";
import { namesOn } from "../../../lib/effectiveDating";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { decide, liveApproval, registerSubject, submit } from "../approvals";
import { payrollHash } from "../hash";
import { canonicalDecimal, dec, fixed, sum, ZERO, type Money } from "../money";
import { addMonths, loanSchedule, type Instalment } from "./schedule";

// P7-4 (docs/plans/P7_4_LOANS.md): loans and advances. Directors only, except a person reading and asking for their own. Money moves only through payroll runs:
// a sanctioned loan becomes pending adjustments (the disbursement for the next run, each instalment's principal and interest due in its month). The loan record is
// immutable; its state is read from its approval, its changes and its adjustments, so no balance is ever stored.

export interface Actor {
  userId: string;
  ip?: string | null;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (s: string) => new Date(`${s.slice(0, 7)}-01T00:00:00Z`);
const monthEnd = (s: string) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0)); // allow-number: calendar arithmetic for a month's last day, not money

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const typeSchema = z
  .object({
    typeKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Capital letters, digits and _ (for example STAFF_ADVANCE)"),
    name: z.string().trim().min(2).max(60),
    maxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable(),
    maxInstalments: z.number().int().min(1).max(600).nullable(),
    ratePercent: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/).nullable(),
    employeesMayRequest: z.boolean().nullable(),
    disbursementHead: z.string().min(1).max(40).nullable(),
    principalHead: z.string().min(1).max(40).nullable(),
    interestHead: z.string().min(1).max(40).nullable(),
    retired: z.boolean().default(false),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

async function latestTypes() {
  const rows = await prisma.loanTypeVersion.findMany({ orderBy: [{ typeKey: "asc" }, { version: "asc" }] });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(r.typeKey, r);
  return latest;
}

/** What a type still lacks before a loan of it can be sanctioned (Not set until a director chooses). */
export function typeGaps(t: { maxAmount: unknown; maxInstalments: number | null; ratePercent: unknown; employeesMayRequest: boolean | null; disbursementHead: string | null; principalHead: string | null; interestHead: string | null; retired: boolean }): string[] {
  const gaps: string[] = [];
  if (t.retired) gaps.push("the type is retired");
  if (t.maxAmount === null) gaps.push("the maximum amount");
  if (t.maxInstalments === null) gaps.push("the maximum number of instalments");
  if (t.ratePercent === null) gaps.push("the yearly interest rate (0 is a valid choice)");
  if (t.employeesMayRequest === null) gaps.push("whether employees may ask for one");
  if (!t.disbursementHead) gaps.push("the pay head the money is paid under");
  if (!t.principalHead) gaps.push("the pay head the principal part is recovered under");
  if (!t.interestHead) gaps.push("the pay head the interest part is recovered under");
  return gaps;
}

export async function listTypes(actor: Actor) {
  await requireDirector(actor.userId, "see loan types");
  return { types: [...(await latestTypes()).values()].map((t) => ({ ...t, maxAmount: t.maxAmount ? canonicalDecimal(dec(t.maxAmount.toString())) : null, ratePercent: t.ratePercent ? canonicalDecimal(dec(t.ratePercent.toString())) : null, gaps: typeGaps(t) })) };
}

export async function saveType(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "set loan types");
  const parsed = typeSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const v = parsed.data;
  // Each head must be a pay head that exists, of the right kind.
  const heads = [v.disbursementHead, v.principalHead, v.interestHead].filter((h): h is string => !!h);
  if (heads.length) {
    const rows = await prisma.payrollItemVersion.findMany({ where: { kind: "COMPONENT", key: { in: heads } }, orderBy: { version: "asc" } });
    const typeOf = new Map(rows.map((r) => [r.key, (r.value as { type?: string }).type]));
    if (v.disbursementHead && typeOf.get(v.disbursementHead) !== "EARNING") throw new HttpError(400, "The head the money is paid under must be an earning pay head.", "VALIDATION_ERROR");
    for (const h of [v.principalHead, v.interestHead]) if (h && typeOf.get(h) !== "DEDUCTION") throw new HttpError(400, "The principal and interest parts are recovered under deduction pay heads.", "VALIDATION_ERROR");
  }
  const prev = (await latestTypes()).get(v.typeKey);
  const row = await prisma.loanTypeVersion.create({ data: { ...v, version: (prev?.version ?? 0) + 1, setByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.loan_type.saved", entityType: "LoanType", entityId: v.typeKey, after: { version: row.version, reason: v.reason } });
  return { typeKey: row.typeKey, version: row.version, gaps: typeGaps(row) };
}

// ── Loans ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const loanSchema = z
  .object({
    employeeId: z.string().min(1).max(64).optional(),
    typeKey: z.string().min(2).max(32),
    principal: z.string().regex(/^\d+(\.\d{1,2})?$/, "Digits with up to two decimals"),
    instalments: z.number().int().min(1).max(600),
    firstMonth: z.string().regex(/^\d{4}-\d{2}-01$/, "The first day of the month recovery starts"),
    purpose: z.string().trim().min(3).max(300),
  })
  .strict();

function scheduleJson(rows: Instalment[]) {
  return rows.map((r) => ({ n: r.n, month: r.month, principal: fixed(r.principal, 2), interest: fixed(r.interest, 2), balanceAfter: fixed(r.balanceAfter, 2) }));
}

async function createLoan(raw: unknown, actor: Actor, own: { employeeId: string } | null) {
  const parsed = loanSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const v = parsed.data;
  const employeeId = own ? own.employeeId : v.employeeId;
  if (!employeeId) throw new HttpError(400, "Choose the person.", "VALIDATION_ERROR");
  if (!(await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const type = (await latestTypes()).get(v.typeKey);
  if (!type) throw new HttpError(400, "No such loan type.", "VALIDATION_ERROR");
  const gaps = typeGaps(type);
  if (gaps.length) throw new HttpError(409, `This loan type is not ready: ${gaps.join(", ")}.`, "TYPE_NOT_SET");
  if (own && !type.employeesMayRequest) throw new HttpError(403, "Employees cannot ask for this kind of loan.", "NOT_REQUESTABLE");
  if (dec(v.principal).gt(dec(type.maxAmount!.toString()))) throw new HttpError(400, "That is more than this loan type allows.", "OVER_MAXIMUM");
  if (v.instalments > type.maxInstalments!) throw new HttpError(400, "That is more instalments than this loan type allows.", "OVER_MAXIMUM");
  if (v.firstMonth < `${iso(businessToday()).slice(0, 7)}-01`) throw new HttpError(400, "Recovery cannot start in a month that has passed.", "VALIDATION_ERROR");
  const rate = canonicalDecimal(dec(type.ratePercent!.toString()));
  let schedule: Instalment[];
  try {
    schedule = loanSchedule(v.principal, rate, v.instalments, v.firstMonth);
  } catch (err) {
    throw new HttpError(400, (err as Error).message, "VALIDATION_ERROR");
  }
  const loan = await prisma.loan.create({
    data: { employeeId, typeKey: type.typeKey, typeVersion: type.version, principal: v.principal, ratePercent: rate, instalments: v.instalments, firstMonth: monthStart(v.firstMonth), schedule: scheduleJson(schedule), purpose: v.purpose, requestedByEmployee: !!own, createdByUserId: actor.userId },
  });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.loan.created", entityType: "Loan", entityId: loan.id, after: { type: type.typeKey, instalments: v.instalments, byEmployee: !!own } }); // no figure in the audit row
  return { id: loan.id };
}

export async function createForPerson(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "enter a loan");
  const employeeId = (raw as { employeeId?: string }).employeeId;
  const own = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  if (employeeId && own?.employeeId === employeeId) throw new HttpError(403, "Ask for your own loan from your own Loans page; another director sanctions it.", "OWN_LOAN");
  return createLoan(raw, actor, null);
}

export async function requestOwn(raw: unknown, actor: Actor & { employeeId: string }) {
  const { employeeId: _ignored, ...rest } = (raw ?? {}) as Record<string, unknown>;
  return createLoan(rest, actor, { employeeId: actor.employeeId });
}

// State, read from what happened.
type LoanRow = Awaited<ReturnType<typeof prisma.loan.findUniqueOrThrow>>;
async function stateOf(loan: LoanRow) {
  const [approval, adjustments, changes, changeApprovals, exitRecoveries] = await Promise.all([
    liveApproval("LOAN_SANCTION", loan.id),
    prisma.payrollAdjustment.findMany({ where: { source: { in: ["LOAN_DISBURSEMENT", "LOAN_PRINCIPAL", "LOAN_INTEREST"] }, sourceRef: { startsWith: loan.id } } }),
    prisma.loanChange.findMany({ where: { loanId: loan.id }, orderBy: { createdAt: "asc" } }),
    prisma.payrollApproval.findMany({ where: { subject: "LOAN_CHANGE", subjectId: { startsWith: loan.id } } }),
    prisma.offCycleLoanRecovery.findMany({ where: { loanId: loan.id }, select: { amount: true } }),
  ]);
  const sanctioned = adjustments.length > 0;
  const status = sanctioned ? "SANCTIONED" : approval?.status === "PENDING" ? "WAITING" : approval?.status === "REJECTED" ? "REJECTED" : "DRAFT";
  const approvedChange = new Set(changeApprovals.filter((a) => a.status === "APPROVED" || a.status === "CONSUMED").map((a) => a.subjectId));
  const effective = changes.filter((c) => approvedChange.has(`${loan.id}:${c.id}`));
  const disbursed = adjustments.some((a) => a.source === "LOAN_DISBURSEMENT" && a.status === "CONSUMED");
  const recovered = sum(adjustments.filter((a) => a.source === "LOAN_PRINCIPAL" && a.status === "CONSUMED").map((a) => dec(a.amount.toString())));
  const interestPaid = sum(adjustments.filter((a) => a.source === "LOAN_INTEREST" && a.status === "CONSUMED").map((a) => dec(a.amount.toString())));
  const prepaid = sum(effective.filter((c) => c.kind === "PREPAID").map((c) => dec(c.amount!.toString())));
  const waived = sum(effective.filter((c) => c.kind === "WAIVED").map((c) => dec(c.amount!.toString())));
  const principal = dec(loan.principal.toString());
  // P7-6b: what a final settlement recovered through an off-cycle run.
  const recoveredAtExit = sum(exitRecoveries.map((r) => dec(r.amount.toString())));
  const balance: Money = disbursed ? principal.minus(recovered).minus(prepaid).minus(waived).minus(recoveredAtExit) : ZERO;
  return { status, approval, adjustments, changes, effective, disbursed, recovered, interestPaid, prepaid, waived, recoveredAtExit, balance };
}

async function view(loan: LoanRow, viewerUserId: string | null = null) {
  const s = await stateOf(loan);
  const byRef = new Map(s.adjustments.map((a) => [a.sourceRef, a]));
  return {
    id: loan.id,
    employeeId: loan.employeeId,
    typeKey: loan.typeKey,
    principal: canonicalDecimal(dec(loan.principal.toString())),
    ratePercent: canonicalDecimal(dec(loan.ratePercent.toString())),
    instalments: loan.instalments,
    firstMonth: iso(loan.firstMonth),
    purpose: loan.purpose,
    status: s.status,
    disbursed: s.disbursed,
    balance: fixed(s.balance, 2),
    recovered: fixed(s.recovered, 2),
    interestPaid: fixed(s.interestPaid, 2),
    prepaid: fixed(s.prepaid, 2),
    waived: fixed(s.waived, 2),
    schedule: (loan.schedule as Array<{ n: number; month: string; principal: string; interest: string; balanceAfter: string }>).map((r) => ({ ...r, state: byRef.get(`${loan.id}#${r.n}`)?.status ?? (s.status === "SANCTIONED" ? "CANCELLED" : "NOT_SANCTIONED") })),
    changes: s.changes.map((c) => ({ id: c.id, kind: c.kind, amount: c.amount ? canonicalDecimal(dec(c.amount.toString())) : null, reference: c.reference, effective: s.effective.some((e) => e.id === c.id), createdAt: c.createdAt.toISOString() })),
    waiting: s.approval?.status === "PENDING" ? { mine: s.approval.makerUserId === viewerUserId } : null,
    fingerprint: fingerprintOf(loan.id, await hashOfLoan(loan.id)),
    createdAt: loan.createdAt.toISOString(),
  };
}

export async function listAll(actor: Actor) {
  await requireDirector(actor.userId, "see loans");
  const loans = await prisma.loan.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  const names = await namesOn([...new Set(loans.map((l) => l.employeeId))], businessToday());
  return { loans: await Promise.all(loans.map(async (l) => ({ ...(await view(l, actor.userId)), name: names.get(l.employeeId) ?? "" }))) };
}

export async function listOwn(employeeId: string) {
  const loans = await prisma.loan.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
  const types = await latestTypes();
  return { loans: await Promise.all(loans.map((l) => view(l))), requestable: [...types.values()].filter((t) => t.employeesMayRequest && typeGaps(t).length === 0).map((t) => ({ typeKey: t.typeKey, name: t.name, maxAmount: canonicalDecimal(dec(t.maxAmount!.toString())), maxInstalments: t.maxInstalments, ratePercent: canonicalDecimal(dec(t.ratePercent!.toString())) })) };
}

// ── Sanction (always a different director; nobody on their own loan) ─────────────────────────────────────────────────────────

export async function hashOfLoan(loanId: string): Promise<string> {
  const l = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
  return payrollHash({ id: l.id, employeeId: l.employeeId, type: [l.typeKey, l.typeVersion], principal: canonicalDecimal(dec(l.principal.toString())), rate: canonicalDecimal(dec(l.ratePercent.toString())), instalments: l.instalments, firstMonth: iso(l.firstMonth), schedule: l.schedule });
}
const fingerprintOf = (id: string, hash: string) => createHash("sha256").update(`${id}|${hash}`).digest("hex");

/** Nobody prepares or decides their own loan. */
async function refuseOwn(employeeId: string, userId: string) {
  if ((await userIdOfEmployee(employeeId)) === userId) throw new HttpError(403, "This is your own loan: another director prepares and decides it.", "OWN_LOAN");
}

async function userIdOfEmployee(employeeId: string) {
  return (await prisma.user.findUnique({ where: { employeeId }, select: { id: true } }))?.id ?? null;
}

export const sanctionRequestSchema = z.object({ fingerprint: z.string().length(64), note: z.string().trim().max(300).optional() }).strict();
export const decisionSchema = z.object({ fingerprint: z.string().length(64), decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(300).optional() }).strict();

export async function requestSanction(loanId: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "prepare a loan sanction");
  const parsed = sanctionRequestSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
  if ((await stateOf(loan)).status !== "DRAFT") throw new HttpError(409, "This loan is not waiting to be sanctioned.", "NOT_DRAFT");
  await refuseOwn(loan.employeeId, actor.userId);
  if (fingerprintOf(loanId, await hashOfLoan(loanId)) !== parsed.data.fingerprint) throw new HttpError(409, "The loan changed since you looked at it.", "PREVIEW_STALE");
  return submit({ subject: "LOAN_SANCTION", subjectId: loanId, makerUserId: actor.userId, previewFingerprint: parsed.data.fingerprint, ...(parsed.data.note ? { note: parsed.data.note } : {}), ip: actor.ip ?? null, notify: { step: "SALARY_REVISION", subjectLabel: "a loan sanction", itemCount: 1 } });
}

export async function decideSanction(loanId: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "decide a loan sanction");
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
  await refuseOwn(loan.employeeId, actor.userId);
  const approval = await liveApproval("LOAN_SANCTION", loanId);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision on this loan.", "NOT_PENDING");
  const hash = await hashOfLoan(loanId);
  if (fingerprintOf(loanId, hash) !== parsed.data.fingerprint) throw new HttpError(409, "What you were looking at is not what is there now.", "PREVIEW_STALE");
  const type = await prisma.loanTypeVersion.findUniqueOrThrow({ where: { typeKey_version: { typeKey: loan.typeKey, version: loan.typeVersion } } });
  const schedule = loan.schedule as Array<{ n: number; month: string; principal: string; interest: string }>;
  return decide({
    approvalId: approval.id,
    checkerUserId: actor.userId,
    decision: parsed.data.decision,
    ...(parsed.data.note ? { note: parsed.data.note } : {}),
    ip: actor.ip ?? null,
    expectedHash: hash,
    // On approval the money is put on the road through payroll, in the same transaction: the disbursement for the next run, and each instalment due in its month.
    inTransaction: async (tx, a) => {
      if (parsed.data.decision !== "APPROVE") return;
      const base = { employeeId: loan.employeeId, createdByUserId: a.makerUserId, reason: `Loan ${loan.typeKey}` };
      await tx.payrollAdjustment.create({ data: { ...base, componentCode: type.disbursementHead!, direction: "EARNING", amount: loan.principal, source: "LOAN_DISBURSEMENT", sourceRef: loan.id, reason: `Loan paid out (${loan.typeKey})` } });
      for (const r of schedule) {
        const period = { periodStart: monthStart(r.month), periodEnd: monthEnd(r.month) };
        await tx.payrollAdjustment.create({ data: { ...base, ...period, componentCode: type.principalHead!, direction: "DEDUCTION", amount: r.principal, source: "LOAN_PRINCIPAL", sourceRef: `${loan.id}#${r.n}`, reason: `Loan instalment ${r.n} of ${schedule.length}: principal part` } });
        if (dec(r.interest).gt(ZERO)) await tx.payrollAdjustment.create({ data: { ...base, ...period, componentCode: type.interestHead!, direction: "DEDUCTION", amount: r.interest, source: "LOAN_INTEREST", sourceRef: `${loan.id}#${r.n}i`, reason: `Loan instalment ${r.n} of ${schedule.length}: interest part` } });
      }
    },
  });
}

// ── Changes (prepared by one director, approved by a different one) ───────────────────────────────────────────────────────────

export const changeSchema = z.object({ kind: z.enum(["PREPAID", "WAIVED", "CANCEL_PENDING"]), amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), reference: z.string().trim().min(3).max(300) }).strict();

export async function requestChange(loanId: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "prepare a loan change");
  const parsed = changeSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
  const s = await stateOf(loan);
  if (s.status !== "SANCTIONED") throw new HttpError(409, "Only a sanctioned loan can be changed.", "NOT_SANCTIONED");
  await refuseOwn(loan.employeeId, actor.userId);
  const v = parsed.data;
  if (v.kind !== "CANCEL_PENDING" && (!v.amount || dec(v.amount).lte(ZERO))) throw new HttpError(400, "Give the amount.", "VALIDATION_ERROR");
  if (v.kind !== "CANCEL_PENDING" && dec(v.amount!).gt(s.balance)) throw new HttpError(400, "That is more than the balance.", "OVER_BALANCE");
  const change = await prisma.loanChange.create({ data: { loanId, kind: v.kind, amount: v.kind === "CANCEL_PENDING" ? null : v.amount!, reference: v.reference, createdByUserId: actor.userId } });
  const subjectId = `${loanId}:${change.id}`;
  await submit({ subject: "LOAN_CHANGE", subjectId, makerUserId: actor.userId, previewFingerprint: fingerprintOf(subjectId, await hashOfChange(subjectId)), ip: actor.ip ?? null, notify: { step: "SALARY_REVISION", subjectLabel: "a loan change", itemCount: 1 } });
  return { id: change.id };
}

async function hashOfChange(subjectId: string) {
  const [loanId, changeId] = subjectId.split(":");
  const c = await prisma.loanChange.findUniqueOrThrow({ where: { id: changeId! } });
  return payrollHash({ loanId, changeId, kind: c.kind, amount: c.amount ? canonicalDecimal(dec(c.amount.toString())) : null, reference: c.reference });
}

export async function decideChange(loanId: string, changeId: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "decide a loan change");
  const parsed = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(300).optional() }).strict().safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const subjectId = `${loanId}:${changeId}`;
  const approval = await liveApproval("LOAN_CHANGE", subjectId);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision on this change.", "NOT_PENDING");
  const change = await prisma.loanChange.findUniqueOrThrow({ where: { id: changeId }, include: { loan: { select: { employeeId: true } } } });
  await refuseOwn(change.loan.employeeId, actor.userId);
  return decide({
    approvalId: approval.id,
    checkerUserId: actor.userId,
    decision: parsed.data.decision,
    ...(parsed.data.note ? { note: parsed.data.note } : {}),
    ip: actor.ip ?? null,
    expectedHash: await hashOfChange(subjectId),
    inTransaction: async (tx) => {
      // Cancelling the instalments still to come: every not-yet-paid principal and interest adjustment of the loan is cancelled (paid ones are history).
      if (parsed.data.decision === "APPROVE" && change.kind === "CANCEL_PENDING") {
        await tx.payrollAdjustment.updateMany({ where: { source: { in: ["LOAN_PRINCIPAL", "LOAN_INTEREST"] }, sourceRef: { startsWith: `${loanId}#` }, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: actor.userId, cancelReason: `Loan change: ${change.reference}` } }); // allow-clock: an instant
      }
    },
  });
}

// ── The person's own, and the approvals core ────────────────────────────────────────────────────────────────────────────────

export async function ownLoan(loanId: string, employeeId: string) {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan || loan.employeeId !== employeeId) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
  return view(loan);
}

export async function directorsLoan(loanId: string, actor: Actor) {
  await requireDirector(actor.userId, "see a loan");
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new HttpError(404, "Loan not found.", "NOT_FOUND");
  return view(loan, actor.userId);
}

registerSubject({
  subject: "LOAN_SANCTION",
  makerPermission: "payroll.salary.edit",
  checkerPermission: "payroll.approve",
  async describe() {
    return "a loan sanction";
  },
  hash: (id) => hashOfLoan(id),
  async affectedUserIds(id) {
    const l = await prisma.loan.findUnique({ where: { id }, select: { employeeId: true } });
    const u = l ? await userIdOfEmployee(l.employeeId) : null;
    return u ? [u] : [];
  },
});
registerSubject({
  subject: "LOAN_CHANGE",
  makerPermission: "payroll.salary.edit",
  checkerPermission: "payroll.approve",
  async describe() {
    return "a loan change";
  },
  hash: (id) => hashOfChange(id),
  async affectedUserIds(id) {
    const l = await prisma.loan.findUnique({ where: { id: id.split(":")[0]! }, select: { employeeId: true } });
    const u = l ? await userIdOfEmployee(l.employeeId) : null;
    return u ? [u] : [];
  },
});

export { addMonths, isDirector };

/** P7-6: for a settlement, each sanctioned loan's balance and the principal already pending as adjustments (so a settlement does not count it twice). */
export async function outstandingLoans(employeeId: string): Promise<Array<{ loanId: string; typeKey: string; balance: Money; pendingPrincipal: Money }>> {
  const loans = await prisma.loan.findMany({ where: { employeeId } });
  const out: Array<{ loanId: string; typeKey: string; balance: Money; pendingPrincipal: Money }> = [];
  for (const l of loans) {
    const s = await stateOf(l);
    if (s.status !== "SANCTIONED") continue;
    const pendingPrincipal = sum(s.adjustments.filter((a) => a.source === "LOAN_PRINCIPAL" && a.status === "PENDING").map((a) => dec(a.amount.toString())));
    out.push({ loanId: l.id, typeKey: l.typeKey, balance: s.balance, pendingPrincipal });
  }
  return out;
}
