import { getSetting } from "./settings";

// System Settings → Attendance → Excess hours (Phase 3 commit 4, docs/plans/PHASE_3.md). The Excess hours report lists the
// minutes a person worked beyond their shift's end. Only days with at least this many excess minutes are listed (0 = any
// excess). There is no overtime policy yet (HR has not defined one), so these hours are not payable overtime; this setting
// only decides what is worth looking at. Read on every request, written only by modules/settings.
export const EXCESS_HOURS_SETTING_KEY = "attendance.excessHours";

export interface ExcessHoursSettings {
  /** A day counts when its excess is at least this many minutes. */
  minMinutes: number;
}

export const DEFAULT_EXCESS_HOURS_SETTINGS: ExcessHoursSettings = { minMinutes: 0 };

export async function getExcessHoursSettings(): Promise<ExcessHoursSettings> {
  const stored = await getSetting<Partial<ExcessHoursSettings>>(EXCESS_HOURS_SETTING_KEY, DEFAULT_EXCESS_HOURS_SETTINGS);
  return { ...DEFAULT_EXCESS_HOURS_SETTINGS, ...stored };
}
