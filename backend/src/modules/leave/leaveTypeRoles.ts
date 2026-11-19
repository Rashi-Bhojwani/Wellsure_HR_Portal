import type { LeavePolicy, LeaveType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { behaviourValue } from "../behaviours/service";

// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 2): which leave type is the earned / paid leave and which is comp-off is a director setting (Default
// behaviours), not a name. Not set: the runs that need it refuse, naming the setting; nothing is skipped silently.

export const LEAVE_ROLES = {
  EARNED: { key: "leave.earnedLeaveType", text: "Earned / paid leave type is not set. Choose it in settings (Default behaviours)." },
  COMP_OFF: { key: "leave.compOffType", text: "Comp-off leave type is not set. Choose it in settings (Default behaviours)." },
} as const;
export type LeaveRole = keyof typeof LEAVE_ROLES;

/** The leave type id holding a role, or null while it is Not set. */
export async function leaveTypeIdFor(role: LeaveRole): Promise<string | null> {
  return ((await behaviourValue(LEAVE_ROLES[role].key)).value as string | null) ?? null;
}

/** The leave type (with its policy) holding a role; refuses, naming the setting, while it is Not set or the type has gone. */
export async function requireLeaveTypeFor(role: LeaveRole, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<LeaveType & { policy: LeavePolicy | null }> {
  const id = await leaveTypeIdFor(role);
  const type = id ? await client.leaveType.findUnique({ where: { id }, include: { policy: true } }) : null;
  if (!type) throw new HttpError(409, LEAVE_ROLES[role].text, "SETTING_NOT_SET", { settings: [LEAVE_ROLES[role].key] });
  return type;
}

/** Is this leave type the one holding the role? False while the role is Not set (then no type is comp-off). */
export async function isLeaveTypeFor(role: LeaveRole, leaveTypeId: string): Promise<boolean> {
  return (await leaveTypeIdFor(role)) === leaveTypeId;
}
