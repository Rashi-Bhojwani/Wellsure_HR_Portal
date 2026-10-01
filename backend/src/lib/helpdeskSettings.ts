import { DEFAULT_HELPDESK_AUTO_CLOSE_DAYS, DEFAULT_HELPDESK_REOPEN_WINDOW_DAYS } from "@shared/constants/helpdesk";
import { getSetting } from "./settings";

// System Settings → Helpdesk (Phase 5 commit D). Read by modules/helpdesk;
// written only by modules/settings.
export const HELPDESK_SETTING_KEYS = {
  autoCloseDays: "helpdesk.autoCloseDays",
  reopenWindowDays: "helpdesk.reopenWindowDays",
} as const;

export interface HelpdeskSettings {
  autoCloseDays: number;
  reopenWindowDays: number;
}

export async function getHelpdeskSettings(): Promise<HelpdeskSettings> {
  const [autoCloseDays, reopenWindowDays] = await Promise.all([
    getSetting<number>(HELPDESK_SETTING_KEYS.autoCloseDays, DEFAULT_HELPDESK_AUTO_CLOSE_DAYS),
    getSetting<number>(HELPDESK_SETTING_KEYS.reopenWindowDays, DEFAULT_HELPDESK_REOPEN_WINDOW_DAYS),
  ]);
  return { autoCloseDays, reopenWindowDays };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// The dates the employee is shown — computed in one place so the notice and
// the auto-close job can never disagree.
export function autoCloseAt(resolvedAt: Date, settings: HelpdeskSettings): Date {
  return new Date(resolvedAt.getTime() + settings.autoCloseDays * DAY_MS);
}

export function reopenUntil(resolvedAt: Date, settings: HelpdeskSettings): Date {
  return new Date(resolvedAt.getTime() + settings.reopenWindowDays * DAY_MS);
}
