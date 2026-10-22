import { HOLD_REASON_ACTION, HOLD_REASON_LABEL, type HoldReason } from "@shared/constants/payrollRun";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";

// The people in a run who will not get a payslip, and why. One function so the publish screen (before) and the Payslips card (after) show the same list in the same words:
// HR has to be able to see, at publish time and later, exactly who was not paid by this run and what to do about each of them.

export interface NoPayslipPerson {
  employeeId: string;
  employeeCode: string;
  name: string;
  /** HELD: calculated but not payable. EXCLUDED: could not be calculated at all. */
  kind: "HELD" | "EXCLUDED";
  reason: string | null;
  reasonLabel: string;
  detail: string | null;
  action: string;
}

export async function peopleWithoutPayslip(run: { id: string; cycleEnd: Date }): Promise<NoPayslipPerson[]> {
  const rows = await prisma.payrollRunItem.findMany({
    where: { runId: run.id, status: { in: ["HELD", "EXCLUDED"] } },
    include: { employee: { select: { employeeCode: true } } },
    orderBy: { employee: { employeeCode: "asc" } },
  });
  const names = await namesOn(rows.map((r) => r.employeeId), run.cycleEnd);
  return rows.map((r) => {
    const reason = r.holdReason as HoldReason | null;
    return {
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      name: names.get(r.employeeId) ?? r.employee.employeeCode,
      kind: r.status as "HELD" | "EXCLUDED",
      reason: r.holdReason,
      reasonLabel: reason && HOLD_REASON_LABEL[reason] ? HOLD_REASON_LABEL[reason] : "Held",
      detail: r.holdDetail,
      action: reason && HOLD_REASON_ACTION[reason] ? HOLD_REASON_ACTION[reason] : "Look at their line in the run.",
    };
  });
}
