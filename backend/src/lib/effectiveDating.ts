import { Prisma, type AttendanceAssignment, type DeviceUserMapping, type EmployeeBankAccount, type EmployeeJobHistory, type EmployeeNameHistory, type EmployeeSalary, type EmployeeSalaryLine, type SalaryChangeReason } from "@prisma/client";
import { HttpError } from "../middleware/errorHandler";
import { addCalendarDays, businessToday } from "./businessDate";
import { logger } from "./logger";
import { prisma } from "./prisma";
import { getSetting } from "./settings";

// Effective dating — ONE model for every history table (user decisions
// 2026-10-03, docs/plans/EFFECTIVE_DATES.md):
//
//   - A row covers its start date up to, but NOT including, its end date:
//     in force on day D  ⇔  effective_from <= D AND (effective_to IS NULL
//     OR effective_to > D). effective_to is the next row's effective_from.
//   - "Current" means in force TODAY (businessToday(), IST) — never "the row
//     with no end date", which may be a scheduled future change.
//   - History is only ever appended at the end: a change dated D must be on
//     or after the start of the latest row. Older history is never
//     rewritten. A change dated the SAME day as the latest row amends that
//     row (a same-day correction, audited by the caller with before/after).
//   - A scheduled change (not yet in force) can be cancelled: the row is
//     removed and the previous one reopened; the caller audits the removed
//     row in full.
//   - Leaving closes job history and device mappings the day AFTER the last
//     working day, so a leaver is in force on their last day.
//   - The database backs this up: CHECK (to > from) and an EXCLUDE
//     constraint so no two rows for one employee overlap (migration
//     20261004090000_effective_dating).

const iso = (d: Date) => d.toISOString().slice(0, 10);

// ── Reading ──────────────────────────────────────────────────────────────

/** Prisma `where` for effectiveFrom/effectiveTo tables: rows in force on `day`. */
export function inForceOn(day: Date = businessToday()) {
  return { effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: day } }] };
}

/** The same for validFrom/validTo (device_user_mappings). */
export function mappingInForceOn(day: Date = businessToday()) {
  return { validFrom: { lte: day }, OR: [{ validTo: null }, { validTo: { gt: day } }] };
}

/**
 * The same condition for raw SQL on an effective_from/effective_to table
 * aliased `alias` (e.g. the team-scope recursive query).
 */
export function inForceSql(alias: "jh", day: Date = businessToday()): Prisma.Sql {
  const d = iso(day);
  return Prisma.sql`${Prisma.raw(alias)}.effective_from <= ${d}::date AND (${Prisma.raw(alias)}.effective_to IS NULL OR ${Prisma.raw(alias)}.effective_to > ${d}::date)`;
}

/**
 * Raw-SQL condition: the employee `employeeIdExpr` was placed at this branch and/or department on the date `dateExpr`
 * (a column such as d.date). For paged, filterable lists over per-day rows (the exceptions queue), where reading
 * placements one person at a time is not an option. The placement history is only ever read here.
 */
export function placedAtSql(employeeIdExpr: Prisma.Sql, dateExpr: Prisma.Sql, where: { locationId?: string; departmentId?: string }): Prisma.Sql {
  const extra = [
    where.locationId ? Prisma.sql`AND jh.location_id = ${where.locationId}` : Prisma.empty,
    where.departmentId ? Prisma.sql`AND jh.department_id = ${where.departmentId}` : Prisma.empty,
  ];
  return Prisma.sql`EXISTS (SELECT 1 FROM employee_job_history jh WHERE jh.employee_id = ${employeeIdExpr} AND jh.effective_from <= ${dateExpr} AND (jh.effective_to IS NULL OR jh.effective_to > ${dateExpr}) ${Prisma.join(extra, " ")})`;
}

/**
 * Where a new person's first name/placement/bank row starts: their date of
 * joining, or today if they join later — so a pre-joiner is in force (named,
 * in their team) from the day they're added. Employment itself is always
 * read from dateOfJoining / lastWorkingDate, never from these rows.
 */
export function firstHistoryDay(dateOfJoining: Date, today: Date = businessToday()): Date {
  return dateOfJoining < today ? dateOfJoining : today;
}

/** The exclusive end date for something whose last covered day is `lastDay`. */
export const dayAfter = (lastDay: Date) => addCalendarDays(lastDay, 1);


export interface Placement {
  departmentId: string;
  department: string;
  designation: string;
  locationId: string;
  location: string;
  city: string | null;
  reportingManagerId: string | null;
  reportingManager: string | null;
}

/**
 * The job placement in force on `day` for each employee. A day before
 * someone's first placement falls back to their first row (a joiner shown
 * as of their date of joining); a gap — which the constraints and the
 * writer now prevent — falls back to the latest row that had started.
 * The reporting manager's name is the one in force on `day` too.
 */
export async function placementsOn(employeeIds: string[], day: Date): Promise<Map<string, Placement>> {
  const rows = await prisma.employeeJobHistory.findMany({
    where: { employeeId: { in: employeeIds } },
    orderBy: { effectiveFrom: "asc" },
    select: {
      employeeId: true,
      effectiveFrom: true,
      effectiveTo: true,
      departmentId: true,
      locationId: true,
      reportingManagerId: true,
      department: { select: { name: true } },
      designation: { select: { name: true } },
      location: { select: { name: true, cityMaster: { select: { name: true } } } },
      reportingManager: { select: { employeeCode: true, nameHistory: { where: inForceOn(day), select: { fullName: true } } } },
    },
  });
  const toPlacement = (r: (typeof rows)[number]): Placement => ({
    departmentId: r.departmentId,
    department: r.department.name,
    designation: r.designation.name,
    locationId: r.locationId,
    location: r.location.name,
    city: r.location.cityMaster?.name ?? null,
    reportingManagerId: r.reportingManagerId,
    reportingManager: r.reportingManager ? (r.reportingManager.nameHistory[0]?.fullName ?? r.reportingManager.employeeCode) : null,
  });
  const t = day.getTime();
  const byEmployee = new Map<string, typeof rows>();
  for (const r of rows) byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r]);
  const result = new Map<string, Placement>();
  for (const [id, history] of byEmployee) {
    const inForce = history.find((r) => r.effectiveFrom.getTime() <= t && (!r.effectiveTo || r.effectiveTo.getTime() > t));
    const started = history.filter((r) => r.effectiveFrom.getTime() <= t);
    result.set(id, toPlacement(inForce ?? started.at(-1) ?? history[0]!)); // rows are oldest first
  }
  return result;
}

// ── The payroll contract (EF4) ───────────────────────────────────────────
// Payroll, attendance and anything else that asks "what was true on day D"
// uses these readers — never a raw history query (docs/plans/PHASE_6.md,
// "Effective-dating contract"). Each takes the day explicitly; none of them
// defaults to today.

/** The placement in force on `day` (null if none — before the first, or after leaving). */
export async function placementOn(employeeId: string, day: Date): Promise<EmployeeJobHistory | null> {
  return prisma.employeeJobHistory.findFirst({ where: { employeeId, ...inForceOn(day) } });
}

