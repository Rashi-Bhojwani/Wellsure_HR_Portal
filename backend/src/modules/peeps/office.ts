import { Prisma } from "@prisma/client";
import { OFFICE_CAPABILITIES, OFFICE_CAPABILITY_IDS, OFFICE_GRANT_REASON, OFFICE_WORKSPACE_KEY, type OfficeChangeKind } from "@shared/constants/peeps";
import { notifyAccessChanged } from "../../lib/accessChanged";
import { writeAuditLogs } from "../../lib/audit";
import { inForceOn } from "../../lib/effectiveDating";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta, PeepsActor } from "./types";

// Wellsure Office membership (owner decision D-30, option 1). Who is in the workspace is a series of append-only changes: a director proposes, a
// different director confirms (service + database triggers), and the change is applied at its effective time — at once if that time has come, else by the
// scheduled job (applyDueChanges, every minute). Applying writes or removes ordinary per-person permission grants labelled OFFICE_GRANT_REASON, which
// access (lib/permissions.ts) already honours; nothing in the access resolver or the HR switch framework changes. The Peeps routes also read this state
// directly (peeps/access.ts), so a grant made by hand elsewhere opens nothing, and a member who also holds the MANAGER role (whose resolver ceiling strips
// non-manager keys) still reaches the workspace.

type Client = Prisma.TransactionClient | typeof prisma;

export interface MemberState {
  employeeId: string;
  capabilities: string[];
  since: Date;
}

/**
 * Folds the applied changes, in the order they were applied, into the current members. An UPDATE for someone who is no longer a member by then (a dated
 * change confirmed before they were removed or replaced) changes nothing.
 */
export async function currentMembers(client: Client = prisma): Promise<Map<string, MemberState>> {
  const applied = await client.officeMembershipChange.findMany({ where: { application: { isNot: null } }, include: { application: { select: { appliedAt: true, id: true } } } });
  applied.sort((x, y) => x.application!.appliedAt.getTime() - y.application!.appliedAt.getTime() || x.application!.id.localeCompare(y.application!.id));
  const members = new Map<string, MemberState>();
  for (const c of applied) {
    const caps = (c.capabilities as string[]) ?? [];
    if (c.kind === "APPOINT") members.set(c.employeeId, { employeeId: c.employeeId, capabilities: caps, since: c.effectiveFrom });
    else if (c.kind === "UPDATE") {
      const m = members.get(c.employeeId);
      if (m) members.set(c.employeeId, { ...m, capabilities: caps });
    }
    else if (c.kind === "REMOVE") members.delete(c.employeeId);
    else if (c.kind === "REPLACE") {
      if (c.fromEmployeeId) members.delete(c.fromEmployeeId);
      members.set(c.employeeId, { employeeId: c.employeeId, capabilities: caps, since: c.effectiveFrom });
    }
  }
  return members;
}

/** One person's membership, if they are an active member whose account is active. */
export async function memberStateFor(employeeId: string, client: Client = prisma): Promise<MemberState | null> {
  const m = (await currentMembers(client)).get(employeeId);
  if (!m) return null;
  const user = await client.user.findUnique({ where: { employeeId }, select: { status: true, employee: { select: { status: true } } } });
  if (!user || user.status !== "ACTIVE" || user.employee.status !== "ACTIVE") return null;
  return m;
}

export function keysFor(capabilities: readonly string[]): Set<string> {
  const keys = new Set<string>([OFFICE_WORKSPACE_KEY]);
  for (const cap of OFFICE_CAPABILITIES) if (capabilities.includes(cap.id)) for (const k of cap.keys) keys.add(k);
  return keys;
}

// ── Grants ─────────────────────────────────────────────────────────────────

/** Makes the labelled grants of these people match their membership. Never touches a grant somebody made by hand (different reason). */
async function syncGrants(tx: Prisma.TransactionClient, employeeIds: string[], byUserId: string): Promise<{ added: number; removed: number; users: Array<{ id: string; employeeId: string }> }> {
  const members = await currentMembers(tx);
  const users = await tx.user.findMany({ where: { employeeId: { in: employeeIds } }, select: { id: true, employeeId: true } });
  const allKeys = [...keysFor(OFFICE_CAPABILITY_IDS)];
  const perms = await tx.permission.findMany({ where: { key: { in: allKeys } }, select: { id: true, key: true } });
  const permId = new Map(perms.map((p) => [p.key, p.id]));
  let added = 0;
  let removed = 0;
  for (const u of users) {
    const m = members.get(u.employeeId);
    const expected = m ? keysFor(m.capabilities) : new Set<string>();
    const existing = await tx.userPermissionOverride.findMany({ where: { userId: u.id, permissionId: { in: perms.map((p) => p.id) } }, include: { permission: true } });
    for (const key of expected) {
      if (existing.some((o) => o.permission.key === key)) continue; // a hand-made grant or revoke stays as it is (the drift check reports a revoke)
      await tx.userPermissionOverride.create({ data: { userId: u.id, permissionId: permId.get(key)!, effect: "GRANT", reason: OFFICE_GRANT_REASON, createdByUserId: byUserId } });
      added += 1;
    }
    for (const o of existing) {
      if (o.reason === OFFICE_GRANT_REASON && !expected.has(o.permission.key)) {
        await tx.userPermissionOverride.delete({ where: { id: o.id } });
        removed += 1;
      }
    }
  }
  return { added, removed, users };
}

