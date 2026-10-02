import type { Prisma } from "@prisma/client";
import { getTeamEmployeeIds, type DataScope } from "../../lib/dataScope";
import { delegatedReach, type ApprovalViewer, type DelegatedReach, type Delegator } from "../delegations/reach";

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

// ── Approval reach (Phase 5 commit E3: workflow delegates) ─────────────
// The approval flows — review queue, request detail, approve/reject, the
// requester's balances, Tasks — reach the viewer's own scope PLUS the team
// of any manager actively delegating to them (modules/delegations/reach.ts).
// Every other leave flow keeps using the plain helpers above.
export interface ApprovalReach {
  own: Set<string> | null; // null = ALL scope (everyone); always includes the viewer
  delegated: DelegatedReach;
}

export async function resolveApprovalReach(viewer: ApprovalViewer): Promise<ApprovalReach> {
  const own = viewer.dataScope === "ALL" ? null : new Set([viewer.employeeId, ...(viewer.dataScope === "TEAM" ? await getTeamEmployeeIds(viewer.employeeId) : [])]);
  return { own, delegated: await delegatedReach(viewer) };
}

// Whether targetEmployeeId is reachable, and if only through a delegation,
// on whose behalf.
export function reachFor(reach: ApprovalReach, targetEmployeeId: string): { reachable: boolean; onBehalfOf: Delegator | null } {
  if (!reach.own || reach.own.has(targetEmployeeId)) return { reachable: true, onBehalfOf: null };
  const delegator = reach.delegated.get(targetEmployeeId);
  return delegator ? { reachable: true, onBehalfOf: delegator } : { reachable: false, onBehalfOf: null };
}

// LeaveRequest.employeeId filter for the approval flows; undefined = ALL.
export function approvalEmployeeIdFilter(reach: ApprovalReach): Prisma.StringFilter | undefined {
  if (!reach.own) return undefined;
  return { in: [...reach.own, ...reach.delegated.keys()] };
}
