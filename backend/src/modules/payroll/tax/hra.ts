import { prisma } from "../../../lib/prisma";
import { dec, max, min, sum, ZERO, type Money } from "../money";

// Part 4 (ST-15, docs/plans/A_PART4.md): the HRA exemption in the old regime. The least of: the HRA received; the rent paid less a percentage of the basis; a
// percentage of the basis (one for a metro city, one for others). Every percentage and the heads are the owners' (the tax year); absent = no exemption.

export interface HraDef { rentSection: string; hraHeads: string[]; basisHeads: string[]; rentExcessPercent: string; metroPercent: string; nonMetroPercent: string; metro: boolean }

/** Pure: the exemption for a year's figures. Exported for the exact-fraction test. */
export function hraExemptionOf(def: HraDef, figures: { received: Money; basis: Money; rent: Money }): Money {
  const hundred = dec("100");
  const rentLess = max(ZERO, figures.rent.minus(figures.basis.times(dec(def.rentExcessPercent)).div(hundred)));
  const share = figures.basis.times(dec(def.metro ? def.metroPercent : def.nonMetroPercent)).div(hundred);
  return max(ZERO, min(min(figures.received, rentLess), share));
}

/** What finalised runs of the financial year paid on the chosen heads before `before` (YYYY-MM-DD), for each person. */
export async function headsPaidSoFar(employeeIds: readonly string[], fyStart: string, before: string, heads: readonly string[]): Promise<Map<string, Money>> {
  const lines = await prisma.payrollRunLine.findMany({
    where: { employeeId: { in: [...employeeIds] }, code: { in: [...heads] }, kind: "EARNING", runItem: { status: "PAYABLE" }, run: { status: "FINALISED", cycleEnd: { gte: new Date(`${fyStart}T00:00:00Z`), lt: new Date(`${before}T00:00:00Z`) } } },
    select: { employeeId: true, amount: true },
  });
  const out = new Map<string, Money>();
  for (const id of employeeIds) out.set(id, sum(lines.filter((l) => l.employeeId === id).map((l) => dec(l.amount.toString()))));
  return out;
}