/** Every placement covering any part of [from, to] (inclusive days), each clipped to that range, oldest first. */
export async function placementSegments(employeeId: string, from: Date, to: Date): Promise<Array<{ row: EmployeeJobHistory; from: Date; to: Date }>> {
  const rows = await prisma.employeeJobHistory.findMany({
    where: { employeeId, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] },
    orderBy: { effectiveFrom: "asc" },
  });
  return rows.map((row) => {
    const segFrom = row.effectiveFrom > from ? row.effectiveFrom : from;
    const lastDay = row.effectiveTo ? addCalendarDays(row.effectiveTo, -1) : to;
    return { row, from: segFrom, to: lastDay < to ? lastDay : to };
  });
}

/**
 * Branch and department per employee over [from, to] (inclusive days), as
 * clipped segments oldest first — the muster's "which branch was this
 * person in on day D" (P2-D: manual entry is branch-limited per day).
 */
export async function placementPeriods(employeeIds: string[], from: Date, to: Date): Promise<Map<string, Array<{ locationId: string; departmentId: string; from: Date; to: Date }>>> {
  const rows = await prisma.employeeJobHistory.findMany({
    where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] },
    orderBy: { effectiveFrom: "asc" },
    select: { employeeId: true, locationId: true, departmentId: true, effectiveFrom: true, effectiveTo: true },
  });
  const out = new Map<string, Array<{ locationId: string; departmentId: string; from: Date; to: Date }>>();
  for (const r of rows) {
    const segFrom = r.effectiveFrom > from ? r.effectiveFrom : from;
    const lastDay = r.effectiveTo ? addCalendarDays(r.effectiveTo, -1) : to;
    out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), { locationId: r.locationId, departmentId: r.departmentId, from: segFrom, to: lastDay < to ? lastDay : to }]);
  }
  return out;
}

const assignmentInclude = { shift: { include: { sessions: { orderBy: { sortOrder: "asc" as const } } } }, weekOffPattern: true, policy: true } as const;
export type AssignmentWithRules = Prisma.AttendanceAssignmentGetPayload<{ include: typeof assignmentInclude }>;

/** The attendance assignment (shift with sessions, week-off pattern, policy) in force on `day`. */
export async function assignmentOn(employeeId: string, day: Date): Promise<AssignmentWithRules | null> {
  return prisma.attendanceAssignment.findFirst({ where: { employeeId, ...inForceOn(day) }, include: assignmentInclude });
}

/** Every assignment covering part of [from, to] (inclusive days), clipped, oldest first. */
export async function assignmentSegments(employeeId: string, from: Date, to: Date): Promise<Array<{ row: AssignmentWithRules; from: Date; to: Date }>> {
  const rows = await prisma.attendanceAssignment.findMany({
    where: { employeeId, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] },
    orderBy: { effectiveFrom: "asc" },
    include: assignmentInclude,
  });
  return rows.map((row) => {
    const lastDay = row.effectiveTo ? addCalendarDays(row.effectiveTo, -1) : to;
    return { row, from: row.effectiveFrom > from ? row.effectiveFrom : from, to: lastDay < to ? lastDay : to };
  });
}

/** Everyone's assignment in force on `day` (bulk screens), keyed by employee id. */
export async function assignmentsOn(employeeIds: string[], day: Date): Promise<Map<string, AssignmentWithRules>> {
  const rows = await prisma.attendanceAssignment.findMany({ where: { employeeId: { in: employeeIds }, ...inForceOn(day) }, include: assignmentInclude });
  return new Map(rows.map((r) => [r.employeeId, r]));
}

/** For each employee, their next scheduled assignment change after `day` (if any). */
export async function nextAssignmentChanges(employeeIds: string[], day: Date): Promise<Map<string, AssignmentWithRules>> {
  const rows = await prisma.attendanceAssignment.findMany({ where: { employeeId: { in: employeeIds }, effectiveFrom: { gt: day } }, orderBy: { effectiveFrom: "asc" }, include: assignmentInclude });
  const out = new Map<string, AssignmentWithRules>();
  for (const r of rows) if (!out.has(r.employeeId)) out.set(r.employeeId, r);
  return out;
}

/** Every assignment row overlapping [from, to] (inclusive days) for these employees — the engine's loader picks the one in force per day. */
export async function assignmentsBetween(employeeIds: string[], from: Date, to: Date): Promise<AssignmentWithRules[]> {
  return prisma.attendanceAssignment.findMany({
    where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] },
    orderBy: { effectiveFrom: "asc" },
    include: assignmentInclude,
  });
}

// ── Salary (Phase 6, docs/plans/PHASE_6.md §14B) ─────────────────────────
// A person's salary is effective-dated in the same family, with one deliberate difference: a change dated the same day as the latest row is REFUSED,
// never amended, because an amend would overwrite money. A salary row is written only through writeSalaryChange (called by a salary revision) and read
// only through these functions; payroll code never queries employee_salaries directly (currentRowGuard.test.ts).

export type SalaryWithLines = EmployeeSalary & { lines: EmployeeSalaryLine[] };
const salaryInclude = { lines: { orderBy: { sortOrder: "asc" as const } } } as const;

/** The salary (with its frozen breakup) in force on `day`; null before the first row or after leaving. */
export async function salaryOn(employeeId: string, day: Date): Promise<SalaryWithLines | null> {
  return prisma.employeeSalary.findFirst({ where: { employeeId, ...inForceOn(day) }, include: salaryInclude });
}

/** Everyone's salary in force on `day` (bulk screens), keyed by employee id. */
export async function salariesOn(employeeIds: string[], day: Date): Promise<Map<string, SalaryWithLines>> {
  const rows = await prisma.employeeSalary.findMany({ where: { employeeId: { in: employeeIds }, ...inForceOn(day) }, include: salaryInclude });
  return new Map(rows.map((r) => [r.employeeId, r]));
}

/** Every salary row covering part of [from, to] (inclusive days), clipped to that range, oldest first: a revision on the 16th gives two segments. */
export async function salarySegments(employeeId: string, from: Date, to: Date): Promise<Array<{ row: SalaryWithLines; from: Date; to: Date }>> {
  const rows = await prisma.employeeSalary.findMany({
    where: { employeeId, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] },
    orderBy: { effectiveFrom: "asc" },
    include: salaryInclude,
  });
  return rows.map((row) => {
    const lastDay = row.effectiveTo ? addCalendarDays(row.effectiveTo, -1) : to;
    return { row, from: row.effectiveFrom > from ? row.effectiveFrom : from, to: lastDay < to ? lastDay : to };
  });
}

/** Many people's salary rows covering part of [from, to], each clipped to that range, oldest first, keyed by employee id (one query, for a payroll run). */
export async function salarySegmentsMany(employeeIds: string[], from: Date, to: Date): Promise<Map<string, Array<{ row: SalaryWithLines; from: Date; to: Date }>>> {
  const rows = await prisma.employeeSalary.findMany({
    where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] },
    orderBy: [{ employeeId: "asc" }, { effectiveFrom: "asc" }],
    include: salaryInclude,
  });
  const out = new Map<string, Array<{ row: SalaryWithLines; from: Date; to: Date }>>();
  for (const row of rows) {
    const lastDay = row.effectiveTo ? addCalendarDays(row.effectiveTo, -1) : to;
    const list = out.get(row.employeeId) ?? [];
    list.push({ row, from: row.effectiveFrom > from ? row.effectiveFrom : from, to: lastDay < to ? lastDay : to });
    out.set(row.employeeId, list);
  }
  return out;
}

