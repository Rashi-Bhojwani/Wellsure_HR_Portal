import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { XlsError, looksLikeXls, readXls } from "../xls";
import { compoundFile, writeXls, type TestCell } from "./xlsWriter";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): the read-only .xls reader. The two synthetic samples (fake values, the real column layout) are read exactly; generated
// workbooks round-trip; a damaged or unsupported file is refused with a plain message, never half-read. The expected sample values were checked against an
// independent reader during development.
const SAMPLES = path.join(__dirname, "..", "..", "..", "..", "docs", "samples");
const sample = (f: string) => readFileSync(path.join(SAMPLES, f));

describe("legacy Excel (.xls) reader", () => {
  it("reads the synthetic salary statement exactly: the header block, the header row on row 5, one employee row", () => {
    const wb = readXls(sample("Salary_Statement_template.xls"));
    expect(wb.sheets.map((s) => s.name)).toEqual(["Report"]);
    const rows = wb.sheets[0]!.rows;
    expect(rows[1]).toEqual(["DEMO COMPANY PRIVATE LIMITED"]);
    expect(rows[4]).toHaveLength(33);
    expect(rows[4]!.slice(0, 13)).toEqual(["EmployeeNo", "Name", "Department", "designation", "location", "Manager Name", "DAYS IN MONTH", "EMP EFFECTIVE WORKDAYS", "LOP", "BASIC", "HRA", "SPECIAL ALLOWANCE", "GROSS"]);
    expect(rows[5]!.slice(6, 13)).toEqual([31, 31, 0, 10000, 4000, 6000, 20000]);
    expect(rows[5]![25]).toBe(18800); // NET PAY
    expect(rows[5]![31]).toBeNull(); // Leaving Date, empty
  });

  it("reads the synthetic bank transfer file exactly: 21 headers and one row", () => {
    const rows = readXls(sample("Bank_Transfer_template.xls")).sheets[0]!.rows;
    expect(rows[0]).toHaveLength(21);
    expect(rows[0]![0]).toBe("From A/C No.");
    expect(rows[0]![1]).toBe("A/C no. "); // the trailing space is kept: the check reports it
    expect(rows[1]!.slice(0, 7)).toEqual(["000000000000", "000000000001", "Demo Employee 01", 18800, "I", "13-JAN-2021", "DEMO0000001"]);
  });

  it("round-trips generated workbooks: text (with and without a shared string table split across records), numbers, booleans", () => {
    const cell = fc.oneof(fc.string({ maxLength: 40 }).filter((s) => s.length > 0), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.boolean(), fc.constant(null), fc.string({ unit: "grapheme", maxLength: 12 }).filter((s) => s.length > 0));
    fc.assert(
      fc.property(fc.array(fc.array(cell, { maxLength: 8 }), { minLength: 1, maxLength: 12 }), fc.boolean(), fc.integer({ min: 9, max: 300 }), (rows, sst, splitAt) => {
        const file = writeXls([{ name: "S", rows: rows as TestCell[][] }], { sst, splitAt });
        const back = readXls(file).sheets[0]!.rows;
        rows.forEach((row, r) =>
          row.forEach((v, c) => {
            const got = back[r]?.[c] ?? null;
            if (typeof v === "number") expect(Object.is(got, v) || got === v).toBe(true);
            else expect(got).toEqual(v);
          }),
        );
      }),
      { numRuns: 150 },
    );
  });

  it("reads RK numbers and a formula's cached result (number or text) without evaluating anything", () => {
    const rows = readXls(writeXls([{ name: "F", rows: [[{ rk: 42 }, { rk: -7 }, { formula: 1234.5 }, { formula: "cached text" }]] }])).sheets[0]!.rows;
    expect(rows[0]).toEqual([42, -7, 1234.5, "cached text"]);
  });

  it("refuses what it cannot read, in plain words, and reads nothing half-way", () => {
    const refuse = (b: Buffer, msg: RegExp) => expect(() => readXls(b)).toThrowError(msg);
    expect(looksLikeXls(Buffer.from("EmployeeNo,Name\n1,a"))).toBe(false);
    refuse(Buffer.from("EmployeeNo,Name\n1,a"), /not a legacy Excel/);
    refuse(sample("Attendance_Swipes_template.xlsx"), /not a legacy Excel/); // an .xlsx is a zip, not a compound file
    refuse(Buffer.alloc(0), /not a legacy Excel/);
    const good = writeXls([{ name: "S", rows: [["a", 1]] }]);
    refuse(good.subarray(0, 1024), /damaged/); // truncated
    const corrupt = Buffer.from(good);
    corrupt.fill(0xab, 600, 1100); // the workbook's first records overwritten
    expect(() => readXls(corrupt)).toThrowError(XlsError);
    refuse(writeXls([{ name: "S", rows: [["a"]] }], { encrypted: true }), /password/);
    refuse(writeXls([{ name: "S", rows: [["a"]] }], { version: 0x0500 }), /Excel 97-2003/);
    refuse(compoundFile("Book", Buffer.alloc(16)), /Excel 5/);
    refuse(compoundFile("Other", Buffer.alloc(16)), /not an Excel workbook/);
    const loop = Buffer.from(good);
    const fatAt = (loop.readUInt32LE(0x4c) + 1) * 512;
    loop.writeUInt32LE(0, fatAt); // sector 0 points to itself
    refuse(loop, /loop/);
  });
});
