import { Prisma } from "@prisma/client";
import { writeAuditLogs } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { getSetting, missingSettings } from "../peeps/settings";
import type { BadgeCatalogueItem } from "../peeps/settingSchemas";
import type { ActorMeta, PeepsActor } from "../peeps/types";
import { PEEPS_REQUIRED, PEEPS_SETTINGS } from "@shared/constants/peeps";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { canGive, employeeRef, giverKindFor, giverLabels, monthStart, recipientsFor } from "./common";

// Badges (D-29, Q-16): a persistent recognition record from a giver (the directors) to a recipient. Catalogue, limits, duration and revocation are
// settings; the module refuses to work until the catalogue is set. Q-16: badges are visible company-wide to signed-in staff, on the profile and in the
// directory (never the giver's message, never to the Developer). Giving is idempotent on the giver's key.

type Row = Prisma.BadgeAwardGetPayload<{ include: { revocation: true } }>;

async function catalogue(): Promise<BadgeCatalogueItem[]> {
  return (await getSetting<BadgeCatalogueItem[]>("badges.catalogue")) ?? [];
}

const isActive = (r: Row, at: Date) => !r.revocation && (!r.expiresAt || r.expiresAt > at);

async function present(rows: Row[], opts: { withGiver: boolean }) {
  const cat = await catalogue();
  const label = await giverLabels(rows);
  const now = new Date(); // allow-clock: an instant
  return rows.map((r) => ({
    id: r.id,
    badgeCode: r.badgeCode,
    badge: cat.find((c) => c.code === r.badgeCode)?.label ?? r.badgeCode,
    message: r.message,
    givenAt: r.givenAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revoked: Boolean(r.revocation),
    active: isActive(r, now),
    ...(opts.withGiver ? { from: label(r) } : {}),
  }));
}

export async function status(actor: PeepsActor) {
  const missing = await missingSettings(PEEPS_REQUIRED.badges);
  return { active: missing.length === 0, missing: missing.map((k) => PEEPS_SETTINGS[k].label), canGive: missing.length === 0 ? (await canGive(actor, "badges")).any : false, catalogue: await catalogue() };
}

export const recipients = (actor: PeepsActor, q: string) => recipientsFor(actor, "badges", q);

