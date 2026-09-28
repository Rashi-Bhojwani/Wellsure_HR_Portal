import { prisma } from "../../lib/prisma";
import { resolveDataScope } from "../../lib/dataScope";
import { HttpError } from "../../middleware/errorHandler";
import { getLeaveBalanceDetail } from "./ledger";
import { isEmployeeInScope } from "./scope";
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

export async function getLeaveBalancesForDisplay(targetEmployeeId: string | undefined, viewer: LeaveViewer, asOfDate: Date = new Date()): Promise<LeaveBalanceCard[]> {
  const employeeId = targetEmployeeId ?? viewer.employeeId;
  if (employeeId !== viewer.employeeId) {
    if (!viewer.permissions.has("leave.view")) {
      throw new HttpError(403, "Missing permission: leave.view", "FORBIDDEN");
    }
    const scope = resolveDataScope(viewer.roleCodes);
    if (!(await isEmployeeInScope(employeeId, viewer.employeeId, scope))) {
      throw new HttpError(404, "Employee not found.", "NOT_FOUND");
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
