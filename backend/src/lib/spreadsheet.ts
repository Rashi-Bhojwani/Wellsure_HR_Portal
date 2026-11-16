import ExcelJS from "exceljs";
import { HttpError } from "../middleware/errorHandler";
import { XlsError, looksLikeXls, readXls } from "./xls";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): one way to read the first sheet of an uploaded .xlsx or .xls as a grid of plain values. Formulas are never evaluated (a
// formula cell gives its saved result), macros are never read, nothing is logged or stored. Every problem is an HttpError worded for the uploader.

export type GridCell = string | number | boolean | Date | null;
export type Grid = GridCell[][];

const isZip = (b: Buffer) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

function excelCell(v: ExcelJS.CellValue): GridCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return excelCell((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue); // the saved result only
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    if ("text" in v) return String((v as { text: unknown }).text);
    if ("error" in v) return null;
  }
  return null;
}

/** The first worksheet of an .xlsx or .xls file, as rows of values (row 0 = the sheet's first row). `what` names the file in messages. */
export async function readGrid(buffer: Buffer, what: string, maxBytes: number): Promise<Grid> {
  if (buffer.length === 0) throw new HttpError(400, `${what} is empty.`, "EMPTY_FILE");
  if (buffer.length > maxBytes) throw new HttpError(413, `${what} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`, "FILE_TOO_LARGE");
  if (looksLikeXls(buffer)) {
    try {
      return readXls(buffer).sheets[0]?.rows ?? [];
    } catch (err) {
      if (err instanceof XlsError) throw new HttpError(400, `${what}: ${err.message}`, "UNREADABLE_FILE");
      throw err;
    }
  }
  if (!isZip(buffer)) throw new HttpError(400, `${what} is not an Excel file (.xlsx or .xls).`, "WRONG_FILE_TYPE");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, `${what} could not be read as an Excel file. It may be damaged; save it again from Excel.`, "UNREADABLE_FILE");
  }
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const grid: Grid = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    const out: GridCell[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      out[c - 1] = excelCell(cell.value);
    });
    grid[n - 1] = Array.from(out, (x) => x ?? null);
  });
  return Array.from(grid, (r) => r ?? []);
}

/** A cell as trimmed text ("" for empty). Numbers keep their plain form. */
export const cellText = (v: GridCell | undefined): string => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v).trim());
/** Header text compared loosely: case, spaces and punctuation ignored ("A/C no. " = "a c no"). */
export const headerKey = (v: GridCell | undefined): string => cellText(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