/** One employee's whole salary history, newest first (past, current and scheduled), for the Employee Salaries screen. */
export async function salaryHistory(employeeId: string): Promise<SalaryWithLines[]> {
  return prisma.employeeSalary.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" }, include: salaryInclude });
}

/** The salary rows a salary revision wrote, for showing an applied revision as it was written. */
export async function salaryRowsOfRevision(revisionId: string): Promise<SalaryWithLines[]> {
  return prisma.employeeSalary.findMany({ where: { revisionId }, orderBy: { effectiveFrom: "asc" }, include: salaryInclude });
}

/** The latest salary row per employee (whatever its dates), keyed by employee id: where the next revision would start from. */
export async function latestSalaries(employeeIds: string[]): Promise<Map<string, SalaryWithLines>> {
  const rows = await prisma.employeeSalary.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { effectiveFrom: "asc" }, include: salaryInclude });
  const out = new Map<string, SalaryWithLines>();
  for (const r of rows) out.set(r.employeeId, r); // oldest first, so the last write per employee is the latest row
  return out;
}

/** Employees employed on `day` who were placed at this branch and/or in this grade on it (a salary revision's "everyone in grade G" pick). */
export async function employeeIdsPlacedOn(day: Date, filter: { locationId?: string; gradeId?: string }): Promise<string[]> {
  const rows = await prisma.employeeJobHistory.findMany({
    where: { ...inForceOn(day), ...(filter.locationId ? { locationId: filter.locationId } : {}), ...(filter.gradeId ? { gradeId: filter.gradeId } : {}), employee: employedOn(day) },
    select: { employeeId: true },
  });
  return [...new Set(rows.map((r) => r.employeeId))];
}

/** Employees whose salary in force on `day` is on this structure (and version, if given). */
export async function employeeIdsOnStructure(day: Date, structureKey: string, structureVersion?: number): Promise<string[]> {
  const rows = await prisma.employeeSalary.findMany({
    where: { ...inForceOn(day), structureKey, ...(structureVersion ? { structureVersion } : {}), employee: employedOn(day) },
    select: { employeeId: true },
  });
  return [...new Set(rows.map((r) => r.employeeId))];
}

/** In-force test for a half-open row on `day` (shared by the engine's loader). */
export function rowInForce(row: { effectiveFrom: Date; effectiveTo: Date | null }, day: Date): boolean {
  return row.effectiveFrom <= day && (!row.effectiveTo || row.effectiveTo > day);
}

/**
 * Device-mapping periods overlapping [from, to] for these employees, as
 * half-open [from, to) — the engine's "capture" per day: a day inside one is
 * device capture, any other day is manual (docs/plans/PHASE_2.md §4.3).
 */
export async function deviceMappingPeriods(employeeIds: string[], from: Date, to: Date): Promise<Map<string, Array<{ from: Date; to: Date | null }>>> {
  const rows = await prisma.deviceUserMapping.findMany({
    where: { employeeId: { in: employeeIds }, validFrom: { lte: to }, OR: [{ validTo: null }, { validTo: { gt: from } }] },
    select: { employeeId: true, validFrom: true, validTo: true },
  });
  const out = new Map<string, Array<{ from: Date; to: Date | null }>>();
  for (const r of rows) out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), { from: r.validFrom, to: r.validTo }]);
  return out;
}

/** Everyone's whole assignment history with each shift's code, oldest first (the shift roster plans against it). */
export async function assignmentHistories(employeeIds: string[]) {
  return prisma.attendanceAssignment.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { effectiveFrom: "asc" }, include: { shift: { select: { id: true, code: true } } } });
}

/** One employee's whole assignment history, newest first (the Assignments tab). */
export async function assignmentHistory(employeeId: string): Promise<AssignmentWithRules[]> {
  return prisma.attendanceAssignment.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" }, include: assignmentInclude });
}

/** The name in force on `day` (a payslip or letter keeps the name of its own date). */
export async function nameOn(employeeId: string, day: Date): Promise<string | null> {
  const row = await prisma.employeeNameHistory.findFirst({ where: { employeeId, ...inForceOn(day) }, select: { fullName: true } });
  return row?.fullName ?? null;
}

/** Everyone's name in force on `day` (bulk screens), keyed by employee id. */
export async function namesOn(employeeIds: string[], day: Date): Promise<Map<string, string>> {
  const rows = await prisma.employeeNameHistory.findMany({ where: { employeeId: { in: employeeIds }, ...inForceOn(day) }, select: { employeeId: true, fullName: true } });
  return new Map(rows.map((r) => [r.employeeId, r.fullName]));
}

/**
 * Of `employeeIds`, those with a device mapping in force on `day` — the
 * rest are manual capture that day (Phase 2, docs/plans/PHASE_2.md §4.3:
 * manual capture = no mapping in force, never a flag or a branch setting).
 */
export async function deviceCapturedOn(employeeIds: string[], day: Date): Promise<Set<string>> {
  const rows = await prisma.deviceUserMapping.findMany({ where: { employeeId: { in: employeeIds }, ...mappingInForceOn(day) }, select: { employeeId: true } });
  return new Set(rows.map((r) => r.employeeId));
}

/**
 * How many employees each shift / week-off pattern / policy applies to,
 * today or in a scheduled change — what deactivating one would strand.
 */
export async function assignmentUsage(today: Date = businessToday()): Promise<{ shift: Map<string, number>; weekOffPattern: Map<string, number>; policy: Map<string, number> }> {
  const rows = await prisma.attendanceAssignment.findMany({
    where: { OR: [{ effectiveTo: { gt: today } }, { effectiveTo: null }] },
    select: { employeeId: true, shiftId: true, weekOffPatternId: true, policyId: true },
  });
  const count = (key: "shiftId" | "weekOffPatternId" | "policyId") => {
    const people = new Map<string, Set<string>>();
    for (const r of rows) people.set(r[key], (people.get(r[key]) ?? new Set()).add(r.employeeId));
    return new Map([...people].map(([id, set]) => [id, set.size]));
  };
  return { shift: count("shiftId"), weekOffPattern: count("weekOffPatternId"), policy: count("policyId") };
}

/** The bank account in force on `day` — for a payment, the payment date. */
export async function bankAccountOn(employeeId: string, day: Date): Promise<EmployeeBankAccount | null> {
  return prisma.employeeBankAccount.findFirst({ where: { employeeId, ...inForceOn(day) } });
}

/** Many people's bank account in force on `day` (the payment date), keyed by employee id; a person with none is absent. */
export async function bankAccountsOn(employeeIds: string[], day: Date): Promise<Map<string, EmployeeBankAccount>> {
  const rows = await prisma.employeeBankAccount.findMany({ where: { employeeId: { in: employeeIds }, ...inForceOn(day) } });
  return new Map(rows.map((r) => [r.employeeId, r]));
}

