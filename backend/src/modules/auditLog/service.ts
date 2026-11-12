// PEEPS-BEGIN recruitment
import { recruitmentAuditWhere } from "../recruitment/audience";
// PEEPS-END recruitment
// PEEPS-BEGIN exits
import { exitAuditAudienceWhere } from "../exits/audience";
// PEEPS-END exits
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { inForceOn } from "../../lib/effectiveDating";
import { writeAuditLog } from "../../lib/audit";
import { buildXlsx } from "../../lib/xlsx";

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

// PEEPS-BEGIN exits
export async function listAuditLogs(query: ListAuditLogQuery, viewer: { canSeePayroll: boolean; onlyPayroll?: boolean; userId?: string } = { canSeePayroll: false }) {
// PEEPS-END exits
  // PEEPS-BEGIN exits
  // PEEPS-BEGIN recruitment
  const where: Prisma.AuditLogWhereInput = { AND: [await exitAuditAudienceWhere(viewer.userId), await recruitmentAuditWhere(viewer.userId)] };
  // PEEPS-END recruitment
  // PEEPS-END exits
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

// AU-04 (M session): the same filtered list as an Excel file, for the directors (the route refuses the Developer role). At most EXPORT_LIMIT rows,
// newest first; the file says so when the filter matched more. The same payroll and money rules as the screen apply. The export is itself audited.
export const AUDIT_EXPORT_LIMIT = 10_000;
export async function exportAuditLogs(query: Omit<ListAuditLogQuery, "page" | "pageSize">, viewer: { canSeePayroll: boolean }, meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null }) {
  const page = await listAuditLogs({ ...query, page: 1, pageSize: AUDIT_EXPORT_LIMIT }, viewer);
  const filters = Object.entries(query).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}: ${String(v)}`);
  const buffer = await buildXlsx([
    {
      name: "Audit log",
      columns: [
        { key: "createdAt", header: "When (UTC)", width: 22 },
        { key: "actorEmployeeCode", header: "Actor code", width: 12 },
        { key: "actorName", header: "Actor", width: 24 },
        { key: "onBehalfOfName", header: "On behalf of", width: 20 },
        { key: "action", header: "Action", width: 34 },
        { key: "entityType", header: "Entity", width: 20 },
        { key: "entityId", header: "Entity id", width: 28 },
        { key: "before", header: "Before (redacted)", width: 50 },
        { key: "after", header: "After (redacted)", width: 50 },
        { key: "ipAddress", header: "IP address", width: 16 },
      ],
      rows: page.rows.map((r) => ({ ...r, before: r.before == null ? "" : JSON.stringify(r.before), after: r.after == null ? "" : JSON.stringify(r.after) })),
      footer: [
        `${page.rows.length} of ${page.total} matching entries${page.total > page.rows.length ? ` (the newest ${AUDIT_EXPORT_LIMIT}; narrow the dates for the rest)` : ""}.`,
        filters.length ? `Filters: ${filters.join("; ")}` : "No filters.",
        "Identity numbers were redacted to their last four digits when each entry was written.",
      ],
    },
  ]);
  await writeAuditLog({ actorUserId: meta.actorUserId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, action: "audit.exported", entityType: "AuditLog", entityId: "export", after: { rows: page.rows.length, total: page.total, filters: query } });
  return { buffer, rows: page.rows.length };
}
