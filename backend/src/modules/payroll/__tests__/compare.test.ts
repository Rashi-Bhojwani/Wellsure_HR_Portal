import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { buildPayrollXlsx } from "../exports";
import { compareRegisters, parseOptions } from "../compare/diff";
import { amountOf, parseRegister } from "../compare/parse";
import type { Register } from "../compare/types";

// Comparing two registers: matched by employee code, per person and per component, with a tolerance. Tested with registers generated here, in the shape this system's own register has (and in
// the shapes a spreadsheet from elsewhere might have). The greytHR parser is the one piece that waits for real samples.

const reg = (label: string, columns: string[], people: Array<[string, string, Record<string, string>]>): Register => ({
  label,
  source: "GENERIC",
  columns,
  ignoredColumns: [],
  people: new Map(people.map(([code, name, amounts]) => [code, { code, name, amounts: new Map(Object.entries(amounts)) }])),
});
const opts = (over: Parameters<typeof parseOptions>[0] = {}) => parseOptions(over);

describe("the comparison", () => {
  const a = () =>
    reg("Wellsure", ["Basic", "HRA", "PF", "Net pay"], [
      ["E1", "Asha", { Basic: "20000", HRA: "10000", PF: "1800", "Net pay": "28200" }],
      ["E2", "Bala", { Basic: "30000", HRA: "15000", PF: "1800", "Net pay": "43200" }],
      ["E3", "Chitra", { Basic: "25000", HRA: "12500", PF: "1800", "Net pay": "35700" }],
      ["E4", "Dev", { Basic: "40000", HRA: "20000", PF: "1800", "Net pay": "58200" }],
    ]);

  it("says nothing is different when nothing is", () => {
    const r = compareRegisters(a(), a(), opts());
    expect(r.summary).toEqual({ matchedPeople: 4, identical: 4, differing: 0, flagged: 0, onlyInA: 0, onlyInB: 0 });
    expect(r.people).toEqual([]);
    expect(r.totals.every((t) => t.difference === "0")).toBe(true);
  });

  it("finds each planted difference by person and by component, exactly, and flags what is beyond the tolerance", () => {
    const b = a();
    b.people.get("E1")!.amounts.set("Net pay", "28200.50"); // 50 paise: within the default ₹1
    b.people.get("E2")!.amounts.set("Basic", "30500"); // ₹500 more
    b.people.get("E2")!.amounts.set("Net pay", "43700");
    b.people.get("E3")!.amounts.set("PF", "1799.00"); // ₹1 exactly: within
    b.people.get("E4")!.amounts.set("HRA", "20001.01"); // ₹1.01: beyond
    const r = compareRegisters(a(), b, opts());
    expect(r.summary).toMatchObject({ matchedPeople: 4, identical: 0, differing: 4, flagged: 2 });
    const by = Object.fromEntries(r.people.map((p) => [p.code, p]));
    expect(by.E1!.flagged).toBe(false);
    expect(by.E1!.differences).toEqual([{ label: "Net pay", a: "28200", b: "28200.50", difference: "0.5", percent: "0", flagged: false }]);
    expect(by.E2!.differences.map((d) => [d.label, d.difference, d.flagged])).toEqual([["Basic", "500", true], ["Net pay", "500", true]]);
    expect(by.E3!.differences.map((d) => [d.label, d.difference, d.flagged])).toEqual([["PF", "-1", false]]);
    expect(by.E4!.differences.map((d) => [d.label, d.difference, d.flagged])).toEqual([["HRA", "1.01", true]]);
    // Flagged people come first.
    expect(r.people.slice(0, 2).map((p) => p.code)).toEqual(["E2", "E4"]);
    // Totals over the people in both.
    expect(r.totals.find((t) => t.label === "Basic")).toEqual({ label: "Basic", a: "115000", b: "115500", difference: "500" });
  });

  it("a percentage tolerance and an amount tolerance each excuse a difference, and a figure of nil is never divided by", () => {
    const b = a();
    b.people.get("E2")!.amounts.set("Basic", "30060"); // 0.2% of 30000
    b.people.get("E1")!.amounts.set("PF", "1900");
    const strict = compareRegisters(a(), b, opts({ toleranceAmount: "0", tolerancePercent: "0" }));
    expect(strict.summary.flagged).toBe(2);
    const loose = compareRegisters(a(), b, opts({ toleranceAmount: "0", tolerancePercent: "0.5" }));
    expect(loose.people.find((p) => p.code === "E2")!.flagged).toBe(false); // within 0.5%
    expect(loose.people.find((p) => p.code === "E1")!.flagged).toBe(true); // 100 on 1800 is 5.5%
    const zero = a();
    zero.people.get("E1")!.amounts.set("HRA", "0");
    const withNil = compareRegisters(zero, a(), opts());
    const d = withNil.people.find((p) => p.code === "E1")!.differences[0]!;
    expect([d.difference, d.percent, d.flagged]).toEqual(["10000", null, true]);
  });

  it("lists people found in only one register, and the columns that could not be lined up", () => {
    const b = reg("greytHR", ["Basic Salary", "HRA", "Bonus", "Net pay"], [
      ["E1", "Asha", { "Basic Salary": "20000", HRA: "10000", Bonus: "0", "Net pay": "28200" }],
      ["E9", "Newcomer", { "Basic Salary": "10000", HRA: "5000", Bonus: "0", "Net pay": "14000" }],
    ]);
    const r = compareRegisters(a(), b, opts({ aliases: { "Basic Salary": "Basic" } }));
    expect(r.summary).toMatchObject({ matchedPeople: 1, onlyInA: 3, onlyInB: 1 });
    expect(r.onlyInA.map((p) => p.code)).toEqual(["E2", "E3", "E4"]);
    expect(r.onlyInB).toEqual([{ code: "E9", name: "Newcomer" }]);
    expect(r.columns).toEqual({ matched: ["Basic", "HRA", "Net pay"], onlyInA: ["PF"], onlyInB: ["Bonus"] });
    // Without the alias, "Basic Salary" is a column of its own and nothing is silently matched.
    const noAlias = compareRegisters(a(), b, opts());
    expect(noAlias.columns.onlyInB).toContain("Basic Salary");
    expect(noAlias.columns.onlyInA).toContain("Basic");
  });

  it("matches column labels regardless of case, spaces and punctuation, and works in exact decimals", () => {
    const x = reg("A", ["Net Pay"], [["E1", null as unknown as string, { "Net Pay": "0.1" }]]);
    const y = reg("B", ["net-pay"], [["E1", "x", { "net-pay": "0.30" }]]);
    const r = compareRegisters(x, y, opts({ toleranceAmount: "0" }));
    expect(r.people[0]!.differences[0]).toMatchObject({ difference: "0.2", flagged: true });
    const sum = reg("A", ["N"], [["E1", "x", { N: "0.3" }]]);
    const parts = reg("B", ["N"], [["E1", "x", { N: "0.30" }]]);
    expect(compareRegisters(sum, parts, opts()).summary.identical).toBe(1); // 0.3 and 0.30 are the same figure
  });
});

