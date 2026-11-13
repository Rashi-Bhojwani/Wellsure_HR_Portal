import { Prisma } from '@prisma/client';
import { decryptField, encryptField } from '../../lib/encryption';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../middleware/errorHandler';
import { auditDirectorOpen } from '../peeps/access';
import type { ActorMeta, PeepsActor } from '../peeps/types';
import { employeeRef, giverLabels, isDeveloper } from './common';

// The old private corrective notes (D-37), READ-ONLY since Peeps Stage 3. No new note, read mark or withdrawal is written (the service has no write
// path, and a database trigger refuses inserts). Existing notes stay readable by the person they concern and by the directors (a director opening one
// that is not about them is audited). The text is field-encrypted and never leaves through a list other than these, a notification, a log or a socket.

type Row = Prisma.PrivateNudgeGetPayload<{ include: { read: true; revocation: true } }>;
const include = { read: true, revocation: true } as const;

async function view(rows: Row[], opts: { recipient: boolean }) {
  const label = await giverLabels(rows.map((r) => ({ giverUserId: r.senderUserId, giverKind: r.senderKind }))); // as before Stage 3: a director shows as the workspace's name
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

/** The notes about me (withdrawn ones hidden). Reading records nothing. */
export async function mine(actor: PeepsActor) {
  if (isDeveloper(actor)) throw new HttpError(403, "The Developer role does not see people's records.", 'FORBIDDEN');
  const rows = await prisma.privateNudge.findMany({ where: { recipientEmployeeId: actor.employeeId }, orderBy: { sentAt: 'desc' }, include });
  return { readOnly: true, notes: await view(rows.filter((r) => !r.revocation), { recipient: true }) };
}

/** One note: the person it concerns, or a director (audited unless it is about them). Nobody else, the original sender included unless a director. */
export async function getOne(actor: PeepsActor, id: string, meta: ActorMeta) {
  const r = await prisma.privateNudge.findUnique({ where: { id }, include });
  const concerned = r && r.recipientEmployeeId === actor.employeeId;
  if (!r || (!concerned && !actor.isDirector)) throw new HttpError(404, 'Not found.', 'NOT_FOUND');
  await auditDirectorOpen(actor, meta, 'PrivateNudge', [r.id], () => Boolean(concerned));
  return (await view([r], { recipient: false }))[0]!;
}

/** Every note, for the directors (D-28): each one not about the director is audited as opened. */
export async function adminAll(actor: PeepsActor, meta: ActorMeta) {
  const rows = await prisma.privateNudge.findMany({ orderBy: { sentAt: 'desc' }, take: 500, include });
  await auditDirectorOpen(actor, meta, 'PrivateNudge', rows.map((r) => r.id), (id) => rows.find((x) => x.id === id)!.recipientEmployeeId === actor.employeeId);
  return { readOnly: true, notes: await view(rows, { recipient: false }) };
}

/** Development and test databases only: writes a fixture note (the database refuses anywhere without its dev marker). Used by the demo company and
 *  the tests that prove existing notes stay readable. Never called by a route. */
export async function insertLegacyNoteFixture(input: { recipientEmployeeId: string; senderUserId: string; body: string; idempotencyKey: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.legacy_note_fixture', 'dev', true)");
    return tx.privateNudge.create({ data: { recipientEmployeeId: input.recipientEmployeeId, senderUserId: input.senderUserId, senderKind: 'DIRECTOR', bodyEncrypted: Buffer.from(encryptField(input.body)), idempotencyKey: input.idempotencyKey } });
  });
}
