import type { DirectorChangeAction } from "@prisma/client";
import { DIRECTOR_ONLY_ROLE_CODES } from "@shared/constants/directorAuthority";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { writeAuditLog } from "../../lib/audit";
import { notifyAccessChanged } from "../../lib/accessChanged";
import { activeDirectors, isDirector, requireDirector, requireDirectorTwoFactor } from "../../lib/directorAuthority";
import { notifyDirectors } from "../../lib/notifyDirectors";
import { SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { raiseSecurityEvent, sendOutsideSecurityAlert } from "../../lib/securityAlerts";
import { assertSuperAdminRemains } from "../../lib/superAdminGuard";
import { HttpError } from "../../middleware/errorHandler";
import { disconnectUserSockets } from "../../realtime/emit";
import { revokeAllUserRefreshTokens } from "../auth/tokens";

// FIX-C2 (independent audit 2026-11-20, finding C2). The "two directors check each other" rule rests on there being exactly two directors, so who IS a director
// is itself a two-director decision. Creating a director (Super Admin), removing that status, changing a director's roles and turning off a director's portal
// access are proposed by one director and applied only when another director confirms. A third active director needs EVERY existing director (the proposer
// ticks "add a third director", every other director confirms). The number of active directors never falls below one. The database refuses a Super Admin
// role row added or removed outside an APPLIED change (trigger user_roles_zz_director_change_guard), so no route, import, seed or job can bypass this.

export interface DirectorChangeActor {
  userId: string;
  employeeId: string;
}
interface Meta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const ACTION_TEXT: Record<DirectorChangeAction, string> = {
  GRANT_SUPER_ADMIN: "make a director (Super Admin)",
  REVOKE_SUPER_ADMIN: "remove director (Super Admin) status from",
  ASSIGN_ROLE: "give a role to the director",
  REMOVE_ROLE: "take a role from the director",
  SUSPEND: "turn off portal access for the director",
  RESET_2FA: "reset two-step sign-in for the director",
  UNLOCK: "unlock the sign-in of the director",
};

async function labelOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { employee: { select: { employeeCode: true } } } });
  return u?.employee.employeeCode ?? "an employee";
}

/** True when this target's role change must go through a director change: the role is Super Admin, or the person is a director. */
export async function needsDirectorChange(targetUserId: string, roleCode: string): Promise<boolean> {
  return roleCode === SUPER_ADMIN_ROLE_CODE || (await isDirector(targetUserId));
}

export async function proposeDirectorChange(
  input: { action: DirectorChangeAction; targetUserId: string; roleCode?: string | null; reason: string; thirdDirector?: boolean },
  actor: DirectorChangeActor,
  meta: Meta,
) {
  await requireDirector(actor.userId, "propose a change to who is a director");
  await requireDirectorTwoFactor(actor.userId);
  const target = await prisma.user.findUnique({ where: { id: input.targetUserId }, include: { roles: { include: { role: true } } } });
  if (!target) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const held = target.roles.map((r) => r.role.code);
  const directors = await activeDirectors();
  if (input.action === "GRANT_SUPER_ADMIN") {
    if (held.includes(SUPER_ADMIN_ROLE_CODE)) throw new HttpError(409, "This person is already a director.", "ALREADY_DIRECTOR");
    if (held.includes(DEVELOPER_ROLE_CODE)) throw new HttpError(403, "Nobody can be both a developer and a Super Admin.", "DEVELOPER_CEILING");
    if (target.status === "DEACTIVATED" || target.status === "SUSPENDED") throw new HttpError(409, "This person's account is not active.", "NOT_ACTIVE");
    if (directors.length >= 2 && !input.thirdDirector) {
      throw new HttpError(409, `There are already ${directors.length} directors. Adding another needs every existing director: tick "add a third director" and every other director confirms.`, "THIRD_DIRECTOR_NEEDS_ALL");
    }
  } else {
    if (!held.includes(SUPER_ADMIN_ROLE_CODE)) throw new HttpError(409, "This person is not a director.", "NOT_DIRECTOR");
    if (input.action === "REVOKE_SUPER_ADMIN" || input.action === "SUSPEND") await assertSuperAdminRemains(target.id);
    if ((input.action === "RESET_2FA" || input.action === "UNLOCK") && target.id === actor.userId) throw new HttpError(403, "Use your own account security settings for this.", "SELF");
    if (input.action === "ASSIGN_ROLE" || input.action === "REMOVE_ROLE") {
      if (!input.roleCode || input.roleCode === SUPER_ADMIN_ROLE_CODE) throw new HttpError(400, "Name the role.", "VALIDATION_ERROR");
      if (!(await prisma.role.findUnique({ where: { code: input.roleCode } }))) throw new HttpError(404, "Role not found.", "NOT_FOUND");
      if (input.roleCode === DEVELOPER_ROLE_CODE) throw new HttpError(403, "Nobody can be both a developer and a Super Admin.", "DEVELOPER_CEILING");
      if ((DIRECTOR_ONLY_ROLE_CODES as readonly string[]).includes(input.roleCode) && input.action === "ASSIGN_ROLE") throw new HttpError(403, "The payroll roles are given to nobody.", "PAYROLL_ROLE_NOT_ASSIGNABLE");
    }
  }
  const duplicate = await prisma.directorRoleChange.findFirst({ where: { status: "PENDING", targetUserId: target.id, action: input.action, roleCode: input.roleCode ?? null } });
  if (duplicate) throw new HttpError(409, "The same change is already waiting for confirmation.", "ALREADY_PENDING");
  const row = await prisma.directorRoleChange.create({
    data: { action: input.action, targetUserId: target.id, roleCode: input.roleCode ?? null, reason: input.reason, thirdDirectorAcknowledged: input.thirdDirector === true, proposedByUserId: actor.userId },
  });
  const who = await labelOf(target.id);
  const text = `${ACTION_TEXT[input.action]} ${who}${input.roleCode ? ` (${input.roleCode})` : ""}`;
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, action: "director.role_change.proposed", entityType: "DirectorRoleChange", entityId: row.id, after: { action: input.action, targetUserId: target.id, roleCode: input.roleCode ?? null, reason: input.reason } });
  await notifyDirectors({ type: "director.role_change_pending", title: "A change to who is a director waits for confirmation", body: `A director proposed to ${text}. It takes effect only when ${directors.length >= 2 && input.action === "GRANT_SUPER_ADMIN" ? "every other director confirms" : "the other director confirms"}.`, link: "/admin/admin-tools/confirmations", payload: { changeId: row.id } });
  await raiseSecurityEvent({ kind: "director.role_change_proposed", targetUserId: actor.userId, summary: `A director proposed to ${text}.`, details: { changeId: row.id, action: input.action } });
  // FIX-M6: a director-on-director security action always alerts the outside mailbox, when proposed and when applied.
  if (input.action === "RESET_2FA" || input.action === "UNLOCK") await sendOutsideSecurityAlert(`A director proposed to ${ACTION_TEXT[input.action]} ${who}`, [["Change", text], ["Reason", input.reason], ["Status", "Waits for the other director's confirmation"]]);
  return { pendingConfirmation: true as const, id: row.id, action: input.action };
}

