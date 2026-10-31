import { z } from "zod";
import { buildXlsx, type XlsxColumn } from "../../../lib/xlsx";
import { HttpError } from "../../../middleware/errorHandler";
import { dec, fixed } from "../money";

// The layout engine behind the bank file and the statutory outputs (docs/plans/PHASE_6.md §14H). A layout is DATA, written from the bank's or the portal's own
// specification and confirmed by a second person like any governed item; nothing here knows what any real bank or portal expects. The engine only does what a
// specification can say: which fields, in which order, delimited or fixed width or a workbook, with header and trailer rows, date and amount formats.
// It refuses rather than guesses: a value too wide for its column, an amount that would be changed by the format, an unknown field.

export type LayoutKind = "BANK" | "BANK_RETURN" | "PF_ECR" | "ESI" | "PT" | "LWF";
export const LAYOUT_KINDS: readonly LayoutKind[] = ["BANK", "BANK_RETURN", "PF_ECR", "ESI", "PT", "LWF"];

/** The fields each kind of file can draw on, and which of them are amounts or dates (formatted by the layout's own formats). */
export const LAYOUT_FIELDS: Record<LayoutKind, { fields: readonly string[]; amounts: readonly string[]; dates: readonly string[]; description: Record<string, string> }> = {
  BANK: {
    fields: ["SERIAL", "EMPLOYEE_CODE", "NAME", "ACCOUNT_NUMBER", "IFSC", "BANK_NAME", "AMOUNT", "NARRATION", "PAYMENT_DATE", "DEBIT_ACCOUNT"],
    amounts: ["AMOUNT"],
    dates: ["PAYMENT_DATE"],
    description: { SERIAL: "Row number, from 1", EMPLOYEE_CODE: "Employee code", NAME: "Name as on the payslip", ACCOUNT_NUMBER: "Account number (full)", IFSC: "IFSC", BANK_NAME: "Bank name", AMOUNT: "Net pay", NARRATION: "Narration from the pattern below", PAYMENT_DATE: "Payment date", DEBIT_ACCOUNT: "The company's debit account" },
  },
  // The file the bank sends back (read, never written): which of its columns hold these, found by the column's title.
  BANK_RETURN: {
    fields: ["EMPLOYEE_CODE", "AMOUNT", "STATUS", "REASON"],
    amounts: ["AMOUNT"],
    dates: [],
    description: { EMPLOYEE_CODE: "The employee code as the bank echoes it", AMOUNT: "The amount the bank reports (checked against the batch)", STATUS: "The bank's status for the row", REASON: "The bank's reason for a rejection" },
  },
  PF_ECR: {
    fields: ["UAN", "NAME", "GROSS_WAGES", "EPF_WAGES", "EPS_WAGES", "EDLI_WAGES", "EPF_CONTRIBUTION", "EPS_CONTRIBUTION", "EPF_EPS_DIFF", "NCP_DAYS", "REFUND"],
    amounts: ["GROSS_WAGES", "EPF_WAGES", "EPS_WAGES", "EDLI_WAGES", "EPF_CONTRIBUTION", "EPS_CONTRIBUTION", "EPF_EPS_DIFF", "REFUND"],
    dates: [],
    description: { UAN: "UAN (decrypted)", NAME: "Name", GROSS_WAGES: "Gross pay", EPF_WAGES: "PF wages (before the ceiling)", EPS_WAGES: "Wages the ceiling leaves (EPS)", EDLI_WAGES: "Wages the ceiling leaves (EDLI)", EPF_CONTRIBUTION: "Employee PF", EPS_CONTRIBUTION: "Employer pension (EPS)", EPF_EPS_DIFF: "Employer PF", NCP_DAYS: "Days not paid (loss of pay)", REFUND: "Always 0 (nothing is refunded here)" },
  },
  ESI: {
    fields: ["ESI_NUMBER", "NAME", "DAYS_PAID", "ESI_WAGES", "EMPLOYEE_CONTRIBUTION", "EMPLOYER_CONTRIBUTION"],
    amounts: ["ESI_WAGES", "EMPLOYEE_CONTRIBUTION", "EMPLOYER_CONTRIBUTION"],
    dates: [],
    description: { ESI_NUMBER: "ESI number", NAME: "Name", DAYS_PAID: "Days paid", ESI_WAGES: "Wages ESI was worked on", EMPLOYEE_CONTRIBUTION: "Employee ESI", EMPLOYER_CONTRIBUTION: "Employer ESI" },
  },
  PT: {
    fields: ["EMPLOYEE_CODE", "NAME", "STATE", "PT_AMOUNT"],
    amounts: ["PT_AMOUNT"],
    dates: [],
    description: { EMPLOYEE_CODE: "Employee code", NAME: "Name", STATE: "State the branch is in", PT_AMOUNT: "Professional tax deducted" },
  },
  LWF: {
    fields: ["EMPLOYEE_CODE", "NAME", "STATE", "LWF_EMPLOYEE", "LWF_EMPLOYER"],
    amounts: ["LWF_EMPLOYEE", "LWF_EMPLOYER"],
    dates: [],
    description: { EMPLOYEE_CODE: "Employee code", NAME: "Name", STATE: "State the branch is in", LWF_EMPLOYEE: "Employee contribution", LWF_EMPLOYER: "Employer contribution" },
  },
};

