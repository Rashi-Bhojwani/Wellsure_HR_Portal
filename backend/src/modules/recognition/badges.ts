import { Prisma } from "@prisma/client";
import { PEEPS_REQUIRED, PEEPS_SETTINGS } from "@shared/constants/peeps";
import { writeAuditLogs } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { enterSetting, getSetting, missingSettings } from "../peeps/settings";
import type { BadgeCatalogueItem } from "../peeps/settingSchemas";
import type { ActorMeta, PeepsActor } from "../peeps/types";
import { canGive, employeeRef, expiryFor, giverKindFor, giverLabels, isDeveloper, monthStart, recipientsFor } from "./common";

// Badges and cheers (D-29, D-36): a public recognition record from a giver to a recipient, given along the reporting line (common.ts). Catalogue (each
// item with its duration: this week, this month or permanent), the monthly limit, repeats and whether the giver and message show in public are director
// settings, all Not set; only the catalogue is required. Visible to every signed-in member of staff on profiles, the directory and the home page (never
// to the Developer, never signed out). Weekly and monthly items expire when their period ends; directors revoke any badge with a reason. Every give and
// revoke is append-only and audited; giving is idempotent on the giver's key.

type Row = Prisma.BadgeAwardGetPayload<{ include: { revocation: true } }>;

async function catalogue(): Promise<BadgeCatalogueItem[]> {
  return (await getSetting<BadgeCatalogueItem[]>("badges.catalogue")) ?? [];
}

const isActive = (r: Row, at: Date) => !r.revocation && (!r.expiresAt || r.expiresAt > at);
const activeWhere = (now: Date): Prisma.BadgeAwardWhereInput => ({ revocation: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], recipient: { status: "ACTIVE" } });
const refuseDeveloper = (actor: PeepsActor) => {
  if (isDeveloper(actor)) throw new HttpError(403, "The Developer role does not see people's records.", "FORBIDDEN");
};

/** What a row shows. `withGiver`/`withMessage` decide whether the giver and the message are included. */
async function present(rows: Row[], opts: { withGiver: boolean; withMessage: boolean }) {
  const cat = await catalogue();
  const label = await giverLabels(rows);
  const now = new Date(); // allow-clock: an instant
  return rows.map((r) => {
    const item = cat.find((c) => c.code === r.badgeCode);
    return {
      id: r.id,
      badgeCode: r.badgeCode,
      badge: item?.label ?? r.badgeCode,
      duration: item?.duration ?? null,
      givenAt: r.givenAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      revoked: Boolean(r.revocation),
      active: isActive(r, now),
      ...(opts.withMessage ? { message: r.message } : {}),
      ...(opts.withGiver ? { from: label(r) } : {}),
    };
  });
}

/** The directors' choice of what public surfaces show (Not set: neither the giver nor the message). */
async function publicDetails(): Promise<{ giver: boolean; reason: boolean }> {
  const v = await getSetting<{ giver: boolean; reason: boolean }>("badges.publicDetails");
  return { giver: v?.giver === true, reason: v?.reason === true };
}

export async function status(actor: PeepsActor) {
  const missing = await missingSettings(PEEPS_REQUIRED.badges);
  return { active: missing.length === 0, missing: missing.map((k) => PEEPS_SETTINGS[k].label), canGive: missing.length === 0 ? (await canGive(actor, "badges")).any : false, catalogue: await catalogue() };
}

export const recipients = (actor: PeepsActor, q: string) => recipientsFor(actor, "badges", q);

