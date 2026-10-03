// Core reports (Phase 5 commit F, docs/plans/PHASE_5.md §F) — the catalog
// shared by the backend (modules/reports) and the Reports app. A report
// declares which filters it takes; the screen renders exactly those.

export type ReportFilter = "asOf" | "range" | "department" | "location" | "employmentType" | "leaveType" | "celebrationKind";

export interface ReportInfo {
  key: ReportKey;
  title: string;
  description: string;
  filters: readonly ReportFilter[];
  // An extra, non-grantable key beyond reports.view (leave liability).
  extraPermission?: string;
}

export const REPORT_KEYS = ["headcount", "joiners", "leavers", "celebrations", "leave-balance", "leave-liability", "lop"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

const ORG = ["department", "location", "employmentType"] as const;

export const REPORT_CATALOG: Record<ReportKey, ReportInfo> = {
  headcount: { key: "headcount", title: "Headcount", description: "Everyone employed on a date, with the department, branch and designation they held that day.", filters: ["asOf", ...ORG] },
  joiners: { key: "joiners", title: "Joiners", description: "People who joined in a date range.", filters: ["range", ...ORG] },
  leavers: { key: "leavers", title: "Leavers & attrition", description: "People who left in a date range, with tenure, reason and the attrition rate.", filters: ["range", ...ORG] },
  celebrations: { key: "celebrations", title: "Birthdays & anniversaries", description: "Birthdays and work anniversaries coming up in a date range.", filters: ["range", "celebrationKind", ...ORG] },
  "leave-balance": { key: "leave-balance", title: "Leave balance", description: "Every active employee's balance per leave type on a date.", filters: ["asOf", "leaveType", ...ORG] },
  "leave-liability": {
    key: "leave-liability",
    title: "Leave liability",
    description: "Encashable leave balance × the encashment daily rate, in rupees.",
    filters: ["asOf", ...ORG],
    extraPermission: "reports.liability.view",
  },
  lop: { key: "lop", title: "Loss of pay (LOP)", description: "Approved unpaid leave days in a date range.", filters: ["range", ...ORG] },
};

export type ReportColumnType = "text" | "number" | "date" | "money" | "percent";

export interface ReportColumn {
  key: string;
  header: string;
  type?: ReportColumnType;
}

export interface ReportSummaryItem {
  label: string;
  value: number | string | null;
  type?: ReportColumnType;
}

export interface ReportBreakdown {
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
}

export interface ReportResult {
  key: ReportKey;
  title: string;
  scope: "company" | "team";
  generatedAt: string;
  filtersApplied: string[]; // human-readable, also printed under the export
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  summary: ReportSummaryItem[];
  breakdowns: ReportBreakdown[];
  notes: string[]; // what the report does / doesn't include
  warnings: string[]; // e.g. provisional encashment rate
  rateProvisional?: boolean; // leave liability: rate awaits CA confirmation
}