/** Tokens a header or trailer row (or any pattern) can use besides a row's own fields. */
export const FILE_TOKENS = ["COUNT", "TOTAL", "PAYMENT_DATE", "PERIOD", "DEBIT_ACCOUNT"] as const;

const DATE_FORMATS = ["YYYY-MM-DD", "DD-MM-YYYY", "DD/MM/YYYY", "YYYYMMDD", "DD-MMM-YYYY"] as const;

const columnSchema = z
  .object({
    header: z.string().max(80).optional(),
    source: z.enum(["FIELD", "CONSTANT", "PATTERN"]),
    /** FIELD: the field's name. CONSTANT: the text. PATTERN: text with {TOKENS}. */
    value: z.string().max(200),
    width: z.int().min(1).max(200).optional(),
    align: z.enum(["LEFT", "RIGHT"]).default("LEFT"),
    pad: z.string().length(1).default(" "),
    /** XLSX only: write the cell as a number rather than text. */
    numeric: z.boolean().default(false),
  })
  .strict();

export const layoutSchema = z
  .object({
    format: z.enum(["DELIMITED", "FIXED_WIDTH", "XLSX"]),
    delimiter: z.string().min(1).max(3).default(","),
    quote: z.boolean().default(true),
    lineEnding: z.enum(["LF", "CRLF"]).default("CRLF"),
    extension: z.string().regex(/^[a-z0-9]{1,5}$/),
    dateFormat: z.enum(DATE_FORMATS).default("DD-MM-YYYY"),
    amountDecimals: z.int().min(0).max(2).default(2),
    /** The rows written above and below the data, each a list of cells (a CONSTANT or a PATTERN). */
    header: z.array(z.array(columnSchema).min(1).max(60)).max(20).default([]),
    trailer: z.array(z.array(columnSchema).min(1).max(60)).max(20).default([]),
    /** Write a first row naming the columns (from each column's `header`). */
    columnHeaders: z.boolean().default(false),
    columns: z.array(columnSchema).min(1).max(60),
    narrationPattern: z.string().max(200).optional(),
    /** BANK_RETURN only: the status words that mean a row was rejected, in the bank's own words (entered by the owners, never guessed). */
    rejectedStatuses: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    // The company's debit account (BANK only): stored encrypted in the layout's version, so only the last four digits are ever shown.
    debitAccountEnc: z.string().max(500).optional(),
    debitAccountLast4: z.string().max(4).optional(),
    debitAccountHash: z.string().max(100).optional(),
  })
  .strict();

export type Layout = z.infer<typeof layoutSchema>;
type Column = z.infer<typeof columnSchema>;

const tokensIn = (text: string) => [...text.matchAll(/\{([A-Z_]+)\}/g)].map((m) => m[1]!);

