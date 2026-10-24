import { attendanceStatusColor, v } from "../../theme/tokens";

// One attendance day code → its colour pair (attendanceStatusColor tokens) and a word, shared by the calendar, the day panel,
// the muster grid and their legends. The code itself is always printed too, so colour is never the only signal.

export interface StatusTone {
  bg: string;
  fg: string;
  /** The word for the code (legends, aria labels). */
  label: string;
}

const NONE: StatusTone = { bg: "transparent", fg: v.textSecondary, label: "No record" };

export function statusTone(code: string | null | undefined): StatusTone {
  if (!code) return NONE;
  if (code === "P") return { ...attendanceStatusColor.P!, label: "Present" };
  if (code === "A") return { ...attendanceStatusColor.A!, label: "Absent" };
  if (code === "LOP") return { ...attendanceStatusColor.LOP!, label: "Loss of pay" };
  if (code === "OFF" || code === "O") return { ...attendanceStatusColor.O!, label: "Week-off" };
  if (code === "H") return { ...attendanceStatusColor.H!, label: "Holiday" };
  if (code === "HD" || /^(P:A|A:P)$/.test(code)) return { ...attendanceStatusColor.HD!, label: "Half day" };
  if (code === "NM") return { ...NONE, label: "Not marked" };
  if (code === "NS") return { ...NONE, label: "No shift" };
  return { ...attendanceStatusColor.L!, label: "Leave" }; // leave codes and leave splits (PL, CL, P:PL …)
}

/** The legend under the calendar and the muster grid: code chip + word. */
export const STATUS_LEGEND: Array<{ code: string; label: string }> = [
  { code: "P", label: "Present" },
  { code: "A", label: "Absent" },
  { code: "HD", label: "Half day" },
  { code: "L", label: "Leave" },
  { code: "H", label: "Holiday" },
  { code: "OFF", label: "Week-off" },
];
