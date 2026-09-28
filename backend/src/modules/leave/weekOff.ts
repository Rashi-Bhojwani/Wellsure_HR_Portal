import { getSetting } from "../../lib/settings";

// JS Date.getUTCDay() convention: 0 = Sunday, 6 = Saturday.
const DEFAULT_WEEK_OFF_DAYS = [0, 6];

// Stub until Phase 2's real per-employee week_off_patterns exists (see
// schema.prisma's comment on LeaveRequest.totalDays) — total_days must
// exclude week-offs so a vacation spanning a weekend doesn't burn 7 PL
// days, but per-employee patterns are Phase 2 scope. This is a single
// global default (Sun+Sat), configurable via one system_settings key,
// used only for leave-day counting. Flagged for Phase 2: swap the
// CALLER of this function to consult the employee's real week-off
// pattern instead — no schema change needed either way, total_days stays
// a plain computed-at-apply-time column.
export async function getDefaultWeekOffDays(): Promise<number[]> {
  return getSetting("leave.defaultWeekOffDays", DEFAULT_WEEK_OFF_DAYS);
}
