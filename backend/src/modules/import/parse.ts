import ExcelJS from "exceljs";
import { HttpError } from "../../middleware/errorHandler";
import { DATASET_COLUMNS, type ImportDatasetKey } from "./types";

export interface ParsedRow {
  rowNumber: number; // 1-based spreadsheet row number, for error messages
  values: Record<string, string>; // header name -> trimmed cell text, "" if blank
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "").trim();
  if (typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "").trim();
  return String(value).trim();
}

// Parses the first worksheet of an uploaded .xlsx into rows keyed by this
// dataset's known column headers (case-insensitive, matched by header text
// so a re-ordered or partially-narrowed column set still parses) — spec
// §10's "upload -> parse into staging table" step.
export async function parseUpload(dataset: ImportDatasetKey, buffer: Buffer): Promise<ParsedRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new HttpError(400, "Could not read this file. Upload a .xlsx file, ideally the downloaded template.", "INVALID_FILE");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 1) {
    throw new HttpError(400, "The uploaded file has no data.", "EMPTY_FILE");
  }

  const knownColumns = new Set(DATASET_COLUMNS[dataset].map((c) => c.toLowerCase()));
  const headerRow = sheet.getRow(1);
  const columnIndexByHeader = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const header = cellText(cell);
    if (header && knownColumns.has(header.toLowerCase())) {
      // Preserve the canonical casing from DATASET_COLUMNS, not whatever
      // casing the uploaded file happened to use.
      const canonical = DATASET_COLUMNS[dataset].find((c) => c.toLowerCase() === header.toLowerCase())!;
      columnIndexByHeader.set(canonical, colNumber);
    }
  });
  if (columnIndexByHeader.size === 0) {
    throw new HttpError(
      400,
      `None of this file's column headers match the ${dataset} template. Download the template and use its exact header row.`,
      "UNRECOGNISED_HEADERS",
    );
  }

  const rows: ParsedRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (row.actualCellCount === 0) continue; // fully blank row — skip, don't count as data

    const values: Record<string, string> = {};
    let anyValue = false;
    for (const header of DATASET_COLUMNS[dataset]) {
      const colIndex = columnIndexByHeader.get(header);
      const text = colIndex ? cellText(row.getCell(colIndex)) : "";
      values[header] = text;
      if (text) anyValue = true;
    }
    if (!anyValue) continue; // blank row with only formatting — skip

    rows.push({ rowNumber: r, values });
  }

  return rows;
}
