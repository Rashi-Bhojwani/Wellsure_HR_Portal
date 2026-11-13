import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { notifyEmployee } from "../notifications/notifyEmployee";

// Peeps notifications (Stage 3 review). One place every new Peeps event goes through:
//   - durable: notifyEmployee writes the Notification row (the bell's record) before the socket delivery;
//   - deduplicated: with a dedupe key, a second delivery for the same event (a retry, a double click, a raced request) is skipped;
//   - retried: a failed delivery is tried again (three attempts in all); a final failure is logged with the event type only, never the text,
//     and never undoes the action that was already committed;
//   - nothing confidential: the title and body are fixed generic words chosen by the caller, the payload carries ids only (refused otherwise),
//     and the link is a screen whose API rechecks the reader's access when it is opened.

const ID_ONLY = /^[A-Za-z0-9_-]{1,64}$/;

export async function peepsNotify(
  employeeId: string,
  input: { type: string; title: string; body: string; link: string; payload?: Record<string, string> },
  opts: { dedupeKey?: string } = {},
): Promise<"sent" | "duplicate" | "failed"> {
  for (const [k, val] of Object.entries(input.payload ?? {})) if (!ID_ONLY.test(val)) throw new Error(`peepsNotify: payload ${k} must be an id`);
  const payload = { ...(input.payload ?? {}), ...(opts.dedupeKey ? { dedupeKey: opts.dedupeKey } : {}) };
  if (opts.dedupeKey) {
    const user = await prisma.user.findUnique({ where: { employeeId }, select: { id: true } });
    if (user && (await prisma.notification.count({ where: { userId: user.id, type: input.type, payload: { path: ["dedupeKey"], equals: opts.dedupeKey } } })) > 0) return "duplicate";
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await notifyEmployee(employeeId, { ...input, payload });
      return "sent";
    } catch {
      if (attempt === 3) {
        logger.warn({ event: "peeps.notify.failed", type: input.type }, "a Peeps notification could not be delivered");
        return "failed";
      }
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
  return "failed";
}

/** The active directors other than the actor (for "waiting for your confirmation" notices). */
export async function otherDirectorEmployeeIds(actorUserId: string): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { id: { not: actorUserId }, status: "ACTIVE", roles: { some: { role: { code: "SUPER_ADMIN" } } }, employee: { status: "ACTIVE" } }, select: { employeeId: true } });
  return users.map((u) => u.employeeId);
}
