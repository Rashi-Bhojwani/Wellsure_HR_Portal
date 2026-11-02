import { BADGE_DURATION_LABELS, DIRECTORY_CONTACT_LABELS, type BadgeDuration, type DirectoryContactField, type PeepsSettingKey } from "@shared/constants/peeps";

// The shapes behind each Peeps setting editor, and a setting's value in words.

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const NUMBERS: Partial<Record<PeepsSettingKey, { min: number; max: number; unit: string }>> = {
  "unmute.sessionMinutes": { min: 5, max: 240, unit: "minutes" },
  "unmute.bookingWindowDays": { min: 1, max: 365, unit: "days" },
  "unmute.minNoticeHours": { min: 0, max: 720, unit: "hours" },
  "unmute.cancellationNoticeHours": { min: 0, max: 720, unit: "hours" },
};
export const BOOLEANS: Partial<Record<PeepsSettingKey, Array<{ field: string; label: string }>>> = {
  "audience.assets": [
    { field: "officeManages", label: "Wellsure Office members manage the register" },
  ],
  "audience.unmute": [{ field: "employeesMayBook", label: "Employees (HR included) may book Unmute conversations" }],
  "leave.calendarShowsType": [{ field: "showType", label: "Team calendars name wedding and bereavement leave" }],
  "leave.showSensitiveTypes": [{ field: "show", label: "Managers, team calendars and managers' notifications name menstrual and medical leave" }],
  "audience.badges": [{ field: "officeGivesToAnyone", label: "Wellsure Office members (with Give badges) may give to anyone" }],
  "badges.repeat": [{ field: "allowed", label: "One giver may give the same badge again to someone who still holds it" }],
  "badges.publicDetails": [
    { field: "giver", label: "Show who gave it on profiles, the directory and the home page" },
    { field: "reason", label: "Show the giver's message there too" },
  ],
  "nudges.enabled": [{ field: "enabled", label: "Directors may send private corrective notes" }],
  "nudges.revocation": [{ field: "allowed", label: "A sender (a director) may withdraw a corrective note" }],
};
export const LIMITS: Partial<Record<PeepsSettingKey, string>> = { "badges.limits": "perGiverPerMonth", "nudges.limits": "perSenderPerMonth" };

/** A setting's value in words, for the lists. */
export function describeValue(key: PeepsSettingKey, value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  const n = NUMBERS[key];
  if (n) return `${String(value)} ${n.unit}`;
  const b = BOOLEANS[key];
  if (b) return b.map((f) => `${f.label}: ${(value as Record<string, boolean>)[f.field] ? "yes" : "no"}`).join(" · ");
  const l = LIMITS[key];
  if (l) return `${(value as Record<string, number>)[l]} per month`;
  if (key === "unmute.availability") {
    const w = value as { days: number[]; from: string; to: string };
    return `${w.days.map((d) => DAYS[d]).join(", ")}, ${w.from}–${w.to}`;
  }
  if (key === "directory.contactFields") {
    const list = value as DirectoryContactField[];
    return list.length ? list.map((f) => DIRECTORY_CONTACT_LABELS[f]).join(", ") : "None";
  }
  if (key === "badges.catalogue") return (value as Array<{ label: string; duration?: BadgeDuration }>).map((x) => (x.duration ? `${x.label} (${BADGE_DURATION_LABELS[x.duration].toLowerCase()})` : x.label)).join(", ");
  if (key === "badges.noManagerFallback") return (value as { upTo: string }).upTo === "DIRECTORS" ? "May give up to the directors" : "Nobody above them";
  return String(value);
}