async function applyChange(changeId: string, byUserId: string): Promise<boolean> {
  const result = await prisma.$transaction(
    async (tx) => {
      const change = await tx.officeMembershipChange.findUnique({ where: { id: changeId }, include: { application: true, confirmation: true } });
      if (!change || change.application || !change.confirmation) return null;
      // Applied first, so the fold below already sees this change.
      const app = await tx.officeMembershipApplication.create({ data: { changeId, grantsAdded: 0, grantsRemoved: 0 } });
      const affected = [change.employeeId, ...(change.fromEmployeeId ? [change.fromEmployeeId] : [])];
      const sync = await syncGrants(tx, affected, change.confirmation.confirmedByUserId);
      await writeAuditLogs(
        [{ actorUserId: byUserId, action: "office.membership.applied", entityType: "OfficeMembershipChange", entityId: changeId, after: { applicationId: app.id, kind: change.kind, employeeId: change.employeeId, fromEmployeeId: change.fromEmployeeId, grantsAdded: sync.added, grantsRemoved: sync.removed } }],
        tx,
      );
      return sync.users;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!result) return false;
  await notifyAccessChanged(result);
  return true;
}

/** The scheduled job: every confirmed change whose time has come and that has not been applied, oldest first. Safe to run twice (the application row is unique). */
export async function applyDueChanges(now: Date = new Date()): Promise<number> { // allow-clock: an instant
  const due = await prisma.officeMembershipChange.findMany({
    where: { effectiveFrom: { lte: now }, confirmation: { isNot: null }, application: null },
    orderBy: [{ effectiveFrom: "asc" }, { proposedAt: "asc" }],
    include: { confirmation: true },
  });
  let applied = 0;
  for (const c of due) {
    try {
      if (await applyChange(c.id, c.confirmation!.confirmedByUserId)) applied += 1;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2034")) continue; // another run applied it
      logger.error({ event: "office.membership.apply_failed", changeId: c.id, err }, "applying a Wellsure Office membership change failed");
    }
  }
  return applied;
}

// ── Proposals and confirmations ────────────────────────────────────────────

async function activeEmployee(employeeId: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { employeeId }, select: { status: true, employee: { select: { status: true } } } });
  if (!u || u.status !== "ACTIVE" || u.employee.status !== "ACTIVE") throw new HttpError(409, "Only an active employee with an active account can be in the Wellsure Office.", "EMPLOYEE_NOT_ACTIVE");
}

export interface ProposeInput {
  kind: OfficeChangeKind;
  employeeId: string;
  fromEmployeeId?: string;
  capabilities?: string[];
  effectiveFrom?: string;
  reason: string;
}

export async function proposeChange(input: ProposeInput, actor: PeepsActor, meta: ActorMeta) {
  if (!actor.isDirector) throw new HttpError(403, "Only a director changes the Wellsure Office membership.", "DIRECTORS_ONLY");
  const now = new Date(); // allow-clock: an instant
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : now;
  if (effectiveFrom.getTime() < now.getTime() - 60_000) throw new HttpError(400, "A change cannot take effect in the past.", "VALIDATION_ERROR");
  if (effectiveFrom.getTime() > now.getTime() + 366 * 86_400_000) throw new HttpError(400, "A change can be dated at most a year ahead.", "VALIDATION_ERROR");
  const caps = [...new Set(input.capabilities ?? [])];
  const members = await currentMembers();
  if (input.kind === "APPOINT") {
    if (members.has(input.employeeId)) throw new HttpError(409, "This person is already a member.", "ALREADY_MEMBER");
    await activeEmployee(input.employeeId);
  } else if (input.kind === "UPDATE" || input.kind === "REMOVE") {
    if (!members.has(input.employeeId)) throw new HttpError(409, "This person is not a member.", "NOT_MEMBER");
  } else if (input.kind === "REPLACE") {
    if (!input.fromEmployeeId || !members.has(input.fromEmployeeId)) throw new HttpError(409, "The person being replaced is not a member.", "NOT_MEMBER");
    if (members.has(input.employeeId)) throw new HttpError(409, "The new person is already a member.", "ALREADY_MEMBER");
    await activeEmployee(input.employeeId);
  }
  const capabilities = input.kind === "REMOVE" ? [] : input.kind === "REPLACE" && !input.capabilities ? members.get(input.fromEmployeeId!)!.capabilities : caps;
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.officeMembershipChange.create({
      data: { kind: input.kind, employeeId: input.employeeId, fromEmployeeId: input.kind === "REPLACE" ? input.fromEmployeeId! : null, capabilities, effectiveFrom, reason: input.reason, proposedByUserId: actor.userId },
    });
    await writeAuditLogs([{ ...meta, action: "office.membership.proposed", entityType: "OfficeMembershipChange", entityId: r.id, after: { kind: r.kind, employeeId: r.employeeId, fromEmployeeId: r.fromEmployeeId, capabilities, effectiveFrom } }], tx);
    return r;
  });
  return row;
}