/** Validates a layout for one kind: the shape, then every field and token it uses, and that a fixed-width file gives every column a width. */
export function parseLayout(kind: LayoutKind, raw: unknown): Layout {
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `The layout is not valid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "layout"}: ${i.message}`).join("; ")}`, "VALIDATION_ERROR");
  const layout = parsed.data;
  const known = new Set<string>(LAYOUT_FIELDS[kind].fields);
  const tokens = new Set<string>([...FILE_TOKENS, ...known]);
  const problems: string[] = [];
  const checkCell = (c: Column, where: string, rowCell: boolean) => {
    if (c.source === "FIELD") {
      if (!rowCell) problems.push(`${where}: a header or trailer cell cannot be a data field; use a pattern with {COUNT}, {TOTAL} and the like`);
      else if (!known.has(c.value)) problems.push(`${where}: "${c.value}" is not a field of this file (${[...known].join(", ")})`);
    }
    if (c.source === "PATTERN") for (const t of tokensIn(c.value)) if (!tokens.has(t) || (!rowCell && known.has(t) && !FILE_TOKENS.includes(t as (typeof FILE_TOKENS)[number]))) problems.push(`${where}: {${t}} is not available here`);
    if (layout.format === "FIXED_WIDTH" && c.width === undefined) problems.push(`${where}: a fixed-width file needs a width for every column`);
  };
  // The files this system writes: .xlsx (a spreadsheet) and .csv (or another delimited text). A legacy .xls writer is deliberately not built, so a layout cannot ask for one.
  if (["xls", "xlsm", "xlsb"].includes(layout.extension)) problems.push(`extension: a .${layout.extension} file is not written (only .xlsx for a spreadsheet, or a delimited text file such as .csv)`);
  if (layout.format === "XLSX" && layout.extension !== "xlsx") problems.push("extension: a spreadsheet layout is written as .xlsx");
  if (layout.format !== "XLSX" && layout.extension === "xlsx") problems.push("extension: a text layout cannot be named .xlsx; choose the spreadsheet format for an .xlsx file");
  layout.columns.forEach((c, i) => checkCell(c, `column ${i + 1}`, true));
  layout.header.forEach((row, r) => row.forEach((c, i) => checkCell(c, `header row ${r + 1}, cell ${i + 1}`, false)));
  layout.trailer.forEach((row, r) => row.forEach((c, i) => checkCell(c, `trailer row ${r + 1}, cell ${i + 1}`, false)));
  if (layout.narrationPattern) for (const t of tokensIn(layout.narrationPattern)) if (!tokens.has(t)) problems.push(`narration: {${t}} is not available`);
  if (kind === "BANK_RETURN") {
    if (layout.format === "FIXED_WIDTH") problems.push("a bank return file is read as a spreadsheet or a delimited text file, not as fixed-width text");
    const fieldsUsed = new Set(layout.columns.flatMap((c) => (c.source === "FIELD" ? [c.value] : [])));
    for (const need of ["EMPLOYEE_CODE", "STATUS"]) if (!fieldsUsed.has(need)) problems.push(`the return layout needs a column for ${need}`);
    layout.columns.forEach((c, i) => {
      if (c.source !== "FIELD") problems.push(`column ${i + 1}: a return layout only maps fields (the column's title says where the bank puts it)`);
      else if (!c.header) problems.push(`column ${i + 1}: give the title the bank uses for this column`);
    });
    if (!layout.rejectedStatuses || layout.rejectedStatuses.length === 0) problems.push("say which status words mean a row was rejected (the bank's own words)");
  } else if (layout.rejectedStatuses) problems.push("only a bank return layout lists rejected status words");
  if (kind !== "BANK" && layout.debitAccountEnc) problems.push("only a bank layout has a debit account");
  const usesDebit = [...layout.columns, ...layout.header.flat(), ...layout.trailer.flat()].some((c) => (c.source === "FIELD" && c.value === "DEBIT_ACCOUNT") || (c.source === "PATTERN" && tokensIn(c.value).includes("DEBIT_ACCOUNT")));
  if (usesDebit && !layout.debitAccountEnc) problems.push("the layout uses the debit account but none has been entered");
  if (problems.length > 0) throw new HttpError(400, `The layout cannot be used: ${problems.join("; ")}.`, "VALIDATION_ERROR", { problems });
  return layout;
}