/** The confirmations that make a change apply: at least one director other than the proposer; for a director added beyond the second, every other active director. */
function satisfied(action: DirectorChangeAction, proposer: string, confirmed: string[], directors: string[], third: boolean): boolean {
  if (confirmed.length === 0) return false;
  if (action === "GRANT_SUPER_ADMIN" && (third || directors.length >= 2)) return directors.filter((d) => d !== proposer).every((d) => confirmed.includes(d));
  return true;
}

export async function confirmDirectorChange(id: string, actor: DirectorChangeActor, meta: Meta) {
  await requireDirector(actor.userId, "confirm a change to who is a director");
  await requireDirectorTwoFactor(actor.userId);
  const outcome = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM director_role_changes WHERE id = ${id} FOR UPDATE`;
    if (!locked) throw new HttpError(404, "There is no such change.", "NOT_FOUND");
    const c = await tx.directorRoleChange.findUniqueOrThrow({ where: { id } });
    if (c.status !== "PENDING") throw new HttpError(409, "This change has already been decided.", "ALREADY_DECIDED");
    if (c.proposedByUserId === actor.userId) throw new HttpError(403, "You proposed this, so the other director confirms it.", "CHECKER_IS_MAKER");
    if (c.confirmedByUserIds.includes(actor.userId)) throw new HttpError(409, "You have already confirmed this change.", "ALREADY_CONFIRMED");
    const confirmed = [...c.confirmedByUserIds, actor.userId];
    const directors = (await activeDirectors(tx)).map((d) => d.userId);
    if (!satisfied(c.action, c.proposedByUserId, confirmed, directors, c.thirdDirectorAcknowledged)) {
      await tx.directorRoleChange.update({ where: { id }, data: { confirmedByUserIds: confirmed } });
      return { applied: false as const, c };
    }
    await tx.directorRoleChange.update({ where: { id }, data: { confirmedByUserIds: confirmed, status: "APPLIED", decidedByUserId: actor.userId, decidedAt: new Date() } });
    await tx.$executeRawUnsafe("SELECT set_config('app.director_change', $1, true)", id);
    const target = await tx.user.findUniqueOrThrow({ where: { id: c.targetUserId } });
    const role = async (code: string) => tx.role.findUniqueOrThrow({ where: { code } });
    if (c.action === "GRANT_SUPER_ADMIN") {
      await tx.userRole.create({ data: { userId: target.id, roleId: (await role(SUPER_ADMIN_ROLE_CODE)).id, assignedByUserId: actor.userId } });
    } else if (c.action === "REVOKE_SUPER_ADMIN") {
      const others = await tx.userRole.count({ where: { userId: { not: target.id }, role: { code: SUPER_ADMIN_ROLE_CODE }, user: { status: "ACTIVE" } } });
      if (others === 0) throw new HttpError(409, "This is the last active director.", "LAST_SUPER_ADMIN");
      await tx.userRole.deleteMany({ where: { userId: target.id, role: { code: { in: [SUPER_ADMIN_ROLE_CODE, ...DIRECTOR_ONLY_ROLE_CODES] } } } });
    } else if (c.action === "ASSIGN_ROLE") {
      await tx.userRole.upsert({ where: { userId_roleId: { userId: target.id, roleId: (await role(c.roleCode!)).id } }, create: { userId: target.id, roleId: (await role(c.roleCode!)).id, assignedByUserId: actor.userId }, update: {} });
    } else if (c.action === "REMOVE_ROLE") {
      await tx.userRole.deleteMany({ where: { userId: target.id, role: { code: c.roleCode! } } });
    } else if (c.action === "SUSPEND") {
      const others = await tx.userRole.count({ where: { userId: { not: target.id }, role: { code: SUPER_ADMIN_ROLE_CODE }, user: { status: "ACTIVE" } } });
      if (others === 0) throw new HttpError(409, "This is the last active director.", "LAST_SUPER_ADMIN");
      await tx.user.update({ where: { id: target.id }, data: { status: "SUSPENDED" } });
    }
    // RESET_2FA and UNLOCK are carried out after the transaction (they write through the auth service), below.
    return { applied: true as const, c, target };
  });
  const who = await labelOf(outcome.c.targetUserId);
  const text = `${ACTION_TEXT[outcome.c.action]} ${who}${outcome.c.roleCode ? ` (${outcome.c.roleCode})` : ""}`;
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, action: outcome.applied ? "director.role_change.applied" : "director.role_change.confirmed", entityType: "DirectorRoleChange", entityId: id, after: { action: outcome.c.action, targetUserId: outcome.c.targetUserId, roleCode: outcome.c.roleCode, proposedBy: outcome.c.proposedByUserId } });
  if (!outcome.applied) return { applied: false as const, id, waitingFor: "every other director" };
  if (outcome.c.action === "SUSPEND") await revokeAllUserRefreshTokens(outcome.target.id);
  if (outcome.c.action === "RESET_2FA" || outcome.c.action === "UNLOCK") {
    const { adminResetTotp, adminUnlock } = await import("../auth/service");
    const securityMeta = { actorUserId: actor.userId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, reason: outcome.c.reason };
    if (outcome.c.action === "RESET_2FA") await adminResetTotp(outcome.target.id, securityMeta as never);
    else await adminUnlock(outcome.target.id, securityMeta as never);
    await sendOutsideSecurityAlert(`A director's ${outcome.c.action === "RESET_2FA" ? "two-step sign-in was reset" : "sign-in was unlocked"} (confirmed by a second director)`, [["Change", text], ["Reason", outcome.c.reason]]);
  }
  disconnectUserSockets(outcome.target.employeeId); // FIX-M2: any change to a director's roles or access reconnects their screens
  await notifyAccessChanged([outcome.target]);
  await notifyDirectors({ type: "director.role_change_applied", title: "A change to who is a director took effect", body: `Confirmed by a second director: ${text}.`, link: "/admin/admin-tools/confirmations", payload: { changeId: id } });
  await raiseSecurityEvent({ kind: "director.role_change_applied", targetUserId: actor.userId, summary: `A change to who is a director took effect: ${text}.`, details: { changeId: id, action: outcome.c.action } });
  return { applied: true as const, id };
}

