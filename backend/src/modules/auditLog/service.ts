import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

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
export async function listAuditLogs(query: ListAuditLogQuery) {
  const where: Prisma.AuditLogWhereInput = {};
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
            { nameHistory: { some: { effectiveTo: null, fullName: { contains: query.actorSearch, mode: "insensitive" } } } },
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
    select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: { effectiveTo: null }, select: { fullName: true } } } } },
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
      before: r.before,
      after: r.after,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