export type LayoutRow = Record<string, string>;
export interface LayoutContext {
  count: number;
  total: string;
  paymentDate?: string | undefined;
  period: string;
  debitAccount?: string | undefined;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function formatDate(iso: string, format: Layout["dateFormat"]): string {
  const [y, m, d] = iso.split("-") as [string, string, string];
  switch (format) {
    case "YYYY-MM-DD": return `${y}-${m}-${d}`;
    case "DD-MM-YYYY": return `${d}-${m}-${y}`;
    case "DD/MM/YYYY": return `${d}/${m}/${y}`;
    case "YYYYMMDD": return `${y}${m}${d}`;
    case "DD-MMM-YYYY": return `${d}-${MONTHS[Number(m) - 1]!.charAt(0)}${MONTHS[Number(m) - 1]!.slice(1).toLowerCase()}-${y}`; // allow-number: a month number, not money
  }
}

/** An amount in the layout's decimals. If that would change the amount (whole rupees for 1234.50) the file is refused: a bank file must never pay a different sum. */
function formatAmount(value: string, decimals: number, what: string): string {
  const exact = dec(value);
  const out = fixed(exact, decimals);
  if (!dec(out).equals(exact)) throw new HttpError(409, `${what} is ${value}, which cannot be written with ${decimals} decimal places without changing it. Change the layout's amount decimals.`, "LAYOUT_LOSSY");
  return out;
}

function cellText(c: Column, row: LayoutRow | null, kind: LayoutKind, layout: Layout, ctx: LayoutContext, where: string): string {
  const spec = LAYOUT_FIELDS[kind];
  const tokenValue = (t: string): string => {
    if (t === "COUNT") return String(ctx.count);
    if (t === "TOTAL") return formatAmount(ctx.total, layout.amountDecimals, "The total");
    if (t === "PAYMENT_DATE") return ctx.paymentDate ? formatDate(ctx.paymentDate, layout.dateFormat) : "";
    if (t === "PERIOD") return ctx.period;
    if (t === "DEBIT_ACCOUNT") return ctx.debitAccount ?? "";
    const v = row?.[t] ?? "";
    if (spec.amounts.includes(t)) return formatAmount(v, layout.amountDecimals, `${where}, ${t}`);
    if (spec.dates.includes(t)) return formatDate(v, layout.dateFormat);
    return v;
  };
  if (c.source === "CONSTANT") return c.value;
  if (c.source === "PATTERN") return c.value.replace(/\{([A-Z_]+)\}/g, (_, t: string) => tokenValue(t));
  return tokenValue(c.value);
}

function fit(text: string, c: Column, where: string): string {
  if (c.width === undefined) return text;
  if (text.length > c.width) throw new HttpError(409, `${where}: "${text}" is ${text.length} characters but the column is ${c.width} wide. Widen the column in the layout; nothing is cut off.`, "LAYOUT_TOO_WIDE");
  return c.align === "RIGHT" ? text.padStart(c.width, c.pad) : text.padEnd(c.width, c.pad);
}

function delimit(cells: string[], layout: Layout, where: string): string {
  return cells
    .map((t) => {
      const needs = t.includes(layout.delimiter) || t.includes('"') || /[\r\n]/.test(t);
      if (!needs) return t;
      if (!layout.quote) throw new HttpError(409, `${where}: "${t}" contains the delimiter or a quote, and the layout does not quote fields.`, "LAYOUT_NEEDS_QUOTES");
      return `"${t.replace(/"/g, '""')}"`;
    })
    .join(layout.delimiter);
}

export interface RenderedFile {
  bytes: Buffer;
  contentType: string;
  extension: string;
}

/** Renders rows into the file the layout describes. Pure: the same rows and layout always give the same bytes. */
export async function renderLayout(kind: LayoutKind, layoutRaw: unknown, rows: LayoutRow[], ctx: LayoutContext): Promise<RenderedFile> {
  const layout = parseLayout(kind, layoutRaw);
  const nl = layout.lineEnding === "CRLF" ? "\r\n" : "\n";
  const lineOf = (cells: Column[], row: LayoutRow | null, where: string): string[] => cells.map((c, i) => fit(cellText(c, row, kind, layout, ctx, where), c, `${where}, column ${i + 1}`));
  const headerLines = layout.header.map((cells, r) => lineOf(cells, null, `Header row ${r + 1}`));
  const trailerLines = layout.trailer.map((cells, r) => lineOf(cells, null, `Trailer row ${r + 1}`));
  const dataLines = rows.map((row, i) => lineOf(layout.columns, row, row.EMPLOYEE_CODE ? `Row ${i + 1} (${row.EMPLOYEE_CODE})` : `Row ${i + 1}`));
  const titles = layout.columnHeaders ? [layout.columns.map((c) => c.header ?? "")] : [];

  if (layout.format === "XLSX") {
    // The first line becomes the sheet's header row (the builder always writes one), so the file has no blank line above it. Everything after it is a row.
    const tagged = [...headerLines.map((cells) => ({ cells, data: false })), ...titles.map((cells) => ({ cells, data: false })), ...dataLines.map((cells) => ({ cells, data: true })), ...trailerLines.map((cells) => ({ cells, data: false }))];
    const width = Math.max(...tagged.map((l) => l.cells.length), layout.columns.length);
    const first = tagged[0]?.cells ?? [];
    const columns: XlsxColumn[] = Array.from({ length: width }, (_, i) => ({ key: `c${i}`, header: first[i] ?? "" }));
    const numericAt = new Set(layout.columns.flatMap((c, i) => (c.numeric ? [i] : [])));
    // allow-number: a workbook cell has to be a number for a bank's sheet to read it; the exact decimal is already in the row's text and in every hash.
    const sheetRows = tagged.slice(1).map((l) => Object.fromEntries(l.cells.map((t, i) => [`c${i}`, l.data && numericAt.has(i) ? dec(t).toNumber() : t]))); // allow-number
    const bytes = await buildXlsx([{ name: "File", columns, rows: sheetRows }]);
    return { bytes, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: layout.extension };
  }
  const lines = [...headerLines, ...titles, ...dataLines, ...trailerLines].map((cells, i) => (layout.format === "FIXED_WIDTH" ? cells.join("") : delimit(cells, layout, `Line ${i + 1}`)));
  return { bytes: Buffer.from(lines.length > 0 ? `${lines.join(nl)}${nl}` : "", "utf8"), contentType: layout.format === "DELIMITED" && layout.delimiter === "," ? "text/csv" : "text/plain", extension: layout.extension };
}