export async function confirmChange(changeId: string, actor: PeepsActor, meta: ActorMeta): Promise<{ applied: boolean }> {
  if (!actor.isDirector) throw new HttpError(403, "Only a director confirms a membership change.", "DIRECTORS_ONLY");
  await prisma.$transaction(async (tx) => {
    const change = await tx.officeMembershipChange.findUnique({ where: { id: changeId }, include: { confirmation: true } });
    if (!change) throw new HttpError(404, "That change does not exist.", "NOT_FOUND");
    if (change.confirmation) throw new HttpError(409, "That change is already confirmed.", "ALREADY_CONFIRMED");
    if (change.proposedByUserId === actor.userId) throw new HttpError(403, "A different director confirms a membership change.", "SAME_DIRECTOR");
    const c = await tx.officeMembershipConfirmation.create({ data: { changeId, confirmedByUserId: actor.userId } });
    await writeAuditLogs([{ ...meta, action: "office.membership.confirmed", entityType: "OfficeMembershipChange", entityId: changeId, after: { confirmationId: c.id } }], tx);
  });
  const change = await prisma.officeMembershipChange.findUniqueOrThrow({ where: { id: changeId } });
  const applied = change.effectiveFrom.getTime() <= Date.now() ? await applyChange(changeId, actor.userId) : false; // allow-clock: an instant
  return { applied };
}

// ── Reading ────────────────────────────────────────────────────────────────

const personSelect = { select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } as const;

export async function membershipOverview(actor: PeepsActor) {
  const [members, changes] = await Promise.all([
    currentMembers(),
    prisma.officeMembershipChange.findMany({ orderBy: { proposedAt: "desc" }, take: 200, include: { confirmation: true, application: true, employee: personSelect } }),
  ]);
  const people = await prisma.employee.findMany({ where: { id: { in: [...members.keys(), ...changes.flatMap((c) => (c.fromEmployeeId ? [c.fromEmployeeId] : []))] } }, ...personSelect });
  const nameOf = (id: string) => {
    const p = people.find((x) => x.id === id) ?? changes.find((c) => c.employee.id === id)?.employee;
    return p ? { employeeId: p.id, employeeCode: p.employeeCode, name: p.nameHistory[0]?.fullName ?? p.employeeCode } : { employeeId: id, employeeCode: "", name: "" };
  };
  return {
    members: [...members.values()].map((m) => ({ ...nameOf(m.employeeId), capabilities: m.capabilities, since: m.since.toISOString() })),
    changes: changes.map((c) => ({
      id: c.id,
      kind: c.kind,
      person: nameOf(c.employeeId),
      from: c.fromEmployeeId ? nameOf(c.fromEmployeeId) : null,
      capabilities: c.capabilities as string[],
      effectiveFrom: c.effectiveFrom.toISOString(),
      reason: c.reason,
      proposedByMe: c.proposedByUserId === actor.userId,
      proposedAt: c.proposedAt.toISOString(),
      confirmedAt: c.confirmation?.confirmedAt.toISOString() ?? null,
      appliedAt: c.application?.appliedAt.toISOString() ?? null,
    })),
  };
}

// ── Drift ──────────────────────────────────────────────────────────────────

export interface GrantDrift {
  employeeId: string;
  key: string;
  problem: "MISSING" | "UNEXPECTED" | "REVOKED_BY_HAND";
}

/** Where the labelled grants no longer match the membership (somebody edited them on the Roles & Permissions screen or in the database). */
export async function officeGrantDrift(): Promise<GrantDrift[]> {
  const members = await currentMembers();
  const allKeys = [...keysFor(OFFICE_CAPABILITY_IDS)];
  const rows = await prisma.userPermissionOverride.findMany({ where: { permission: { key: { in: allKeys } } }, include: { permission: true, user: { select: { employeeId: true } } } });
  const drift: GrantDrift[] = [];
  for (const r of rows) {
    const m = members.get(r.user.employeeId);
    const expected = m ? keysFor(m.capabilities) : new Set<string>();
    // Any grant of an office key to someone the membership does not give it to (labelled or made by hand): the routes ignore it, but it should not exist.
    if (r.effect === "GRANT" && !expected.has(r.permission.key)) drift.push({ employeeId: r.user.employeeId, key: r.permission.key, problem: "UNEXPECTED" });
    if (r.effect === "REVOKE" && expected.has(r.permission.key)) drift.push({ employeeId: r.user.employeeId, key: r.permission.key, problem: "REVOKED_BY_HAND" });
  }
  const users = await prisma.user.findMany({ where: { employeeId: { in: [...members.keys()] } }, select: { id: true, employeeId: true } });
  for (const u of users) {
    for (const key of keysFor(members.get(u.employeeId)!.capabilities)) {
      if (!rows.some((r) => r.userId === u.id && r.permission.key === key)) drift.push({ employeeId: u.employeeId, key, problem: "MISSING" });
    }
  }
  return drift;
}
