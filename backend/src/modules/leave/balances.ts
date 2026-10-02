import { prisma } from "../../lib/prisma";
import { businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import { getLeaveBalanceDetail } from "./ledger";
import { isEmployeeInScope, resolveApprovalReach } from "./scope";
import type { LeaveViewer } from "./types";

export interface LeaveBalanceCard {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  granted: number;
  balance: number;
}

export async function getLeaveBalancesForDisplay(targetEmployeeId: string | undefined, viewer: LeaveViewer, asOfDate: Date = businessToday()): Promise<LeaveBalanceCard[]> {
  const employeeId = targetEmployeeId ?? viewer.employeeId;
  if (employeeId !== viewer.employeeId) {
    // E3: a delegate sees the balances of the team they're covering
    // approvals for (Review shows the requester's balance).
    const delegated = (await resolveApprovalReach(viewer)).delegated.has(employeeId);
    if (!delegated) {
      if (!viewer.permissions.has("leave.view")) {
        throw new HttpError(403, "Missing permission: leave.view", "FORBIDDEN");
      }
      const scope = viewer.dataScope;
      if (!(await isEmployeeInScope(employeeId, viewer.employeeId, scope))) {
        throw new HttpError(404, "Employee not found.", "NOT_FOUND");
      }
    }
  }

  const leaveTypes = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
  return Promise.all(
    leaveTypes.map(async (lt) => {
      const { granted, balance } = await getLeaveBalanceDetail(prisma, employeeId, lt.id, asOfDate);
      return {
        leaveTypeId: lt.id,
        code: lt.code,
        name: lt.name,
        isPaid: lt.isPaid,
        allowHalfDay: lt.allowHalfDay,
        granted: granted.toNumber(),
        balance: balance.toNumber(),
      };
    }),
  );
}
