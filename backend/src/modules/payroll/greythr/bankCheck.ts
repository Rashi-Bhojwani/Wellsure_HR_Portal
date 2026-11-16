import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { cellText, headerKey, readGrid } from "../../../lib/spreadsheet";
import { HttpError } from "../../../middleware/errorHandler";
import { currentLayout } from "../run/layouts";
import type { Layout } from "../run/layout";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): greytHR's bank transfer file checked against the portal's bank layout. Only the header row is read; the rows below
// (account numbers, names, amounts) are counted and never returned, stored or logged. The writer is not changed. Where the headers differ, a suggested layout
// is offered: a column is filled from a field only where the header leaves no doubt; everything else (payment mode code, remark, the debit account) is
// Not set until a director enters it, and a different director confirms the layout as for any layout.

export const BANK_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** Headers whose field is certain; any other header is Not set. Exported for the test. */
export const CERTAIN_FIELDS: Record<string, string> = {
  "from a c no": "DEBIT_ACCOUNT",
  "a c no": "ACCOUNT_NUMBER",
  "beneficiary name": "NAME",
  amount: "AMOUNT",
  date: "PAYMENT_DATE",
  "ifsc code": "IFSC",
};

export interface BankCheckColumn {
  position: number;
  fileHeader: string;
  layoutHeader: string | null;
  verdict: "SAME" | "DIFFERS_ONLY_IN_SPACES_OR_CASE" | "DIFFERENT" | "ONLY_IN_FILE" | "ONLY_IN_LAYOUT";
  /** What the writer would put in the column: a field, or Not set. */
  suggested: string | null;
}
export interface BankCheck {
  fileName: string;
  dataRows: number;
  layout: { status: "NOT_SET" | "PLACEHOLDER" | "CONFIRMED"; version: number | null; extension: string | null; dateFormat: string | null; columnHeaders: boolean };
  columns: BankCheckColumn[];
  headersMatch: boolean;
  /** Plain-language findings beyond the columns (file type, date style). */
  notes: string[];
  /** Offered only when the headers differ (or no layout exists): a layout to start from, every uncertain value Not set. */
  suggestedLayout: Partial<Layout> | null;
}

export async function checkBankFile(file: { buffer: Buffer; originalname: string }, actor: { userId: string; ip?: string | null }): Promise<BankCheck> {
  await requireDirector(actor.userId, "check a bank file layout");
  const grid = await readGrid(file.buffer, `"${file.originalname}"`, BANK_FILE_MAX_BYTES);
  const headerAt = grid.findIndex((r) => r.filter((c) => cellText(c) !== "").length >= 3);
  if (headerAt < 0) throw new HttpError(400, `"${file.originalname}" has no header row: it does not look like a bank transfer file.`, "WRONG_COLUMNS");
  const headerRow = grid[headerAt]!;
  let last = headerRow.length - 1;
  while (last >= 0 && cellText(headerRow[last]) === "") last--;
  const fileHeaders = headerRow.slice(0, last + 1).map((c) => (c === null ? "" : String(c)));
  if (!fileHeaders.some((h) => headerKey(h) === "amount") || !fileHeaders.some((h) => /a c no|account/.test(headerKey(h)))) throw new HttpError(400, `"${file.originalname}" does not look like a bank transfer file: it needs an account number column and an Amount column.`, "WRONG_COLUMNS");
  const dataRows = grid.slice(headerAt + 1).filter((r) => r.some((c) => cellText(c) !== "")).length;

  const current = await currentLayout("BANK_TEMPLATE");
  const layout = (current?.value ?? null) as Layout | null;
  const layoutHeaders = layout?.columnHeaders ? layout.columns.map((c) => c.header ?? "") : layout ? layout.columns.map(() => "") : [];
  const n = Math.max(fileHeaders.length, layoutHeaders.length);
  const columns: BankCheckColumn[] = [];
  for (let i = 0; i < n; i++) {
    const f = fileHeaders[i];
    const l = i < layoutHeaders.length ? layoutHeaders[i]! : null;
    const verdict: BankCheckColumn["verdict"] = f === undefined ? "ONLY_IN_LAYOUT" : l === null ? "ONLY_IN_FILE" : f === l ? "SAME" : headerKey(f) === headerKey(l) && headerKey(f) !== "" ? "DIFFERS_ONLY_IN_SPACES_OR_CASE" : "DIFFERENT";
    columns.push({ position: i + 1, fileHeader: f ?? "", layoutHeader: l, verdict, suggested: f === undefined ? null : (CERTAIN_FIELDS[headerKey(f)] ?? null) });
  }
  const headersMatch = layout !== null && columns.every((c) => c.verdict === "SAME");
  const notes: string[] = [];
  if (/\.xls$/i.test(file.originalname)) notes.push("The bank's file is a legacy .xls. The portal writes .xlsx or a delimited text file (.csv), not .xls: ask the bank whether it accepts .xlsx or .csv before switching. This is an owner question.");
  const dateCol = fileHeaders.findIndex((h) => headerKey(h) === "date");
  const dateSample = dateCol >= 0 ? grid.slice(headerAt + 1).map((r) => cellText(r[dateCol])).find((s) => s !== "") : undefined;
  if (dateSample && /^\d{2}-[A-Z]{3}-\d{4}$/.test(dateSample)) notes.push('The date is written day, month in capitals, year (for example 05-JAN-2026). The layout\'s nearest date style is "DD-MMM-YYYY"; check with the bank whether the month must be in capitals.');
  if (fileHeaders.some((h) => h !== h.trim())) notes.push("Some headers end or start with a space in the bank's file; a layout copies them exactly only if typed with the space.");
  if (!layout) notes.push("No bank layout has been saved yet (Payroll, Bank and Statutory Layouts).");
  else if (current?.status !== "CONFIRMED") notes.push("The saved bank layout is not confirmed yet: a different director confirms it.");
  const suggestedLayout: Partial<Layout> | null = headersMatch
    ? null
    : {
        format: "XLSX",
        extension: "xlsx",
        columnHeaders: true,
        dateFormat: "DD-MMM-YYYY",
        amountDecimals: 2,
        header: [],
        trailer: [],
        columns: fileHeaders.map((h) => {
          const field = CERTAIN_FIELDS[headerKey(h)];
          return field ? { header: h, source: "FIELD" as const, value: field, align: "LEFT" as const, pad: " ", numeric: field === "AMOUNT" } : { header: h, source: "CONSTANT" as const, value: "", align: "LEFT" as const, pad: " ", numeric: false };
        }),
      };
  // Audited without any value from the file: only its shape.
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.greythr.bank_file_checked", entityType: "PayrollLayout", entityId: "BANK_TEMPLATE", after: { columns: fileHeaders.length, dataRows, headersMatch } });
  return {
    fileName: file.originalname,
    dataRows,
    layout: { status: !current ? "NOT_SET" : current.status === "CONFIRMED" ? "CONFIRMED" : "PLACEHOLDER", version: current?.version ?? null, extension: layout?.extension ?? null, dateFormat: layout?.dateFormat ?? null, columnHeaders: layout?.columnHeaders ?? false },
    columns,
    headersMatch,
    notes,
    suggestedLayout,
  };
}