export async function give(actor: PeepsActor, input: { recipientEmployeeId: string; badgeCode: string; message?: string; idempotencyKey: string }, meta: ActorMeta) {
  const kind = await giverKindFor(actor, input.recipientEmployeeId, "badges");
  const existing = await prisma.badgeAward.findUnique({ where: { giverUserId_idempotencyKey: { giverUserId: actor.userId, idempotencyKey: input.idempotencyKey } }, include: { revocation: true } });
  if (existing) return { ...(await present([existing], { withGiver: true }))[0]!, repeated: true };
  if (!(await catalogue()).some((c) => c.code === input.badgeCode)) throw new HttpError(400, "That badge is not in the catalogue.", "VALIDATION_ERROR");
  const limit = await getSetting<{ perGiverPerMonth: number }>("badges.limits");
  const durationDays = await getSetting<number>("badges.durationDays");
  let repeated = false;
  const row = await prisma
    .$transaction(
      async (tx) => {
        if (limit && (await tx.badgeAward.count({ where: { giverUserId: actor.userId, givenAt: { gte: monthStart() } } })) >= limit.perGiverPerMonth) {
          throw new HttpError(409, `You have given the most badges allowed this month (${limit.perGiverPerMonth}).`, "LIMIT_REACHED");
        }
        const now = new Date(); // allow-clock: an instant
        const r = await tx.badgeAward.create({
          data: { badgeCode: input.badgeCode, recipientEmployeeId: input.recipientEmployeeId, giverUserId: actor.userId, giverKind: kind, message: input.message ?? null, idempotencyKey: input.idempotencyKey, givenAt: now, expiresAt: durationDays ? new Date(now.getTime() + durationDays * 86_400_000) : null },
          include: { revocation: true },
        });
        await writeAuditLogs([{ ...meta, action: "badges.given", entityType: "BadgeAward", entityId: r.id, after: { badgeCode: r.badgeCode, recipientEmployeeId: r.recipientEmployeeId, giverKind: kind } }], tx);
        return r;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch(async (err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        repeated = true; // the same key won a race a moment ago: answer with that badge
        return prisma.badgeAward.findUniqueOrThrow({ where: { giverUserId_idempotencyKey: { giverUserId: actor.userId, idempotencyKey: input.idempotencyKey } }, include: { revocation: true } });
      }
      throw err;
    });
  if (!repeated) await notifyEmployee(input.recipientEmployeeId, { type: "badges.received", title: "You received a badge", body: "Open Recognition to see it.", link: "/app/recognition" });
  return { ...(await present([row], { withGiver: true }))[0]!, repeated };
}

export async function mine(actor: PeepsActor) {
  const rows = await prisma.badgeAward.findMany({ where: { recipientEmployeeId: actor.employeeId }, orderBy: { givenAt: "desc" }, include: { revocation: true } });
  return present(rows, { withGiver: true });
}

export async function given(actor: PeepsActor) {
  const rows = await prisma.badgeAward.findMany({ where: { giverUserId: actor.userId }, orderBy: { givenAt: "desc" }, take: 200, include: { revocation: true } });
  const out = await present(rows, { withGiver: false });
  return Promise.all(out.map(async (b, i) => ({ ...b, recipient: await employeeRef(rows[i]!.recipientEmployeeId) })));
}

const isDeveloper = (actor: PeepsActor) => actor.roleCodes.includes(DEVELOPER_ROLE_CODE);

/** A person's active badges as signed-in colleagues see them (Q-16: company-wide). The message stays between giver and recipient; the Developer sees none. */
export async function forPerson(actor: PeepsActor, employeeId: string) {
  if (employeeId !== actor.employeeId && isDeveloper(actor)) throw new HttpError(403, "The Developer role does not see people's records.", "FORBIDDEN");
  const rows = await prisma.badgeAward.findMany({ where: { recipientEmployeeId: employeeId }, orderBy: { givenAt: "desc" }, include: { revocation: true } });
  const now = new Date(); // allow-clock: an instant
  return { shown: true, badges: (await present(rows.filter((r) => isActive(r, now)), { withGiver: true })).map(({ message: _m, ...b }) => b) };
}

/** Active badges per person for the directory (Q-16: company-wide to signed-in staff; the Developer sees none). */
export async function directoryCounts(actor: PeepsActor, employeeIds: string[]) {
  if (isDeveloper(actor)) throw new HttpError(403, "The Developer role does not see people's records.", "FORBIDDEN");
  const now = new Date(); // allow-clock: an instant
  const rows = await prisma.badgeAward.findMany({ where: { recipientEmployeeId: { in: employeeIds }, revocation: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { recipientEmployeeId: true } });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.recipientEmployeeId] = (counts[r.recipientEmployeeId] ?? 0) + 1;
  return { shown: true, counts };
}

/** Everyone's active badge count (only people who have one), for the directory cards and the org chart in one small request. Developer refused. */
export async function allCounts(actor: PeepsActor) {
  if (isDeveloper(actor)) throw new HttpError(403, "The Developer role does not see people's records.", "FORBIDDEN");
  const now = new Date(); // allow-clock: an instant
  const rows = await prisma.badgeAward.groupBy({ by: ["recipientEmployeeId"], where: { revocation: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], recipient: { status: "ACTIVE" } }, _count: { _all: true } });
  return { counts: Object.fromEntries(rows.map((r) => [r.recipientEmployeeId, r._count._all])) as Record<string, number> };
}

export async function revoke(actor: PeepsActor, id: string, input: { reason: string }, meta: ActorMeta) {
  const rule = await getSetting<{ allowed: boolean }>("badges.revocation");
  if (!rule?.allowed) throw new HttpError(409, "Badges cannot be revoked: the directors have not allowed it.", "REVOCATION_NOT_ALLOWED");
  const row = await prisma.badgeAward.findUnique({ where: { id }, include: { revocation: true } });
  if (!row || (row.giverUserId !== actor.userId && !actor.isDirector)) throw new HttpError(404, "Badge not found.", "NOT_FOUND");
  if (row.revocation) return { revoked: true, repeated: true };
  await prisma.$transaction(async (tx) => {
    const r = await tx.badgeRevocation.create({ data: { awardId: id, revokedByUserId: actor.userId, reason: input.reason } });
    await writeAuditLogs([{ ...meta, action: "badges.revoked", entityType: "BadgeAward", entityId: id, after: { revocationId: r.id } }], tx);
  });
  return { revoked: true, repeated: false };
}

export async function adminAll() {
  const rows = await prisma.badgeAward.findMany({ orderBy: { givenAt: "desc" }, take: 500, include: { revocation: true } });
  const out = await present(rows, { withGiver: true });
  return Promise.all(out.map(async (b, i) => ({ ...b, recipient: await employeeRef(rows[i]!.recipientEmployeeId), giverKind: rows[i]!.giverKind })));
}
