import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { formatDate, parseLayout, renderLayout, type LayoutRow } from "../run/layout";

// The layout engine writes exactly what a specification says, and refuses rather than guesses (docs/plans/PHASE_6.md §14H). These are hand-worked expected files.

const rows: LayoutRow[] = [
  { SERIAL: "1", EMPLOYEE_CODE: "E001", NAME: "Asha Rao", ACCOUNT_NUMBER: "123456789012", IFSC: "TEST0000001", BANK_NAME: "Test Bank", AMOUNT: "45000.5", NARRATION: "Salary Aug 2026", PAYMENT_DATE: "2026-09-05", DEBIT_ACCOUNT: "" },
  { SERIAL: "2", EMPLOYEE_CODE: "E002", NAME: "Ravi, Kumar", ACCOUNT_NUMBER: "998877665544", IFSC: "TEST0000002", BANK_NAME: "Test Bank", AMOUNT: "1200", NARRATION: "Salary Aug 2026", PAYMENT_DATE: "2026-09-05", DEBIT_ACCOUNT: "" },
];
const ctx = { count: 2, total: "46200.5", paymentDate: "2026-09-05", period: "Aug 2026", debitAccount: "000111222333" };
const col = (value: string, extra: object = {}) => ({ source: "FIELD", value, ...extra });

const delimited = {
  format: "DELIMITED",
  delimiter: ",",
  lineEnding: "LF",
  extension: "csv",
  dateFormat: "DD-MM-YYYY",
  columns: [col("SERIAL"), col("NAME"), col("ACCOUNT_NUMBER"), col("IFSC"), col("AMOUNT"), col("PAYMENT_DATE")],
};

describe("a delimited file", () => {
  it("writes the columns in order, formats amounts and dates by the layout, and quotes what needs it", async () => {
    const f = await renderLayout("BANK", delimited, rows, ctx);
    expect(f.bytes.toString("utf8")).toBe('1,Asha Rao,123456789012,TEST0000001,45000.50,05-09-2026\n2,"Ravi, Kumar",998877665544,TEST0000002,1200.00,05-09-2026\n');
    expect([f.contentType, f.extension]).toEqual(["text/csv", "csv"]);
  });

  it("writes header and trailer rows with the count, the total and the payment date, and a column-title row on request", async () => {
    const layout = {
      ...delimited,
      columnHeaders: true,
      columns: [col("SERIAL", { header: "Sl" }), col("AMOUNT", { header: "Amount" })],
      header: [[{ source: "CONSTANT", value: "HDR" }, { source: "PATTERN", value: "{PAYMENT_DATE}" }, { source: "PATTERN", value: "{DEBIT_ACCOUNT}" }]],
      trailer: [[{ source: "CONSTANT", value: "TRL" }, { source: "PATTERN", value: "{COUNT}" }, { source: "PATTERN", value: "{TOTAL}" }]],
      debitAccountEnc: "x",
    };
    const f = await renderLayout("BANK", layout, rows, ctx);
    expect(f.bytes.toString("utf8")).toBe("HDR,05-09-2026,000111222333\nSl,Amount\n1,45000.50\n2,1200.00\nTRL,2,46200.50\n");
  });

  it("uses CRLF when the bank wants it, and another delimiter and date format", async () => {
    const f = await renderLayout("BANK", { ...delimited, delimiter: "|", lineEnding: "CRLF", extension: "txt", dateFormat: "YYYYMMDD", columns: [col("EMPLOYEE_CODE"), col("PAYMENT_DATE")] }, rows, ctx);
    expect(f.bytes.toString("utf8")).toBe("E001|20260905\r\nE002|20260905\r\n");
    expect(f.contentType).toBe("text/plain");
  });

  it("refuses a field that needs quoting when the layout does not quote, rather than writing a broken file", async () => {
    await expect(renderLayout("BANK", { ...delimited, quote: false, columns: [col("NAME")] }, rows, ctx)).rejects.toMatchObject({ code: "LAYOUT_NEEDS_QUOTES" });
  });
});

