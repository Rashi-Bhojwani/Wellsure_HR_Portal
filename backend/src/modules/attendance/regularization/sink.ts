import type { RegularizationRequestSink, RegularizationTaskCounts, RegularizationViewer } from "../../admin/regularizationIntegration";
import { getTeamEmployeeIds } from "../../../lib/dataScope";
import { prisma } from "../../../lib/prisma";

// Admin Home "My Tasks" counts for regularization (P2-E): Review = pending
// requests the viewer can decide (approve key, data scope, never their own);
// Monitor = the rest of the org's pending requests an ALL-scope viewer can see.
export class EngineRegularizationSink implements RegularizationRequestSink {
  async getPendingCounts(viewer: RegularizationViewer): Promise<RegularizationTaskCounts> {
    const canView = viewer.permissions.has("attendance.regularization.view") || viewer.permissions.has("attendance.regularization.approve");
    if (!canView) return { review: 0, monitor: 0 };
    let review = 0;
    if (viewer.permissions.has("attendance.regularization.approve")) {
      if (viewer.dataScope === "ALL") review = await prisma.regularizationRequest.count({ where: { status: "PENDING", employeeId: { not: viewer.employeeId } } });
      else if (viewer.dataScope === "TEAM") review = await prisma.regularizationRequest.count({ where: { status: "PENDING", employeeId: { in: await getTeamEmployeeIds(viewer.employeeId) } } });
    }
    const monitor = viewer.dataScope === "ALL" ? Math.max(0, (await prisma.regularizationRequest.count({ where: { status: "PENDING", employeeId: { not: viewer.employeeId } } })) - review) : 0;
    return { review, monitor };
  }
}