export async function rejectDirectorChange(id: string, note: string, actor: DirectorChangeActor, meta: Meta) {
  await requireDirector(actor.userId, "turn down a change to who is a director");
  const { count } = await prisma.directorRoleChange.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionNote: note } });
  if (count === 0) throw new HttpError(409, "This change has already been decided, or does not exist.", "ALREADY_DECIDED");
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, action: "director.role_change.rejected", entityType: "DirectorRoleChange", entityId: id, after: { note } });
  await notifyDirectors({ type: "director.role_change_rejected", title: "A proposed change to who is a director was turned down", body: note, link: "/admin/admin-tools/confirmations", payload: { changeId: id } });
  return { id, status: "REJECTED" as const };
}

export async function listDirectorChanges(actor: DirectorChangeActor) {
  await requireDirector(actor.userId, "see changes to who is a director");
  const rows = await prisma.directorRoleChange.findMany({ orderBy: { proposedAt: "desc" }, take: 50 });
  const out = [];
  for (const r of rows) {
    out.push({
      id: r.id,
      action: r.action,
      status: r.status,
      target: await labelOf(r.targetUserId),
      roleCode: r.roleCode,
      reason: r.reason,
      proposedAt: r.proposedAt.toISOString(),
      mine: r.proposedByUserId === actor.userId,
      confirmations: r.confirmedByUserIds.length,
      canConfirm: r.status === "PENDING" && r.proposedByUserId !== actor.userId && !r.confirmedByUserIds.includes(actor.userId),
      canReject: r.status === "PENDING",
      decidedAt: r.decidedAt?.toISOString() ?? null,
    });
  }
  return { changes: out };
}
