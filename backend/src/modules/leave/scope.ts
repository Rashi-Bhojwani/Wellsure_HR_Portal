import type { Prisma } from "@prisma/client";
import { getTeamEmployeeIds, type DataScope } from "../../lib/dataScope";

// Same SELF/TEAM/ALL narrowing as buildEmployeeScopeWhere (lib/dataScope.ts),
// shaped for LeaveRequest/LeaveLedger/CompOffCredit's `employeeId` column
// instead of Employee's own `id`. undefined = no filter (ALL) — never
// widens access, only narrows.
export async function buildLeaveEmployeeIdFilter(requestingEmployeeId: string, scope: DataScope): Promise<Prisma.StringFilter | undefined> {
  if (scope === "ALL") return undefined;
  if (scope === "SELF") return { equals: requestingEmployeeId };
  const teamIds = await getTeamEmployeeIds(requestingEmployeeId);
  return { in: [requestingEmployeeId, ...teamIds] };
}

// Whether targetEmployeeId is visible to requestingEmployeeId under scope —
// the same IDOR-safe check findScopedEmployee (employee module) does, for
// callers that already have a specific employeeId to check rather than a
// list to filter.
export async function isEmployeeInScope(targetEmployeeId: string, requestingEmployeeId: string, scope: DataScope): Promise<boolean> {
  if (scope === "ALL") return true;
  if (targetEmployeeId === requestingEmployeeId) return true;
  if (scope === "SELF") return false;
  const teamIds = await getTeamEmployeeIds(requestingEmployeeId);
  return teamIds.includes(targetEmployeeId);
}
