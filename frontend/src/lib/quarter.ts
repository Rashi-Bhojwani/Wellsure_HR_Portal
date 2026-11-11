import { financialYearOf } from "@shared/utils/financialYear";

/** Where Quarterly TDS data opens: the last quarter that has ended (April–June is quarter 1), the one a quarterly return is made for. */
export function lastFinishedQuarter(todayIso: string): { fy: string; quarter: number } {
  const [y, m] = todayIso.split("-").map(Number) as [number, number];
  const current = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  const fyStartYear = m >= 4 ? y : y - 1;
  if (current > 1) return { fy: financialYearOf(`${fyStartYear}-04-01`).label, quarter: current - 1 };
  return { fy: financialYearOf(`${fyStartYear - 1}-04-01`).label, quarter: 4 };
}