export interface PayrollPlacement {
  locationId: string;
  /** The free text on the branch (for example "Tamilnadu"), mapped to a state key by a payroll rule. */
  locationState: string;
  departmentId: string;
  gradeId: string | null;
  costCentreId: string | null;
}

/** Where each person was placed on `day`, with what payroll needs (state of the branch, grade, cost centre), keyed by employee id. */
export async function payrollPlacementsOn(employeeIds: string[], day: Date): Promise<Map<string, PayrollPlacement>> {
  const rows = await prisma.employeeJobHistory.findMany({
    where: { employeeId: { in: employeeIds }, ...inForceOn(day) },
    select: { employeeId: true, locationId: true, departmentId: true, gradeId: true, costCentreId: true, location: { select: { state: true } } },
  });
  return new Map(rows.map((r) => [r.employeeId, { locationId: r.locationId, locationState: r.location.state, departmentId: r.departmentId, gradeId: r.gradeId, costCentreId: r.costCentreId }]));
}

/** Whose punch is this: the employee a device user ID belonged to on `day`. */
export async function employeeForDeviceUserOn(deviceUserId: string, day: Date): Promise<string | null> {
  const m = await prisma.deviceUserMapping.findFirst({ where: { deviceUserId, ...mappingInForceOn(day) }, select: { employeeId: true } });
  return m?.employeeId ?? null;
}

/**
 * Bulk form of employeeForDeviceUserOn, for an ingestion batch: whose punch
 * is each (device user ID, day)? Keyed `${deviceUserId}|${YYYY-MM-DD}`;
 * absent = unmapped that day.
 */
export async function employeesForDeviceUsersOn(keys: Array<{ deviceUserId: string; day: Date }>): Promise<Map<string, string>> {
  const ids = [...new Set(keys.map((k) => k.deviceUserId))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await prisma.deviceUserMapping.findMany({ where: { deviceUserId: { in: ids } }, select: { deviceUserId: true, employeeId: true, validFrom: true, validTo: true } });
  for (const k of keys) {
    const m = rows.find((r) => r.deviceUserId === k.deviceUserId && r.validFrom <= k.day && (!r.validTo || r.validTo > k.day));
    if (m) out.set(`${k.deviceUserId}|${iso(k.day)}`, m.employeeId);
  }
  return out;
}

/**
 * Prisma `where` on Employee: employed on `day` — joined on or before it,
 * and not yet past their last working day. Read from dateOfJoining /
 * lastWorkingDate, never from `status` (the login switch) or history rows.
 */
export function employedOn(day: Date) {
  return { dateOfJoining: { lte: day }, OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: day } }] };
}

/** Prisma `where` on Employee: employed on at least one day of [from, to] (a payroll cycle). Never `status`. */
export function employedBetween(from: Date, to: Date) {
  return { dateOfJoining: { lte: to }, OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: from } }] };
}

/** The part of [from, to] a person was employed: from the later of the start and their joining date to the earlier of the end and their last working day. */
export function employmentSpan(person: { dateOfJoining: Date; lastWorkingDate: Date | null }, from: Date, to: Date): { from: Date; to: Date } | null {
  const start = person.dateOfJoining > from ? person.dateOfJoining : from;
  const end = person.lastWorkingDate && person.lastWorkingDate < to ? person.lastWorkingDate : to;
  return start > end ? null : { from: start, to: end };
}

// ── Payroll's view of attendance ─────────────────────────────────────────
// Payroll pays only for days attendance has FINALISED (locked). A day that is not locked does not exist as far as payroll is concerned: an unlocked
// day can still change, and money is never calculated from a number that can still move. Payroll code reads attendance only through these two
// functions (currentRowGuard.test.ts forbids `dailyAttendance` in modules/payroll).

export interface FinalisedDay {
  date: Date;
  status: string;
  lopDays: Prisma.Decimal;
}

/** The locked days of these people in [from, to], oldest first, keyed by employee id. */
export async function finalisedAttendanceDays(employeeIds: string[], from: Date, to: Date): Promise<Map<string, FinalisedDay[]>> {
  const rows = await prisma.dailyAttendance.findMany({
    where: { employeeId: { in: employeeIds }, date: { gte: from, lte: to }, isLocked: true },
    select: { employeeId: true, date: true, status: true, lopDays: true },
    orderBy: [{ employeeId: "asc" }, { date: "asc" }],
  });
  const out = new Map<string, FinalisedDay[]>();
  for (const r of rows) {
    const list = out.get(r.employeeId) ?? [];
    list.push({ date: r.date, status: r.status, lopDays: r.lopDays });
    out.set(r.employeeId, list);
  }
  return out;
}

/** For each person, the days of their employment inside [from, to] that attendance has not locked (missing or still open), as ISO dates. People with none are absent. */
export async function unfinalisedAttendanceDays(people: Array<{ id: string; dateOfJoining: Date; lastWorkingDate: Date | null }>, from: Date, to: Date): Promise<Map<string, string[]>> {
  const locked = await finalisedAttendanceDays(people.map((p) => p.id), from, to);
  const out = new Map<string, string[]>();
  for (const p of people) {
    const span = employmentSpan(p, from, to);
    if (!span) continue;
    const have = new Set((locked.get(p.id) ?? []).map((d) => iso(d.date)));
    const missing: string[] = [];
    for (let d = span.from; d <= span.to; d = addCalendarDays(d, 1)) if (!have.has(iso(d))) missing.push(iso(d));
    if (missing.length) out.set(p.id, missing);
  }
  return out;
}

// ── Payroll lock (EF4 hook; enforced from Phase 6) ───────────────────────
// A change dated inside a locked (finalised) payroll period would silently
// change what was paid. Phase 6 registers the real check; until then there
// are no locked periods and this lets everything through. Every history
// writer, cancel and separation close calls it with the date it changes.
type PayrollLockCheck = (day: Date) => Promise<{ locked: boolean; period?: string }>;
let payrollLockCheck: PayrollLockCheck = async () => ({ locked: false });
export function setPayrollLockCheck(check: PayrollLockCheck | null): void {
  payrollLockCheck = check ?? (async () => ({ locked: false }));
}
/** Whether payroll has locked any day in [from, to] (inclusive), and the first period that did. Until Phase 6 nothing is locked. */
export async function payrollLockedBetween(from: Date, to: Date): Promise<{ locked: boolean; period?: string }> {
  for (let d = from; d.getTime() <= to.getTime(); d = addCalendarDays(d, 1)) {
    const r = await payrollLockCheck(d);
    if (r.locked) return { locked: true, period: r.period ?? iso(d) };
  }
  return { locked: false };
}

