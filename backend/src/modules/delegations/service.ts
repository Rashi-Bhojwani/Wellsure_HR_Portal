import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { activeUsersHoldingPermission, resolveAccess } from "../../lib/permissions";
import { HttpError } from "../../middleware/errorHandler";
import { emitDelegationChanged, emitTasksCounts } from "../../realtime/emit";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { inForceOn } from "../../lib/effectiveDating";

// Workflow Delegates (Phase 5 commit E3; docs/plans/PHASE_5.md §E3).
// A manager's leave approvals covered by someone else for a date range.
// The rules live here; what a delegation *reaches* lives in ./reach.ts.

export interface Meta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type DelegationStatus = "SCHEDULED" | "ACTIVE" | "ENDED" | "REVOKED";

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export function statusOf(row: { startDate: Date; endDate: Date; revokedAt: Date | null }, today: Date = businessToday()): DelegationStatus {
  if (row.revokedAt) return "REVOKED";
  if (row.startDate.getTime() > today.getTime()) return "SCHEDULED";
  if (row.endDate.getTime() < today.getTime()) return "ENDED";
  return "ACTIVE";
}

const personSelect = () => ({
  id: true,
  employeeId: true,
  status: true,
  employee: {
    select: {
      employeeCode: true,
      nameHistory: { where: inForceOn(), select: { fullName: true } },
      jobHistory: { where: inForceOn(), select: { designation: { select: { name: true } }, department: { select: { name: true } } } },
    },
  },
} satisfies Prisma.UserSelect);

type PersonRow = Prisma.UserGetPayload<{ select: ReturnType<typeof personSelect> }>;

function person(u: PersonRow) {
  const job = u.employee.jobHistory[0];
  return {
    userId: u.id,
    employeeId: u.employeeId,
    employeeCode: u.employee.employeeCode,
    name: u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode,
    designation: job?.designation?.name ?? null,
    department: job?.department?.name ?? null,
  };
}

const rowInclude = () => ({ delegator: { select: personSelect() }, delegate: { select: personSelect() } } satisfies Prisma.WorkflowDelegateInclude);
type DelegationRecord = Prisma.WorkflowDelegateGetPayload<{ include: ReturnType<typeof rowInclude> }>;

async function format(rows: DelegationRecord[]) {
  const today = businessToday();
  const approvers = new Set((await activeUsersHoldingPermission("leave.approve")).map((u) => u.userId));
  const actorIds = [...new Set(rows.flatMap((r) => [r.createdByUserId, r.revokedByUserId]).filter((x): x is string => !!x))];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: personSelect() })).map((u) => [u.id, person(u).name]));
  const out = [];
  for (const r of rows) {
    // What the delegate did on the delegator's behalf inside this
    // delegation — "what happened while I was away".
    const actionsOnBehalf = await prisma.auditLog.count({
      where: { actorUserId: r.delegateUserId, onBehalfOfUserId: r.delegatorUserId, createdAt: { gte: r.createdAt, ...(r.revokedAt ? { lte: r.revokedAt } : {}) } },
    });
    out.push({
      id: r.id,
      delegator: person(r.delegator),
      delegate: person(r.delegate),
      startDate: dateOnly(r.startDate),
      endDate: dateOnly(r.endDate),
      reason: r.reason,
      status: statusOf(r, today),
      // A delegate who no longer holds leave.approve (or isn't active) can't
      // act on it — flagged on screen rather than silently ignored.
      delegateCanApprove: r.delegate.status === "ACTIVE" && approvers.has(r.delegateUserId),
      actionsOnBehalf,
      createdAt: r.createdAt.toISOString(),
      createdBy: actors.get(r.createdByUserId) ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokedBy: r.revokedByUserId ? (actors.get(r.revokedByUserId) ?? null) : null,
      revokeReason: r.revokeReason,
    });
  }
  const rank: Record<DelegationStatus, number> = { ACTIVE: 0, SCHEDULED: 1, ENDED: 2, REVOKED: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.startDate.localeCompare(a.startDate));
}

export type DelegationRow = Awaited<ReturnType<typeof format>>[number];

