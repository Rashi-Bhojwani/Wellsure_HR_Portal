import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { inForceOn } from "../../lib/effectiveDating";

export interface ListAuditLogQuery {
  actorSearch?: string;
  entityType?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

// Read-only viewer over audit_logs (spec §7.8/§9) — actor/entity/action/
// date-range filters, paginated. before/after were already redacted at
// write time (see lib/audit.ts's writeAuditLog), so it's safe to return
// them as-is here; there is deliberately no route anywhere that can PATCH
// or DELETE a row — see this module's routes.ts.
/**
 * Payroll's own audit rows (rule changes, approvals, runs, salary revisions) are visible here only to people who may see salary. The audit viewer
 * is open to more people (audit.view) than the payroll screens are, so without this it would be a side door onto payroll (Phase 6 §0A item 5).
 * The match is on the action prefix AND the entity type, so a payroll row cannot slip out under an unexpected name.
 */
export const PAYROLL_AUDIT_ACTION_PREFIX = "payroll.";
export const PAYROLL_AUDIT_ENTITY_PREFIX = "Payroll";

// Rows that are not payroll's own can still carry a rupee amount (the leave year-end's total encashment). A viewer who may not see salary does not get it from the audit viewer either.
const MONEY_FIELDS = new Set(["totalEncashedAmount"]);
function withoutMoney<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutMoney) as unknown as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !MONEY_FIELDS.has(k)).map(([k, v]) => [k, withoutMoney(v)])) as T;
  return value;
}

export async function listAuditLogs(query: ListAuditLogQuery, viewer: { canSeePayroll: boolean; onlyPayroll?: boolean } = { canSeePayroll: false }) {
  const where: Prisma.AuditLogWhereInput = {};
  const payrollRows = { OR: [{ action: { startsWith: PAYROLL_AUDIT_ACTION_PREFIX } }, { entityType: { startsWith: PAYROLL_AUDIT_ENTITY_PREFIX } }] };
  if (!viewer.canSeePayroll) where.NOT = payrollRows;
  else if (viewer.onlyPayroll) Object.assign(where, payrollRows);
  if (query.entityType) where.entityType = { contains: query.entityType, mode: "insensitive" };
  if (query.action) where.action = { contains: query.action, mode: "insensitive" };
  if (query.dateFrom || query.dateTo) {
    where.createdAt = {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } : {}),
    };
  }
  if (query.actorSearch) {
    // actorUserId is a plain column, not a relation (append-only, E1.1),
    // so matching actors are resolved first.
    const actors = await prisma.user.findMany({
      where: {
        employee: {
          OR: [
            { employeeCode: { contains: query.actorSearch, mode: "insensitive" } },
            { nameHistory: { some: { ...inForceOn(), fullName: { contains: query.actorSearch, mode: "insensitive" } } } },
          ],
        },
      },
      select: { id: true },
    });
    where.actorUserId = { in: actors.map((a) => a.id) };
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const actorIds = [...new Set(rows.flatMap((r) => [r.actorUserId, r.onBehalfOfUserId]).filter((id): id is string => Boolean(id)))];
  const actorRows = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } },
  });
  const actorById = new Map(actorRows.map((a) => [a.id, a.employee]));

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    rows: rows.map((r) => ({
      id: r.id,
      actorEmployeeCode: (r.actorUserId && actorById.get(r.actorUserId)?.employeeCode) ?? null,
      actorName: (r.actorUserId && actorById.get(r.actorUserId)?.nameHistory[0]?.fullName) ?? null,
      // E3: the manager whose approvals the actor was covering.
      onBehalfOfName: (r.onBehalfOfUserId && (actorById.get(r.onBehalfOfUserId)?.nameHistory[0]?.fullName ?? actorById.get(r.onBehalfOfUserId)?.employeeCode)) ?? null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: viewer.canSeePayroll ? r.before : withoutMoney(r.before),
      after: viewer.canSeePayroll ? r.after : withoutMoney(r.after),
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
