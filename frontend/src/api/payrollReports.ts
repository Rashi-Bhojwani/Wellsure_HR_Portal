import { apiClient } from "./client";
import type { PayrollReportDef, PayrollReportKey, PayrollReportResult } from "@shared/constants/payrollReports";

// Stage 6 (docs/plans/STAGE_6_PAYROLL_REPORTS.md): payroll reports, directors only. Figures are exact decimal strings from the API; the screen never re-adds them.
const base = "/api/payroll-reports";
export interface ReportLayout {
  columns: string[];
  isDefault: boolean;
  /** "Default, change in settings" until a director saves a layout. */
  label: string | null;
  savedAt: string | null;
  reason: string | null;
}
export type ReportFilters = Partial<Record<"month" | "compareMonth" | "fromMonth" | "toMonth" | "fromDate" | "toDate" | "asOf" | "department" | "location" | "company", string>>;
export type CatalogEntry = PayrollReportDef & { layout: ReportLayout };
export type ReportResult = PayrollReportResult & { layout: ReportLayout };

const clean = (f: ReportFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v));
export const catalog = async () => (await apiClient.get<{ reports: CatalogEntry[] }>(base)).data.reports;
export const runReport = async (key: PayrollReportKey, filters: ReportFilters) => (await apiClient.get<ReportResult>(`${base}/${key}`, { params: clean(filters) })).data;
export const saveLayout = async (key: PayrollReportKey, columns: string[], reason: string) => (await apiClient.put<ReportLayout>(`${base}/${key}/layout`, { columns, reason })).data;
export const exportReport = async (key: PayrollReportKey, filters: ReportFilters, format: "xlsx" | "csv", columns: string[]) =>
  (await apiClient.get(`${base}/${key}/export`, { params: { ...clean(filters), format, columns: columns.join(",") }, responseType: "blob" })).data as Blob;