async function roleCodesOfUser(userId: string): Promise<string[]> {
  return (await prisma.userRole.findMany({ where: { userId }, select: { role: { select: { code: true } } } })).map((r) => r.role.code);
}

// ── Reads ────────────────────────────────────────────────────────────

export async function listMine(userId: string) {
  const [given, covering, roles] = await Promise.all([
    prisma.workflowDelegate.findMany({ where: { delegatorUserId: userId }, include: rowInclude() }),
    prisma.workflowDelegate.findMany({ where: { delegateUserId: userId }, include: rowInclude() }),
    roleCodesOfUser(userId),
  ]);
  const covered = (await format(covering)).filter((r) => r.status === "ACTIVE" || r.status === "SCHEDULED");
  return { canDelegate: roles.includes("MANAGER"), notAllowedReason: notAllowedReason(roles), given: await format(given), covering: covered };
}

export async function listAll(status?: DelegationStatus) {
  const rows = await format(await prisma.workflowDelegate.findMany({ include: rowInclude() }));
  return status ? rows.filter((r) => r.status === status) : rows;
}

// Who a delegator may pick: every other active user who currently holds
// leave.approve. Only a manager gets rows (nobody else can delegate).
export async function delegateOptions(delegatorUserId: string) {
  if (!(await roleCodesOfUser(delegatorUserId)).includes("MANAGER")) return [];
  const approvers = (await activeUsersHoldingPermission("leave.approve")).filter((u) => u.userId !== delegatorUserId);
  const users = await prisma.user.findMany({ where: { id: { in: approvers.map((a) => a.userId) } }, select: { ...personSelect(), roles: { select: { role: { select: { name: true } } } } } });
  return users
    .map((u) => ({ ...person(u), roles: u.roles.map((r) => r.role.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Managers HR can set a delegation up for.
export async function delegatorOptions() {
  const users = await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: "MANAGER" } } } }, select: personSelect() });
  return users.map(person).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Writes ───────────────────────────────────────────────────────────

// Why someone who isn't a manager can't delegate — model A (spec §2.1):
// see docs/plans/PHASE_5.md §E3 "Can a Super Admin delegate?".
function notAllowedReason(roles: string[]): string | null {
  if (roles.includes("MANAGER")) return null;
  if (roles.includes("SUPER_ADMIN")) return "Super Admins don't delegate: the two Super Admins already cover each other, and HR Admins can approve any manager's leave.";
  if (roles.includes("HR_ADMIN")) return "HR Admins don't have a team to delegate: their approvals already reach everyone, and a Super Admin decides their own leave.";
  return "Only managers delegate their approvals.";
}

export interface CreateInput {
  delegatorUserId: string;
  delegateUserId: string;
  startDate: string; // YYYY-MM-DD, inclusive
  endDate: string; // YYYY-MM-DD, inclusive
  reason?: string | null;
}