describe("reading a register from a spreadsheet", () => {
  async function own(rows: Array<{ code: string; name: string; status: string; basic: number; hra: number; net: number }>, test = false): Promise<Buffer> {
    return buildPayrollXlsx(
      [
        {
          name: "Register",
          columns: [
            { key: "code", header: "Employee code" },
            { key: "name", header: "Name" },
            { key: "status", header: "Status" },
            { key: "basic", header: "Basic", type: "money" },
            { key: "hra", header: "House rent allowance", type: "money" },
            { key: "net", header: "Net pay", type: "money" },
          ],
          rows,
          totals: { name: "Total", net: rows.reduce((s, r) => s + r.net, 0) },
          footer: ["Payroll cycle Aug 2026."],
        },
        { name: "Other", columns: [{ key: "x", header: "x" }], rows: [] },
      ],
      test ? { test: true, text: "TEST — placeholder rules", rules: [] } : { test: false, text: "", rules: [] },
    );
  }
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ code: `E${i + 1}`, name: `Person ${i + 1}`, status: "Payable", basic: 20000 + i * 1000, hra: 10000 + i * 500, net: 28000 + i * 1500 }));

  it("reads this system's own register: the header after a TEST banner, the totals row skipped, the status column left out as not an amount", async () => {
    const r = await parseRegister("OWN", await own(rows(5), true), "Wellsure");
    expect(r.people.size).toBe(5);
    expect(r.columns).toEqual(["Basic", "House rent allowance", "Net pay"]);
    expect(r.ignoredColumns).toEqual(["Status"]);
    expect(r.people.get("E3")!.amounts.get("Net pay")).toBe("31000");
    expect(r.people.get("E3")!.name).toBe("Person 3");
  });

  it("reads a plain table with its own header names, amounts written in any common way, and refuses what it cannot read", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Salary register for August"]);
    ws.addRow([]);
    ws.addRow(["Emp Code", "Employee Name", "Basic Salary", "Deductions", "Net Pay", "Remarks"]);
    ws.addRow(["e1", "Asha", "₹ 20,000.00", "(1,800)", 18200, "ok"]);
    ws.addRow(["e2", "Bala", "30,000", "1,800-", 28200, ""]);
    ws.addRow(["Total", "", 50000, 3600, 46400, ""]);
    const r = await parseRegister("GENERIC", Buffer.from(await wb.xlsx.writeBuffer()), "greytHR");
    expect([...r.people.keys()]).toEqual(["E1", "E2"]); // codes are matched case-insensitively
    expect(r.people.get("E1")!.amounts.get("Deductions")).toBe("-1800");
    expect(r.people.get("E2")!.amounts.get("Deductions")).toBe("-1800");
    expect(r.people.get("E1")!.amounts.get("Basic Salary")).toBe("20000");
    expect(r.ignoredColumns).toEqual(["Remarks"]);
    expect(amountOf("12abc")).toBeNull();
    expect(amountOf("")).toBeNull();

    const noHeader = new ExcelJS.Workbook();
    noHeader.addWorksheet("S").addRow(["Name", "Amount"]);
    await expect(parseRegister("GENERIC", Buffer.from(await noHeader.xlsx.writeBuffer()), "B")).rejects.toMatchObject({ code: "NO_HEADER" });
    await expect(parseRegister("GENERIC", Buffer.from("not a spreadsheet"), "B")).rejects.toMatchObject({ code: "INVALID_FILE" });

    const dup = new ExcelJS.Workbook();
    const d = dup.addWorksheet("S");
    d.addRow(["Employee code", "Net"]);
    d.addRow(["E1", 1]);
    d.addRow(["E1", 2]);
    await expect(parseRegister("GENERIC", Buffer.from(await dup.xlsx.writeBuffer()), "B")).rejects.toMatchObject({ code: "DUPLICATE_CODES" });
  });

  it("greytHR's own layout is waiting for a real sample, and says so rather than guessing", async () => {
    await expect(parseRegister("GREYTHR", Buffer.from("x"), "greytHR")).rejects.toMatchObject({ status: 501, code: "PARSER_WAITING_FOR_SAMPLE" });
  });
});

