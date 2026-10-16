import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";

// Nobody changes their own pay (docs/plans/PHASE_6.md §14B), whatever role they hold: Super Admin included. The same rule as nobody correcting their own attendance.

/** The employee record a user is, if any. */
export async function employeeIdOfUser(userId: string): Promise<string | null> {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } }))?.employeeId ?? null;
}

/** The users behind these employee records. */
export async function userIdsOfEmployees(employeeIds: readonly string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  return (await prisma.user.findMany({ where: { employeeId: { in: [...employeeIds] } }, select: { id: true } })).map((u) => u.id);
}

/** Refuses when `employeeIds` includes the actor's own employee record. */
export async function assertNotOwnPay(actorUserId: string, employeeIds: readonly string[], what: string): Promise<void> {
  const own = await employeeIdOfUser(actorUserId);
  if (own && employeeIds.includes(own)) {
    throw new HttpError(403, `${what} would change your own pay. Nobody changes their own pay, whatever their role: somebody else has to do it.`, "SELF_PAY");
  }
}
