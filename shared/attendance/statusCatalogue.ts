// A-10 G1 (docs/plans/GREYTHR_PARITY_WORKFORCE.md, item 2): every attendance status and marker the system produces, as data. The codes are ours; the
// meaning is our own wording, used until the directors set a label of their own (the label setting, Not set = this wording). Nothing here is money:
// "alert for deduction" is a marker that a day carries loss-of-pay DAYS, never an amount.

export type StatusKind = "day" | "half" | "marker";
export interface StatusEntry {
  code: string;
  meaning: string;
  kind: StatusKind;
}

export const STATUS_CATALOGUE: readonly StatusEntry[] = [
  { code: "P", meaning: "Present", kind: "day" },
  { code: "A", meaning: "Absent", kind: "day" },
  { code: "A:P", meaning: "Absent in the first half, present in the second", kind: "half" },
  { code: "P:A", meaning: "Present in the first half, absent in the second", kind: "half" },
  { code: "HD", meaning: "Half day (which half not decided)", kind: "half" },
  { code: "O", meaning: "Off day (week-off)", kind: "day" },
  { code: "H", meaning: "Holiday", kind: "day" },
  { code: "LEAVE", meaning: "Leave, shown by the leave type's own code (for example PL); a split such as PL:P is leave in one half", kind: "day" },
  { code: "NM", meaning: "Status unknown: not marked yet", kind: "day" },
  { code: "NS", meaning: "Status unknown: no shift assigned", kind: "day" },
  { code: "LOP", meaning: "Loss of pay (days)", kind: "marker" },
  { code: "DED", meaning: "Alert for deduction: the day carries loss-of-pay days", kind: "marker" },
  { code: "WFH", meaning: "Work from home: an approved remote day", kind: "marker" },
  { code: "GRACE", meaning: "Arrived after the shift start, within the grace period", kind: "marker" },
  { code: "REG", meaning: "Regularized: corrected through an approved request", kind: "marker" },
  { code: "OVR", meaning: "Override: set directly by an administrator", kind: "marker" },
];
export const STATUS_CODES = STATUS_CATALOGUE.map((s) => s.code);

/** The markers of one day, from what the day record already holds. Pure; the muster and its export use it. */
export function markersFor(day: { lopDays: number; overrideKind: string | null; firstIn: string | null; shiftStart: string | null; lateInMinutes: number | null; remoteApproved: boolean }): string[] {
  const m: string[] = [];
  if (day.lopDays > 0) m.push("DED");
  if (day.remoteApproved) m.push("WFH");
  if (day.firstIn && day.shiftStart && (day.lateInMinutes ?? 0) === 0 && day.firstIn > day.shiftStart) m.push("GRACE");
  if (day.overrideKind === "REGULARIZATION") m.push("REG");
  if (day.overrideKind === "MANUAL_OVERRIDE") m.push("OVR");
  return m;
}

/** The statuses Manual Override can set (the engine's own list). The directors may narrow it with a setting; Not set means all of these. */
export const OVERRIDE_STATUSES = ["P", "A", "HD_FIRST", "HD_SECOND", "WORKED"] as const;
export type OverrideStatusCode = (typeof OVERRIDE_STATUSES)[number];
