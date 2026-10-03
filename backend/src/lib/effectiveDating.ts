import type { EmployeeBankAccount, EmployeeJobHistory, EmployeeNameHistory, Prisma } from "@prisma/client";
import { HttpError } from "../middleware/errorHandler";
import { addCalendarDays, businessToday } from "./businessDate";
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

// ── Reading ──────────────────────────────────────────────────────────────

/** Prisma `where` for effectiveFrom/effectiveTo tables: rows in force on `day`. */
export function inForceOn(day: Date = businessToday()) {
  return { effectiveFrom: { lte: day }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: day } }] };
}

/** The same for validFrom/validTo (device_user_mappings). */
export function mappingInForceOn(day: Date = businessToday()) {
  return { validFrom: { lte: day }, OR: [{ validTo: null }, { validTo: { gt: day } }] };
}

/** The exclusive end date for something whose last covered day is `lastDay`. */
export const dayAfter = (lastDay: Date) => addCalendarDays(lastDay, 1);

const iso = (d: Date) => d.toISOString().slice(0, 10);

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

/**
 * Cancel a scheduled (not yet in force) job change: the row is removed and
 * the previous one reopened. Returns the removed row for the caller's audit
 * entry. A change already in force can't be cancelled — supersede it.
 */
export async function cancelScheduledJobChange(tx: Prisma.TransactionClient, employeeId: string, rowId: string): Promise<{ removed: EmployeeJobHistory; reopened: EmployeeJobHistory }> {
  await lockEmployee(tx, employeeId);
  const rows = await tx.employeeJobHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });
  const target = rows.find((r) => r.id === rowId);
  if (!target) throw new HttpError(404, "That change wasn't found.", "NOT_FOUND");
  if (target !== rows.at(-1)) throw new HttpError(409, "Only the latest scheduled change can be cancelled — cancel the later one first.", "HISTORY_NOT_LATEST");
  if (target.effectiveFrom <= businessToday()) throw new HttpError(409, "This change is already in force, so it can't be cancelled — make a new change instead.", "HISTORY_IN_FORCE");
  const previous = rows.at(-2);
  if (!previous) throw new HttpError(409, "This is their only placement, so it can't be cancelled.", "HISTORY_ONLY_ROW");
  await tx.employeeJobHistory.delete({ where: { id: target.id } });
  const reopened = await tx.employeeJobHistory.update({ where: { id: previous.id }, data: { effectiveTo: null } });
  return { removed: target, reopened };
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
  const end = dayAfter(lastWorkingDate);
  const removedScheduled = await tx.employeeJobHistory.findMany({ where: { employeeId, effectiveFrom: { gte: end } } });
  const inForce = removedScheduled.find((r) => r.effectiveFrom <= businessToday());
  if (inForce) {
    throw new HttpError(409, `A job change has been in force since ${iso(inForce.effectiveFrom)}, after the last working day (${iso(lastWorkingDate)}) — earlier history is never rewritten.`, "HISTORY_AFTER_LEAVING");
  }
  if (removedScheduled.length) await tx.employeeJobHistory.deleteMany({ where: { id: { in: removedScheduled.map((r) => r.id) } } });
  await tx.employeeJobHistory.updateMany({ where: { employeeId, effectiveFrom: { lt: end }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: end } }] }, data: { effectiveTo: end } });
  await tx.deviceUserMapping.updateMany({ where: { employeeId, validFrom: { lt: end }, OR: [{ validTo: null }, { validTo: { gt: end } }] }, data: { validTo: end } });
  return { removedScheduled };
}

function toRow(r: { id: string; effectiveFrom: Date; effectiveTo: Date | null }): TimelineRow {
  return { id: r.id, from: r.effectiveFrom, to: r.effectiveTo };
}
