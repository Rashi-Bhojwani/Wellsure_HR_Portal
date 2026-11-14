import { cellText, headerKey, readGrid, type GridCell } from "../../../lib/spreadsheet";
import { HttpError } from "../../../middleware/errorHandler";
import { canonicalDecimal, dec } from "../money";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): greytHR's monthly salary statement (.xls, also .xlsx): a header block, then a header row starting "EmployeeNo", then one row
// per person. Columns are recognised by name: the person, the days, the three totals, columns never read (bank account, IFSC), columns shown but not compared,
// and every other column with figures is a pay head. Nothing is guessed: a column whose cells are not all numbers is not a head.

export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_PEOPLE = 20_000;

/** Columns by role (keys are loose header keys: lower case, punctuation as spaces). */
const IDENTITY = new Set(["employeeno", "employee no", "employee number", "name", "department", "designation", "location", "manager name"]);
export const DAY_COLUMNS: Record<string, "daysInMonth" | "workdays" | "lop"> = { "days in month": "daysInMonth", "emp effective workdays": "workdays", lop: "lop" };
export const TOTAL_COLUMNS: Record<string, "gross" | "deductions" | "net"> = { gross: "gross", "total deductions": "deductions", "net pay": "net" };
/** Never read into the result: bank details. */
export const NEVER_READ = new Set(["bankaccno", "bank acc no", "ifsc code", "ifsc"]);
/** Shown as present but not compared: not a figure of the month's pay, or not certain what it counts. */
export const NOT_COMPARED = new Set(["attendance lop", "latest salary revision effective date", "has left the organization", "leaving date", "monthly ctc"]);

export interface StatementPerson {
  code: string;
  days: { daysInMonth: string | null; workdays: string | null; lop: string | null };
  totals: { gross: string | null; deductions: string | null; net: string | null };
  /** greytHR column header → amount (canonical decimal). */
  heads: Record<string, string>;
}
export interface Statement {
  title: string | null;
  headColumns: string[];
  notCompared: string[];
  people: StatementPerson[];
}

/** An exact decimal from a cell, or null when the cell is empty; a cell that is neither is reported. */
function amountOf(v: GridCell): string | null | "BAD" {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? canonicalDecimal(dec(v.toFixed(6))) : "BAD"; // allow-number: a cell number read once, to six places, then exact
  if (typeof v === "boolean" || v instanceof Date) return "BAD";
  const s = v.trim().replace(/[₹,\s]/g, "");
  if (s === "" || s === "-") return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? canonicalDecimal(dec(s)) : "BAD";
}

export async function readStatement(buffer: Buffer, fileName: string): Promise<Statement> {
  const grid = await readGrid(buffer, `"${fileName}"`, STATEMENT_MAX_BYTES);
  const headerAt = grid.findIndex((r) => r.some((c) => ["employeeno", "employee no", "employee number"].includes(headerKey(c))));
  if (headerAt < 0) throw new HttpError(400, `"${fileName}" does not look like greytHR's salary statement: there is no "EmployeeNo" column.`, "WRONG_COLUMNS");
  const header = grid[headerAt]!.map((c) => cellText(c));
  const keys = header.map((h) => headerKey(h));
  const codeCol = keys.findIndex((k) => ["employeeno", "employee no", "employee number"].includes(k));
  if (!keys.includes("net pay")) throw new HttpError(400, `"${fileName}" has no "NET PAY" column, so it cannot be compared.`, "WRONG_COLUMNS");
  const title = grid.slice(0, headerAt).map((r) => r.map(cellText).find((t) => /salary statement/i.test(t))).find(Boolean) ?? null;
  const body = grid.slice(headerAt + 1).filter((r) => cellText(r[codeCol]) !== "");
  if (body.length === 0) throw new HttpError(400, `"${fileName}" has no employee rows.`, "EMPTY_FILE");
  if (body.length > MAX_PEOPLE) throw new HttpError(413, `"${fileName}" has more than ${MAX_PEOPLE} rows.`, "FILE_TOO_LARGE");
  // A head is a column outside the known roles with at least one figure and nothing but figures (or blanks).
  const headCols: number[] = [];
  const notCompared: string[] = [];
  const problems: string[] = [];
  keys.forEach((k, i) => {
    if (i === codeCol || k === "" || IDENTITY.has(k) || NEVER_READ.has(k) || DAY_COLUMNS[k] || TOTAL_COLUMNS[k]) return;
    if (NOT_COMPARED.has(k)) return void notCompared.push(header[i]!);
    const cells = body.map((r) => amountOf(r[i] ?? null));
    if (cells.some((c) => c === "BAD")) return void notCompared.push(header[i]!);
    if (cells.some((c) => c !== null)) headCols.push(i);
  });
  const seen = new Set<string>();
  const people: StatementPerson[] = [];
  body.forEach((r, n) => {
    const code = cellText(r[codeCol]);
    if (seen.has(code)) return void problems.push(`Row ${headerAt + n + 2}: employee number ${code} appears twice.`);
    seen.add(code);
    const num = (col: number, what: string): string | null => {
      if (col < 0) return null;
      const v = amountOf(r[col] ?? null);
      if (v === "BAD") {
        problems.push(`Row ${headerAt + n + 2}: ${what} "${cellText(r[col])}" is not a number.`);
        return null;
      }
      return v;
    };
    const col = (k: string) => keys.indexOf(k);
    const heads: Record<string, string> = {};
    for (const i of headCols) {
      const v = num(i, header[i]!);
      if (v !== null) heads[header[i]!] = v;
    }
    people.push({
      code,
      days: { daysInMonth: num(col("days in month"), "DAYS IN MONTH"), workdays: num(col("emp effective workdays"), "EMP EFFECTIVE WORKDAYS"), lop: num(col("lop"), "LOP") },
      totals: { gross: num(col("gross"), "GROSS"), deductions: num(col("total deductions"), "TOTAL DEDUCTIONS"), net: num(col("net pay"), "NET PAY") },
      heads,
    });
  });
  if (problems.length) throw new HttpError(400, `"${fileName}" cannot be compared: ${problems.slice(0, 5).join(" ")}${problems.length > 5 ? ` (and ${problems.length - 5} more)` : ""}`, "FILE_HAS_INVALID_ROWS");
  return { title, headColumns: headCols.map((i) => header[i]!), notCompared, people };
}
