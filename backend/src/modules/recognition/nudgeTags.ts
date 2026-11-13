import { Prisma } from '@prisma/client';
import { NUDGE_LIFETIME_DAYS, PEEPS_REQUIRED, PEEPS_SETTINGS } from '@shared/constants/peeps';
import { writeAuditLogs } from '../../lib/audit';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../middleware/errorHandler';
import { notifyEmployee } from '../notifications/notifyEmployee';
import { offLimitsWordIn } from '../peeps/settingChecks';
import { getSetting, missingSettings } from '../peeps/settings';
import type { NudgeTagItem } from '../peeps/settingSchemas';
import type { ActorMeta, PeepsActor } from '../peeps/types';
import { employeeRef, giverKindFor, giverLabels, isDeveloper, recipientsFor } from './common';

// Nudge tags (Peeps Stage 3): public, light-hearted tags a director gives to any employee. Each shows for a week, then disappears. Visible to everyone
// like badges; the giver is always named (the receiver always sees who gave it). Safeguards: no free text anywhere; tag names come from a director-run
// catalogue checked against a director-run list of off-limits words (a tag that later matches a new word can no longer be given); a director removes
// any tag at once with a reason; the receiver may ask for a review, which waits as a directors' task until a director keeps or removes it. Never
// created by a system job: the only write path is give() below, called by a director's request, and the database refuses a giver who is not a director.
// Every give, removal, review request and decision is append-only and audited (ids and the tag code only).

type Row = Prisma.NudgeTagAwardGetPayload<{ include: { removal: true; reviews: { include: { decision: true } } } }>;
const include = { removal: true, reviews: { include: { decision: true } } } as const;

async function catalogue(): Promise<NudgeTagItem[]> {
  return (await getSetting<NudgeTagItem[]>('nudges.catalogue')) ?? [];
}
async function offLimits(): Promise<string[]> {
  return (await getSetting<string[]>('nudges.offLimitsWords')) ?? [];
}
/** Tags that may be given now: in the catalogue, not retired, and not matching an off-limits word. */
async function givable(): Promise<NudgeTagItem[]> {
  const words = await offLimits();
  return (await catalogue()).filter((t) => !t.retired && !offLimitsWordIn(t.label, words));
}

const now = () => new Date(); // allow-clock: an instant
const activeWhere = (at: Date): Prisma.NudgeTagAwardWhereInput => ({ removal: null, expiresAt: { gt: at }, recipient: { status: 'ACTIVE' } });
const refuseDeveloper = (actor: PeepsActor) => {
  if (isDeveloper(actor)) throw new HttpError(403, "The Developer role does not see people's records.", 'FORBIDDEN');
};
const refuseNonDirector = (actor: PeepsActor, what: string) => {
  if (!actor.isDirector || isDeveloper(actor)) throw new HttpError(403, `Only a director ${what}.`, 'FORBIDDEN');
};

async function present(rows: Row[]) {
  const cat = await catalogue();
  const label = await giverLabels(rows.map((r) => ({ giverUserId: r.giverUserId, giverKind: 'DIRECTOR' as const })), { realNames: true });
  const at = now();
  return rows.map((r) => {
    const review = r.reviews[0];
    return {
      id: r.id,
      tagCode: r.tagCode,
      tag: cat.find((c) => c.code === r.tagCode)?.label ?? r.tagCode,
      givenAt: r.givenAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      removed: Boolean(r.removal),
      active: !r.removal && r.expiresAt > at,
      from: label({ giverUserId: r.giverUserId, giverKind: 'DIRECTOR' }),
      review: review ? { requestedAt: review.at.toISOString(), outcome: review.decision?.outcome ?? null } : null,
    };
  });
}

export async function status(actor: PeepsActor) {
  const missing = await missingSettings(PEEPS_REQUIRED.nudges);
  return {
    active: missing.length === 0,
    missing: missing.map((k) => PEEPS_SETTINGS[k].label),
    canGive: missing.length === 0 && actor.isDirector && !isDeveloper(actor),
    tags: actor.isDirector ? await givable() : [],
    lifetimeDays: NUDGE_LIFETIME_DAYS,
  };
}

export const recipients = (actor: PeepsActor, q: string) => recipientsFor(actor, 'nudges', q);

