import { Prisma } from '@prisma/client';
import { PEEPS_REQUIRED, PEEPS_SETTING_DEFAULTS, PEEPS_SETTINGS } from '@shared/constants/peeps';
import { writeAuditLogs } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../middleware/errorHandler';
import { notifyEmployee } from '../notifications/notifyEmployee';
import { getSetting, missingSettings } from '../peeps/settings';
import type { BadgeCatalogueItem } from '../peeps/settingSchemas';
import type { ActorMeta, PeepsActor } from '../peeps/types';
import {
  canGive,
  employeeRef,
  expiryFor,
  giverKindFor,
  giverLabels,
  isDeveloper,
  monthStart,
  recipientsFor,
} from './common';

// Badges and cheers (D-29, D-36, Peeps Stage 3): a public recognition record from a giver to a recipient, given along the reporting line (common.ts),
// always with a reason. The catalogue (12 conventional badges, each lasting this week, this month or permanently), the monthly limit per giver (5), the
// limit per giver-receiver pair per month (1), repeats and whether the giver and reason show in public ship as defaults ("Default, change in
// settings"); directors change them (two-director confirmation, audited). A retired badge cannot be given and stays on past awards. Visible to every
// signed-in member of staff on profiles, the directory and the home page (never to the Developer, never signed out). Weekly and monthly items expire when
// their period ends (India time); directors revoke any badge with a reason. Every give and revoke is append-only and audited; giving is idempotent on the
// giver's key, and the limits hold under concurrent gives (serializable transaction).

type Row = Prisma.BadgeAwardGetPayload<{ include: { revocation: true } }>;
/** Used when a limits version entered before Stage 3 has no pair limit: the shipped default. */
const DEFAULT_PAIR_LIMIT = (PEEPS_SETTING_DEFAULTS['badges.limits'] as { perPairPerMonth: number }).perPairPerMonth;

async function catalogue(): Promise<BadgeCatalogueItem[]> {
  return (await getSetting<BadgeCatalogueItem[]>('badges.catalogue')) ?? [];
}

const isActive = (r: Row, at: Date) => !r.revocation && (!r.expiresAt || r.expiresAt > at);
const activeWhere = (now: Date): Prisma.BadgeAwardWhereInput => ({
  revocation: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  recipient: { status: 'ACTIVE' },
});
const refuseDeveloper = (actor: PeepsActor) => {
  if (isDeveloper(actor))
    throw new HttpError(403, "The Developer role does not see people's records.", 'FORBIDDEN');
};

/** What a row shows. `withGiver`/`withMessage` decide whether the giver and the message are included. */
async function present(rows: Row[], opts: { withGiver: boolean; withMessage: boolean; realNames?: boolean }) {
  const cat = await catalogue();
  const label = await giverLabels(rows, { realNames: opts.realNames === true });
  const now = new Date(); // allow-clock: an instant
  return rows.map((r) => {
    const item = cat.find((c) => c.code === r.badgeCode);
    return {
      id: r.id,
      badgeCode: r.badgeCode,
      badge: item?.label ?? r.badgeCode,
      duration: item?.duration ?? null,
      retiredBadge: item?.retired === true,
      givenAt: r.givenAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      revoked: Boolean(r.revocation),
      active: isActive(r, now),
      ...(opts.withMessage ? { message: r.message } : {}),
      ...(opts.withGiver ? { from: label(r) } : {}),
    };
  });
}

/** The directors' choice of what public surfaces show (default: both the giver and the reason). */
async function publicDetails(): Promise<{ giver: boolean; reason: boolean }> {
  const v = await getSetting<{ giver: boolean; reason: boolean }>('badges.publicDetails');
  return { giver: v?.giver === true, reason: v?.reason === true };
}

export async function status(actor: PeepsActor) {
  const missing = await missingSettings(PEEPS_REQUIRED.badges);
  return {
    active: missing.length === 0,
    missing: missing.map((k) => PEEPS_SETTINGS[k].label),
    canGive: missing.length === 0 ? (await canGive(actor, 'badges')).any : false,
    catalogue: (await catalogue()).filter((c) => !c.retired),
  };
}

export const recipients = (actor: PeepsActor, q: string) => recipientsFor(actor, 'badges', q);