describe("the comparison through the API", () => {
  let org: TestOrgMasters;
  let maker: { employeeId: string; userId: string; employeeCode: string };
  let employee: { employeeId: string; userId: string; employeeCode: string };
  let makerToken = "";
  let employeeToken = "";

  const book = async (rows: Array<Array<string | number>>) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Register");
    ws.addRow(["Employee code", "Name", "Basic", "Net pay"]);
    for (const r of rows) ws.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    maker = await createFullTestEmployee(org, { roleCode: "PAYROLL_ADMIN" });
    employee = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    makerToken = await loginAs(maker.employeeCode);
    employeeToken = await loginAs(employee.employeeCode);
  });
  afterAll(async () => {
    await cleanupFullTestEmployee(maker.employeeId);
    await cleanupFullTestEmployee(employee.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  const send = (token: string, a: Buffer, b: Buffer, fields: Record<string, string> = {}) => {
    let r = request(app).post("/api/payroll/compare").set(...authHeader(token)).attach("a", a, "a.xlsx").attach("b", b, "b.xlsx");
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r;
  };

  it("compares two registers, returns the differences, keeps nothing, and records only counts", async () => {
    const a = await book([["Z1", "Asha", 20000, 28200], ["Z2", "Bala", 30000, 43200], ["Z3", "Chitra", 25000, 35700]]);
    const b = await book([["Z1", "Asha", 20000, 28200], ["Z2", "Bala", 30500, 43700], ["Z4", "Dev", 40000, 58200]]);
    const r = await send(makerToken, a, b, { sourceA: "OWN", sourceB: "GENERIC", labelA: "Wellsure", labelB: "greytHR" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.summary).toEqual({ matchedPeople: 2, identical: 1, differing: 1, flagged: 1, onlyInA: 1, onlyInB: 1 });
    expect(r.body.people[0]).toMatchObject({ code: "Z2", flagged: true });
    expect(r.body.onlyInA).toEqual([{ code: "Z3", name: "Chitra" }]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.registers.compared", actorUserId: maker.userId }, orderBy: { createdAt: "desc" } });
    const written = JSON.stringify(audit.after);
    expect(written).toContain("\"flagged\":1");
    for (const secret of ["Z1", "Z2", "Z3", "Asha", "Bala", "30500", "43700"]) expect(written).not.toContain(secret);
  });

  it("returns the same result as a workbook to keep", async () => {
    const a = await book([["Z1", "Asha", 20000, 28200], ["Z2", "Bala", 30000, 43200]]);
    const b = await book([["Z1", "Asha", 20000, 28200], ["Z2", "Bala", 31000, 44200]]);
    const r = await send(makerToken, a, b, { format: "xlsx" }).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Summary", "Differences", "Only in one", "Columns"]);
    const diffs: string[] = [];
    wb.getWorksheet("Differences")!.eachRow((row) => diffs.push(row.values!.toString()));
    expect(diffs.join("\n")).toContain("Z2");
  });

  it("is for those who may see salary reports; refuses greytHR's own layout until a sample exists; and says what is wrong with a bad upload", async () => {
    const a = await book([["Z1", "Asha", 1, 1]]);
    expect((await send(employeeToken, a, a)).status).toBe(403);
    const grey = await send(makerToken, a, a, { sourceB: "GREYTHR" });
    expect([grey.status, grey.body.error.code]).toEqual([501, "PARSER_WAITING_FOR_SAMPLE"]);
    expect((await send(makerToken, a, Buffer.from("nope"))).body.error.code).toBe("INVALID_FILE");
    expect((await request(app).post("/api/payroll/compare").set(...authHeader(makerToken)).attach("a", a, "a.xlsx")).body.error.code).toBe("INVALID_UPLOAD");
    expect((await send(makerToken, a, a, { toleranceAmount: "lots" })).status).toBe(400);
  });
});