export async function give(actor: PeepsActor, input: { recipientEmployeeId: string; tagCode: string; idempotencyKey: string }, meta: ActorMeta) {
  await giverKindFor(actor, input.recipientEmployeeId, 'nudges'); // directors only; not yourself; an active employee
  const key = { giverUserId_idempotencyKey: { giverUserId: actor.userId, idempotencyKey: input.idempotencyKey } };
  const existing = await prisma.nudgeTagAward.findUnique({ where: key, include });
  if (existing) return { ...(await present([existing]))[0]!, repeated: true };
  const tag = (await catalogue()).find((t) => t.code === input.tagCode);
  if (!tag) throw new HttpError(400, 'That tag is not in the catalogue.', 'VALIDATION_ERROR');
  if (tag.retired) throw new HttpError(409, 'That tag has been retired.', 'RETIRED');
  if (offLimitsWordIn(tag.label, await offLimits())) throw new HttpError(409, 'That tag uses an off-limits word and cannot be given.', 'OFF_LIMITS_WORD');
  let repeated = false;
  const row = await prisma
    .$transaction(async (tx) => {
      const at = now();
      const r = await tx.nudgeTagAward.create({
        data: { tagCode: tag.code, recipientEmployeeId: input.recipientEmployeeId, giverUserId: actor.userId, idempotencyKey: input.idempotencyKey, givenAt: at, expiresAt: new Date(at.getTime() + NUDGE_LIFETIME_DAYS * 86_400_000) },
        include,
      });
      await writeAuditLogs([{ ...meta, action: 'nudges.tag.given', entityType: 'NudgeTagAward', entityId: r.id, after: { tagCode: r.tagCode, recipientEmployeeId: r.recipientEmployeeId, expiresAt: r.expiresAt.toISOString() } }], tx);
      return r;
    })
    .catch(async (err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const won = await prisma.nudgeTagAward.findUnique({ where: key, include });
        if (won) {
          repeated = true;
          return won;
        }
      }
      throw err;
    });
  if (!repeated) await notifyEmployee(input.recipientEmployeeId, { type: 'nudges.received', title: 'You received a nudge', body: 'Open Recognition to see it.', link: '/app/recognition' });
  return { ...(await present([row]))[0]!, repeated };
}

/** The receiver's own tags, recent first, with who gave each and any review. */
export async function mine(actor: PeepsActor) {
  refuseDeveloper(actor);
  const rows = await prisma.nudgeTagAward.findMany({ where: { recipientEmployeeId: actor.employeeId }, orderBy: { givenAt: 'desc' }, take: 100, include });
  return present(rows);
}

/** A person's active tags, as everyone signed in sees them. */
export async function forPerson(actor: PeepsActor, employeeId: string) {
  if (employeeId !== actor.employeeId) refuseDeveloper(actor);
  const rows = await prisma.nudgeTagAward.findMany({ where: { recipientEmployeeId: employeeId, ...activeWhere(now()) }, orderBy: { givenAt: 'desc' }, include });
  return { tags: await present(rows) };
}

/** Everyone's active tag count (only people who have one), for the directory. */
export async function counts(actor: PeepsActor) {
  refuseDeveloper(actor);
  const rows = await prisma.nudgeTagAward.groupBy({ by: ['recipientEmployeeId'], where: activeWhere(now()), _count: { _all: true } });
  return { counts: Object.fromEntries(rows.map((r) => [r.recipientEmployeeId, r._count._all])) as Record<string, number> };
}

/** The home page: the latest active tags company-wide. */
export async function recent(actor: PeepsActor) {
  refuseDeveloper(actor);
  const rows = await prisma.nudgeTagAward.findMany({ where: activeWhere(now()), orderBy: { givenAt: 'desc' }, take: 20, include });
  const out = await present(rows);
  return Promise.all(out.map(async (t, i) => ({ ...t, recipient: await employeeRef(rows[i]!.recipientEmployeeId) })));
}

async function removeIn(tx: Prisma.TransactionClient, award: Row, actor: PeepsActor, reason: string, meta: ActorMeta) {
  const r = await tx.nudgeTagRemoval.create({ data: { awardId: award.id, removedByUserId: actor.userId, reason } });
  await writeAuditLogs([{ ...meta, action: 'nudges.tag.removed', entityType: 'NudgeTagAward', entityId: award.id, after: { removalId: r.id, reason } }], tx);
  const open = award.reviews.find((v) => !v.decision);
  if (open) {
    const d = await tx.nudgeTagReviewDecision.create({ data: { requestId: open.id, decidedByUserId: actor.userId, outcome: 'REMOVED' } });
    await writeAuditLogs([{ ...meta, action: 'nudges.review.decided', entityType: 'NudgeTagAward', entityId: award.id, after: { decisionId: d.id, outcome: 'REMOVED' } }], tx);
  }
}

