import { getSetting } from "./settings";

// System Settings → Attendance → Regularization (Phase 3 commit 1, docs/plans/PHASE_3.md): how far back a
// correction may reach and the caps on a bulk correction, so a mistake cannot rewrite a quarter. Read on every
// request (a change applies at once), written only by modules/settings.
export const REGULARIZATION_SETTING_KEY = "attendance.regularization";

export interface RegularizationSettings {
  /** How many attendance cycles before the current one a correction may reach (0 = the current cycle only). Never into a finalised period. */
  backdateCycles: number;
  /** A bulk correction covers at most this many days from first to last. */
  bulkMaxRangeDays: number;
  /** ...and at most this many employee-days in one action. */
  bulkMaxEmployeeDays: number;
}

export const DEFAULT_REGULARIZATION_SETTINGS: RegularizationSettings = { backdateCycles: 1, bulkMaxRangeDays: 31, bulkMaxEmployeeDays: 1000 };

export async function getRegularizationSettings(): Promise<RegularizationSettings> {
  const stored = await getSetting<Partial<RegularizationSettings>>(REGULARIZATION_SETTING_KEY, DEFAULT_REGULARIZATION_SETTINGS);
  return { ...DEFAULT_REGULARIZATION_SETTINGS, ...stored };
}
