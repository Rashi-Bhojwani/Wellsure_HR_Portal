// The ATTLOG line format — CONFIRMED from a real export from our device
// (spec §4.1, recorded 2026-10-01). One punch per line, six tab-separated
// columns:
//
//   18	2021-09-01 18:30:19	1	255	1	0
//   └ device user ID, device-local timestamp (no zone), status, verify mode,
//     workcode, reserved
//
// Shared by the backend's ingestion service and the punch simulator so the
// two can never drift apart (docs/plans/PHASE_2.md §3). Tolerant: extra
// trailing columns and surrounding whitespace are accepted; a line that
// can't be read is rejected on its own, kept verbatim, and never fails the
// batch. Status/verify/workcode are stored as received and never relied on
// (our device always sends status 1: no IN/OUT direction).

export interface AttlogLine {
  deviceUserId: string;
  /** Device-local wall-clock time, "YYYY-MM-DD HH:MM:SS" — interpreted in the device's timezone. */
  localTime: string;
  status: string;
  verifyMode: string;
  workcode: string;
  reserved: string;
  raw: string;
}

export interface AttlogRejected {
  lineNumber: number;
  raw: string;
  reason: string;
}

export interface AttlogParseResult {
  lines: Array<AttlogLine & { lineNumber: number }>;
  rejected: AttlogRejected[];
}

const DEVICE_USER_ID = /^[A-Za-z0-9_-]{1,30}$/;
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/** Is "YYYY-MM-DD HH:MM:SS" a real calendar date and time? */
export function isValidLocalTime(s: string): boolean {
  const m = LOCAL_TIME.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && h < 24 && mi < 60 && se < 60;
}

/** Parse one line; returns the reason it can't be read instead of throwing. */
export function parseAttlogLine(raw: string): AttlogLine | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Empty line." };
  const cols = trimmed.split("\t").map((c) => c.trim());
  if (cols.length < 2) return { error: "Expected tab-separated columns: device user ID, then the timestamp." };
  const [deviceUserId, localTimeRaw, status = "", verifyMode = "", workcode = "", reserved = ""] = cols as [string, string, ...string[]];
  if (!DEVICE_USER_ID.test(deviceUserId)) return { error: `"${deviceUserId}" isn't a device user ID.` };
  const localTime = localTimeRaw.replace("T", " ");
  if (!isValidLocalTime(localTime)) return { error: `"${localTimeRaw}" isn't a YYYY-MM-DD HH:MM:SS timestamp.` };
  return { deviceUserId, localTime, status, verifyMode, workcode, reserved, raw: raw.replace(/\r$/, "") };
}

/** Parse a whole ATTLOG text (a file, or an ADMS ATTLOG body). Blank lines are skipped, not rejected. */
export function parseAttlog(text: string): AttlogParseResult {
  const lines: AttlogParseResult["lines"] = [];
  const rejected: AttlogRejected[] = [];
  text.split("\n").forEach((raw, i) => {
    if (!raw.trim()) return;
    const parsed = parseAttlogLine(raw);
    if ("error" in parsed) rejected.push({ lineNumber: i + 1, raw: raw.replace(/\r$/, ""), reason: parsed.error });
    else lines.push({ ...parsed, lineNumber: i + 1 });
  });
  return { lines, rejected };
}

/** One line in exactly the device's format (the simulator writes these). */
export function formatAttlogLine(l: Pick<AttlogLine, "deviceUserId" | "localTime"> & Partial<Pick<AttlogLine, "status" | "verifyMode" | "workcode" | "reserved">>): string {
  return [l.deviceUserId, l.localTime, l.status ?? "1", l.verifyMode ?? "255", l.workcode ?? "1", l.reserved ?? "0"].join("\t");
}

// ── Device-local time ↔ instant ───────────────────────────────────────────

/** The zone's UTC offset in minutes at `instant` (e.g. +330 for Asia/Kolkata). */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** A device-local "YYYY-MM-DD HH:MM:SS" in `timeZone` → the instant it names. */
export function localTimeToInstant(localTime: string, timeZone: string): Date {
  const m = LOCAL_TIME.exec(localTime.replace("T", " "));
  if (!m) throw new Error(`Not a local timestamp: ${localTime}`);
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi, se);
  // Two passes settle the offset around a DST change (none in Asia/Kolkata).
  let instant = naive - zoneOffsetMinutes(timeZone, new Date(naive)) * 60000;
  instant = naive - zoneOffsetMinutes(timeZone, new Date(instant)) * 60000;
  return new Date(instant);
}

/** The instant as device-local "YYYY-MM-DD HH:MM:SS" in `timeZone`. */
export function instantToLocalTime(instant: Date, timeZone: string): string {
  const local = new Date(instant.getTime() + zoneOffsetMinutes(timeZone, instant) * 60000);
  return local.toISOString().slice(0, 19).replace("T", " ");
}

/** The calendar date (UTC-midnight Date, like @db.Date) of a device-local timestamp. */
export function localDate(localTime: string): Date {
  return new Date(`${localTime.slice(0, 10)}T00:00:00Z`);
}
