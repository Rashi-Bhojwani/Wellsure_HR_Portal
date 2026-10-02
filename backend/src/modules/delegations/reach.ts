import { prisma } from "../../lib/prisma";
import { businessToday } from "../../lib/businessDate";
import { getTeamEmployeeIds, type DataScope } from "../../lib/dataScope";

// Workflow delegation reach (Phase 5 commit E3) — the ONE place that says
// whose team a delegate's approval scope also resolves against.
//
// A delegation never grants a permission: the delegate must hold
// leave.approve themselves (checked here on every use, not only when the
// delegation was created), and their dataScope is unchanged. It only adds
// the *current* team of each manager with an active delegation to them —
// in the approval flows only (leave review queue, request detail, decide,
// requester balances, Tasks). Not transitive: a delegation's reach is the
// delegator's own team, never teams delegated to the delegator.

export interface ApprovalViewer {
  employeeId: string;
  dataScope: DataScope;
  permissions: Set<string>;
}

export interface Delegator {
  userId: string;
  employeeId: string;
}

// Team member employeeId → the delegator whose team they're in.
export type DelegatedReach = Map<string, Delegator>;

// Non-revoked delegations whose inclusive date range contains `day`.
export function activeOn(day: Date = businessToday()) {
  return { revokedAt: null, startDate: { lte: day }, endDate: { gte: day } };
}

export async function delegatedReach(viewer: ApprovalViewer): Promise<DelegatedReach> {
  const reach: DelegatedReach = new Map();
  // ALL scope already reaches everyone; no approval permission, no reach.
  if (viewer.dataScope === "ALL" || !viewer.permissions.has("leave.approve")) return reach;
  const delegations = await prisma.workflowDelegate.findMany({
    where: { ...activeOn(), delegate: { employeeId: viewer.employeeId } },
    select: { delegator: { select: { id: true, employeeId: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const { delegator } of delegations) {
    if (delegator.employeeId === viewer.employeeId) continue; // can't happen (CHECK constraint); belt and braces
    for (const memberId of await getTeamEmployeeIds(delegator.employeeId)) {
      if (!reach.has(memberId)) reach.set(memberId, { userId: delegator.id, employeeId: delegator.employeeId });
    }
  }
  reach.delete(viewer.employeeId); // self-approval stays blocked; never "reach" yourself through someone else
  return reach;
}

// Users actively covering a manager's approvals today (for notifying them of
// new requests from the team). Only delegates who still hold leave.approve
// can act, but they're told regardless — the screens flag a delegate who
// lost it.
export async function activeDelegatesOf(managerEmployeeId: string): Promise<{ userId: string; employeeId: string }[]> {
  const rows = await prisma.workflowDelegate.findMany({
    where: { ...activeOn(), delegator: { employeeId: managerEmployeeId } },
    select: { delegate: { select: { id: true, employeeId: true, status: true } } },
  });
  const seen = new Set<string>();
  return rows
    .map((r) => r.delegate)
    .filter((d) => d.status === "ACTIVE" && !seen.has(d.id) && seen.add(d.id))
    .map((d) => ({ userId: d.id, employeeId: d.employeeId }));
}
