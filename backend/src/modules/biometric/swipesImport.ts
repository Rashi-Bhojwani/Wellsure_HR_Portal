import type { AttlogRejected } from "@shared/attendance/attlog";
import { formatAttlogLine } from "@shared/attendance/attlog";
import { mappingInForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { cellText, headerKey, readGrid, type GridCell } from "../../lib/spreadsheet";
import { HttpError } from "../../middleware/errorHandler";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): greytHR's Attendance Swipes file (.xlsx or .xls: "Access Card number/Employee Number", "Employee Name", "In/Out Status",
// "Door Name", "Date & Time") turned into ATTLOG lines for the chosen device, so it goes through the same preview, duplicate check and immutable ingestion as a
// device's own export. The employee number becomes that person's device user ID in force on the day; a number nobody has, or a person with no device user ID
// that day, is listed as a rejected line and never guessed. Dates are read day first (05/01/2026 = 5 January), as greytHR writes them.

export const SWIPES_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 50_000;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** A local wall time "YYYY-MM-DD HH:MM:SS" from a cell, or null. Exported for the test. */
export function swipeTime(v: GridCell): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  if (typeof v === "number") {
    if (!(v > 1 && v < 2958466)) return null; // an Excel day number (1900 system)
    return swipeTime(new Date(Math.round((v - 25569) * 86400) * 1000));
  }
  const s = cellText(v);
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  let y: number, mo: number, d: number, h: number, mi: number, se: number;
  if (m) [d, mo, y, h, mi, se] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  else {
    m = /^(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (!m) return null;
    [y, mo, d, h, mi, se] = [+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)];
  }
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || se > 59) return null;
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(se)}`;
}

export interface SwipesConversion {
  /** ATTLOG lines, one per readable swipe, for the existing ingestion. */
  text: string;
  /** Rows not turned into a punch, with the sheet's row number and the reason. */
  rejected: AttlogRejected[];
  /** Employee numbers in the file that no employee has. */
  unknownNumbers: string[];
  rows: number;
}

export async function swipesToAttlog(buffer: Buffer, fileName: string): Promise<SwipesConversion> {
  const grid = await readGrid(buffer, `"${fileName}"`, SWIPES_MAX_BYTES);
  const headerAt = grid.findIndex((r) => r.some((c) => /employee number/.test(headerKey(c))) && r.some((c) => headerKey(c) === "date time"));
  if (headerAt < 0) throw new HttpError(400, `"${fileName}" does not look like greytHR's Attendance Swipes file: it needs an "Employee Number" column and a "Date & Time" column.`, "WRONG_COLUMNS");
  const header = grid[headerAt]!.map(headerKey);
  const col = { code: header.findIndex((h) => /employee number/.test(h)), status: header.findIndex((h) => h === "in out status"), time: header.indexOf("date time") };
  const body = grid.slice(headerAt + 1);
  if (body.length > MAX_ROWS) throw new HttpError(413, `"${fileName}" has more than ${MAX_ROWS} rows.`, "FILE_TOO_LARGE");
  const rejected: AttlogRejected[] = [];
  const parsed: Array<{ line: number; code: string; time: string; status: string; raw: string }> = [];
  let considered = 0;
  body.forEach((r, i) => {
    const line = headerAt + i + 2; // the sheet's own row number
    const raw = r.map(cellText).join(" | ");
    const code = cellText(r[col.code]);
    const timeCell = r[col.time] ?? null;
    if (!code && cellText(timeCell) === "") return; // a blank row
    if (r.filter((c) => cellText(c) !== "").length === 1 && /mandatory/i.test(code)) return; // the template's own footer note
    considered++;
    if (!code) return void rejected.push({ lineNumber: line, raw, reason: "No employee number." });
    const time = swipeTime(timeCell);
    if (!time) return void rejected.push({ lineNumber: line, raw, reason: `"${cellText(timeCell)}" is not a date and time (day first, for example 05/01/2026 09:58).` });
    const io = col.status >= 0 ? headerKey(r[col.status]) : "";
    if (io && io !== "in" && io !== "out") return void rejected.push({ lineNumber: line, raw, reason: `In/Out Status "${cellText(r[col.status])}" is neither In nor Out.` });
    parsed.push({ line, code, time, status: io === "in" ? "0" : io === "out" ? "1" : "1", raw });
  });
  const codes = [...new Set(parsed.map((p) => p.code))];
  const employees = await prisma.employee.findMany({ where: { employeeCode: { in: codes } }, select: { id: true, employeeCode: true } });
  const byCode = new Map(employees.map((e) => [e.employeeCode, e.id]));
  const unknownNumbers = codes.filter((c) => !byCode.has(c));
  const lines: string[] = [];
  const mappingCache = new Map<string, string | null>();
  for (const p of parsed) {
    const employeeId = byCode.get(p.code);
    if (!employeeId) {
      rejected.push({ lineNumber: p.line, raw: p.raw, reason: `No employee has the number "${p.code}". Nothing is guessed.` });
      continue;
    }
    const day = p.time.slice(0, 10);
    const key = `${employeeId}|${day}`;
    if (!mappingCache.has(key)) {
      const m = await prisma.deviceUserMapping.findFirst({ where: { employeeId, ...mappingInForceOn(new Date(`${day}T00:00:00Z`)) }, select: { deviceUserId: true } });
      mappingCache.set(key, m?.deviceUserId ?? null);
    }
    const deviceUserId = mappingCache.get(key);
    if (!deviceUserId) {
      rejected.push({ lineNumber: p.line, raw: p.raw, reason: `${p.code} has no device user ID on ${day}. Map it in Attendance, Devices first.` });
      continue;
    }
    lines.push(formatAttlogLine({ deviceUserId, localTime: p.time, status: p.status }));
  }
  rejected.sort((a, b) => a.lineNumber - b.lineNumber);
  return { text: lines.join("\n"), rejected, unknownNumbers, rows: considered };
}
