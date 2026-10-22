import { Prisma, type PayrollApproval, type PayrollApprovalSubject } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit";
import { activeUsersHoldingPermission, resolveAccess } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { namesOfUsers } from "./names";
import { figureEditorsSince, recordEvent, type Db } from "./events";

// Maker-checker: one small purpose-built piece, seven subjects, nothing configurable about the invariants (docs/plans/PHASE_6.md §6).
//
//   1. Different people. The checker is never the maker, nor anyone recorded as having changed the figures since submission.
//      (The database also refuses a checker equal to the maker.)
//   2. Bound to the figures. Submitting stores a hash of the exact figures; deciding stores the hash the checker saw.
//   3. Voided by change. A change that alters the hash voids the approval; the consuming action recomputes the hash and refuses on a mismatch.
//   4. Single use. An approval is consumed by the one action it authorised.
//   5. Recorded. Every step is a payroll event and an audit row, with the hash.
//
// Each subject registers an adapter that says who may make and check it and how to compute the hash of its live figures. Later commits register
// the real adapters (run, period, payslips, bank file, salary revision); the mechanics here are the same for all seven and are tested generically.

export interface SubjectAdapter {
  subject: PayrollApprovalSubject;
  /** Permission the maker needs. */
  makerPermission: string;
  /** Permission the checker needs. */
  checkerPermission: string;
  /** What this thing is called in messages, "the payroll run for October". */
  describe(subjectId: string): Promise<string>;
  /** The hash of the live figures this approval is bound to. */
  hash(subjectId: string): Promise<string>;
  /**
   * Users whose own pay (or other personal interest) is in these figures. They can be neither the maker nor the checker: nobody prepares or
   * approves a change to their own pay. Optional; a subject with nobody personally in it leaves it out.
   */
  affectedUserIds?(subjectId: string): Promise<string[]>;
  /**
   * Called inside the same transaction when a live approval of this subject is voided, for any reason (withdrawn, changed figures, reopened). A subject whose
   * state follows its approval (a run that is SUBMITTED only while its approval is live) puts that state right here, so the two can never disagree.
   */
  onVoided?(approval: PayrollApproval, reason: string, actorUserId: string | null, db: Db): Promise<void>;
}

const adapters = new Map<PayrollApprovalSubject, SubjectAdapter>();
export function registerSubject(adapter: SubjectAdapter): void {
  adapters.set(adapter.subject, adapter);
}
export function adapterFor(subject: PayrollApprovalSubject): SubjectAdapter {
  const a = adapters.get(subject);
  if (!a) throw new HttpError(500, `No payroll approval is registered for ${subject}.`, "APPROVAL_SUBJECT_UNREGISTERED");
  return a;
}
/** Test-only: forget a registration. */
export function unregisterSubjectForTests(subject: PayrollApprovalSubject): void {
  if (!process.env.VITEST) throw new Error("for tests only");
  adapters.delete(subject);
}

/** The marker used as the "maker" of a value that no person wrote (the shipped placeholder). Not a user id. */
export const SYSTEM_MAKER = "system";

const live = ["PENDING", "APPROVED"] as const;

export async function liveApproval(subject: PayrollApprovalSubject, subjectId: string, db: Db = prisma): Promise<PayrollApproval | null> {
  return db.payrollApproval.findFirst({ where: { subject, subjectId, status: { in: [...live] } } });
}

async function holds(userId: string, permission: string): Promise<boolean> {
  return (await resolveAccess(userId)).permissions.has(permission);
}

function conflict(message: string, code: string): HttpError {
  return new HttpError(409, message, code);
}

export interface SubmitInput {
  subject: PayrollApprovalSubject;
  subjectId: string;
  makerUserId: string;
  /** The fingerprint of the preview the maker confirmed. */
  previewFingerprint: string;
  note?: string;
  ip?: string | null;
  /** Runs inside the same transaction as the approval row, so a state that must follow it (a run becoming SUBMITTED) can never be seen without it. */
  inTransaction?: (tx: Prisma.TransactionClient, approval: PayrollApproval) => Promise<void>;
}