describe("a fixed-width file", () => {
  const fixed = { format: "FIXED_WIDTH", lineEnding: "LF", extension: "txt", columns: [col("EMPLOYEE_CODE", { width: 6 }), col("NAME", { width: 12 }), col("AMOUNT", { width: 10, align: "RIGHT", pad: "0" })] };
  it("pads each column to its width, left or right, with the chosen character", async () => {
    const f = await renderLayout("BANK", fixed, rows, ctx);
    expect(f.bytes.toString("utf8")).toBe("E001  Asha Rao    0045000.50\nE002  Ravi, Kumar 0001200.00\n");
  });
  it("never cuts a value off: too wide is a refusal that names the person and the column", async () => {
    await expect(renderLayout("BANK", { ...fixed, columns: [col("NAME", { width: 5 })] }, rows, ctx)).rejects.toMatchObject({ code: "LAYOUT_TOO_WIDE", message: expect.stringMatching(/E001.*"Asha Rao".*8 characters.*5 wide/) });
  });
  it("needs a width on every column", () => {
    expect(() => parseLayout("BANK", { ...fixed, columns: [col("NAME")] })).toThrow(/needs a width/);
  });
});

describe("a workbook", () => {
  it("writes the same rows, with numbers where the layout asks for them and the header line first (no blank row above it)", async () => {
    const f = await renderLayout("BANK", { format: "XLSX", extension: "xlsx", columnHeaders: true, columns: [col("EMPLOYEE_CODE", { header: "Code" }), col("AMOUNT", { header: "Amount", numeric: true })] }, rows, ctx);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(f.bytes as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual([undefined, "Code", "Amount"]);
    expect(sheet.getRow(2).values).toEqual([undefined, "E001", 45000.5]);
    expect(sheet.getRow(3).values).toEqual([undefined, "E002", 1200]);
  });
});

describe("refusals", () => {
  it("an amount the format would change is refused: a bank file never pays a different sum", async () => {
    await expect(renderLayout("BANK", { ...delimited, amountDecimals: 0, columns: [col("AMOUNT")] }, rows, ctx)).rejects.toMatchObject({ code: "LAYOUT_LOSSY" });
    const whole = await renderLayout("BANK", { ...delimited, amountDecimals: 0, columns: [col("AMOUNT")] }, [rows[1]!], { ...ctx, total: "1200" });
    expect(whole.bytes.toString("utf8")).toBe("1200\n");
  });
  it("a field that is not part of this kind of file, a header cell that is a data field, an unknown token and an unused debit account are refused with the reason", () => {
    expect(() => parseLayout("BANK", { ...delimited, columns: [col("UAN")] })).toThrow(/"UAN" is not a field/);
    expect(() => parseLayout("PF_ECR", { ...delimited, columns: [col("ACCOUNT_NUMBER")] })).toThrow(/"ACCOUNT_NUMBER" is not a field/);
    expect(() => parseLayout("BANK", { ...delimited, header: [[col("NAME")]] })).toThrow(/cannot be a data field/);
    expect(() => parseLayout("BANK", { ...delimited, columns: [{ source: "PATTERN", value: "{NOPE}" }] })).toThrow(/\{NOPE\} is not available/);
    expect(() => parseLayout("BANK", { ...delimited, columns: [{ source: "PATTERN", value: "{DEBIT_ACCOUNT}" }] })).toThrow(/debit account but none/);
    expect(() => parseLayout("PT", { ...delimited, columns: [col("NAME")], debitAccountEnc: "x" })).toThrow(/only a bank layout/);
  });
  it("unknown keys, an empty column list and a bad extension are refused", () => {
    expect(() => parseLayout("BANK", { ...delimited, surprise: 1 })).toThrow();
    expect(() => parseLayout("BANK", { ...delimited, columns: [] })).toThrow();
    expect(() => parseLayout("BANK", { ...delimited, extension: "../x" })).toThrow();
  });
});

describe("dates", () => {
  it("formats every supported style", () => {
    expect(["YYYY-MM-DD", "DD-MM-YYYY", "DD/MM/YYYY", "YYYYMMDD", "DD-MMM-YYYY"].map((f) => formatDate("2026-03-07", f as never))).toEqual(["2026-03-07", "07-03-2026", "07/03/2026", "20260307", "07-Mar-2026"]);
  });
});
