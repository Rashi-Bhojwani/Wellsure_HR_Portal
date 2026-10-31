import type { PeepsSettingKey } from "@shared/constants/peeps";

// The shapes behind each Peeps setting editor, and a setting's value in words.

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const NUMBERS: Partial<Record<PeepsSettingKey, { min: number; max: number; unit: string }>> = {
  "unmute.sessionMinutes": { min: 5, max: 240, unit: "minutes" },
  "unmute.bookingWindowDays": { min: 1, max: 365, unit: "days" },
  "unmute.minNoticeHours": { min: 0, max: 720, unit: "hours" },
  "unmute.cancellationNoticeHours": { min: 0, max: 720, unit: "hours" },
  "badges.durationDays": { min: 1, max: 3650, unit: "days" },
};
export const BOOLEANS: Partial<Record<PeepsSettingKey, Array<{ field: string; label: string }>>> = {
  "audience.assets": [
    { field: "officeManages", label: "Wellsure Office members manage the register" },
  ],
  "audience.unmute": [{ field: "employeesMayBook", label: "Employees (HR included) may book Unmute conversations" }],
  "badges.revocation": [{ field: "allowed", label: "A giver (or a director) may revoke a badge" }],
  "badges.display": [
    { field: "profile", label: "Show badges on a person's profile" },
    { field: "directory", label: "Show badges in the directory" },
  ],
  "nudges.revocation": [{ field: "allowed", label: "A sender (or a director) may withdraw a nudge" }],
};
export const GIVERS: Partial<Record<PeepsSettingKey, string>> = { "audience.badges": "givers", "audience.nudges": "senders" };
export const LIMITS: Partial<Record<PeepsSettingKey, string>> = { "badges.limits": "perGiverPerMonth", "nudges.limits": "perSenderPerMonth" };

/** A setting's value in words, for the lists. */
export function describeValue(key: PeepsSettingKey, value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  const n = NUMBERS[key];
  if (n) return `${String(value)} ${n.unit}`;
  const b = BOOLEANS[key];
  if (b) return b.map((f) => `${f.label}: ${(value as Record<string, boolean>)[f.field] ? "yes" : "no"}`).join(" · ");
  const g = GIVERS[key];
  if (g) {
    const list = (value as Record<string, string[]>)[g] ?? [];
    return list.length ? `Directors, ${list.map((x) => (x === "MANAGERS" ? "managers (own team)" : "Wellsure Office members")).join(", ")}` : "Directors only";
  }
  const l = LIMITS[key];
  if (l) return `${(value as Record<string, number>)[l]} per month`;
  if (key === "unmute.availability") {
    const w = value as { days: number[]; from: string; to: string };
    return `${w.days.map((d) => DAYS[d]).join(", ")}, ${w.from}–${w.to}`;
  }
  if (key === "badges.catalogue") return (value as Array<{ label: string }>).map((x) => x.label).join(", ");
  return String(value);
}
