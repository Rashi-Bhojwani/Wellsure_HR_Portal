import { prisma } from "../../lib/prisma";

// Read-only for commit B (every role needs this for the Leave Apply
// dropdown, same as org masters' reads); commit C adds the mutating admin
// endpoints (create/edit type, upsert policy — leave.policy.manage) to
// this same module.
export async function listActiveLeaveTypes() {
  return prisma.leaveType.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, isPaid: true, allowHalfDay: true },
    orderBy: { code: "asc" },
  });
}
