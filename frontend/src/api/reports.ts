import type { ReportInfo, ReportKey, ReportResult } from "@shared/constants/reports";
import { apiClient } from "./client";

// Core reports (Phase 5 commit F) — backend/src/modules/reports.

export interface ReportQuery {
  asOf?: string;
  from?: string;
  to?: string;
  departmentId?: string;
  locationId?: string;
  employmentType?: string;
  leaveTypeId?: string;
  kind?: "all" | "birthday" | "anniversary";
}

export async function catalog(): Promise<ReportInfo[]> {
  return (await apiClient.get<{ reports: ReportInfo[] }>("/api/reports")).data.reports;
}
export async function run(key: ReportKey, query: ReportQuery): Promise<ReportResult> {
  return (await apiClient.get<ReportResult>(`/api/reports/${key}`, { params: query })).data;
}
export async function exportXlsx(key: ReportKey, query: ReportQuery): Promise<Blob> {
  return (await apiClient.get(`/api/reports/${key}/export`, { params: query, responseType: "blob" })).data as Blob;
}

// RP-13 (M session): "email me this report" — the signed-in person's own schedules.
export interface ReportSubscription {
  id: string;
  reportKey: ReportKey;
  title: string;
  frequency: "WEEKLY" | "MONTHLY";
  filters: Record<string, string>;
  active: boolean;
  stoppedWhy: string | null;
  lastSentOn: string | null;
}
export const mySubscriptions = async () => (await apiClient.get<{ subscriptions: ReportSubscription[] }>("/api/reports/subscriptions/mine")).data.subscriptions;
export const subscribe = async (reportKey: ReportKey, frequency: "WEEKLY" | "MONTHLY", filters: Record<string, string>) =>
  (await apiClient.post<{ subscriptions: ReportSubscription[] }>("/api/reports/subscriptions/mine", { reportKey, frequency, filters })).data.subscriptions;
export const unsubscribe = async (id: string) => (await apiClient.delete<{ subscriptions: ReportSubscription[] }>(`/api/reports/subscriptions/mine/${id}`)).data.subscriptions;
