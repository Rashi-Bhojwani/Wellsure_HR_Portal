import { isTopLevel } from "../../lib/reportingHierarchy";
import { resolveAccess } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { activeDelegatesOf } from "../delegations/reach";
import { roleCodesOf } from "../managers/hierarchy";

// A leave request nobody on the team side can decide (2026-10-03): a
// manager starts with no permissions, so a team whose manager hasn't been
// granted leave approval, and who has no active delegate covering, has no
// approver below HR. The same holds for someone with no reporting manager
// at all (the Unassigned list). Managers and HR Admins themselves sit under
// Admin (model A) and go to the Super Admins instead, so they never count.
//
// Computed live, never stored: granting the manager leave approval or
// setting up a delegation clears the flag at once.
export type NoTeamApproverReason = "NO_MANAGER" | "MANAGER_CANNOT_APPROVE";

async function userCanApprove(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  return Boolean(user && user.status === "ACTIVE" && (await resolveAccess(userId)).permissions.has("leave.approve"));
}

async function managerCovered(managerEmployeeId: string): Promise<boolean> {
  const manager = await prisma.user.findUnique({ where: { employeeId: managerEmployeeId }, select: { id: true } });
  if (manager && (await userCanApprove(manager.id))) return true;
  for (const d of await activeDelegatesOf(managerEmployeeId)) if (await userCanApprove(d.userId)) return true;
  return false;
}

export async function noTeamApproverReason(employeeId: string, reportingManagerId: string | null): Promise<NoTeamApproverReason | null> {
  if (!reportingManagerId) return isTopLevel(await roleCodesOf(employeeId)) ? null : "NO_MANAGER";
  return (await managerCovered(reportingManagerId)) ? null : "MANAGER_CANNOT_APPROVE";
}

// Every PENDING request with no team-side approver, by request id. The
// pending set is small, and each distinct manager is resolved once.
export async function pendingWithNoTeamApprover(): Promise<Map<string, NoTeamApproverReason>> {
  const pending = await prisma.leaveRequest.findMany({
    where: { status: "PENDING" },
    select: {
      id: true,
      employeeId: true,
      employee: { select: { jobHistory: { where: { effectiveTo: null }, select: { reportingManagerId: true }, take: 1 } } },
    },
  });
  const byEmployee = new Map<string, NoTeamApproverReason | null>();
  const covered = new Map<string, boolean>();
  const out = new Map<string, NoTeamApproverReason>();
  for (const r of pending) {
    if (!byEmployee.has(r.employeeId)) {
      const managerId = r.employee.jobHistory[0]?.reportingManagerId ?? null;
      let reason: NoTeamApproverReason | null;
      if (!managerId) {
        reason = isTopLevel(await roleCodesOf(r.employeeId)) ? null : "NO_MANAGER";
      } else {
        if (!covered.has(managerId)) covered.set(managerId, await managerCovered(managerId));
        reason = covered.get(managerId) ? null : "MANAGER_CANNOT_APPROVE";
      }
      byEmployee.set(r.employeeId, reason);
    }
    const reason = byEmployee.get(r.employeeId);
    if (reason) out.set(r.id, reason);
  }
  return out;
}

// Who decides a request with no team approver: every active user with
// company-wide leave approval (HR Admin, HR Executive, Super Admin by
// default), except the person who applied.
export async function companyWideApprovers(exceptEmployeeId: string): Promise<string[]> {
  const candidates = await prisma.user.findMany({
    where: { status: "ACTIVE", employeeId: { not: exceptEmployeeId }, roles: { some: { role: { dataScope: "ALL" } } } },
    select: { id: true, employeeId: true },
  });
  const out: string[] = [];
  for (const c of candidates) {
    const access = await resolveAccess(c.id);
    if (access.dataScope === "ALL" && access.permissions.has("leave.approve")) out.push(c.employeeId);
  }
  return out;
}
