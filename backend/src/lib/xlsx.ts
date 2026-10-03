import ExcelJS from "exceljs";

// The ONE way the backend builds an Excel export (Phase 5 commit F): the
// employee grid, Year End and every report go through here, so headers,
// widths and date/number/rupee formats are the same everywhere. Callers
// hand over plain values; formatting is decided by the column type.

export type XlsxColumnType = "text" | "number" | "date" | "money" | "percent";

export interface XlsxColumn {
  key: string;
  header: string;
  type?: XlsxColumnType; // default "text"
  width?: number;
}

export interface XlsxSheet {
  name: string;
  columns: XlsxColumn[];
  rows: Array<Record<string, unknown>>;
  // A bold row after a blank line (e.g. Year End's total).
  totals?: Record<string, unknown>;
  // Italic lines after the table (filters used, "team only", caveats).
  footer?: string[];
}

const NUM_FMT: Partial<Record<XlsxColumnType, string>> = {
  number: "#,##0.##",
  date: "dd-mmm-yyyy",
  money: '"₹"#,##0.00',
  percent: "0.0%",
};

// "YYYY-MM-DD" strings become real Excel dates (UTC midnight, so the
// calendar date never shifts); anything else is passed through.
function cell(value: unknown, type: XlsxColumnType): unknown {
  if (value === null || value === undefined) return "";
  if (type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`);
  return value;
}

// Excel sheet names: at most 31 characters, none of : \ / ? * [ ].
export function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";
}

export async function buildXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const s of sheets) {
    const sheet = workbook.addWorksheet(safeSheetName(s.name));
    sheet.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, Math.min(40, c.header.length + 4)) }));
    sheet.getRow(1).font = { bold: true };
    for (const c of s.columns) {
      const fmt = NUM_FMT[c.type ?? "text"];
      if (fmt) sheet.getColumn(c.key).numFmt = fmt;
    }
    const addRow = (row: Record<string, unknown>) => sheet.addRow(Object.fromEntries(s.columns.map((c) => [c.key, cell(row[c.key], c.type ?? "text")])));
    for (const row of s.rows) addRow(row);
    if (s.totals) {
      sheet.addRow({});
      addRow(s.totals).font = { bold: true };
    }
    if (s.footer?.length) {
      sheet.addRow({});
      for (const line of s.footer) sheet.addRow([line]).font = { italic: true };
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
