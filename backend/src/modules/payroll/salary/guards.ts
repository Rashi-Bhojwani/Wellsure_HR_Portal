import { randomUUID } from "node:crypto";
import { writeAuditLog } from "../../../lib/audit";
import { isDirector } from "../../../lib/directorAuthority";
import { recordDirectorNotice, scheduleDelivery } from "../../../lib/directorNotices";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";

// Superseded 2026-11-20 (independent audit, H4/T1): a director may PROPOSE a change to their own pay; the OTHER director confirms it (see assertNotOwnPay).
// Earlier owner decision (Stage 3 review): a DIRECTOR may set their own pay. It is never silent: each such act is audited, tagged as a self-change, and announced to the other
// director (counts only: the notice names no figure and no person) with the same red banner after three days unacknowledged as any other director act. Anybody who is
// not a director still cannot change their own pay, whatever else they hold.

/** The employee record a user is, if any. */
export async function employeeIdOfUser(userId: string): Promise<string | null> {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } }))?.employeeId ?? null;
}

/** The users behind these employee records. */
export async function userIdsOfEmployees(employeeIds: readonly string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  return (await prisma.user.findMany({ where: { employeeId: { in: [...employeeIds] } }, select: { id: true } })).map((u) => u.id);
}

/**
 * An act that touches the actor's own pay. A director's is allowed and recorded: one audit row tagged SELF_CHANGE and one notice to the other director, written together
 * (the notice carries no amount, no name and no identifier). It is raised when the act begins, so an act that then fails still leaves a record that it was tried.
 */
export async function recordSelfPayChange(actorUserId: string, what: string): Promise<void> {
  const ref = `self-pay-${randomUUID()}`;
  const { noticeId } = await prisma.$transaction(async (tx) =>
    recordDirectorNotice({ kind: "ACTION", step: "SALARY_REVISION", subjectType: "SELF_PAY_CHANGE", subjectId: ref, subjectLabel: "a change to their own pay", actorUserId, detail: { tag: "SELF_CHANGE", what } }, tx).then(async (n) => {
      await writeAuditLog({ actorUserId, action: "payroll.self_pay_change", entityType: "PayrollSelfPayChange", entityId: ref, after: { tag: "SELF_CHANGE", what, amounts: "redacted" } });
      return n;
    }),
  );
  await scheduleDelivery(noticeId);
}

/**
 * FIX-H4/T1 (independent audit 2026-11-20): a director is never the only approver of a change to their own pay. Refuses when `employeeIds` includes the actor's own
 * record, except a director's PROPOSAL (`proposal: true`: a revision, a month's inputs, carrying out a revision the other director approved), which is allowed and
 * recorded (recordSelfPayChange) because the other director decides it. A one-person act on one's own pay (a hold, an adjustment, an override, an exclusion, a
 * correction) is refused for a director too: the other director does it.
 */
export async function assertNotOwnPay(actorUserId: string, employeeIds: readonly string[], what: string, opts: { proposal?: boolean } = {}): Promise<void> {
  const own = await employeeIdOfUser(actorUserId);
  if (!own || !employeeIds.includes(own)) return;
  if (!(await isDirector(actorUserId))) {
    throw new HttpError(403, `${what} would change your own pay. Only a director may do that; somebody else has to do it for you.`, "SELF_PAY");
  }
  if (!opts.proposal) {
    throw new HttpError(403, `${what} would change your own pay. The other director does this for you: a director is never the only one to decide their own pay.`, "SELF_PAY_OTHER_DIRECTOR");
  }
  await recordSelfPayChange(actorUserId, what);
}
