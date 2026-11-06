import { salaryHistory } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { canonicalDecimal, dec } from "../money";

// P7-3 (docs/plans/PHASE_7.md §6): the employee's own Salary Revision page. Their own pay is theirs to see: every salary row that has been applied to them (past,
// current and scheduled), its CTC and breakup by pay head, and the change from the row before. Nobody else's, ever (the route passes the signed-in person only).

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function mySalaryRevisions(employeeId: string) {
  const history = await salaryHistory(employeeId);
  const codes = [...new Set(history.flatMap((h) => h.lines.map((l) => `${l.componentCode}@${l.componentVersion}`)))];
  const versions = codes.length
    ? await prisma.payrollItemVersion.findMany({ where: { kind: "COMPONENT", OR: codes.map((c) => ({ key: c.split("@")[0]!, version: Number(c.split("@")[1]) })) }, select: { key: true, version: true, value: true } }) // allow-number: a pay head's version number, not money
    : [];
  const nameOf = new Map(versions.map((v) => [`${v.key}@${v.version}`, (v.value as { name?: string }).name ?? v.key]));
  const rows = [...history].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  return {
    revisions: rows
      .map((r, i) => {
        const before = i > 0 ? rows[i - 1]! : null;
        const annual = dec(r.annualCtc.toString());
        return {
          effectiveFrom: iso(r.effectiveFrom)!,
          effectiveTo: iso(r.effectiveTo),
          reason: r.reason,
          annualCtc: canonicalDecimal(annual),
          monthlyCtc: canonicalDecimal(dec(r.monthlyCtc.toString())),
          previousAnnualCtc: before ? canonicalDecimal(dec(before.annualCtc.toString())) : null,
          change: before ? canonicalDecimal(annual.minus(dec(before.annualCtc.toString()))) : null,
          breakup: [...r.lines].sort((a, b) => a.sortOrder - b.sortOrder).map((l) => ({ code: l.componentCode, name: nameOf.get(`${l.componentCode}@${l.componentVersion}`) ?? l.componentCode, type: l.componentType, monthly: canonicalDecimal(dec(l.amount.toString())) })),
        };
      })
      .reverse(),
  };
}