// Two more seams, for what attendance must know about payroll without importing it (Phase 6, P6-4).
//   Consumption: has payroll relied on these days? True once a run for the period is submitted for approval, approved or finalised (the lock above is only the last
//     of those). Attendance's unlock asks it, and warns.
//   Inputs changed: something payroll reads has moved (attendance was unlocked), so any run waiting for a decision should be checked against its approved figures.
type PayrollConsumptionCheck = (from: Date, to: Date) => Promise<{ consumed: boolean; period?: string; stage?: "SUBMITTED" | "APPROVED" | "FINALISED" }>;
let payrollConsumptionCheck: PayrollConsumptionCheck = async () => ({ consumed: false });
export function setPayrollConsumptionCheck(check: PayrollConsumptionCheck | null): void {
  payrollConsumptionCheck = check ?? (async () => ({ consumed: false }));
}
export async function payrollConsumedBetween(from: Date, to: Date): Promise<{ consumed: boolean; period?: string; stage?: "SUBMITTED" | "APPROVED" | "FINALISED" }> {
  const locked = await payrollLockedBetween(from, to); // a locked period is a final one, whatever the second check says
  if (locked.locked) return { consumed: true, period: locked.period ?? iso(from), stage: "FINALISED" };
  return payrollConsumptionCheck(from, to);
}
type PayrollInputsListener = (what: string, actorUserId: string | null) => Promise<void>;
let payrollInputsListener: PayrollInputsListener = async () => undefined;
export function setPayrollInputsListener(listener: PayrollInputsListener | null): void {
  payrollInputsListener = listener ?? (async () => undefined);
}
/** Tells payroll that something it reads has moved. Never throws into the caller: the change has already happened and payroll re-checks on its own at every step. */
export async function notifyPayrollInputsChanged(what: string, actorUserId: string | null): Promise<void> {
  try {
    await payrollInputsListener(what, actorUserId);
  } catch (err) {
    logger.error({ err, what }, "payroll could not re-check its open runs");
  }
}

export async function assertNotInLockedPayroll(day: Date): Promise<void> {
  const r = await payrollLockCheck(day);
  if (r.locked) {
    throw new HttpError(409, `Payroll for ${r.period ?? iso(day)} is finalised, so a change dated ${iso(day)} would rewrite what was paid. Date it after that period.`, "PAYROLL_LOCKED");
  }
}

// ── Planning a change (pure — property-tested) ───────────────────────────

export interface TimelineRow {
  id: string;
  from: Date;
  to: Date | null;
}

export type TimelinePlan =
  | { kind: "first" } // no history yet: insert [D, ∞)
  | { kind: "append"; closeId: string } // close the latest at D, insert [D, ∞)
  | { kind: "amend"; id: string }; // D is the latest row's own start: replace its values

export const DEFAULT_MAX_SCHEDULE_DAYS = 366;
export const MAX_SCHEDULE_DAYS_KEY = "history.maxScheduleAheadDays";

export function planTimelineChange(rows: readonly TimelineRow[], day: Date, today: Date, maxAheadDays: number): TimelinePlan {
  if (day > addCalendarDays(today, maxAheadDays)) {
    throw new HttpError(400, `A change can be scheduled at most ${maxAheadDays} days ahead (until ${iso(addCalendarDays(today, maxAheadDays))}).`, "HISTORY_TOO_FAR_AHEAD");
  }
  if (rows.length === 0) return { kind: "first" };
  const latest = rows.reduce((a, b) => (b.from > a.from ? b : a));
  if (latest.to !== null) {
    throw new HttpError(409, `This history ended on ${iso(addCalendarDays(latest.to, -1))} (they've left), so it can't change.`, "HISTORY_CLOSED");
  }
  if (day < latest.from) {
    if (latest.from > today) {
      throw new HttpError(409, `A change is already scheduled for ${iso(latest.from)}. Cancel it first, or date this change on or after it.`, "HISTORY_SCHEDULED_EXISTS");
    }
    throw new HttpError(
      400,
      `A change can't be dated before the current period started (${iso(latest.from)}) — earlier history is never rewritten.`,
      "HISTORY_BEFORE_LATEST",
    );
  }
  if (day.getTime() === latest.from.getTime()) return { kind: "amend", id: latest.id };
  return { kind: "append", closeId: latest.id };
}

export async function maxScheduleAheadDays(): Promise<number> {
  const v = await getSetting<number>(MAX_SCHEDULE_DAYS_KEY, DEFAULT_MAX_SCHEDULE_DAYS);
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_MAX_SCHEDULE_DAYS;
}

// Serialises every history write for one employee (two HR users changing
// the same person at once can't interleave close + insert).
export async function lockEmployee(tx: Prisma.TransactionClient, employeeId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
}

/** Locks several employees in a fixed order (so two bulk writers cannot deadlock). */
export async function lockEmployees(tx: Prisma.TransactionClient, employeeIds: string[]): Promise<void> {
  for (const id of [...new Set(employeeIds)].sort()) await lockEmployee(tx, id);
}

// ── Writers: the only code that changes history ──────────────────────────

type JobFields = Pick<EmployeeJobHistory, "departmentId" | "designationId" | "locationId" | "gradeId" | "costCentreId" | "reportingManagerId">;

export interface TimelineWrite<T> {
  before: T | null; // the row in force before the change (null for the first row)
  after: T;
  plan: TimelinePlan["kind"];
}

/**
 * Change job history from `day`. `fields` is applied on top of the latest
 * row (or must be complete for the first row).
 */
export async function writeJobChange(
  tx: Prisma.TransactionClient,
  employeeId: string,
  day: Date,
  fields: Partial<JobFields>,
  meta: { createdByUserId: string; changeReason: string | null },
): Promise<TimelineWrite<EmployeeJobHistory>> {
  await lockEmployee(tx, employeeId);
  await assertNotInLockedPayroll(day);
  const rows = await tx.employeeJobHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });
  const plan = planTimelineChange(rows.map(toRow), day, businessToday(), await maxScheduleAheadDays());
  const latest = rows.at(-1) ?? null;
  const merged = {
    departmentId: fields.departmentId ?? latest?.departmentId,
    designationId: fields.designationId ?? latest?.designationId,
    locationId: fields.locationId ?? latest?.locationId,
    gradeId: fields.gradeId !== undefined ? fields.gradeId : (latest?.gradeId ?? null),
    costCentreId: fields.costCentreId !== undefined ? fields.costCentreId : (latest?.costCentreId ?? null),
    reportingManagerId: fields.reportingManagerId !== undefined ? fields.reportingManagerId : (latest?.reportingManagerId ?? null),
  };
  if (!merged.departmentId || !merged.designationId || !merged.locationId) {
    throw new HttpError(400, "This employee has no job placement yet — choose a department, designation and location.", "VALIDATION_ERROR");
  }
  const data = { ...merged, departmentId: merged.departmentId, designationId: merged.designationId, locationId: merged.locationId, changeReason: meta.changeReason };
  if (plan.kind === "amend") {
    const after = await tx.employeeJobHistory.update({ where: { id: plan.id }, data: { ...data, createdByUserId: meta.createdByUserId } });
    return { before: latest, after, plan: plan.kind };
  }
  if (plan.kind === "append") await tx.employeeJobHistory.update({ where: { id: plan.closeId }, data: { effectiveTo: day } });
  const after = await tx.employeeJobHistory.create({ data: { employeeId, ...data, effectiveFrom: day, createdByUserId: meta.createdByUserId } });
  return { before: latest, after, plan: plan.kind };
}

