import type { Prisma } from "@prisma/client";
import { resolveAccess } from "../../lib/permissions";

// Peeps Stage 4 (independent review, finding 2): audit rows that would tell an audit viewer who booked an Unmute session, who asked for a nudge
// review, who attached or opened a leave document, or which private item a director opened. Only the directors see them; everyone else with the
// audit log (HR, the Developer) gets the rest of the log without these rows.
export const PEEPS_PRIVATE_AUDIT_PREFIXES = ["unmute.booking.", "nudges.review.", "leave.document.", "peeps.director.opened"] as const;

export async function peepsPrivateAuditWhere(userId: string | undefined): Promise<Prisma.AuditLogWhereInput> {
  if (userId) {
    const access = await resolveAccess(userId);
    if (access.isSuperAdmin && !access.roleCodes.includes("DEVELOPER")) return {};
  }
  return { NOT: { OR: PEEPS_PRIVATE_AUDIT_PREFIXES.map((p) => ({ action: { startsWith: p } })) } };
}
