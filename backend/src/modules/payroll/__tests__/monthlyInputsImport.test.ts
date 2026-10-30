import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { setPayrollConsumptionCheck, setPayrollInputsListener, setPayrollLockCheck } from "../../../lib/effectiveDating";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { payrollConsumption, payrollLockOn } from "../run/lock";
import { CYCLE, buildRunWorld, lockCycle, sidelineEveryoneBut, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary, makeComponent } from "./salaryTestHelpers";

// Stage 4.3: the import of Monthly Inputs, in the layout of the Bulk Salary Overrides sample. Upload → preview → a director confirms; nothing is a figure until then; the
// same file is applied once; one invalid row refuses the whole file unless the director chooses to skip the invalid rows.

describe("monthly inputs import", () => {
  let w: RunWorld;
  let restore: () => Promise<void>;
  let incentive = "";
  let advance = "";
  let nameInc = "";
  let nameAdv = "";
  const id = (n: string) => w.named[n]!.employeeId;
  const code = (n: string) => w.named[n]!.employeeCode;
  const maker = () => w.tokens.maker;
  const get = (path: string, token = maker()) => request(app).get(`/api/payroll/monthly-inputs${path}`).set(...authHeader(token));
  const post = (path: string, body: object, token = maker()) => request(app).post(`/api/payroll/monthly-inputs${path}`).set(...authHeader(token)).send(body);
  const upload = (content: string | Buffer, name = "overrides.csv", token = maker()) => request(app).post("/api/payroll/monthly-inputs/import").set(...authHeader(token)).attach("file", Buffer.isBuffer(content) ? content : Buffer.from(content), name);
  const apply = (batchId: string, fingerprint: string, over: Record<string, unknown> = {}) => post(`/import/${batchId}/apply`, { fingerprint, skipInvalid: false, reason: "Loaded in the test", ...over });
  const ledger = (employee: string, head?: string, month?: string) => prisma.payrollMonthlyInput.findMany({ where: { employeeId: id(employee), ...(head ? { componentCode: head } : {}), ...(month ? { cycleStart: new Date(`${month}T00:00:00Z`) } : {}) }, orderBy: { createdAt: "asc" } });
  let tag = 0;
  const header = () => `Employee Number,Overide From,Overide Till,Principal Part,Interest Part,Remarks,${nameInc},${nameAdv},Slab Salary Bonus,Training Exp`;
  const row = (n: string, from: string, till: string, inc: string, adv = "", remarks = "") => `${code(n)},${from},${till},,,${remarks || `row ${(tag += 1)}`},${inc},${adv},,`;

  beforeAll(async () => {
    setPayrollLockCheck(payrollLockOn);
    setPayrollConsumptionCheck(payrollConsumption);
    w = await buildRunWorld(["a", "b", "c"]);
    const everyone = [w.maker, w.checkerA, w.checkerB, w.outsider, ...w.staff];
    restore = await sidelineEveryoneBut(everyone.map((p) => p.employeeId));
    for (const p of everyone) {
      await lockCycle(p.employeeId, CYCLE.start, CYCLE.end);
      await lockCycle(p.employeeId, "2026-07-01", "2026-07-31");
    }
    for (const n of ["a", "b", "c"]) await giveSalary(w, id(n), "600000", FIRST_SALARY_DAY);
    incentive = `${w.prefix}_INC`;
    advance = `${w.prefix}_ADV`;
    nameInc = `Incentive ${w.prefix}`;
    nameAdv = `Advance ${w.prefix}`;
    await makeComponent(w, incentive, { name: nameInc, payslipOrder: 20, inputItem: true });
    await makeComponent(w, advance, { name: nameAdv, type: "DEDUCTION", payslipOrder: 21, inputItem: true, taxable: false });
  }, 300_000);
  afterAll(async () => {
    setPayrollLockCheck(null);
    setPayrollConsumptionCheck(null);
    setPayrollInputsListener(null);
    await restore?.();
    await teardownRunWorld(w);
  }, 120_000);

  it("offers a template: the sample's fixed columns, then one column per pay head that takes its value from Monthly Inputs", async () => {
    const csv = await get("/import/template?format=csv");
    expect(csv.status).toBe(200);
    expect(csv.text.trim()).toContain(`Employee Number,Override From,Override Till,Principal Part,Interest Part,Remarks`);
    expect(csv.text).toContain(nameInc);
    expect(csv.text).toContain(nameAdv);
    expect(csv.text).not.toMatch(/Slab Salary Bonus|Training Exp|Old Month/i); // never assumed: they exist only if a director creates them
    const xlsx = await get("/import/template?format=xlsx").buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as unknown as ExcelJS.Buffer);
    const first = wb.worksheets[0]!.getRow(1).values as string[];
    expect(first.slice(1, 7)).toEqual(["Employee Number", "Override From", "Override Till", "Principal Part", "Interest Part", "Remarks"]);
  });

  it("a file in the sample's layout previews with nothing saved: columns, rows, empty unknown columns ignored, the two unconfirmed readings stated", async () => {
    const r = await upload(`${header()}\n${row("a", "01-Aug-2026", "31-Aug-2026", "1500.50", "100")}\n${row("b", "2026-08-01", "2026-08-31", "0", "")}\n`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const a = r.body.analysis;
    expect([a.valid, a.invalid, a.fileProblems]).toEqual([2, 0, []]);
    expect(a.columns.filter((c: { kind: string }) => c.kind === "HEAD").map((c: { head: string }) => c.head).sort()).toEqual([advance, incentive].sort());
    expect(a.columns.filter((c: { kind: string }) => c.kind === "IGNORED_EMPTY").map((c: { header: string }) => c.header)).toEqual(["Slab Salary Bonus", "Training Exp"]);
    expect(a.notices.join(" ")).toMatch(/not confirmed/i);
    expect(a.notices.join(" ")).toMatch(/Principal Part and Interest Part/);
    expect(a.rows[0].figures).toEqual({ [incentive]: "1500.5", [advance]: "100" });
    expect(a.rows[1].figures).toEqual({ [incentive]: "0" }); // a blank enters nothing
    expect(a.cells).toBe(3);
    expect(r.body.canApply).toBe(true);
    expect(await prisma.payrollMonthlyInput.count({ where: { employeeId: { in: [id("a"), id("b")] } } })).toBe(0); // nothing saved before a director confirms
  });

  it("confirming writes the figures once, for each month of an inclusive range, void any confirmation, and the same file is never applied twice", async () => {
    const file = `${header()}\n${row("a", "15-Jul-2026", "20-Aug-2026", "700", "", "two months")}\n`;
    const r = await upload(file);
    expect(r.body.analysis.rows[0].months).toEqual(["2026-07-01", "2026-08-01"]); // the months containing From and Till, inclusive
    const stale = await apply(r.body.id, "not-the-fingerprint-you-saw");
    expect([stale.status, stale.body.error.code]).toEqual([409, "PREVIEW_STALE"]);
    const done = await apply(r.body.id, r.body.fingerprint);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect([done.body.written, done.body.months]).toEqual([2, ["2026-07-01", "2026-08-01"]]);
    expect((await ledger("a", incentive, "2026-07-01")).map((x) => x.amount?.toString())).toEqual(["700"]);
    expect((await ledger("a", incentive, "2026-08-01")).map((x) => x.amount?.toString())).toEqual(["700"]);
    expect((await ledger("a", incentive))[0]!.batchId).toBe(r.body.id);
    const batch = await prisma.payrollInputBatch.findUniqueOrThrow({ where: { id: r.body.id } });
    expect([batch.status, batch.appliedByUserId]).toEqual(["APPLIED", w.maker.userId]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.monthly_inputs.import_applied", entityId: r.body.id } });
    expect(JSON.stringify(audit.after)).not.toContain("700"); // the audit row has counts, never a figure
    expect(JSON.stringify(audit.after)).toContain("redacted");
    // Again: the same bytes. It is recognised, and cannot be applied.
    const again = await upload(file);
    expect(again.body.id).toBe(r.body.id);
    expect(again.body.status).toBe("APPLIED");
    const second = await apply(r.body.id, again.body.fingerprint);
    expect(second.status).toBe(409);
    expect(await ledger("a", incentive)).toHaveLength(2);
    // A batch is final: the database refuses to change what was read, or to reopen it.
    await expect(prisma.payrollInputBatch.update({ where: { id: r.body.id }, data: { status: "PREVIEW" } })).rejects.toThrow(/INPUT_BATCHES_FINAL/);
    await expect(prisma.payrollInputBatch.delete({ where: { id: r.body.id } })).rejects.toThrow(/INPUT_BATCHES_APPEND_ONLY/);
  });

  it("principal and interest are read and shown but posted to no month", async () => {
    const file = `${header()}\n${code("c")},2026-08-01,2026-08-31,5000,250.5,loan row,11,,,\n`;
    const r = await upload(file);
    expect([r.body.analysis.rows[0].principal, r.body.analysis.rows[0].interest]).toEqual(["5000", "250.5"]);
    const done = await apply(r.body.id, r.body.fingerprint);
    expect(done.status).toBe(200);
    const rows = await ledger("c");
    expect(rows.map((x) => [x.componentCode, x.amount?.toString()])).toEqual([[incentive, "11"]]);
    expect(await prisma.payrollAdjustment.count({ where: { employeeId: id("c") } })).toBe(0);
  });

  it("one invalid row refuses the whole file, with line numbers and words; nothing is saved", async () => {
    const file = [header(), row("b", "2026-08-01", "2026-08-31", "10"), `NO_SUCH_EMP,2026-08-01,2026-08-31,,,bad person,5,,,`, row("c", "01/08/2026", "2026-08-31", "4"), row("a", "2026-08-01", "2026-08-31", "-3"), row("b", "2026-08-01", "2026-08-31", "99", "", "dup of line 2"), row("a", "2026-09-01", "2026-09-30", "8")].join("\n");
    const r = await upload(file);
    expect([r.body.analysis.valid, r.body.analysis.invalid]).toEqual([1, 5]);
    const problems = Object.fromEntries(r.body.analysis.rows.map((x: { line: number; problems: string[] }) => [x.line, x.problems.join(" | ")]));
    expect(problems[2]).toBe("");
    expect(problems[3]).toMatch(/No employee has the number NO_SUCH_EMP/);
    expect(problems[4]).toMatch(/Override From "01\/08\/2026" is not a date/);
    expect(problems[5]).toMatch(/is negative/);
    expect(problems[6]).toMatch(/also on line 2/);
    expect(problems[7]).toMatch(/not finalised/i); // September's attendance is not final
    expect(r.body.canApply).toBe(false);
    expect(r.body.canApplySkippingInvalid).toBe(true);
    const before = await prisma.payrollMonthlyInput.count({ where: { employeeId: { in: [id("a"), id("b"), id("c")] } } });
    const refused = await apply(r.body.id, r.body.fingerprint);
    expect([refused.status, refused.body.error.code]).toEqual([409, "FILE_HAS_INVALID_ROWS"]);
    expect(await prisma.payrollMonthlyInput.count({ where: { employeeId: { in: [id("a"), id("b"), id("c")] } } })).toBe(before);
    expect((await prisma.payrollInputBatch.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe("PREVIEW");
  });

  it("a director may choose to skip the invalid rows: only the valid rows are saved, and the choice is recorded", async () => {
    const file = [header(), row("b", "2026-08-01", "2026-08-31", "10.25", "", "good line"), `NO_SUCH_EMP,2026-08-01,2026-08-31,,,bad person,5,,,`].join("\n");
    const r = await upload(file);
    const noReason = await post(`/import/${r.body.id}/apply`, { fingerprint: r.body.fingerprint, skipInvalid: true, reason: "r" });
    expect(noReason.status).toBe(400); // a reason is needed
    const done = await apply(r.body.id, r.body.fingerprint, { skipInvalid: true });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect([done.body.written, done.body.skippedRows]).toEqual([1, 1]);
    expect((await ledger("b", incentive, "2026-08-01")).map((x) => x.amount?.toString())).toContain("10.25");
    const batch = await prisma.payrollInputBatch.findUniqueOrThrow({ where: { id: r.body.id } });
    expect([batch.status, batch.skipInvalid]).toEqual(["APPLIED", true]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.monthly_inputs.import_applied", entityId: r.body.id } });
    expect(audit.after).toMatchObject({ skipInvalid: true, skippedInvalidRows: 1 });
    const event = await prisma.payrollEvent.findFirstOrThrow({ where: { subjectType: "MONTHLY_INPUTS_IMPORT", subjectId: r.body.id } });
    expect(event.payload).toMatchObject({ skipInvalid: true, skippedRows: 1 });
  });

  it("a column with figures that names no pay head refuses the file; nothing is guessed from a name", async () => {
    const file = `Employee Number,Overide From,Overide Till,${nameInc},Slab Salary Bonus\n${code("a")},2026-08-01,2026-08-31,5,900\n`;
    const r = await upload(file);
    expect(r.body.analysis.fileProblems.join(" ")).toMatch(/"Slab Salary Bonus" has figures but is not a pay head/);
    expect(r.body.canApply).toBe(false);
    const refused = await apply(r.body.id, r.body.fingerprint);
    expect([refused.status, refused.body.error.code]).toEqual([409, "FILE_REFUSED"]);
    expect((await upload(`Employee Number,${nameInc}\n${code("a")},5\n`)).body.analysis.fileProblems.join(" ")).toMatch(/"Override From" is missing/);
  });

  it("reads an Excel file with real dates and numbers, exactly", async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Sheet0");
    sheet.addRow(["Employee Number", "Overide From", "Overide Till", "Principal Part", "Interest Part", "Remarks", nameInc, nameAdv]);
    sheet.addRow([code("b"), new Date(Date.UTC(2026, 7, 1)), new Date(Date.UTC(2026, 7, 31)), null, null, "excel row", 1234.5, 0.1]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await upload(buffer, "overrides.xlsx");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.analysis.rows[0].figures).toEqual({ [incentive]: "1234.5", [advance]: "0.1" });
    expect(r.body.analysis.rows[0].months).toEqual(["2026-08-01"]);
  });

  it("discarding a preview ends it; other file types and empty files are refused", async () => {
    const r = await upload(`${header()}\n${row("c", "2026-08-01", "2026-08-31", "3", "", "to discard")}\n`);
    expect((await post(`/import/${r.body.id}/discard`, {})).status).toBe(200);
    const after = await apply(r.body.id, r.body.fingerprint);
    expect(after.status).toBe(409);
    expect((await upload("a,b", "notes.txt")).status).toBe(400);
    expect((await upload("", "empty.csv")).status).toBe(400);
    expect((await upload("Employee Number\n", "nothing.csv")).status).toBe(201); // a header and no rows reads, and shows what is missing
    expect((await get("/import/does-not-exist")).status).toBe(404);
    const list = await get("/import");
    expect(list.body.batches.length).toBeGreaterThan(0);
  });
});
