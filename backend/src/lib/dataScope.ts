import type { Prisma } from "@prisma/client";
import type { DataScope } from "@shared/constants/roles";
import { businessToday } from "./businessDate";
import { inForceSql } from "./effectiveDating";
import { prisma } from "./prisma";

export type { DataScope };

// Every employee who reports, directly or indirectly, to managerId — walked
// over the org-placement rows IN FORCE on `day` (default today, IST;
// lib/effectiveDating.ts). A move scheduled for next month changes the team
// next month, not now. Prisma has no recursive-query API, so this is a raw
// WITH RECURSIVE CTE.
export async function getTeamEmployeeIds(managerId: string, day: Date = businessToday()): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE reports AS (
      SELECT id FROM employees WHERE id = ${managerId}
      UNION ALL
      SELECT e.id
      FROM employees e
      JOIN employee_job_history jh ON jh.employee_id = e.id AND ${inForceSql("jh", day)}
      JOIN reports r ON jh.reporting_manager_id = r.id
    )
    SELECT id FROM reports WHERE id != ${managerId}
  `;
  return rows.map((row) => row.id);
}

// Data scope is no longer derived from role codes here: since Phase 5
// commit E1 it's a column on each role (Role.dataScope, SUPER_ADMIN-editable)
// resolved once per request in lib/permissions.ts and carried on req.user /
// every *Viewer as `dataScope`.

// Scopes an Employee query to what the requesting user (identified by
// their own employeeId) is allowed to see under SELF/TEAM/ALL (spec §2).
// ALL is not permission-checked here — callers gate that separately via
// requirePermission(); this only ever narrows, never widens, access.
export async function buildEmployeeScopeWhere(
  requestingEmployeeId: string,
  scope: DataScope,
): Promise<Prisma.EmployeeWhereInput> {
  if (scope === "ALL") {
    return {};
  }
  if (scope === "SELF") {
    return { id: requestingEmployeeId };
  }
  const teamIds = await getTeamEmployeeIds(requestingEmployeeId);
  return { id: { in: [requestingEmployeeId, ...teamIds] } };
}
