import { prisma } from "../../lib/prisma";
import { pendingWithNoTeamApprover } from "../leave/noTeamApprover";
import * as leaveRequestsService from "../leave/requests";
import type { LeaveViewer } from "../leave/types";
import { getRegularizationRequestSink } from "./regularizationIntegration";

// Admin Homepage "My Tasks" (spec §7.1) — split into Review (pending
// requests within the caller's own approval scope — "I am approver") and
// Monitor (pending requests elsewhere in the org the caller can see but
// isn't the approver for — HR oversight). Leave is real; regularization
// is wired through RegularizationRequestSink, a genuine query that
// returns zero today (Phase 2/3 not built yet), never a fake count.
export interface TaskCountsByType {
  type: string;
  label: string;
  count: number;
}

export interface TaskCounts {
  review: { total: number; byType: TaskCountsByType[] };
  monitor: { total: number; byType: TaskCountsByType[] };
  // Pending leave no manager or delegate can decide (company-wide approvers
  // only; null for everyone else) — shown as an alert on Admin Home.
  leaveNoTeamApprover: number | null;
}

export async function getTaskCounts(viewer: LeaveViewer): Promise<TaskCounts> {
  const canApprove = viewer.permissions.has("leave.approve");
  const leaveReview = canApprove ? (await leaveRequestsService.listLeaveRequests({ status: "PENDING", page: 1, pageSize: 1 }, viewer)).total : 0;

  const hasBroadView = viewer.permissions.has("leave.view");
  const scope = viewer.dataScope;
  let leaveMonitor = 0;
  if (hasBroadView && scope === "ALL") {
    const orgWidePending = await prisma.leaveRequest.count({ where: { status: "PENDING" } });
    leaveMonitor = Math.max(0, orgWidePending - leaveReview);
  }

  const regularization = await getRegularizationRequestSink().getPendingCounts(viewer.employeeId, viewer.roleCodes);

  const reviewByType: TaskCountsByType[] = [{ type: "LEAVE", label: "Leave", count: leaveReview }];
  if (regularization.review > 0) reviewByType.push({ type: "REGULARIZATION", label: "Attendance Regularization", count: regularization.review });

  const monitorByType: TaskCountsByType[] = [{ type: "LEAVE", label: "Leave", count: leaveMonitor }];
  if (regularization.monitor > 0) monitorByType.push({ type: "REGULARIZATION", label: "Attendance Regularization", count: regularization.monitor });

  const leaveNoTeamApprover = canApprove && scope === "ALL" ? (await pendingWithNoTeamApprover()).size : null;

  return {
    review: { total: leaveReview + regularization.review, byType: reviewByType },
    monitor: { total: leaveMonitor + regularization.monitor, byType: monitorByType },
    leaveNoTeamApprover,
  };
}