/** The maker submits. Refused if they lack the maker permission or a live approval already exists. */
export async function submit(input: SubmitInput): Promise<PayrollApproval> {
  const adapter = adapterFor(input.subject);
  if (!(await holds(input.makerUserId, adapter.makerPermission))) throw new HttpError(403, `Missing permission: ${adapter.makerPermission}`, "FORBIDDEN");
  if (adapter.affectedUserIds && (await adapter.affectedUserIds(input.subjectId)).includes(input.makerUserId)) {
    throw new HttpError(403, "This changes your own pay, so somebody else has to prepare it. Nobody prepares or approves a change to their own pay.", "MAKER_IS_AFFECTED");
  }
  const contentHash = await adapter.hash(input.subjectId);
  try {
    const approval = await prisma.$transaction(async (tx) => {
      const a = await tx.payrollApproval.create({
        data: { subject: input.subject, subjectId: input.subjectId, contentHash, makerUserId: input.makerUserId, previewFingerprint: input.previewFingerprint, submitNote: input.note ?? "" },
      });
      await recordEvent({ subjectType: input.subject, subjectId: input.subjectId, type: "SUBMITTED", actorUserId: input.makerUserId, payload: { approvalId: a.id, hash: contentHash } }, tx);
      await input.inTransaction?.(tx, a);
      return a;
    });
    await writeAuditLog({ actorUserId: input.makerUserId, action: "payroll.approval.submitted", entityType: "PayrollApproval", entityId: approval.id, after: { subject: input.subject, subjectId: input.subjectId, hash: contentHash }, ipAddress: input.ip ?? null });
    return approval;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw conflict("This is already waiting for a decision, or already approved. Void or consume that first.", "APPROVAL_ALREADY_LIVE");
    throw err;
  }
}

export interface DecideInput {
  approvalId: string;
  checkerUserId: string;
  decision: "APPROVE" | "REJECT";
  note?: string;
  ip?: string | null;
  /** The hash the checker was shown. When given, a different live hash is a stale screen, not a decision. */
  expectedHash?: string;
  /** Runs inside the decision's transaction (a run becoming APPROVED, or going back to CALCULATED on a rejection). */
  inTransaction?: (tx: Prisma.TransactionClient, approval: PayrollApproval) => Promise<void>;
}

export async function decide(input: DecideInput): Promise<PayrollApproval> {
  const approval = await prisma.payrollApproval.findUnique({ where: { id: input.approvalId } });
  if (!approval) throw new HttpError(404, "No such approval.", "NOT_FOUND");
  if (approval.status !== "PENDING") throw conflict(`This is already ${approval.status.toLowerCase()}.`, "APPROVAL_NOT_PENDING");
  const adapter = adapterFor(approval.subject);
  if (!(await holds(input.checkerUserId, adapter.checkerPermission))) throw new HttpError(403, `Missing permission: ${adapter.checkerPermission}`, "FORBIDDEN");
  if (input.checkerUserId === approval.makerUserId) throw new HttpError(403, "You prepared this, so you cannot be the one who approves it. A different person must.", "CHECKER_IS_MAKER");
  if (adapter.affectedUserIds && (await adapter.affectedUserIds(approval.subjectId)).includes(input.checkerUserId)) {
    throw new HttpError(403, "This changes your own pay, so you cannot be the one who approves it. Nobody approves a change to their own pay.", "CHECKER_IS_AFFECTED");
  }
  const editors = await figureEditorsSince(approval.subject, approval.subjectId, approval.submittedAt);
  if (editors.has(input.checkerUserId)) throw new HttpError(403, "You changed these figures after they were submitted, so you cannot be the one who approves them.", "CHECKER_EDITED_FIGURES");

  if (input.decision === "REJECT") {
    const note = (input.note ?? "").trim();
    if (note.length < 3) throw new HttpError(400, "Say why you are rejecting it.", "VALIDATION_ERROR");
    return finish(approval, { status: "REJECTED", checkerUserId: input.checkerUserId, decidedAt: new Date(), decisionNote: note }, "REJECTED", input); // allow-clock: an instant, not a business date
  }

  // The checker approves what they were shown. If the figures have moved since the maker submitted, that approval is void.
  const liveHash = await adapter.hash(approval.subjectId);
  if (liveHash !== approval.contentHash) {
    await voidApproval(approval, "The figures changed after they were submitted.", input.checkerUserId);
    throw conflict("The figures changed after they were submitted, so this approval is void. They need to be submitted again.", "APPROVAL_VOIDED");
  }
  if (input.expectedHash !== undefined && input.expectedHash !== liveHash) throw new HttpError(409, "What you were looking at is not what is there now. Look at it again before you decide.", "PREVIEW_STALE");
  return finish(approval, { status: "APPROVED", checkerUserId: input.checkerUserId, decidedAt: new Date(), decisionNote: input.note?.trim() ?? null, hashAtDecision: liveHash }, "APPROVED", input); // allow-clock: an instant, not a business date
}

