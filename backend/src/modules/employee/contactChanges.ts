import type { ContactChangeKind, Prisma } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit";
import { isDirector, requireDirector, requireDirectorTwoFactor } from "../../lib/directorAuthority";
import { inForceOn } from "../../lib/effectiveDating";
import { logger } from "../../lib/logger";
import { notifyDirectors } from "../../lib/notifyDirectors";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { sendSecurityChangeNoticeEmail } from "../auth/emails";
import { behaviourValue } from "../behaviours/service";

// FIX-C1 (independent audit 2026-11-20, finding C1). The audit's attack: HR changed a director's personal email (the address sign-in and password-reset links
// go to), asked for a reset from the public "forgot password" page and signed in as the director. Now:
//   - nobody below a director changes the sign-in email of ANY account: the change is held here until a director (not the proposer, not the person) confirms;
//     for an ordinary employee this is the setting "auth.loginEmailChangeNeedsDirector" (on by default; off, a director's own change applies at once, HR's
//     still waits);
//   - nobody changes ANY contact or identity field of a director except that director, and then only with the OTHER director's confirmation;
//   - every such change emails the OLD address (when proposed and when applied) and gives both directors an in-app notice.

export const PERSONAL_FIELDS = ["mobile", "personalEmail", "bloodGroup", "currentAddress", "permanentAddress", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation"] as const;
type PersonalInput = Partial<Record<(typeof PERSONAL_FIELDS)[number], string | null>>;
export interface ContactMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const LABEL: Record<ContactChangeKind, string> = { LOGIN_EMAIL: "sign-in email", DIRECTOR_RECORD: "director's contact or identity details" };

async function targetOf(employeeId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true, personal: true, nameHistory: { where: inForceOn() } } });
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const director = employee.user ? await isDirector(employee.user.id) : false;
  return { employee, user: employee.user, director, name: employee.nameHistory[0]?.fullName ?? employee.employeeCode, oldEmail: employee.personal?.personalEmail?.trim() || null };
}

async function tellOldAddress(oldEmail: string | null, name: string, what: string): Promise<void> {
  if (!oldEmail) return;
  await sendSecurityChangeNoticeEmail(oldEmail, name, what, "the HR portal", "If you did not ask for this, tell a director at once.").catch((err: unknown) => logger.error({ err }, "failed to send the old-address notice"));
}

async function record(kind: ContactChangeKind, employeeId: string, targetUserId: string | null, changes: Record<string, unknown>, source: string, proposedByUserId: string, meta: ContactMeta, t: Awaited<ReturnType<typeof targetOf>>) {
  const row = await prisma.contactChangeRequest.create({ data: { kind, employeeId, targetUserId, changes: changes as Prisma.InputJsonValue, source, proposedByUserId } });
  await writeAuditLog({ ...meta, action: "contact.change.proposed", entityType: "ContactChangeRequest", entityId: row.id, after: { kind, employeeId, fields: Object.keys(changes), source } });
  await tellOldAddress(t.oldEmail, t.name, `A change to your ${LABEL[kind]} was requested. It takes effect only when a director confirms it`);
  await notifyDirectors({ type: "security.contact_change_pending", title: `A change to a ${LABEL[kind]} waits for confirmation`, body: `Employee ${t.employee.employeeCode}: ${Object.keys(changes).join(", ")}. It takes effect only when ${kind === "DIRECTOR_RECORD" ? "the other director" : "a director who did not make it"} confirms it.`, link: "/admin/admin-tools/confirmations", payload: { requestId: row.id } });
  return row.id;
}

/**
 * Splits a personal-details update into what may be written now and what must wait. Throws when the actor may not change it at all. Returns the fields to
 * write now and, when something was held, the request id (the caller answers 202).
 */
export async function routePersonalUpdate(employeeId: string, input: PersonalInput, meta: ContactMeta, source: string, opts: { requestedBySelf?: boolean } = {}): Promise<{ direct: PersonalInput; pendingId: string | null }> {
  const t = await targetOf(employeeId);
  const changed = Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && (t.employee.personal as Record<string, unknown> | null)?.[k] !== v)) as PersonalInput;
  if (Object.keys(changed).length === 0) return { direct: {}, pendingId: null };
  const actorIsTarget = t.user?.id === meta.actorUserId;
  if (t.director) {
    // A director's record: only that director proposes (their own change request, approved by HR, counts as theirs); the other director confirms.
    if (!actorIsTarget && !opts.requestedBySelf) throw new HttpError(403, "Only a director can change their own contact and identity details, and the other director confirms it.", "DIRECTOR_RECORD_SELF_ONLY");
    const id = await record("DIRECTOR_RECORD", employeeId, t.user!.id, changed, source, t.user!.id, meta, t);
    return { direct: {}, pendingId: id };
  }
  if (changed.personalEmail === undefined || (changed.personalEmail ?? "").toLowerCase() === (t.oldEmail ?? "").toLowerCase()) return { direct: changed, pendingId: null };
  const { personalEmail, ...rest } = changed;
  const needsDirector = (await behaviourValue("auth.loginEmailChangeNeedsDirector")).value;
  const actorIsDirector = !actorIsTarget && (await isDirector(meta.actorUserId));
  if (!needsDirector && actorIsDirector) {
    await tellOldAddress(t.oldEmail, t.name, "Your sign-in email was changed by a director");
    await notifyDirectors({ type: "security.contact_change_applied", title: "A sign-in email was changed", body: `Employee ${t.employee.employeeCode}: changed by a director (the setting lets a director change it without a second confirmation).`, link: "/admin/admin-tools/confirmations" });
    return { direct: changed, pendingId: null };
  }
  const id = await record("LOGIN_EMAIL", employeeId, t.user?.id ?? null, { personalEmail }, source, meta.actorUserId, meta, t);
  return { direct: rest, pendingId: id };
}