export async function writeNameChange(
  tx: Prisma.TransactionClient,
  employeeId: string,
  day: Date,
  fullName: string,
  meta: { createdByUserId: string; changeReason: string | null },
): Promise<TimelineWrite<EmployeeNameHistory>> {
  await lockEmployee(tx, employeeId);
  await assertNotInLockedPayroll(day);
  const rows = await tx.employeeNameHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });
  const plan = planTimelineChange(rows.map(toRow), day, businessToday(), await maxScheduleAheadDays());
  const latest = rows.at(-1) ?? null;
  if (plan.kind === "amend") {
    const after = await tx.employeeNameHistory.update({ where: { id: plan.id }, data: { fullName, changeReason: meta.changeReason, createdByUserId: meta.createdByUserId } });
    return { before: latest, after, plan: plan.kind };
  }
  if (plan.kind === "append") await tx.employeeNameHistory.update({ where: { id: plan.closeId }, data: { effectiveTo: day } });
  const after = await tx.employeeNameHistory.create({ data: { employeeId, fullName, effectiveFrom: day, changeReason: meta.changeReason, createdByUserId: meta.createdByUserId } });
  return { before: latest, after, plan: plan.kind };
}

type BankFields = Pick<EmployeeBankAccount, "accountHolderName" | "accountNumberEncrypted" | "accountNumberLast4" | "accountNumberHash" | "ifsc" | "bankName" | "branchName">;

export async function writeBankChange(
  tx: Prisma.TransactionClient,
  employeeId: string,
  day: Date,
  fields: BankFields,
  meta: { createdByUserId: string },
): Promise<TimelineWrite<EmployeeBankAccount>> {
  await lockEmployee(tx, employeeId);
  await assertNotInLockedPayroll(day);
  const rows = await tx.employeeBankAccount.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });
  const plan = planTimelineChange(rows.map(toRow), day, businessToday(), await maxScheduleAheadDays());
  const latest = rows.at(-1) ?? null;
  if (plan.kind === "amend") {
    const after = await tx.employeeBankAccount.update({ where: { id: plan.id }, data: { ...fields, createdByUserId: meta.createdByUserId } });
    return { before: latest, after, plan: plan.kind };
  }
  if (plan.kind === "append") await tx.employeeBankAccount.update({ where: { id: plan.closeId }, data: { effectiveTo: day } });
  const after = await tx.employeeBankAccount.create({ data: { employeeId, ...fields, effectiveFrom: day, createdByUserId: meta.createdByUserId } });
  return { before: latest, after, plan: plan.kind };
}

export type HistoryKind = "job" | "name" | "bank";

/** Where a history row stands today: already ended, in force, or scheduled. */
export function rowStatus(from: Date, to: Date | null, today: Date = businessToday()): "past" | "current" | "scheduled" {
  if (from > today) return "scheduled";
  if (to !== null && to <= today) return "past";
  return "current";
}

type AnyHistoryRow = EmployeeJobHistory | EmployeeNameHistory | EmployeeBankAccount;

type AssignmentFields = Pick<AttendanceAssignment, "shiftId" | "weekOffPatternId" | "policyId">;

/**
 * Phase 2: change an employee's attendance assignment (shift, week-off
 * pattern, policy) from `day` — the same rules as every history writer.
 * `fields` apply on top of the latest row (or must be complete for the first).
 */
export async function writeAssignmentChange(
  tx: Prisma.TransactionClient,
  employeeId: string,
  day: Date,
  fields: Partial<AssignmentFields>,
  meta: { createdByUserId: string; changeReason: string | null },
): Promise<TimelineWrite<AttendanceAssignment>> {
  await lockEmployee(tx, employeeId);
  await assertNotInLockedPayroll(day);
  const rows = await tx.attendanceAssignment.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });
  const plan = planTimelineChange(rows.map(toRow), day, businessToday(), await maxScheduleAheadDays());
  const latest = rows.at(-1) ?? null;
  const shiftId = fields.shiftId ?? latest?.shiftId;
  const weekOffPatternId = fields.weekOffPatternId ?? latest?.weekOffPatternId;
  const policyId = fields.policyId ?? latest?.policyId;
  if (!shiftId || !weekOffPatternId || !policyId) throw new HttpError(400, "Choose a shift, week-off pattern and policy.", "VALIDATION_ERROR");
  const data = { shiftId, weekOffPatternId, policyId, changeReason: meta.changeReason };
  if (plan.kind === "amend") {
    const after = await tx.attendanceAssignment.update({ where: { id: plan.id }, data: { ...data, createdByUserId: meta.createdByUserId } });
    return { before: latest, after, plan: plan.kind };
  }
  if (plan.kind === "append") await tx.attendanceAssignment.update({ where: { id: plan.closeId }, data: { effectiveTo: day } });
  const after = await tx.attendanceAssignment.create({ data: { employeeId, ...data, effectiveFrom: day, createdByUserId: meta.createdByUserId } });
  return { before: latest, after, plan: plan.kind };
}

/**
 * Cancel a scheduled (not yet in force) change: the row is removed and the
 * previous one reopened. Returns the removed row for the caller's audit
 * entry. A change already in force can't be cancelled — supersede it.
 */
export async function cancelScheduledChange(tx: Prisma.TransactionClient, kind: HistoryKind, employeeId: string, rowId: string): Promise<{ removed: AnyHistoryRow; reopened: AnyHistoryRow }> {
  await lockEmployee(tx, employeeId);
  const rows: AnyHistoryRow[] =
    kind === "job"
      ? await tx.employeeJobHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } })
      : kind === "name"
        ? await tx.employeeNameHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } })
        : await tx.employeeBankAccount.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });
  const target = rows.find((r) => r.id === rowId);
  if (!target) throw new HttpError(404, "That change wasn't found.", "NOT_FOUND");
  if (target !== rows.at(-1)) throw new HttpError(409, "Only the latest scheduled change can be cancelled — cancel the later one first.", "HISTORY_NOT_LATEST");
  if (target.effectiveFrom <= businessToday()) throw new HttpError(409, "This change is already in force, so it can't be cancelled — make a new change instead.", "HISTORY_IN_FORCE");
  const previous = rows.at(-2);
  if (!previous) throw new HttpError(409, "This is the only record, so it can't be cancelled.", "HISTORY_ONLY_ROW");
  let reopened: AnyHistoryRow;
  if (kind === "job") {
    await tx.employeeJobHistory.delete({ where: { id: target.id } });
    reopened = await tx.employeeJobHistory.update({ where: { id: previous.id }, data: { effectiveTo: null } });
  } else if (kind === "name") {
    await tx.employeeNameHistory.delete({ where: { id: target.id } });
    reopened = await tx.employeeNameHistory.update({ where: { id: previous.id }, data: { effectiveTo: null } });
  } else {
    await tx.employeeBankAccount.delete({ where: { id: target.id } });
    reopened = await tx.employeeBankAccount.update({ where: { id: previous.id }, data: { effectiveTo: null } });
  }
  return { removed: target, reopened };
}