async function finish(approval: PayrollApproval, data: Prisma.PayrollApprovalUpdateManyMutationInput, event: string, input: DecideInput): Promise<PayrollApproval> {
  const result = await prisma.$transaction(async (tx) => {
    // Conditional on still being pending, so two checkers deciding at once cannot both win.
    const { count } = await tx.payrollApproval.updateMany({ where: { id: approval.id, status: "PENDING" }, data });
    if (count !== 1) throw conflict("Somebody else decided this a moment ago.", "APPROVAL_NOT_PENDING");
    await recordEvent({ subjectType: approval.subject, subjectId: approval.subjectId, type: event, actorUserId: input.checkerUserId, payload: { approvalId: approval.id, hash: approval.contentHash, note: input.note ?? null } }, tx);
    const decided = await tx.payrollApproval.findUniqueOrThrow({ where: { id: approval.id } });
    await input.inTransaction?.(tx, decided);
    return decided;
  });
  await writeAuditLog({ actorUserId: input.checkerUserId, action: `payroll.approval.${event.toLowerCase()}`, entityType: "PayrollApproval", entityId: approval.id, before: { status: approval.status }, after: { status: result.status, subject: approval.subject, subjectId: approval.subjectId, hash: approval.contentHash }, ipAddress: input.ip ?? null });
  return result;
}

export async function voidApproval(approval: PayrollApproval, reason: string, actorUserId: string | null, db: Db = prisma): Promise<boolean> {
  const { count } = await db.payrollApproval.updateMany({ where: { id: approval.id, status: { in: [...live] } }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason } }); // allow-clock: an instant, not a business date
  if (count !== 1) return false;
  await recordEvent({ subjectType: approval.subject, subjectId: approval.subjectId, type: "VOIDED", actorUserId, payload: { approvalId: approval.id, reason, hash: approval.contentHash } }, db);
  await adapters.get(approval.subject)?.onVoided?.(approval, reason, actorUserId, db);
  await writeAuditLog({ actorUserId, action: "payroll.approval.voided", entityType: "PayrollApproval", entityId: approval.id, before: { status: approval.status }, after: { status: "VOIDED", reason, subject: approval.subject, subjectId: approval.subjectId } });
  return true;
}

/** Void whatever is live for a subject (a mutation service calls this when it changes the figures). Returns whether anything was voided. */
export async function voidLive(subject: PayrollApprovalSubject, subjectId: string, reason: string, actorUserId: string | null, db: Db = prisma): Promise<boolean> {
  const a = await liveApproval(subject, subjectId, db);
  return a ? voidApproval(a, reason, actorUserId, db) : false;
}

/**
 * Called by every service that changes a subject's figures. Records who did it (so they cannot be the checker) and voids any live approval,
 * inside the caller's transaction when one is passed.
 */
export async function noteFiguresChanged(subject: PayrollApprovalSubject, subjectId: string, actorUserId: string, what: string, db: Db = prisma): Promise<{ voided: boolean }> {
  await recordEvent({ subjectType: subject, subjectId, type: "FIGURES_CHANGED", actorUserId, payload: { what } }, db);
  const voided = await voidLive(subject, subjectId, `The figures were changed: ${what}`, actorUserId, db);
  return { voided };
}

/**
 * The action an approval authorises asks for it here. The live hash must still equal the approved hash; otherwise the approval is void and the action
 * refuses. One use only.
 */
export async function consume(subject: PayrollApprovalSubject, subjectId: string, actorUserId: string, ip: string | null = null, db: Db = prisma): Promise<PayrollApproval> {
  const adapter = adapterFor(subject);
  const approval = await db.payrollApproval.findFirst({ where: { subject, subjectId, status: "APPROVED" } });
  if (!approval) throw new HttpError(409, "This has not been approved by a second person, so it cannot go ahead.", "APPROVAL_REQUIRED");
  const liveHash = await adapter.hash(subjectId);
  if (liveHash !== approval.hashAtDecision) {
    await voidApproval(approval, "The figures no longer match what was approved.", actorUserId); // outside `db`: a void must survive the caller's rollback
    throw conflict("The figures changed after they were approved, so the approval is void. They need to be submitted and approved again.", "APPROVAL_VOIDED");
  }
  const { count } = await db.payrollApproval.updateMany({ where: { id: approval.id, status: "APPROVED" }, data: { status: "CONSUMED", consumedAt: new Date(), consumedByUserId: actorUserId } }); // allow-clock: an instant, not a business date
  if (count !== 1) throw conflict("This approval was just used or voided.", "APPROVAL_VOIDED");
  await recordEvent({ subjectType: subject, subjectId, type: "CONSUMED", actorUserId, payload: { approvalId: approval.id, hash: liveHash } }, db);
  await writeAuditLog({ actorUserId, action: "payroll.approval.consumed", entityType: "PayrollApproval", entityId: approval.id, after: { subject, subjectId, hash: liveHash }, ipAddress: ip });
  return { ...approval, status: "CONSUMED" };
}

