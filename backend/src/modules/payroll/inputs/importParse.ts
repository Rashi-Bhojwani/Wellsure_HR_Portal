import ExcelJS from "exceljs";
import { HttpError } from "../../../middleware/errorHandler";

// Reading an uploaded Monthly Inputs file into plain text cells (docs/plans/STAGE_4_PLAN.md). Pure apart from the workbook reader: no database, no meaning given to a
// column. The layout mirrors the Bulk Salary Overrides sample: a header row, then one row per person.

export const MAX_IMPORT_ROWS = 1000;
const MAX_COLUMNS = 200;

export interface RawTable {
  headers: string[];
  rows: Array<{ line: number; cells: string[] }>;
}

/** The fixed columns, in the order of the sample. "Overide" (the sample's spelling) and "Override" both read. */
export const FIXED_COLUMNS = ["Employee Number", "Override From", "Override Till", "Principal Part", "Interest Part", "Remarks"] as const;
export type FixedColumn = (typeof FIXED_COLUMNS)[number];

export const normaliseHeader = (h: string): string => h.toLowerCase().replace(/overide/g, "override").replace(/[^a-z0-9]/g, "");

const FIXED_BY_KEY = new Map<string, FixedColumn>(FIXED_COLUMNS.map((c) => [normaliseHeader(c), c]));
export const fixedColumnOf = (header: string): FixedColumn | null => FIXED_BY_KEY.get(normaliseHeader(header)) ?? null;

/** RFC 4180: commas, double quotes, doubled quotes inside, line breaks inside quotes. A byte-order mark is dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A date written year-month-day or day-Mon-year (the sample's 01-Apr-2008). Anything else is refused, not guessed (01/04/2008 could be either). */
export function parseDateText(raw: string): string | null {
  const t = raw.trim();
  let iso: string;
  let hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (hit) iso = t;
  else if ((hit = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{4})$/.exec(t))) {
    const month = MONTHS.indexOf(hit[2]!.toLowerCase()) + 1;
    if (month === 0) return null;
    iso = `${hit[3]}-${String(month).padStart(2, "0")}-${hit[1]!.padStart(2, "0")}`;
  } else return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso; // 2008-02-30 reads as March 1: not the same day, so refused
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return String(v); // allow-number: a cell number printed once as text so the amount is parsed exactly, never computed with
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String((v as { text: unknown }).text).trim();
    return "";
  }
  return String(v).trim();
}

function tableOf(grid: string[][]): RawTable {
  if (grid.length === 0) throw new HttpError(400, "The file is empty.", "INVALID_FILE");
  const headers = grid[0]!.map((h) => h.trim());
  if (headers.length > MAX_COLUMNS) throw new HttpError(400, "The file has too many columns.", "INVALID_FILE");
  const rows = grid
    .slice(1)
    .map((cells, i) => ({ line: i + 2, cells: headers.map((_, c) => (cells[c] ?? "").trim()) }))
    .filter((r) => r.cells.some((c) => c !== ""));
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, `The file has more than ${MAX_IMPORT_ROWS} rows. Split it.`, "INVALID_FILE");
  return { headers, rows };
}

export async function readTable(buffer: Buffer, fileName: string): Promise<RawTable> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return tableOf(parseCsv(buffer.toString("utf8")));
  if (!lower.endsWith(".xlsx")) throw new HttpError(400, "Upload an Excel (.xlsx) or CSV (.csv) file.", "INVALID_FILE");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new HttpError(400, "Could not read the file. Upload an Excel (.xlsx) file saved from Excel, or a CSV.", "INVALID_FILE");
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new HttpError(400, "The workbook has no sheet.", "INVALID_FILE");
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    const width = Math.min(row.cellCount, MAX_COLUMNS);
    for (let c = 1; c <= width; c += 1) cells.push(cellText(row.getCell(c).value));
    while (grid.length < rowNumber - 1) grid.push([]);
    grid.push(cells);
  });
  return tableOf(grid);
}