export async function createDelegation(input: CreateInput, meta: Meta) {
  const [delegator, delegate] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.delegatorUserId }, select: personSelect() }),
    prisma.user.findUnique({ where: { id: input.delegateUserId }, select: personSelect() }),
  ]);
  if (!delegator || delegator.status !== "ACTIVE") throw new HttpError(404, "That person isn't an active user.", "NOT_FOUND");
  const reason = notAllowedReason(await roleCodesOfUser(delegator.id));
  if (reason) throw new HttpError(409, reason, "NOT_A_MANAGER");
  if (!delegate || delegate.status !== "ACTIVE") throw new HttpError(400, "The delegate must be an active user.", "INVALID_DELEGATE");
  if (delegate.id === delegator.id) throw new HttpError(400, "A manager can't delegate to themselves.", "INVALID_DELEGATE");
  // Delegation never grants a permission: the delegate must already be able
  // to approve leave (role or override).
  if (!(await resolveAccess(delegate.id)).permissions.has("leave.approve")) {
    throw new HttpError(400, `${person(delegate).name} can't approve leave themselves, so they can't cover someone else's approvals. Give them the permission first, or pick someone who has it.`, "DELEGATE_CANNOT_APPROVE");
  }

  const today = businessToday();
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  if (startDate.getTime() < today.getTime()) throw new HttpError(400, "A delegation can't start in the past.", "PAST_START");
  if (endDate.getTime() < startDate.getTime()) throw new HttpError(400, "The end date is before the start date.", "INVALID_RANGE");

  const created = await prisma.$transaction(async (tx) => {
    // One delegator at a time: two simultaneous requests can't both pass the
    // overlap check.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${delegator.id} FOR UPDATE`;
    const overlap = await tx.workflowDelegate.findFirst({
      where: { delegatorUserId: delegator.id, revokedAt: null, startDate: { lte: endDate }, endDate: { gte: startDate } },
      include: { delegate: { select: personSelect() } },
    });
    if (overlap) {
      throw new HttpError(409, `This overlaps an existing delegation to ${person(overlap.delegate).name} (${dateOnly(overlap.startDate)} to ${dateOnly(overlap.endDate)}). Revoke that one first, or pick other dates.`, "OVERLAPPING_DELEGATION");
    }
    return tx.workflowDelegate.create({
      data: { delegatorUserId: delegator.id, delegateUserId: delegate.id, startDate, endDate, reason: input.reason?.trim() || null, createdByUserId: meta.actorUserId },
      include: rowInclude(),
    });
  });

  await writeAuditLog({
    ...meta,
    action: "delegation.created",
    entityType: "WorkflowDelegate",
    entityId: created.id,
    after: { delegatorUserId: delegator.id, delegateUserId: delegate.id, startDate: input.startDate, endDate: input.endDate, reason: created.reason },
  });
  const from = person(delegator).name;
  await notifyEmployee(delegate.employeeId, {
    type: "delegation.created",
    title: "You're covering approvals",
    body: `${from}'s leave approvals come to you from ${input.startDate} to ${input.endDate}.`,
    link: "/app/workflow-delegates",
    payload: { delegationId: created.id },
  });
  if (meta.actorUserId !== delegator.id) {
    await notifyEmployee(delegator.employeeId, {
      type: "delegation.created",
      title: "Your approvals were delegated",
      body: `HR set up ${person(delegate).name} to cover your leave approvals from ${input.startDate} to ${input.endDate}.`,
      link: "/app/workflow-delegates",
      payload: { delegationId: created.id },
    });
  }
  emitDelegationChanged([delegator.employeeId, delegate.employeeId]);
  emitTasksCounts(null);
  return (await format([created]))[0]!;
}

export async function revokeDelegation(id: string, input: { reason?: string | null }, meta: Meta, opts: { mustBeDelegator: boolean }) {
  const existing = await prisma.workflowDelegate.findUnique({ where: { id }, include: rowInclude() });
  // A manager revoking "their own" can't learn about anyone else's.
  if (!existing || (opts.mustBeDelegator && existing.delegatorUserId !== meta.actorUserId)) throw new HttpError(404, "Delegation not found.", "NOT_FOUND");
  const status = statusOf(existing);
  if (status === "REVOKED") throw new HttpError(409, "This delegation was already revoked.", "ALREADY_REVOKED");
  if (status === "ENDED") throw new HttpError(409, "This delegation has already ended.", "ALREADY_ENDED");

  const updated = await prisma.workflowDelegate.update({
    where: { id },
    data: { revokedAt: new Date(), revokedByUserId: meta.actorUserId, revokeReason: input.reason?.trim() || null },
    include: rowInclude(),
  });
  await writeAuditLog({
    ...meta,
    action: "delegation.revoked",
    entityType: "WorkflowDelegate",
    entityId: id,
    before: { status },
    after: { status: "REVOKED", reason: updated.revokeReason },
  });
  await notifyEmployee(existing.delegate.employeeId, {
    type: "delegation.revoked",
    title: "Approval cover ended",
    body: `You're no longer covering ${person(existing.delegator).name}'s leave approvals.`,
    link: "/app/workflow-delegates",
    payload: { delegationId: id },
  });
  emitDelegationChanged([existing.delegator.employeeId, existing.delegate.employeeId]);
  emitTasksCounts(null);
  return (await format([updated]))[0]!;
}
