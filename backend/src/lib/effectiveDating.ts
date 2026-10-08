import { Prisma, type AttendanceAssignment, type DeviceUserMapping, type EmployeeBankAccount, type EmployeeJobHistory, type EmployeeNameHistory } from "@prisma/client";
import { HttpError } from "../middleware/errorHandler";
import { addCalendarDays, businessToday } from "./businessDate";
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
async function lockEmployee(tx: Prisma.TransactionClient, employeeId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
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
  return { removedScheduled };
}

function toRow(r: { id: string; effectiveFrom: Date; effectiveTo: Date | null }): TimelineRow {
  return { id: r.id, from: r.effectiveFrom, to: r.effectiveTo };
}