export async function give(actor: PeepsActor, input: { recipientEmployeeId: string; badgeCode: string; message?: string; idempotencyKey: string }, meta: ActorMeta) {
  const kind = await giverKindFor(actor, input.recipientEmployeeId, "badges");
  const existing = await prisma.badgeAward.findUnique({ where: { giverUserId_idempotencyKey: { giverUserId: actor.userId, idempotencyKey: input.idempotencyKey } }, include: { revocation: true } });
  if (existing) return { ...(await present([existing], { withGiver: true, withMessage: true }))[0]!, repeated: true };
  const item = (await catalogue()).find((c) => c.code === input.badgeCode);
  if (!item) throw new HttpError(400, "That badge is not in the catalogue.", "VALIDATION_ERROR");
  const limit = await getSetting<{ perGiverPerMonth: number }>("badges.limits");
  const repeat = await getSetting<{ allowed: boolean }>("badges.repeat");
  let repeated = false;
  const row = await prisma
    .$transaction(
      async (tx) => {
        const now = new Date(); // allow-clock: an instant
        if (limit && (await tx.badgeAward.count({ where: { giverUserId: actor.userId, givenAt: { gte: monthStart(now) } } })) >= limit.perGiverPerMonth) {
          throw new HttpError(409, `You have given the most badges allowed this month (${limit.perGiverPerMonth}).`, "LIMIT_REACHED");
        }
        if (repeat?.allowed === false && (await tx.badgeAward.count({ where: { giverUserId: actor.userId, recipientEmployeeId: input.recipientEmployeeId, badgeCode: input.badgeCode, ...activeWhere(now) } })) > 0) {
          throw new HttpError(409, "You have already given this person this badge, and it is still active.", "REPEAT_NOT_ALLOWED");
        }
        const r = await tx.badgeAward.create({
          data: { badgeCode: input.badgeCode, recipientEmployeeId: input.recipientEmployeeId, giverUserId: actor.userId, giverKind: kind, message: input.message ?? null, idempotencyKey: input.idempotencyKey, givenAt: now, expiresAt: expiryFor(item.duration, now) },
          include: { revocation: true },
        });
        await writeAuditLogs([{ ...meta, action: "badges.given", entityType: "BadgeAward", entityId: r.id, after: { badgeCode: r.badgeCode, recipientEmployeeId: r.recipientEmployeeId, giverKind: kind, expiresAt: r.expiresAt?.toISOString() ?? null } }], tx);
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
  return { ...(await present([row], { withGiver: true, withMessage: true }))[0]!, repeated };
}

/** The recipient's own badges: who gave each and their message are theirs to see. */
export async function mine(actor: PeepsActor) {
  const rows = await prisma.badgeAward.findMany({ where: { recipientEmployeeId: actor.employeeId }, orderBy: { givenAt: "desc" }, include: { revocation: true } });
  return present(rows, { withGiver: true, withMessage: true });
}

export async function given(actor: PeepsActor) {
  const rows = await prisma.badgeAward.findMany({ where: { giverUserId: actor.userId }, orderBy: { givenAt: "desc" }, take: 200, include: { revocation: true } });
  const out = await present(rows, { withGiver: false, withMessage: true });
  return Promise.all(out.map(async (b, i) => ({ ...b, recipient: await employeeRef(rows[i]!.recipientEmployeeId) })));
}

/** A person's active badges as signed-in colleagues see them (D-36: everyone). The giver and message follow the directors' setting. */
export async function forPerson(actor: PeepsActor, employeeId: string) {
  if (employeeId !== actor.employeeId) refuseDeveloper(actor);
  const now = new Date(); // allow-clock: an instant
  const rows = await prisma.badgeAward.findMany({ where: { recipientEmployeeId: employeeId, ...activeWhere(now) }, orderBy: { givenAt: "desc" }, include: { revocation: true } });
  const details = await publicDetails();
  return { shown: true, badges: await present(rows, { withGiver: details.giver || actor.isDirector, withMessage: details.reason || actor.isDirector }) };
}

/** Active badge counts for the directory (company-wide to signed-in staff; the Developer sees none). */
export async function directoryCounts(actor: PeepsActor, employeeIds: string[]) {
  refuseDeveloper(actor);
  const rows = await prisma.badgeAward.findMany({ where: { recipientEmployeeId: { in: employeeIds }, ...activeWhere(new Date()) }, select: { recipientEmployeeId: true } }); // allow-clock: an instant
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.recipientEmployeeId] = (counts[r.recipientEmployeeId] ?? 0) + 1;
  return { shown: true, counts };
}

/** Everyone's active badge count (only people who have one), for the directory cards and the org chart in one small request. Developer refused. */
export async function allCounts(actor: PeepsActor) {
  refuseDeveloper(actor);
  const rows = await prisma.badgeAward.groupBy({ by: ["recipientEmployeeId"], where: activeWhere(new Date()), _count: { _all: true } }); // allow-clock: an instant
  return { counts: Object.fromEntries(rows.map((r) => [r.recipientEmployeeId, r._count._all])) as Record<string, number> };
}

/** The home page: the latest active badges company-wide (badges only; corrective notes are never public). Giver and message follow the setting. */
export async function recent(actor: PeepsActor) {
  refuseDeveloper(actor);
  const rows = await prisma.badgeAward.findMany({ where: activeWhere(new Date()), orderBy: { givenAt: "desc" }, take: 20, include: { revocation: true } }); // allow-clock: an instant
  const details = await publicDetails();
  const out = await present(rows, { withGiver: details.giver, withMessage: details.reason });
  return Promise.all(out.map(async (b, i) => ({ ...b, recipient: await employeeRef(rows[i]!.recipientEmployeeId) })));
}

/** D-36: a director revokes any badge, with a reason (audited). Revoking twice changes nothing. */
export async function revoke(actor: PeepsActor, id: string, input: { reason: string }, meta: ActorMeta) {
  if (!actor.isDirector) throw new HttpError(403, "Only a director revokes a badge.", "FORBIDDEN");
  const row = await prisma.badgeAward.findUnique({ where: { id }, include: { revocation: true } });
  if (!row) throw new HttpError(404, "Badge not found.", "NOT_FOUND");
  if (row.revocation) return { revoked: true, repeated: true };
  await prisma.$transaction(async (tx) => {
    const r = await tx.badgeRevocation.create({ data: { awardId: id, revokedByUserId: actor.userId, reason: input.reason } });
    await writeAuditLogs([{ ...meta, action: "badges.revoked", entityType: "BadgeAward", entityId: id, after: { revocationId: r.id, reason: input.reason } }], tx);
  });
  return { revoked: true, repeated: false };
}

export async function adminAll() {
  const rows = await prisma.badgeAward.findMany({ orderBy: { givenAt: "desc" }, take: 500, include: { revocation: true } });
  const out = await present(rows, { withGiver: true, withMessage: true });
  return Promise.all(out.map(async (b, i) => ({ ...b, recipient: await employeeRef(rows[i]!.recipientEmployeeId), giverKind: rows[i]!.giverKind })));
}

/** A starter set the directors may load in one click (never preloaded): entered as a catalogue version that a different director still confirms. */
export const STARTER_CATALOGUE: BadgeCatalogueItem[] = [
  { code: "STARTER_THANK_YOU", label: "Thank you", description: "Starter catalogue: edit before confirming.", duration: "WEEK" },
  { code: "STARTER_TEAM_PLAYER", label: "Team player", description: "Starter catalogue: edit before confirming.", duration: "MONTH" },
  { code: "STARTER_ABOVE_AND_BEYOND", label: "Above and beyond", description: "Starter catalogue: edit before confirming.", duration: "MONTH" },
  { code: "STARTER_PROBLEM_SOLVER", label: "Problem solver", description: "Starter catalogue: edit before confirming.", duration: "MONTH" },
  { code: "STARTER_MENTOR", label: "Mentor", description: "Starter catalogue: edit before confirming.", duration: "PERMANENT" },
  { code: "STARTER_MILESTONE", label: "Milestone", description: "Starter catalogue: edit before confirming.", duration: "PERMANENT" },
];

export async function loadStarterCatalogue(actor: PeepsActor, meta: ActorMeta) {
  if (!actor.isDirector) throw new HttpError(403, "Only a director loads the starter catalogue.", "FORBIDDEN");
  const view = await enterSetting("badges.catalogue", { value: STARTER_CATALOGUE, note: "Starter catalogue (loaded by a director): edit it, then a different director confirms" }, actor, meta);
  await writeAuditLogs([{ ...meta, action: "badges.catalogue.starter_loaded", entityType: "PeepsSetting", entityId: "badges.catalogue", after: { version: view.pending?.version ?? null, items: STARTER_CATALOGUE.length } }]);
  return view;
}
