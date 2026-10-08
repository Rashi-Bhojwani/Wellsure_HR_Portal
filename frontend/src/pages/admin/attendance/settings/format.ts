// Formatting helpers for Attendance Settings (Phase 2 P2-A).

/** Field names → what HR calls them, for placeholder notices. */
export const PLACEHOLDER_LABELS: Record<string, string> = {
  graceInMinutes: "Grace in",
  graceOutMinutes: "Grace out",
  fullDayMinMinutes: "Full-day minimum hours",
  halfDayMinMinutes: "Half-day minimum hours",
};

export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
