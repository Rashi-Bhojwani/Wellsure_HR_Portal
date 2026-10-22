import ExcelJS from "exceljs";
import { HttpError } from "../../../middleware/errorHandler";
import { canonicalDecimal, dec } from "../money";
import type { Register, RegisterPerson, RegisterSource } from "./types";

// Turning a workbook into the neutral shape the comparison works on. Uploads are read in memory and dropped: nothing here stores, logs or caches a file or a figure.
//
//   OWN       the register this system produces (the "Register" sheet of a run's workbook, or the salary register output).
//   GENERIC   any plain table: a header row with a column that holds the employee code, and numeric columns that are the amounts.
//   GREYTHR   greytHR's own register layout. NOT BUILT: it needs real sample files, and it will not be guessed. It says so.

const MAX_ROWS = 20_000;
const SCAN_ROWS = 40;

type Cell = ExcelJS.CellValue;

function text(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("result" in v) return text(v.result as Cell);
    if ("text" in v) return String((v as { text: unknown }).text).trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v).trim();
}

/** An exact decimal from a cell, or null if the cell is not a number. Accepts a number, "1,23,456.50", "₹ 5,000", "(500)" and "500-". */
export function amountOf(v: Cell): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? canonicalDecimal(dec(v.toFixed(6))) : null; // allow-number: a cell number read once, rounded to six places before it becomes a decimal
  if (typeof v === "object" && v !== null && "result" in v) return amountOf(v.result as Cell);
  let s = text(v);
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[₹,\s]|^Rs\.?/gi, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const d = dec(s);
  return canonicalDecimal(negative ? d.negated() : d);
}

async function load(buffer: Buffer, label: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new HttpError(400, `Could not read the file for ${label}. Upload an Excel (.xlsx) file.`, "INVALID_FILE");
  }
  return wb;
}

const CODE_HEADER = /^(emp(loyee)?[\s._-]*(code|id|no\.?|number)|e[\s._-]*code|staff[\s._-]*(id|code|no)|code)$/i;

function findHeader(sheet: ExcelJS.Worksheet, isCode: (header: string) => boolean): { row: number; codeCol: number } | null {
  for (let r = 1; r <= Math.min(SCAN_ROWS, sheet.rowCount); r += 1) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= row.cellCount; c += 1) if (isCode(text(row.getCell(c).value))) return { row: r, codeCol: c };
  }
  return null;
}

/** A neutral register out of a table: the code column, an optional name column, every other column that is entirely numbers. */
function readTable(sheet: ExcelJS.Worksheet, label: string, source: RegisterSource, isCode: (h: string) => boolean): Register {
  const header = findHeader(sheet, isCode);
  if (!header) throw new HttpError(400, `${label}: could not find the header row. It needs a column called “Employee code” (or Emp Code, Employee ID, Code) within the first ${SCAN_ROWS} rows of the sheet “${sheet.name}”.`, "NO_HEADER");
  const headRow = sheet.getRow(header.row);
  const cols: Array<{ index: number; header: string }> = [];
  for (let c = 1; c <= headRow.cellCount; c += 1) {
    const h = text(headRow.getCell(c).value);
    if (h !== "" && c !== header.codeCol) cols.push({ index: c, header: h });
  }
  if (sheet.rowCount - header.row > MAX_ROWS) throw new HttpError(400, `${label}: more than ${MAX_ROWS} rows. A register is one row per person.`, "TOO_LARGE");
  const nameCol = cols.find((c) => /^(employee[\s._-]*)?name$|^full[\s._-]*name$/i.test(c.header))?.index;
  const rows: Array<{ code: string; name: string | null; cells: Map<number, Cell> }> = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (let r = header.row + 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const code = text(row.getCell(header.codeCol).value).toUpperCase();
    if (code === "" || /^(grand\s+)?totals?$/i.test(code)) continue; // blank lines, total rows
    if (cols.every((c) => text(row.getCell(c.index).value) === "")) continue; // a note under the table (a footer line), not a person
    if (seen.has(code)) duplicates.add(code);
    seen.add(code);
    rows.push({ code, name: nameCol ? text(row.getCell(nameCol).value) || null : null, cells: new Map(cols.map((c) => [c.index, row.getCell(c.index).value])) });
  }
  if (duplicates.size > 0) throw new HttpError(400, `${label}: these employee codes appear more than once, so the people cannot be matched: ${[...duplicates].slice(0, 10).join(", ")}.`, "DUPLICATE_CODES");
  if (rows.length === 0) throw new HttpError(400, `${label}: no people were found under the header row.`, "EMPTY_FILE");
  // A column is an amount if every filled cell in it is a number (a status or a note column is not).
  const amountCols: Array<{ index: number; header: string }> = [];
  const ignored: string[] = [];
  const seenHeaders = new Set<string>();
  for (const c of cols) {
    if (c.index === nameCol) continue;
    const filled = rows.map((r) => r.cells.get(c.index)).filter((v) => text(v as Cell) !== "");
    if (filled.length > 0 && filled.every((v) => amountOf(v as Cell) !== null) && !seenHeaders.has(c.header)) {
      amountCols.push(c);
      seenHeaders.add(c.header);
    } else ignored.push(c.header);
  }
  const people = new Map<string, RegisterPerson>();
  for (const r of rows) {
    const amounts = new Map<string, string>();
    for (const c of amountCols) {
      const v = amountOf(r.cells.get(c.index) as Cell);
      if (v !== null) amounts.set(c.header, v);
    }
    people.set(r.code, { code: r.code, name: r.name, amounts });
  }
  return { label, source, columns: amountCols.map((c) => c.header), ignoredColumns: ignored, people };
}

export async function parseRegister(source: RegisterSource, buffer: Buffer, label: string): Promise<Register> {
  if (source === "GREYTHR") {
    throw new HttpError(
      501,
      "greytHR's own register layout is not built yet: it needs a real sample file from your greytHR (one month's register as it exports it), and it will not be guessed. Until then, if your greytHR export is a plain table with an employee-code column, choose “A plain table” for it.",
      "PARSER_WAITING_FOR_SAMPLE",
    );
  }
  const wb = await load(buffer, label);
  if (source === "OWN") {
    const sheet = wb.getWorksheet("Register") ?? wb.worksheets[0];
    if (!sheet) throw new HttpError(400, `${label}: the workbook has no sheets.`, "EMPTY_FILE");
    return readTable(sheet, label, source, (h) => /^employee code$/i.test(h));
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new HttpError(400, `${label}: the workbook has no sheets.`, "EMPTY_FILE");
  return readTable(sheet, label, source, (h) => CODE_HEADER.test(h));
}
