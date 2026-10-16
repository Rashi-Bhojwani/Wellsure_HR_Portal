import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";

/** Display names for user ids (the name in force today; payroll history is displayed with nameOn elsewhere). */
export async function namesOfUsers(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } },
  });
  return new Map(users.map((u) => [u.id, u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode]));
}