/** A director's name: only that director proposes, the other confirms (applied through the employee service's own name history). */
export async function routeDirectorName(employeeId: string, body: Record<string, unknown>, meta: ContactMeta): Promise<string | null> {
  const t = await targetOf(employeeId);
  if (!t.director) return null;
  if (t.user?.id !== meta.actorUserId) throw new HttpError(403, "Only a director can change their own contact and identity details, and the other director confirms it.", "DIRECTOR_RECORD_SELF_ONLY");
  return record("DIRECTOR_RECORD", employeeId, t.user.id, { name: body }, "NAME", t.user.id, meta, t);
}

/** Bank, PAN, Aadhaar, UAN and ESI of a director are entered only by that director (their entry already waits for the other director: identityChanges.ts). */
export async function refuseOthersOnDirectorIdentity(employeeId: string, actorUserId: string): Promise<void> {
  const t = await targetOf(employeeId);
  if (t.director && t.user?.id !== actorUserId) throw new HttpError(403, "Only a director can change their own contact and identity details, and the other director confirms it.", "DIRECTOR_RECORD_SELF_ONLY");
}

export async function confirmContactChange(id: string, actorUserId: string, meta: ContactMeta) {
  await requireDirector(actorUserId, "confirm a change to a sign-in email or a director's details");
  await requireDirectorTwoFactor(actorUserId);
  const row = await prisma.contactChangeRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "There is no such change.", "NOT_FOUND");
  if (row.status !== "PENDING") throw new HttpError(409, "This change has already been decided.", "ALREADY_DECIDED");
  if (row.proposedByUserId === actorUserId) throw new HttpError(403, "You made this change, so a different director confirms it.", "CHECKER_IS_MAKER");
  if (row.targetUserId === actorUserId) throw new HttpError(403, "This change is to your own record, so the other director confirms it.", "CHECKER_IS_TARGET");
  const t = await targetOf(row.employeeId);
  const changes = row.changes as Record<string, unknown>;
  const { count } = await prisma.contactChangeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPLIED", decidedByUserId: actorUserId, decidedAt: new Date() } });
  if (count === 0) throw new HttpError(409, "This change has already been decided.", "ALREADY_DECIDED");
  const { name, ...personal } = changes as { name?: Record<string, unknown> } & PersonalInput;
  if (Object.keys(personal).length) await prisma.employeePersonal.update({ where: { employeeId: row.employeeId }, data: personal as Prisma.EmployeePersonalUpdateInput });
  if (name) {
    const { updateName } = await import("./service");
    await updateName(row.employeeId, name as never, { ...meta, actorUserId });
  }
  await writeAuditLog({ ...meta, actorUserId, action: "contact.change.applied", entityType: "ContactChangeRequest", entityId: id, after: { kind: row.kind, employeeId: row.employeeId, fields: Object.keys(changes), proposedBy: row.proposedByUserId } });
  await tellOldAddress(t.oldEmail, t.name, `Your ${LABEL[row.kind]} was changed (confirmed by a director)`);
  await notifyDirectors({ type: "security.contact_change_applied", title: `A change to a ${LABEL[row.kind]} took effect`, body: `Employee ${t.employee.employeeCode}: ${Object.keys(changes).join(", ")}, confirmed by a director.`, link: "/admin/admin-tools/confirmations", payload: { requestId: id } });
  return { id, status: "APPLIED" as const };
}

export async function rejectContactChange(id: string, note: string, actorUserId: string, meta: ContactMeta) {
  const row = await prisma.contactChangeRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "There is no such change.", "NOT_FOUND");
  if (!(await isDirector(actorUserId)) && row.proposedByUserId !== actorUserId) throw new HttpError(403, "Only a director, or the person who made it, can turn down this change.", "FORBIDDEN");
  const { count } = await prisma.contactChangeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note } });
  if (count === 0) throw new HttpError(409, "This change has already been decided.", "ALREADY_DECIDED");
  await writeAuditLog({ ...meta, actorUserId, action: "contact.change.rejected", entityType: "ContactChangeRequest", entityId: id, after: { note } });
  return { id, status: "REJECTED" as const };
}

/** Directors see every held change; anyone else only the ones they made. Values are never shown, only which fields would change. */
export async function listContactChanges(actorUserId: string) {
  const director = await isDirector(actorUserId);
  const rows = await prisma.contactChangeRequest.findMany({ where: director ? {} : { proposedByUserId: actorUserId }, orderBy: { proposedAt: "desc" }, take: 100 });
  const codes = new Map((await prisma.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, employeeCode: true } })).map((e) => [e.id, e.employeeCode]));
  return {
    changes: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      employeeCode: codes.get(r.employeeId) ?? "",
      fields: Object.keys(r.changes as object),
      source: r.source,
      proposedAt: r.proposedAt.toISOString(),
      mine: r.proposedByUserId === actorUserId,
      aboutMe: r.targetUserId === actorUserId,
      canConfirm: director && r.status === "PENDING" && r.proposedByUserId !== actorUserId && r.targetUserId !== actorUserId,
      canReject: r.status === "PENDING" && (director || r.proposedByUserId === actorUserId),
    })),
  };
}