/** Job-only shorthand (EF1 tests). */
/**
 * Phase 2 (P2-B "map to employee"): give `employeeId` the device user ID
 * `deviceUserId` from `day`. The same rules as every history writer, on the
 * mapping timeline:
 *   - no mapping yet (manual capture until now) → a first row from `day`;
 *   - the same ID already in force → nothing to do, or, if it is their only
 *     row and `day` is earlier, its start moves back to `day` (covering punches
 *     that arrived before anyone mapped them — there was no row there to
 *     rewrite);
 *   - a different ID → the current row closes at `day` and the new one starts
 *     (or replaces it, dated its own start day).
 * Never before joining, never after leaving. One device ID is never two
 * people on the same day (the device_no_overlap constraint).
 */
export async function writeDeviceMapping(
  tx: Prisma.TransactionClient,
  employeeId: string,
  deviceUserId: string,
  day: Date,
  meta: { createdByUserId: string },
): Promise<{ before: DeviceUserMapping | null; after: DeviceUserMapping; plan: "first" | "extend" | "append" | "amend" | "unchanged" }> {
  await lockEmployee(tx, employeeId);
  await assertNotInLockedPayroll(day);
  // The same limit as every other writer (planTimelineChange).
  const today = businessToday();
  const maxAheadDays = await maxScheduleAheadDays();
  if (day > addCalendarDays(today, maxAheadDays)) {
    throw new HttpError(400, `A change can be scheduled at most ${maxAheadDays} days ahead (until ${iso(addCalendarDays(today, maxAheadDays))}).`, "HISTORY_TOO_FAR_AHEAD");
  }
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { dateOfJoining: true, lastWorkingDate: true } });
  if (day < employee.dateOfJoining) throw new HttpError(400, `They joined on ${iso(employee.dateOfJoining)} — a device ID can't be theirs before that.`, "MAPPING_BEFORE_JOINING");
  if (employee.lastWorkingDate && day > employee.lastWorkingDate) throw new HttpError(409, `They left on ${iso(employee.lastWorkingDate)}, so this can't change.`, "HISTORY_CLOSED");
  const end = employee.lastWorkingDate ? addCalendarDays(employee.lastWorkingDate, 1) : null;
  const rows = await tx.deviceUserMapping.findMany({ where: { employeeId }, orderBy: { validFrom: "asc" } });
  const latest = rows.at(-1) ?? null;
  if (!latest) {
    const after = await tx.deviceUserMapping.create({ data: { employeeId, deviceUserId, validFrom: day, validTo: end, createdByUserId: meta.createdByUserId } });
    return { before: null, after, plan: "first" };
  }
  // As every writer: a change dated before an already-scheduled one is refused
  // with that reason, not merely as "before the latest period".
  if (day < latest.validFrom && latest.validFrom > today && !(latest.deviceUserId === deviceUserId && rows.length === 1)) {
    throw new HttpError(409, `A change is already scheduled for ${iso(latest.validFrom)}. Cancel it first, or date this change on or after it.`, "HISTORY_SCHEDULED_EXISTS");
  }
  if (latest.deviceUserId === deviceUserId && (!latest.validTo || latest.validTo > day)) {
    if (day >= latest.validFrom) return { before: latest, after: latest, plan: "unchanged" };
    if (rows.length > 1) throw new HttpError(400, `Their mapping history starts before ${iso(latest.validFrom)} — earlier history is never rewritten.`, "HISTORY_BEFORE_LATEST");
    const after = await tx.deviceUserMapping.update({ where: { id: latest.id }, data: { validFrom: day } });
    return { before: latest, after, plan: "extend" };
  }
  if (latest.validTo && latest.validTo.getTime() === end?.getTime() && day >= latest.validTo) {
    throw new HttpError(409, `They left on ${iso(employee.lastWorkingDate!)}, so this can't change.`, "HISTORY_CLOSED");
  }
  if (day < latest.validFrom) throw new HttpError(400, `Their current device ID started on ${iso(latest.validFrom)} — earlier history is never rewritten.`, "HISTORY_BEFORE_LATEST");
  if (day.getTime() === latest.validFrom.getTime()) {
    const after = await tx.deviceUserMapping.update({ where: { id: latest.id }, data: { deviceUserId, createdByUserId: meta.createdByUserId } });
    return { before: latest, after, plan: "amend" };
  }
  if (!latest.validTo || latest.validTo > day) await tx.deviceUserMapping.update({ where: { id: latest.id }, data: { validTo: day } });
  const after = await tx.deviceUserMapping.create({ data: { employeeId, deviceUserId, validFrom: day, validTo: end, createdByUserId: meta.createdByUserId } });
  return { before: latest, after, plan: "append" };
}

// ── Writing salary ──

export interface SalaryWrite {
  reason: SalaryChangeReason;
  annualCtc: string;
  monthlyCtc: string;
  structureKey: string;
  structureVersion: number;
  structureHash: string;
  roundingPin: Prisma.InputJsonValue;
  revisionId: string | null;
  note: string;
  lines: Array<{ componentCode: string; componentVersion: number; componentType: string; amount: string; sortOrder: number }>;
}

async function writeSalaryRow(tx: Prisma.TransactionClient, employeeId: string, day: Date, data: SalaryWrite, meta: { createdByUserId: string }, checkLock: boolean): Promise<TimelineWrite<SalaryWithLines>> {
  await lockEmployee(tx, employeeId);
  if (checkLock) await assertNotInLockedPayroll(day);
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { dateOfJoining: true, lastWorkingDate: true } });
  if (day < employee.dateOfJoining) throw new HttpError(400, `They joined on ${iso(employee.dateOfJoining)}, so a salary cannot start before that.`, "SALARY_BEFORE_JOINING");
  if (employee.lastWorkingDate && day > employee.lastWorkingDate) throw new HttpError(409, `They left on ${iso(employee.lastWorkingDate)}, so a salary cannot start after that.`, "HISTORY_CLOSED");
  const rows = await tx.employeeSalary.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" }, include: salaryInclude });
  const plan = planTimelineChange(rows.map(toRow), day, businessToday(), await maxScheduleAheadDays());
  if (plan.kind === "amend") {
    throw new HttpError(409, `A salary already starts on ${iso(day)}. It is never overwritten: cancel it if it has not started, or date this change after it.`, "SALARY_SAME_DAY");
  }
  const latest = rows.at(-1) ?? null;
  if (plan.kind === "append") await tx.employeeSalary.update({ where: { id: plan.closeId }, data: { effectiveTo: day } });
  const { lines, ...row } = data;
  const after = await tx.employeeSalary.create({
    data: { employeeId, ...row, effectiveFrom: day, createdByUserId: meta.createdByUserId, lines: { create: lines } },
    include: salaryInclude,
  });
  return { before: latest, after, plan: plan.kind };
}

/** Starts a new salary row on `day`. Refused inside a finalised payroll period; the only way round that is writeBackdatedSalaryChange. */
export async function writeSalaryChange(tx: Prisma.TransactionClient, employeeId: string, day: Date, data: SalaryWrite, meta: { createdByUserId: string }): Promise<TimelineWrite<SalaryWithLines>> {
  return writeSalaryRow(tx, employeeId, day, data, meta, true);
}

/**
 * The ONE function that writes a salary row without asking the payroll lock. A revision dated inside a finalised period keeps its true date on the
 * salary timeline and the closed period is never rewritten; what it owes is paid as arrears in the next run. Only the revision apply step may call
 * this, and only after creating those arrears in the same transaction (a source scan in the tests fails on any other caller).
 */
