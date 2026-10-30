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
  /** The duty this report belongs to (besides reports.view): attendance reports and leave reports are switched for HR separately. */
  permission?: string;
}

export const REPORT_KEYS = ["headcount", "joiners", "leavers", "celebrations", "leave-balance", "leave-liability", "lop", "late-coming", "excess-hours", "exception-summary", "attendance-muster"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

const ORG = ["department", "location", "employmentType"] as const;

export const REPORT_CATALOG: Record<ReportKey, ReportInfo> = {
  headcount: { key: "headcount", title: "Headcount", description: "Everyone employed on a date, with the department, branch and designation they held that day.", filters: ["asOf", ...ORG] },
  joiners: { key: "joiners", title: "Joiners", description: "People who joined in a date range.", filters: ["range", ...ORG] },
  leavers: { key: "leavers", title: "Leavers & attrition", description: "People who left in a date range, with tenure, reason and the attrition rate.", filters: ["range", ...ORG] },
  celebrations: { key: "celebrations", title: "Birthdays & anniversaries", description: "Birthdays and work anniversaries coming up in a date range.", filters: ["range", "celebrationKind", ...ORG] },
  "leave-balance": { key: "leave-balance", title: "Leave balance", description: "Every active employee's balance per leave type on a date.", permission: "reports.leave.view", filters: ["asOf", "leaveType", ...ORG] },
  "leave-liability": {
    key: "leave-liability",
    title: "Leave liability",
    description: "Encashable leave balance × the encashment daily rate, in rupees.",
    filters: ["asOf", ...ORG],
    extraPermission: "reports.liability.view",
    permission: "reports.leave.view",
  },
  lop: { key: "lop", title: "Loss of pay (LOP)", description: "Approved unpaid leave days in a date range.", permission: "reports.leave.view", filters: ["range", ...ORG] },
  // Attendance reports (Phase 3 commit 4): over the computed days, at most 93 days at a time.
  "late-coming": { key: "late-coming", title: "Late coming", description: "Each day someone arrived after their shift start, with how late, and how the day was set (device, correction, HR).", permission: "reports.attendance.view", filters: ["range", ...ORG] },
  "excess-hours": { key: "excess-hours", title: "Excess hours", description: "Time worked beyond the end of the shift, day by day. Not overtime: overtime is not defined yet.", permission: "reports.attendance.view", filters: ["range", ...ORG] },
  "exception-summary": { key: "exception-summary", title: "Attendance exceptions", description: "Per person, the days with a missing punch, a shortfall, no shift or a set-aside punch in a date range.", permission: "reports.attendance.view", filters: ["range", ...ORG] },
  "attendance-muster": { key: "attendance-muster", title: "Attendance summary", description: "Present, absent, leave, holiday, week-off, not-marked and LOP days per person for a date range, with how many days were not the device's.", permission: "reports.attendance.view", filters: ["range", ...ORG] },
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
