import { z } from "zod";
import { businessToday } from "../../../lib/businessDate";
import { employedOn, latestSalaries, namesOn, placementsOn, rowStatus, salariesOn, salaryHistory, type SalaryWithLines } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { canonicalDecimal, dec } from "../money";

// Reading people's salaries for the Employee Salaries screen. Every read of a salary goes through the effective-dating readers with an explicit day.

export const employeeSalaryQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  missing: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const view = (r: SalaryWithLines) => ({
  id: r.id,
  effectiveFrom: iso(r.effectiveFrom)!,
  effectiveTo: iso(r.effectiveTo),
  status: rowStatus(r.effectiveFrom, r.effectiveTo, businessToday()),
  reason: r.reason,
  annualCtc: canonicalDecimal(dec(r.annualCtc.toString())),
  monthlyCtc: canonicalDecimal(dec(r.monthlyCtc.toString())),
  structure: `${r.structureKey} v${r.structureVersion}`,
  structureKey: r.structureKey,
  structureVersion: r.structureVersion,
  revisionId: r.revisionId,
  note: r.note,
  lines: r.lines.map((l) => ({ component: l.componentCode, componentVersion: l.componentVersion, type: l.componentType, amount: canonicalDecimal(dec(l.amount.toString())) })),
});

export async function listEmployeeSalaries(query: z.infer<typeof employeeSalaryQuerySchema>) {
  const today = businessToday();
  const where = {
    ...employedOn(today),
    ...(query.missing === "true" ? { salaries: { none: {} } } : {}),
    ...(query.q
      ? { OR: [{ employeeCode: { contains: query.q, mode: "insensitive" as const } }, { nameHistory: { some: { fullName: { contains: query.q, mode: "insensitive" as const } } } }] }
      : {}),
  };
  const [employees, total] = await Promise.all([
    prisma.employee.findMany({ where, orderBy: { employeeCode: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, employeeCode: true, dateOfJoining: true } }),
    prisma.employee.count({ where }),
  ]);
  const ids = employees.map((e) => e.id);
  const [names, current, latest, placements] = await Promise.all([namesOn(ids, today), salariesOn(ids, today), latestSalaries(ids), placementsOn(ids, today)]);
  return {
    total,
    items: employees.map((e) => {
      const cur = current.get(e.id);
      const last = latest.get(e.id);
      const scheduled = last && last.effectiveFrom > today ? last : null;
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        name: names.get(e.id) ?? e.employeeCode,
        branch: placements.get(e.id)?.location ?? null,
        joinedOn: iso(e.dateOfJoining)!,
        current: cur ? { annualCtc: canonicalDecimal(dec(cur.annualCtc.toString())), monthlyCtc: canonicalDecimal(dec(cur.monthlyCtc.toString())), structure: `${cur.structureKey} v${cur.structureVersion}`, since: iso(cur.effectiveFrom)! } : null,
        scheduled: scheduled ? { effectiveFrom: iso(scheduled.effectiveFrom)!, annualCtc: canonicalDecimal(dec(scheduled.annualCtc.toString())), structure: `${scheduled.structureKey} v${scheduled.structureVersion}` } : null,
      };
    }),
  };
}

export async function getEmployeeSalary(employeeId: string) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeCode: true, dateOfJoining: true, lastWorkingDate: true } });
  if (!emp) throw new HttpError(404, "That employee was not found.", "NOT_FOUND");
  const today = businessToday();
  const [names, history, pending] = await Promise.all([
    namesOn([employeeId], today),
    salaryHistory(employeeId),
    prisma.payrollAdjustment.findMany({ where: { employeeId, status: "PENDING" }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    employeeId,
    employeeCode: emp.employeeCode,
    name: names.get(employeeId) ?? emp.employeeCode,
    joinedOn: iso(emp.dateOfJoining)!,
    lastWorkingDate: iso(emp.lastWorkingDate),
    history: history.map(view),
    pendingAdjustments: pending.map((p) => ({ id: p.id, componentCode: p.componentCode, direction: p.direction, amount: canonicalDecimal(dec(p.amount.toString())), reason: p.reason, source: p.source, periodStart: iso(p.periodStart), periodEnd: iso(p.periodEnd) })),
  };
}

/** Find people by code or name, for the pickers on the revision and adjustment screens. */
export async function searchPeople(q: string) {
  const today = businessToday();
  const rows = await prisma.employee.findMany({
    where: { ...employedOn(today), OR: [{ employeeCode: { contains: q, mode: "insensitive" } }, { nameHistory: { some: { fullName: { contains: q, mode: "insensitive" } } } }] },
    orderBy: { employeeCode: "asc" },
    take: 20,
    select: { id: true, employeeCode: true },
  });
  const ids = rows.map((r) => r.id);
  const [names, latest, placements] = await Promise.all([namesOn(ids, today), latestSalaries(ids), placementsOn(ids, today)]);
  return rows.map((r) => ({ employeeId: r.id, employeeCode: r.employeeCode, name: names.get(r.id) ?? r.employeeCode, branch: placements.get(r.id)?.location ?? null, hasSalary: latest.has(r.id) }));
}
