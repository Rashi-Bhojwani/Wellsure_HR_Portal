import { apiClient } from "./client";

export interface AuditLogRow {
  id: string;
  actorEmployeeCode: string | null;
  actorName: string | null;
  onBehalfOfName: string | null; // E3: acted while covering this manager's approvals
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditLogQuery {
  actorSearch?: string;
  entityType?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogPage {
  total: number;
  page: number;
  pageSize: number;
  rows: AuditLogRow[];
}

/** AU-04 (M session): the filtered general log as Excel (directors; the Developer role is refused). The export is itself audited. */
export async function exportAuditLogs(query: Omit<AuditLogQuery, "page" | "pageSize">): Promise<Blob> {
  return (await apiClient.get("/api/audit-logs/export", { params: query, responseType: "blob" })).data as Blob;
}

/** `payroll` reads the Payroll audit trail (payroll's own rows, behind the salary permission) instead of the general log. */
export async function listAuditLogs(query: AuditLogQuery, scope: "all" | "payroll" = "all"): Promise<AuditLogPage> {
  const { data } = await apiClient.get<AuditLogPage>(scope === "payroll" ? "/api/payroll/audit" : "/api/audit-logs", { params: query });
  return data;
}