export async function writeBackdatedSalaryChange(tx: Prisma.TransactionClient, employeeId: string, day: Date, data: SalaryWrite, meta: { createdByUserId: string }): Promise<TimelineWrite<SalaryWithLines>> {
  return writeSalaryRow(tx, employeeId, day, data, meta, false);
}

/** Cancels the latest salary row if it has not started; the previous one reopens. A row already in force is never cancelled: make a revision after it. */
export async function cancelScheduledSalary(tx: Prisma.TransactionClient, employeeId: string, rowId: string): Promise<{ removed: SalaryWithLines; reopened: SalaryWithLines }> {
  await lockEmployee(tx, employeeId);
  const rows = await tx.employeeSalary.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" }, include: salaryInclude });
  const target = rows.find((r) => r.id === rowId);
  if (!target) throw new HttpError(404, "That salary was not found.", "NOT_FOUND");
  if (target !== rows.at(-1)) throw new HttpError(409, "Only the latest scheduled salary can be cancelled: cancel the later one first.", "HISTORY_NOT_LATEST");
  if (target.effectiveFrom <= businessToday()) throw new HttpError(409, "This salary has already started, so it cannot be cancelled: make a revision dated after it.", "HISTORY_IN_FORCE");
  const previous = rows.at(-2);
  if (!previous) throw new HttpError(409, "This is the only salary on record, so it cannot be cancelled.", "HISTORY_ONLY_ROW");
  await tx.employeeSalary.delete({ where: { id: target.id } });
  const reopened = await tx.employeeSalary.update({ where: { id: previous.id }, data: { effectiveTo: null }, include: salaryInclude });
  return { removed: target, reopened };
}

/** Turns the device-mapping constraints' errors into a friendly 409 (rethrows anything else). */
export function translateMappingConflict(err: unknown, deviceUserId: string): never {
  if (err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes("device_user_mappings_device_no_overlap")) {
    throw new HttpError(409, `Device user ID "${deviceUserId}" belongs to someone else for part of that period — one device ID can't be two people on the same day.`, "CONFLICT");
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new HttpError(409, `Device user ID "${deviceUserId}" is already actively assigned to someone else.`, "CONFLICT");
  }
  throw err;
}

/** Cancel a scheduled attendance-assignment change (the same rules as cancelScheduledChange). */
export async function cancelScheduledAssignment(tx: Prisma.TransactionClient, employeeId: string, rowId: string): Promise<{ removed: AttendanceAssignment; reopened: AttendanceAssignment }> {
  await lockEmployee(tx, employeeId);
  const rows = await tx.attendanceAssignment.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });
  const target = rows.find((r) => r.id === rowId);
  if (!target) throw new HttpError(404, "That change wasn't found.", "NOT_FOUND");
  if (target !== rows.at(-1)) throw new HttpError(409, "Only the latest scheduled change can be cancelled — cancel the later one first.", "HISTORY_NOT_LATEST");
  if (target.effectiveFrom <= businessToday()) throw new HttpError(409, "This change is already in force, so it can't be cancelled — make a new change instead.", "HISTORY_IN_FORCE");
  const previous = rows.at(-2);
  if (!previous) throw new HttpError(409, "This is the only record, so it can't be cancelled.", "HISTORY_ONLY_ROW");
  await tx.attendanceAssignment.delete({ where: { id: target.id } });
  const reopened = await tx.attendanceAssignment.update({ where: { id: previous.id }, data: { effectiveTo: target.effectiveTo } });
  return { removed: target, reopened };
}

export async function cancelScheduledJobChange(tx: Prisma.TransactionClient, employeeId: string, rowId: string): Promise<{ removed: EmployeeJobHistory; reopened: EmployeeJobHistory }> {
  return (await cancelScheduledChange(tx, "job", employeeId, rowId)) as { removed: EmployeeJobHistory; reopened: EmployeeJobHistory };
}

/**
 * Leaving: job history and device mappings end the day AFTER the last
 * working day (so the leaver is in force on it). Scheduled job changes
 * starting after the last day never take effect and are removed — returned
 * so the caller can audit them. A change already IN FORCE after the last
 * day is refused (HISTORY_AFTER_LEAVING): that would rewrite history.
 */
export async function closeHistoryOnLeaving(tx: Prisma.TransactionClient, employeeId: string, lastWorkingDate: Date): Promise<{ removedScheduled: EmployeeJobHistory[] }> {
  await lockEmployee(tx, employeeId);
  await assertNotInLockedPayroll(lastWorkingDate);
  const end = dayAfter(lastWorkingDate);
  const removedScheduled = await tx.employeeJobHistory.findMany({ where: { employeeId, effectiveFrom: { gte: end } } });
  const inForce = removedScheduled.find((r) => r.effectiveFrom <= businessToday());
  if (inForce) {
    throw new HttpError(409, `A job change has been in force since ${iso(inForce.effectiveFrom)}, after the last working day (${iso(lastWorkingDate)}) — earlier history is never rewritten.`, "HISTORY_AFTER_LEAVING");
  }
  if (removedScheduled.length) await tx.employeeJobHistory.deleteMany({ where: { id: { in: removedScheduled.map((r) => r.id) } } });
  await tx.employeeJobHistory.updateMany({ where: { employeeId, effectiveFrom: { lt: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: end } }] }, data: { effectiveTo: end } });
  await tx.deviceUserMapping.updateMany({ where: { employeeId, validFrom: { lt: end }, OR: [{ validTo: null }, { validTo: { gt: end } }] }, data: { validTo: end } });
  // Phase 2: their attendance assignment ends with them; scheduled ones after the last day are dropped.
  await tx.attendanceAssignment.deleteMany({ where: { employeeId, effectiveFrom: { gte: end } } });
  await tx.attendanceAssignment.updateMany({ where: { employeeId, effectiveFrom: { lt: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: end } }] }, data: { effectiveTo: end } });
  // Phase 6: their salary ends with them too; a scheduled one after the last day is dropped, one already in force after it is refused.
  const salaryAfter = await tx.employeeSalary.findMany({ where: { employeeId, effectiveFrom: { gte: end } }, select: { id: true, effectiveFrom: true } });
  const salaryInForce = salaryAfter.find((r) => r.effectiveFrom <= businessToday());
  if (salaryInForce) throw new HttpError(409, `A salary has been in force since ${iso(salaryInForce.effectiveFrom)}, after the last working day (${iso(lastWorkingDate)}): earlier history is never rewritten.`, "HISTORY_AFTER_LEAVING");
  if (salaryAfter.length) await tx.employeeSalary.deleteMany({ where: { id: { in: salaryAfter.map((r) => r.id) } } });
  await tx.employeeSalary.updateMany({ where: { employeeId, effectiveFrom: { lt: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: end } }] }, data: { effectiveTo: end } });
  return { removedScheduled };
}

function toRow(r: { id: string; effectiveFrom: Date; effectiveTo: Date | null }): TimelineRow {
  return { id: r.id, from: r.effectiveFrom, to: r.effectiveTo };
}