export async function give(
  actor: PeepsActor,
  input: {
    recipientEmployeeId: string;
    badgeCode: string;
    message: string;
    idempotencyKey: string;
  },
  meta: ActorMeta,
) {
  const kind = await giverKindFor(actor, input.recipientEmployeeId, 'badges');
  const existing = await prisma.badgeAward.findUnique({
    where: {
      giverUserId_idempotencyKey: {
        giverUserId: actor.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: { revocation: true },
  });
  if (existing)
    return {
      ...(await present([existing], { withGiver: true, withMessage: true }))[0]!,
      repeated: true,
    };
  const item = (await catalogue()).find((c) => c.code === input.badgeCode);
  if (!item) throw new HttpError(400, 'That badge is not in the catalogue.', 'VALIDATION_ERROR');
  if (item.retired) throw new HttpError(409, 'That badge has been retired and can no longer be given.', 'RETIRED');
  const limits = await getSetting<{ perGiverPerMonth: number; perPairPerMonth?: number }>('badges.limits');
  const limit = limits ? { perGiverPerMonth: limits.perGiverPerMonth, perPairPerMonth: limits.perPairPerMonth ?? DEFAULT_PAIR_LIMIT } : null;
  const repeat = await getSetting<{ allowed: boolean }>('badges.repeat');
  let repeated = false;
  const attempt = () =>
    prisma
      .$transaction(
        async (tx) => {
          const now = new Date(); // allow-clock: an instant
          if (
            limit &&
            (await tx.badgeAward.count({
              where: { giverUserId: actor.userId, givenAt: { gte: monthStart(now) } },
            })) >= limit.perGiverPerMonth
          ) {
            throw new HttpError(
              409,
              `You have given the most badges allowed this month (${limit.perGiverPerMonth}).`,
              'LIMIT_REACHED',
            );
          }
          if (
            limit &&
            (await tx.badgeAward.count({
              where: { giverUserId: actor.userId, recipientEmployeeId: input.recipientEmployeeId, givenAt: { gte: monthStart(now) } },
            })) >= limit.perPairPerMonth
          ) {
            throw new HttpError(
              409,
              `You have given this person the most badges allowed in a month (${limit.perPairPerMonth}).`,
              'PAIR_LIMIT_REACHED',
            );
          }
          if (
            repeat?.allowed === false &&
            (await tx.badgeAward.count({
              where: {
                giverUserId: actor.userId,
                recipientEmployeeId: input.recipientEmployeeId,
                badgeCode: input.badgeCode,
                ...activeWhere(now),
              },
            })) > 0
          ) {
            throw new HttpError(
              409,
              'You have already given this person this badge, and it is still active.',
              'REPEAT_NOT_ALLOWED',
            );
          }
          const r = await tx.badgeAward.create({
            data: {
              badgeCode: input.badgeCode,
              recipientEmployeeId: input.recipientEmployeeId,
              giverUserId: actor.userId,
              giverKind: kind,
              message: input.message,
              idempotencyKey: input.idempotencyKey,
              givenAt: now,
              expiresAt: expiryFor(item.duration, now),
            },
            include: { revocation: true },
          });
          await writeAuditLogs(
            [
              {
                ...meta,
                action: 'badges.given',
                entityType: 'BadgeAward',
                entityId: r.id,
                after: {
                  badgeCode: r.badgeCode,
                  recipientEmployeeId: r.recipientEmployeeId,
                  giverKind: kind,
                  expiresAt: r.expiresAt?.toISOString() ?? null,
                },
              },
            ],
            tx,
          );
          return r;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(async (err) => {
        // The same key racing a moment ago surfaces as a unique violation (P2002) or, under serializable isolation, as a serialization conflict
        // (P2034). Either way, if that key's badge now exists, answer with it; a conflict with some other give is retried once.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === 'P2002' || err.code === 'P2034')
        ) {
          const won = await prisma.badgeAward.findUnique({
            where: {
              giverUserId_idempotencyKey: {
                giverUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: { revocation: true },
          });
          if (won) {
            repeated = true;
            return won;
          }
          if (err.code === 'P2034') return null;
        }
        throw err;
      });
  const row = (await attempt()) ?? (await attempt());
  if (!row)
    throw new HttpError(
      409,
      'Someone else was giving a badge at the same moment. Please try again.',
      'CONFLICT',
    );
  if (!repeated)
    await notifyEmployee(input.recipientEmployeeId, {
      type: 'badges.received',
      title: 'You received a badge',
      body: 'Open Recognition to see it.',
      link: '/app/recognition',
    });
  return { ...(await present([row], { withGiver: true, withMessage: true, realNames: true }))[0]!, repeated };
}

/** The recipient's own badges: who gave each (by name, directors included) and why are theirs to see. */
export async function mine(actor: PeepsActor) {
  const rows = await prisma.badgeAward.findMany({
    where: { recipientEmployeeId: actor.employeeId },
    orderBy: { givenAt: 'desc' },
    include: { revocation: true },
  });
  return present(rows, { withGiver: true, withMessage: true, realNames: true });
}

export async function given(actor: PeepsActor) {
  const rows = await prisma.badgeAward.findMany({
    where: { giverUserId: actor.userId },
    orderBy: { givenAt: 'desc' },
    take: 200,
    include: { revocation: true },
  });
  const out = await present(rows, { withGiver: false, withMessage: true });
  return Promise.all(
    out.map(async (b, i) => ({ ...b, recipient: await employeeRef(rows[i]!.recipientEmployeeId) })),
  );
}

/** A person's active badges as signed-in colleagues see them (D-36: everyone). The giver and message follow the directors' setting. */
export async function forPerson(actor: PeepsActor, employeeId: string) {
  if (employeeId !== actor.employeeId) refuseDeveloper(actor);
  const now = new Date(); // allow-clock: an instant
  const rows = await prisma.badgeAward.findMany({
    where: { recipientEmployeeId: employeeId, ...activeWhere(now) },
    orderBy: { givenAt: 'desc' },
    include: { revocation: true },
  });
  const details = await publicDetails();
  return {
    shown: true,
    badges: await present(rows, {
      withGiver: details.giver || actor.isDirector,
      withMessage: details.reason || actor.isDirector,
    }),
  };
}

/** Active badge counts for the directory (company-wide to signed-in staff; the Developer sees none). */
export async function directoryCounts(actor: PeepsActor, employeeIds: string[]) {
  refuseDeveloper(actor);
  const rows = await prisma.badgeAward.findMany({
    where: { recipientEmployeeId: { in: employeeIds }, ...activeWhere(new Date()) },
    select: { recipientEmployeeId: true },
  }); // allow-clock: an instant
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.recipientEmployeeId] = (counts[r.recipientEmployeeId] ?? 0) + 1;
  return { shown: true, counts };
}

/** Everyone's active badge count (only people who have one), for the directory cards and the org chart in one small request. Developer refused. */
export async function allCounts(actor: PeepsActor) {
  refuseDeveloper(actor);
  const rows = await prisma.badgeAward.groupBy({
    by: ['recipientEmployeeId'],
    where: activeWhere(new Date()),
    _count: { _all: true },
  }); // allow-clock: an instant
  return {
    counts: Object.fromEntries(rows.map((r) => [r.recipientEmployeeId, r._count._all])) as Record<
      string,
      number
    >,
  };
}

/** The home page: the latest active badges company-wide (badges only; corrective notes are never public). Giver and message follow the setting. */
export async function recent(actor: PeepsActor) {
  refuseDeveloper(actor);
  const rows = await prisma.badgeAward.findMany({
    where: activeWhere(new Date()),
    orderBy: { givenAt: 'desc' },
    take: 20,
    include: { revocation: true },
  }); // allow-clock: an instant
  const details = await publicDetails();
  const out = await present(rows, { withGiver: details.giver, withMessage: details.reason });
  return Promise.all(
    out.map(async (b, i) => ({ ...b, recipient: await employeeRef(rows[i]!.recipientEmployeeId) })),
  );
}

/** D-36: a director revokes any badge, with a reason (audited). Revoking twice changes nothing. */
export async function revoke(
  actor: PeepsActor,
  id: string,
  input: { reason: string },
  meta: ActorMeta,
) {
  if (!actor.isDirector) throw new HttpError(403, 'Only a director revokes a badge.', 'FORBIDDEN');
  const row = await prisma.badgeAward.findUnique({ where: { id }, include: { revocation: true } });
  if (!row) throw new HttpError(404, 'Badge not found.', 'NOT_FOUND');
  if (row.revocation) return { revoked: true, repeated: true };
  await prisma.$transaction(async (tx) => {
    const r = await tx.badgeRevocation.create({
      data: { awardId: id, revokedByUserId: actor.userId, reason: input.reason },
    });
    await writeAuditLogs(
      [
        {
          ...meta,
          action: 'badges.revoked',
          entityType: 'BadgeAward',
          entityId: id,
          after: { revocationId: r.id, reason: input.reason },
        },
      ],
      tx,
    );
  });
  return { revoked: true, repeated: false };
}

export async function adminAll() {
  const rows = await prisma.badgeAward.findMany({
    orderBy: { givenAt: 'desc' },
    take: 500,
    include: { revocation: true },
  });
  const out = await present(rows, { withGiver: true, withMessage: true });
  return Promise.all(
    out.map(async (b, i) => ({
      ...b,
      recipient: await employeeRef(rows[i]!.recipientEmployeeId),
      giverKind: rows[i]!.giverKind,
    })),
  );
}