/**
 * For a subject whose "submission" and "decision" are one act by two people at one moment (confirming a rule: the author is the maker, the
 * confirmer the checker). Goes through the same table and the same checks, so a rule confirmation is a real maker-checker record.
 */
export async function recordCompletedApproval(
  input: { subject: PayrollApprovalSubject; subjectId: string; hash: string; makerUserId: string; checkerUserId: string; previewFingerprint: string; note: string },
  db: Db,
): Promise<PayrollApproval> {
  if (input.checkerUserId === input.makerUserId) throw new HttpError(403, "The person who wrote a value cannot be the one who confirms it. A different person must.", "CHECKER_IS_MAKER");
  const created = await db.payrollApproval.create({
    data: { subject: input.subject, subjectId: input.subjectId, contentHash: input.hash, makerUserId: input.makerUserId, previewFingerprint: input.previewFingerprint },
  });
  const decided = await db.payrollApproval.update({ where: { id: created.id }, data: { status: "APPROVED", checkerUserId: input.checkerUserId, decidedAt: new Date(), decisionNote: input.note, hashAtDecision: input.hash } }); // allow-clock: an instant, not a business date
  const consumed = await db.payrollApproval.update({ where: { id: decided.id }, data: { status: "CONSUMED", consumedAt: new Date(), consumedByUserId: input.checkerUserId } }); // allow-clock: an instant, not a business date
  await recordEvent({ subjectType: input.subject, subjectId: input.subjectId, type: "CONSUMED", actorUserId: input.checkerUserId, payload: { approvalId: consumed.id, hash: input.hash, maker: input.makerUserId } }, db);
  return consumed;
}

// ── Who can check: made visible, never a silent block ──

export interface Checker {
  userId: string;
  name: string;
}
export interface CheckerAvailability {
  /** People who could decide this right now: hold the checker permission, are not the maker, did not change the figures. */
  eligible: Checker[];
  /** People who hold the permission but are excluded here, and why. */
  excluded: Array<Checker & { reason: string }>;
  state: "NONE" | "ONE" | "MANY";
  message: string;
}

/** The pure part, so every state can be tested whatever users the database happens to hold. */
export function availabilityFrom(
  holders: Array<{ userId: string; name: string }>,
  opts: { makerUserId?: string | null; editors?: ReadonlySet<string>; affected?: ReadonlySet<string> } = {},
): CheckerAvailability {
  const eligible: Checker[] = [];
  const excluded: Array<Checker & { reason: string }> = [];
  for (const who of holders) {
    if (opts.makerUserId && who.userId === opts.makerUserId) excluded.push({ ...who, reason: "prepared this" });
    else if (opts.editors?.has(who.userId)) excluded.push({ ...who, reason: "changed these figures" });
    else if (opts.affected?.has(who.userId)) excluded.push({ ...who, reason: "is paid by this" });
    else eligible.push(who);
  }
  const state = eligible.length === 0 ? "NONE" : eligible.length === 1 ? "ONE" : "MANY";
  const message =
    state === "NONE"
      ? `Nobody can approve this right now${excluded.length ? ` (${excluded.map((e) => `${e.name} ${e.reason}`).join("; ")})` : ""}. A Super Admin needs to give another person the checker role. There is no way around this step.`
      : state === "ONE"
        ? `Only ${eligible[0]!.name} can approve this. Everything that needs a second person depends on them; appoint another checker so that it never waits on one person.`
        : `${eligible.length} people can approve this: ${eligible.map((e) => e.name).join(", ")}.`;
  return { eligible, excluded, state, message };
}

export async function checkerAvailability(subject: PayrollApprovalSubject, opts: { makerUserId?: string | null; subjectId?: string; since?: Date; affectedUserIds?: readonly string[]; checkerPermission?: string } = {}): Promise<CheckerAvailability> {
  const adapter = adapterFor(subject);
  // An owner's secret is confirmed with its own permission (payroll.identifiers.confirm, payroll.banklayout.confirm), so "who could confirm this" counts the people who hold that one.
  const holders = await activeUsersHoldingPermission(opts.checkerPermission ?? adapter.checkerPermission);
  const editors = opts.subjectId && opts.since ? await figureEditorsSince(subject, opts.subjectId, opts.since) : new Set<string>();
  const affected = new Set<string>(opts.affectedUserIds ?? (opts.subjectId && adapter.affectedUserIds ? await adapter.affectedUserIds(opts.subjectId) : []));
  const names = await namesOfUsers(holders.map((h) => h.userId));
  return availabilityFrom(
    holders.map((h) => ({ userId: h.userId, name: names.get(h.userId) ?? "Someone" })),
    { makerUserId: opts.makerUserId ?? null, editors, affected },
  );
}
