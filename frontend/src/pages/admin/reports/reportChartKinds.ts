import type { ReportBreakdown } from "@shared/constants/reports";

// Which chart (if any) a report breakdown gets — see ReportCharts.tsx.
export const CHART_HEIGHT = 240;

export type ChartKind = "donut" | "months" | "bars";

/** A breakdown the charts can draw: exactly a text label column and one numeric column. */
export function chartKindOf(b: ReportBreakdown): ChartKind | null {
  if (b.columns.length !== 2 || b.columns[1]?.type !== "number" || b.rows.length === 0) return null;
  if (b.columns[0]?.header === "Month") return "months";
  return b.rows.length <= 6 ? "donut" : "bars";
}