/** A director removes a tag at once, with a reason (audited). Removing twice changes nothing. */
export async function remove(actor: PeepsActor, id: string, input: { reason: string }, meta: ActorMeta) {
  refuseNonDirector(actor, 'removes a nudge');
  const award = await prisma.nudgeTagAward.findUnique({ where: { id }, include });
  if (!award) throw new HttpError(404, 'Nudge not found.', 'NOT_FOUND');
  if (award.removal) return { removed: true, repeated: true };
  await prisma.$transaction((tx) => removeIn(tx, award, actor, input.reason, meta)).catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return; // removed a moment ago
    throw err;
  });
  return { removed: true, repeated: false };
}

/** The receiver asks the directors to review a tag given to them: it waits in the directors' tasks. Asking twice changes nothing. */
export async function requestReview(actor: PeepsActor, id: string, meta: ActorMeta) {
  refuseDeveloper(actor);
  const award = await prisma.nudgeTagAward.findUnique({ where: { id }, include });
  if (!award || award.recipientEmployeeId !== actor.employeeId) throw new HttpError(404, 'Nudge not found.', 'NOT_FOUND');
  if (award.removal) throw new HttpError(409, 'That nudge has already been removed.', 'ALREADY_REMOVED');
  if (award.reviews.length) return { requested: true, repeated: true };
  const created = await prisma
    .$transaction(async (tx) => {
      const r = await tx.nudgeTagReviewRequest.create({ data: { awardId: id, requestedByEmployeeId: actor.employeeId } });
      await writeAuditLogs([{ ...meta, action: 'nudges.review.requested', entityType: 'NudgeTagAward', entityId: id, after: { requestId: r.id } }], tx);
      return true;
    })
    .catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    });
  return { requested: true, repeated: !created };
}

/** A director decides a review: keep the tag, or remove it (with a reason). */
export async function decideReview(actor: PeepsActor, id: string, input: { outcome: 'KEPT' | 'REMOVED'; reason?: string }, meta: ActorMeta) {
  refuseNonDirector(actor, 'decides a nudge review');
  const award = await prisma.nudgeTagAward.findUnique({ where: { id }, include });
  const open = award?.reviews.find((v) => !v.decision);
  if (!award || !open) throw new HttpError(404, 'There is no open review for that nudge.', 'NOT_FOUND');
  if (input.outcome === 'REMOVED') {
    if (!input.reason || input.reason.trim().length < 3) throw new HttpError(400, 'Give a reason for removing it.', 'VALIDATION_ERROR');
    if (award.removal) throw new HttpError(409, 'That nudge has already been removed.', 'ALREADY_REMOVED');
    await prisma.$transaction((tx) => removeIn(tx, award, actor, input.reason!.trim(), meta));
  } else {
    await prisma.$transaction(async (tx) => {
      const d = await tx.nudgeTagReviewDecision.create({ data: { requestId: open.id, decidedByUserId: actor.userId, outcome: 'KEPT' } });
      await writeAuditLogs([{ ...meta, action: 'nudges.review.decided', entityType: 'NudgeTagAward', entityId: award.id, after: { decisionId: d.id, outcome: 'KEPT' } }], tx);
    });
  }
  await notifyEmployee(award.recipientEmployeeId, { type: 'nudges.reviewed', title: 'Your nudge review is decided', body: 'Open Recognition to see it.', link: '/app/recognition' });
  return { decided: input.outcome };
}

/** Every tag, for the directors, with removals and reviews. */
export async function adminAll(actor: PeepsActor) {
  refuseNonDirector(actor, 'sees every nudge');
  const rows = await prisma.nudgeTagAward.findMany({ orderBy: { givenAt: 'desc' }, take: 500, include });
  const out = await present(rows);
  return Promise.all(out.map(async (t, i) => ({ ...t, recipient: await employeeRef(rows[i]!.recipientEmployeeId) })));
}

/** Open review requests, for the directors' task inbox. */
export async function openReviews() {
  return prisma.nudgeTagReviewRequest.findMany({ where: { decision: null, award: { removal: null } }, orderBy: { at: 'asc' }, select: { id: true, awardId: true, at: true } });
}
