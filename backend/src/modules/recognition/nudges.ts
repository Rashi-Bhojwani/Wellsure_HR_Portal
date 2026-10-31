import { Prisma } from "@prisma/client";
import { PEEPS_REQUIRED, PEEPS_SETTINGS, PRIVATE_NOTICE } from "@shared/constants/peeps";
import { writeAuditLogs } from "../../lib/audit";
import { decryptField, encryptField } from "../../lib/encryption";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { auditDirectorOpen } from "../peeps/access";
import { getSetting, missingSettings } from "../peeps/settings";
import type { ActorMeta, PeepsActor } from "../peeps/types";
import { canGive, employeeRef, giverKindFor, giverLabels, monthStart, recipientsFor } from "./common";

// Private nudges (D-28, D-29): a private corrective note from a permitted sender to a recipient. Readable by the sender, the recipient and the directors
// (a director reading one that is not theirs is audited). Its text is field-encrypted and never leaves through a notification, an audit row, a log, a
// list or a socket event: the recipient is told only that something is waiting.

type Row = Prisma.PrivateNudgeGetPayload<{ include: { read: true; revocation: true } }>;
const include = { read: true, revocation: true } as const;

export async function status(actor: PeepsActor) {
  const missing = await missingSettings(PEEPS_REQUIRED.nudges);
  return { active: missing.length === 0, missing: missing.map((k) => PEEPS_SETTINGS[k].label), canSend: missing.length === 0 ? (await canGive(actor, "nudges")).any : false };
}

export const recipients = (actor: PeepsActor, q: string) => recipientsFor(actor, "nudges", q);

async function view(rows: Row[], opts: { recipient: boolean }) {
  const label = await giverLabels(rows.map((r) => ({ giverUserId: r.senderUserId, giverKind: r.senderKind })));
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      body: decryptField(r.bodyEncrypted),
      sentAt: r.sentAt.toISOString(),
      readAt: r.read?.readAt.toISOString() ?? null,
      withdrawn: Boolean(r.revocation),
      ...(opts.recipient ? {} : { recipient: await employeeRef(r.recipientEmployeeId) }),
      from: label({ giverUserId: r.senderUserId, giverKind: r.senderKind }),
    })),
  );
}

export async function send(actor: PeepsActor, input: { recipientEmployeeId: string; body: string; idempotencyKey: string }, meta: ActorMeta) {
  const kind = await giverKindFor(actor, input.recipientEmployeeId, "nudges");
  const key = { senderUserId_idempotencyKey: { senderUserId: actor.userId, idempotencyKey: input.idempotencyKey } };
  const existing = await prisma.privateNudge.findUnique({ where: key, include });
  if (existing) return { ...(await view([existing], { recipient: false }))[0]!, repeated: true };
  const limit = await getSetting<{ perSenderPerMonth: number }>("nudges.limits");
  let repeated = false;
  const row = await prisma
    .$transaction(
      async (tx) => {
        if (limit && (await tx.privateNudge.count({ where: { senderUserId: actor.userId, sentAt: { gte: monthStart() } } })) >= limit.perSenderPerMonth) {
          throw new HttpError(409, `You have sent the most nudges allowed this month (${limit.perSenderPerMonth}).`, "LIMIT_REACHED");
        }
        const r = await tx.privateNudge.create({
          data: { recipientEmployeeId: input.recipientEmployeeId, senderUserId: actor.userId, senderKind: kind, bodyEncrypted: Buffer.from(encryptField(input.body)), idempotencyKey: input.idempotencyKey },
          include,
        });
        // Ids and the kind only: the text never goes into the audit log.
        await writeAuditLogs([{ ...meta, action: "nudges.sent", entityType: "PrivateNudge", entityId: r.id, after: { recipientEmployeeId: r.recipientEmployeeId, senderKind: kind } }], tx);
        return r;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch(async (err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        repeated = true; // the same key won a race a moment ago: answer with that nudge
        return prisma.privateNudge.findUniqueOrThrow({ where: key, include });
      }
      throw err;
    });
  if (!repeated) await notifyEmployee(input.recipientEmployeeId, { type: "peeps.waiting", title: PRIVATE_NOTICE.title, body: PRIVATE_NOTICE.body, link: "/app/recognition" });
  return { ...(await view([row], { recipient: false }))[0]!, repeated };
}

/** The recipient's nudges. Opening the list records the first read of each. */
export async function mine(actor: PeepsActor) {
  const rows = await prisma.privateNudge.findMany({ where: { recipientEmployeeId: actor.employeeId }, orderBy: { sentAt: "desc" }, include });
  const unread = rows.filter((r) => !r.read).map((r) => r.id);
  if (unread.length) await prisma.nudgeRead.createMany({ data: unread.map((nudgeId) => ({ nudgeId })), skipDuplicates: true });
  const fresh = unread.length ? await prisma.privateNudge.findMany({ where: { recipientEmployeeId: actor.employeeId }, orderBy: { sentAt: "desc" }, include }) : rows;
  return view(fresh.filter((r) => !r.revocation), { recipient: true });
}

export async function sent(actor: PeepsActor) {
  const rows = await prisma.privateNudge.findMany({ where: { senderUserId: actor.userId }, orderBy: { sentAt: "desc" }, take: 200, include });
  return view(rows, { recipient: false });
}

export async function getOne(actor: PeepsActor, id: string, meta: ActorMeta) {
  const r = await prisma.privateNudge.findUnique({ where: { id }, include });
  const participant = r && (r.senderUserId === actor.userId || r.recipientEmployeeId === actor.employeeId);
  if (!r || (!participant && !actor.isDirector)) throw new HttpError(404, "Not found.", "NOT_FOUND");
  await auditDirectorOpen(actor, meta, "PrivateNudge", [r.id], () => Boolean(participant));
  return (await view([r], { recipient: false }))[0]!;
}

export async function revoke(actor: PeepsActor, id: string, input: { reason: string }, meta: ActorMeta) {
  const rule = await getSetting<{ allowed: boolean }>("nudges.revocation");
  if (!rule?.allowed) throw new HttpError(409, "Nudges cannot be withdrawn: the directors have not allowed it.", "REVOCATION_NOT_ALLOWED");
  const r = await prisma.privateNudge.findUnique({ where: { id }, include });
  if (!r || (r.senderUserId !== actor.userId && !actor.isDirector)) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (r.revocation) return { withdrawn: true, repeated: true };
  await prisma.$transaction(async (tx) => {
    const rev = await tx.nudgeRevocation.create({ data: { nudgeId: id, revokedByUserId: actor.userId, reason: input.reason } });
    await writeAuditLogs([{ ...meta, action: "nudges.withdrawn", entityType: "PrivateNudge", entityId: id, after: { revocationId: rev.id } }], tx);
  });
  return { withdrawn: true, repeated: false };
}

/** Every nudge, for the directors (D-28): each one that is not the director's own is audited as opened. */
export async function adminAll(actor: PeepsActor, meta: ActorMeta) {
  const rows = await prisma.privateNudge.findMany({ orderBy: { sentAt: "desc" }, take: 500, include });
  await auditDirectorOpen(actor, meta, "PrivateNudge", rows.map((r) => r.id), (id) => {
    const r = rows.find((x) => x.id === id)!;
    return r.senderUserId === actor.userId || r.recipientEmployeeId === actor.employeeId;
  });
  return view(rows, { recipient: false });
}
