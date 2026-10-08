// The Attendance Muster's cell language (Phase 2 P2-D, docs/plans/PHASE_2.md
// §5.1, "P2-D build design"): what someone may type into a day cell (or a
// muster-upload cell), shared by the grid, the upload parser and the API's
// validation so all three agree exactly.

export type ManualStatus = "P" | "A" | "HD_FIRST" | "HD_SECOND" | "WORKED";

/** A manual entry as typed: times, a status, or a clear. */
export type MusterInput =
  | { kind: "TIMED"; inTime: string; outTime: string | null } // "HH:MM"; an out at or before the in is next day
  | { kind: "STATUS_ONLY"; status: ManualStatus }
  | { kind: "CLEARED" };

export type MusterParse = { ok: true; value: MusterInput | null } | { ok: false; error: string };

const STATUS_LETTERS: Record<string, ManualStatus> = { P: "P", A: "A", "P:A": "HD_FIRST", "A:P": "HD_SECOND", W: "WORKED" };
const STATUS_TEXT: Record<ManualStatus, string> = { P: "P", A: "A", HD_FIRST: "P:A", HD_SECOND: "A:P", WORKED: "W" };

const TIME = String.raw`(\d{1,2})[:.]?(\d{2})`;
const TIMES = new RegExp(String.raw`^${TIME}(?:\s*(?:-|–|to|\s)\s*(?:${TIME})?)?$`, "i");

function hhmm(h: string, m: string): string | null {
  const hours = Number(h);
  const minutes = Number(m);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${m}`;
}

/**
 * Parse what was typed into a muster cell. Blank means "no change" (null);
 * `-` clears the day back to not marked.
 */
export function parseMusterCell(raw: string | null | undefined): MusterParse {
  const text = (raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (text === "") return { ok: true, value: null };
  if (text === "-" || text === "–") return { ok: true, value: { kind: "CLEARED" } };
  const status = STATUS_LETTERS[text.replace(/\s/g, "")];
  if (status) return { ok: true, value: { kind: "STATUS_ONLY", status } };
  if (text === "HD" || text === "H/D" || text === "½") return { ok: false, error: "Which half? Type P:A (present in the first half) or A:P (present in the second half)." };
  const m = TIMES.exec(text);
  if (m) {
    const inTime = hhmm(m[1]!, m[2]!);
    const outTime = m[3] !== undefined ? hhmm(m[3], m[4]!) : null;
    if (!inTime || (m[3] !== undefined && !outTime)) return { ok: false, error: "Times must be real 24-hour times, e.g. 10:05-19:10." };
    if (outTime === inTime) return { ok: false, error: "The OUT time is the same as the IN time." };
    return { ok: true, value: { kind: "TIMED", inTime, outTime } };
  }
  return { ok: false, error: `"${raw?.trim()}" isn't something the muster understands. Type times (10:05-19:10), P, A, P:A, A:P, W or - to clear.` };
}

/** The canonical text for an entry: what a cell shows while editing, and what a template is pre-filled with. */
export function formatMusterInput(entry: MusterInput | null): string {
  if (!entry || entry.kind === "CLEARED") return "";
  if (entry.kind === "STATUS_ONLY") return STATUS_TEXT[entry.status];
  return `${entry.inTime}-${entry.outTime ?? ""}`;
}

export function sameMusterInput(a: MusterInput | null, b: MusterInput | null): boolean {
  return formatMusterInput(a) === formatMusterInput(b) && (a?.kind ?? null) === (b?.kind ?? null);
}

/** What a day's status code shows as in the grid (week-off is OFF, as greytHR does). */
export function musterCode(status: string): string {
  return status === "O" ? "OFF" : status;
}

/** The legend under the grid (and in the export): what each code means, then what may be typed. */
export const MUSTER_LEGEND: Array<{ code: string; label: string }> = [
  { code: "P", label: "Present" },
  { code: "A", label: "Absent" },
  { code: "P:A / A:P", label: "Half day: present in the first / second half" },
  { code: "HD", label: "Half day (worked half not decided)" },
  { code: "OFF", label: "Week-off" },
  { code: "H", label: "Holiday" },
  { code: "PL, SL, …", label: "Leave, by its code (PL:P = leave in the first half)" },
  { code: "NM", label: "Not marked yet (manual-capture branch)" },
  { code: "NS", label: "No shift assigned" },
];

export const MUSTER_INPUT_HELP: Array<{ code: string; label: string }> = [
  { code: "10:05-19:10", label: "IN and OUT times: worked out by the same rules as a punch" },
  { code: "10:05-", label: "IN only (counts like a single punch)" },
  { code: "P / A", label: "Present / absent, status only (no times)" },
  { code: "P:A / A:P", label: "Half day, status only" },
  { code: "W", label: "Worked a holiday or week-off, status only" },
  { code: "-", label: "Clear the entry (back to NM)" },
];
