import ExcelJS from "exceljs";

// Builds an in-memory .xlsx matching a dataset's column headers, for
// supertest's `.attach()` — mirrors what a real filled-in template upload
// looks like, without needing a fixture file on disk.
export async function buildXlsx(columns: string[], rows: Record<string, string>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.columns = columns.map((header) => ({ header, key: header }));
  for (const row of rows) {
    sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
