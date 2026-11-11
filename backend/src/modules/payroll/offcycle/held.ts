import { prisma } from "../../../lib/prisma";
import { dec, ZERO } from "../money";

// Held pay that is still owed: a HELD item of a FINALISED run with a positive net, not yet paid either way. One reader for the settlement, the off-cycle run and
// the director's release, so all three agree on what is unpaid (P7-6b).
//
// It has been paid (or is about to be) when:
//   - an off-cycle run released it (off_cycle_held_releases, unique per item), or
//   - a director released the hold after the run was final, which created a HOLD_RELEASE adjustment (sourceRef = the hold's id) that is not cancelled.
// Items held because they could not be worked out (attendance not final, no salary, part month, negative or nil net) are not payable as they stand.

export const PAYABLE_HELD_REASONS = ["DIRECTOR_HOLD", "FINAL_SETTLEMENT", "NO_BANK_ACCOUNT"] as const;

export async function unpaidHeldItems(where: { employeeId?: string; itemId?: string } = {}) {
  const items = await prisma.payrollRunItem.findMany({
    where: { ...(where.employeeId ? { employeeId: where.employeeId } : {}), ...(where.itemId ? { id: where.itemId } : {}), status: "HELD", holdReason: { in: [...PAYABLE_HELD_REASONS] }, run: { status: "FINALISED" } },
    include: { run: { select: { cycleLabel: true, cycleStart: true } }, employee: { select: { employeeCode: true } } },
  });
  if (items.length === 0) return [];
  const [offCycle, holds] = await Promise.all([
    prisma.offCycleHeldRelease.findMany({ where: { itemId: { in: items.map((i) => i.id) } }, select: { itemId: true } }),
    prisma.payrollSalaryHold.findMany({ where: { employeeId: { in: [...new Set(items.map((i) => i.employeeId))] }, release: { adjustmentId: { not: null } } }, select: { employeeId: true, cycleStart: true, release: { select: { adjustmentId: true } } } }),
  ]);
  const adjustmentIds = holds.map((h) => h.release!.adjustmentId!);
  const live = new Set((await prisma.payrollAdjustment.findMany({ where: { id: { in: adjustmentIds }, status: { not: "CANCELLED" } }, select: { id: true } })).map((a) => a.id));
  const releasedByHold = new Set(holds.filter((h) => live.has(h.release!.adjustmentId!)).map((h) => `${h.employeeId}|${h.cycleStart.toISOString()}`));
  const paidOffCycle = new Set(offCycle.map((r) => r.itemId));
  return items.filter((i) => dec(i.netPay.toString()).gt(ZERO) && !paidOffCycle.has(i.id) && !releasedByHold.has(`${i.employeeId}|${i.run.cycleStart.toISOString()}`));
}
