import type { Prisma } from "@prisma/client";
import { businessToday } from "../../lib/businessDate";
import { writeJobChange } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { checkReportingLine, isTopLevel, MANAGER_ROLE_CODE, type ManagerRef } from "../../lib/reportingHierarchy";
import { HttpError } from "../../middleware/errorHandler";

// Database-backed enforcement of the three-level rules (Phase 5 commit E2,
// model A — the pure rules are in lib/reportingHierarchy.ts). Every write
// that sets someone's reporting manager goes through assertReportingLine:
// Add Employee, Change job details, the Excel import, Manager Management.

type Db = Prisma.TransactionClient | typeof prisma;

export async function roleCodesOf(employeeId: string, db: Db = prisma): Promise<string[]> {
  const user = await db.user.findUnique({ where: { employeeId }, select: { roles: { select: { role: { select: { code: true } } } } } });
  return user?.roles.map((r) => r.role.code) ?? [];
}

export async function managerRef(managerId: string, db: Db = prisma): Promise<ManagerRef> {
  const m = await db.employee.findUnique({ where: { id: managerId }, select: { employeeCode: true, status: true } });
  if (!m) throw new HttpError(400, "That reporting manager doesn't exist.", "VALIDATION_ERROR");
  return { code: m.employeeCode, roleCodes: await roleCodesOf(managerId, db), active: m.status === "ACTIVE" };
}

// Throws 400 HIERARCHY if `person` (with these roles) may not report to
// `managerId` (null = nobody).
export async function assertReportingLine(person: { code: string; roleCodes: readonly string[] }, managerId: string | null, db: Db = prisma): Promise<void> {
  const v = checkReportingLine(person, managerId ? await managerRef(managerId, db) : null);
  if (v) throw new HttpError(400, v, "HIERARCHY");
}

export async function assertReportingLineFor(employeeId: string, managerId: string | null, db: Db = prisma): Promise<void> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { employeeCode: true } });
  if (!e) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (managerId === employeeId) throw new HttpError(400, "Someone can't report to themselves.", "HIERARCHY");
  await assertReportingLine({ code: e.employeeCode, roleCodes: await roleCodesOf(employeeId, db) }, managerId, db);
}

// Effective dates for team moves: today or earlier. Future dates stay
// refused until EF3 (docs/plans/EFFECTIVE_DATES.md) makes scheduled changes
// visible and rolls them over; how far back a change may go is the timeline
// writer's rule (never before the latest period started).
export function parseMoveDate(effectiveFrom: string | undefined): Date {
  const today = businessToday();
  const date = effectiveFrom ? new Date(effectiveFrom) : today;
  if (date > today) throw new HttpError(400, "A team change can't be dated in the future yet — use today or an earlier date.", "FUTURE_DATE");
  return date;
}

// Effective-dated reporting-line change through the one timeline writer
// (lib/effectiveDating.ts): copies everything but the manager. Returns
// before/after for the audit log.
export async function moveReportingLine(tx: Prisma.TransactionClient, employeeId: string, newManagerId: string | null, effectiveFrom: Date, createdByUserId: string | null, changeReason: string) {
  const current = await tx.employeeJobHistory.findFirst({ where: { employeeId }, orderBy: { effectiveFrom: "desc" } });
  if (!current) throw new HttpError(409, "This person has no job placement yet — set their department, designation and branch first (Change job details).", "NO_PLACEMENT");
  if (current.reportingManagerId === newManagerId) return { before: current, after: current, changed: false as const };
  const write = await writeJobChange(tx, employeeId, effectiveFrom, { reportingManagerId: newManagerId }, { createdByUserId: createdByUserId ?? current.createdByUserId, changeReason });
  return { before: current, after: write.after, changed: true as const };
}

// Active direct reports of a manager (current placements only).
export async function directReportIds(managerId: string, db: Db = prisma): Promise<string[]> {
  const rows = await db.employeeJobHistory.findMany({ where: { reportingManagerId: managerId, effectiveTo: null, employee: { status: "ACTIVE" } }, select: { employeeId: true } });
  return rows.map((r) => r.employeeId);
}

export { isTopLevel, MANAGER_ROLE_CODE };
