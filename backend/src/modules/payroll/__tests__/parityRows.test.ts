import ExcelJS from "exceljs";
import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { byBank, bankSummaryHtml } from "../run/bankSummary";
import { addMonthsClamped, serviceLength } from "../settlements/guide";
import { form16Html } from "../tax/form16Html";
import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, driveToFinal, requestStep, staffWith, type Closing } from "./closeTestHelpers";
import { CYCLE, calculateRun, setRules } from "./runTestHelpers";
import { makeComponent } from "./salaryTestHelpers";

// Session A parity rows (docs/plans/A_PARITY_ROWS.md): the Form 16 PDF (ST-24 / SS-05), the quarterly export (ST-21), the settlement guide (PY-27/28/29), PF and ESI
// challans (ST-03 / ST-06), the bank summary PDF (PY-37) and the reimbursement statement (PY-24), over one real finalised run. Made-up people, figures and numbers only.
const paise = (s: string | number) => {
  const t = String(s);
  const neg = t.startsWith("-");
  const [w, f = ""] = (neg ? t.slice(1) : t).split(".");
  const v = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -v : v;
};
const DAY = 86_400_000;
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe("PY-27/28/29 — service length against a brute-force model", () => {
  it("completed months are the most whole months that fit (day clamped at month ends), days are what is left, both ends counted", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 12_000 }), fc.integer({ min: 0, max: 4_000 }), (startOffset, len) => {
        const doj = new Date(utc("1995-01-01").getTime() + startOffset * DAY);
        const lwd = new Date(doj.getTime() + len * DAY);
        const end = new Date(lwd.getTime() + DAY);
        let m = 0;
        while (addMonthsClamped(doj, m + 1) <= end) m += 1; // brute force, one month at a time
        const days = Math.round((end.getTime() - addMonthsClamped(doj, m).getTime()) / DAY);
        expect(serviceLength(doj, lwd)).toEqual({ years: Math.floor(m / 12), months: m % 12, days, totalDays: len + 1 });
      }),
      { numRuns: 500 },
    );
    expect(serviceLength(utc("2020-01-01"), utc("2020-12-31"))).toEqual({ years: 1, months: 0, days: 0, totalDays: 366 });
    expect(serviceLength(utc("2024-01-31"), utc("2024-02-28"))).toEqual({ years: 0, months: 1, days: 0, totalDays: 29 }); // 31 Jan + 1 month clamps to 29 Feb, the day after the last working day
    expect(serviceLength(utc("2023-03-15"), utc("2026-05-20"))).toEqual({ years: 3, months: 2, days: 6, totalDays: 1163 });
    expect(() => serviceLength(utc("2024-02-01"), utc("2024-01-31"))).toThrow();
  });
});

describe("PY-37 and ST-24 — the pure parts", () => {
  it("per bank code: rows and totals exact, every row counted once", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ bank: fc.constantFrom("ZZAA", "ZZBB", "ZZCC"), p: fc.bigInt({ min: 1n, max: 10_000_000_00n }) }), { maxLength: 40 }), (rows) => {
        const txt = (p: bigint) => `${p / 100n}.${String(p % 100n).padStart(2, "0")}`;
        const got = byBank(rows.map((r) => ({ ifsc: `${r.bank}0001234`, amount: txt(r.p) })));
        for (const g of got) {
          const mine = rows.filter((r) => r.bank === g.bank);
          expect(g.rows).toBe(mine.length);
          expect(paise(g.total.toFixed(2))).toBe(mine.reduce((s, r) => s + r.p, 0n));
        }
        expect(got.reduce((s, g) => s + g.rows, 0)).toBe(rows.length);
      }),
      { numRuns: 300 },
    );
  });
  it("a draft Form 16 page carries the DRAFT mark and says Part A is not made; a confirmed one carries no mark; every value is escaped", () => {
    const base = { company: { legalName: "Made-up Co", address: "1 Test Road" }, employee: { name: "<b>Test</b>", code: "T1", panLast4: "1234" }, year: "2026-27", regime: "NEW", taxablePay: "100.00", tdsDeducted: "0.00", computation: null, missing: [], partA: "Part A is issued from the tax department's portal; it is not made here." };
    const draft = form16Html({ ...base, watermark: "DRAFT: not yet confirmed by a second director" });
    expect(draft).toContain('class="wm">DRAFT');
    expect(draft).toContain("not made here");
    expect(draft).toContain("&lt;b&gt;Test&lt;/b&gt;");
    expect(draft).toContain("ending 1234");
    expect(form16Html({ ...base, watermark: null })).not.toContain('class="wm"');
  });
});

const LAYOUT = {
  format: "DELIMITED",
  delimiter: ",",
  lineEnding: "LF",
  extension: "csv",
  dateFormat: "DD-MM-YYYY",
  amountDecimals: 2,
  header: [[{ source: "CONSTANT", value: "ZZHDR9917" }, { source: "PATTERN", value: "{DEBIT_ACCOUNT}" }, { source: "PATTERN", value: "{COUNT}" }, { source: "PATTERN", value: "{TOTAL}" }]],
  columns: [{ source: "FIELD", value: "SERIAL" }, { source: "FIELD", value: "NAME" }, { source: "FIELD", value: "ACCOUNT_NUMBER" }, { source: "FIELD", value: "IFSC" }, { source: "FIELD", value: "AMOUNT" }, { source: "FIELD", value: "NARRATION" }],
  narrationPattern: "Salary {PERIOD}",
};

describe("Session A parity rows over a finalised run", () => {
  let world: Closing;
  let runId = "";
  let batchId = "";
  let claimId = "";
  let separationId = "";
  const challanIds: string[] = [];
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const tok: Record<string, string> = {};
  const FY = "2026-27";
  const who = (n: string) => world.named[n]!.employeeId;
  const call = (t: string, method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](path).set(...authHeader(t)).send(body);
  const binary = (t: string, path: string) =>
    request(app)
      .get(path)
      .set(...authHeader(t))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
  const put = async (path: string, value: object, token: string) => {
    const pre = await call(token, "post", `/api/payroll${path}/save-preview`, { value });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect((await call(token, "put", `/api/payroll${path}`, { value, fingerprint: pre.body.fingerprint })).status).toBe(200);
  };

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    // A claim for a, approved and waiting as a pending adjustment, so August's run pays it (PY-24).
    await makeComponent(world, `${world.prefix}_REIMB`, { name: "Reimbursement", payslipLabel: "Reimbursement", payslipOrder: 40, taxable: false, prorates: false });
    const claim = await prisma.reimbursementClaim.create({ data: { employeeId: who("a"), typeKey: `${world.prefix}_T`, typeVersion: 1, spentOn: utc("2026-07-20"), amount: "1234.56", description: "made-up claim" } });
    claimId = claim.id;
    await prisma.payrollAdjustment.create({ data: { employeeId: who("a"), componentCode: `${world.prefix}_REIMB`, direction: "EARNING", amount: "1234.56", source: "REIMBURSEMENT", sourceRef: claimId, reason: "Reimbursement (test)", createdByUserId: world.maker.userId } });
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    // The bank file (PY-37).
    await put("/layouts/BANK_TEMPLATE", { ...LAYOUT, debitAccountNumber: "000111222333444" }, world.tokens.maker);
    const cp = await call(world.tokens.checkerA, "post", "/api/payroll/layouts/BANK_TEMPLATE/confirm-preview");
    expect((await call(world.tokens.checkerA, "post", "/api/payroll/layouts/BANK_TEMPLATE/confirm", { version: cp.body.version, note: "checked against a made-up specification", fingerprint: cp.body.fingerprint })).status).toBe(200);
    await requestStep(world.tokens.maker, runId, "bank-file");
    await approve(world, world.tokens.checkerB, runId, "bank-file");
    expect((await call(world.tokens.maker, "post", `/api/payroll/runs/${runId}/bank-file/generate`)).status).toBe(201);
    batchId = (await prisma.bankTransferBatch.findUniqueOrThrow({ where: { runId } })).id;
    for (const [k, role] of [["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      people[k] = await createFullTestEmployee(world.org, { roleCode: role });
      world.userIds.push(people[k]!.userId);
    }
    await prisma.employee.updateMany({ where: { id: { in: Object.values(people).map((p) => p.employeeId) } }, data: { dateOfJoining: utc("2026-10-01") } });
    for (const k of Object.keys(people)) tok[k] = await loginAs(people[k]!.employeeCode);
    tok.a = await loginAs(world.named.a!.employeeCode);
    tok.b = await loginAs(world.named.b!.employeeCode);
    separationId = (await prisma.separation.create({ data: { employeeId: who("c"), lastWorkingDate: utc("2026-09-30"), reason: "test", initiatedByUserId: world.maker.userId } })).id;
  }, 900_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await deleteWithDependents("StatutoryChallan", challanIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("HR, a manager, an employee and the Developer are refused every directors' route; the Developer is refused the own routes too; no sign-in is refused", async () => {
    const directorRoutes: Array<[("get" | "post"), string]> = [
      ["get", `/api/tax/form16/${FY}/people/${who("a")}/pdf`],
      ["get", `/api/tax/quarterly/export?fy=${FY}&quarter=2&format=csv`],
      ["get", `/api/tax/statutory-challans?fy=${FY}&kind=PF`],
      ["post", "/api/tax/statutory-challans"],
      ["post", "/api/tax/statutory-challans/x/confirm"],
      ["get", `/api/settlements/guide?separationId=${separationId}`],
      ["get", `/api/payroll/bank-batches/${batchId}/summary.pdf`],
      ["get", "/api/reimbursements/statement?month=2026-08"],
    ];
    for (const t of ["hr", "mgr", "a", "dev"]) for (const [m, path] of directorRoutes) expect((await call(tok[t]!, m, path, m === "post" ? { kind: "PF", month: "2026-08", depositedOn: "2026-09-10", amount: "1", reference: "ZZTEST0001" } : undefined)).status, `${t} ${path}`).toBe(403);
    expect((await call(tok.dev!, "get", `/api/tax/me/form16/pdf?fy=${FY}`)).status).toBe(403);
    expect((await call(tok.dev!, "get", "/api/reimbursements/mine/statement")).status).toBe(403);
    for (const [, path] of directorRoutes) expect((await request(app).get(path)).status).toBe(401);
    expect(await prisma.statutoryChallan.count({ where: { enteredByUserId: { in: Object.values(people).map((p) => p.userId).concat(world.named.a!.userId) } } })).toBe(0);
  });

  it("ST-24 / SS-05: a person downloads their own Form 16 PDF, marked DRAFT until confirmed, audited without a figure; a director downloads anyone's; nobody unpaid gets one", async () => {
    expect((await call(tok.a!, "get", `/api/tax/me/form16/pdf?fy=${FY}`)).body.error.code).toBe("YEAR_NOT_CLOSED");
    setBusinessTodayForTests(utc("2027-04-10"));
    try {
      const mine = await binary(tok.a!, `/api/tax/me/form16/pdf?fy=${FY}`);
      expect(mine.status).toBe(200);
      expect(mine.headers["content-type"]).toBe("application/pdf");
      expect(mine.headers["content-disposition"]).toContain("-DRAFT.pdf");
      expect((mine.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.form16.pdf_downloaded", entityId: who("a"), actorUserId: world.named.a!.userId }, orderBy: { createdAt: "desc" } });
      expect(audit.after).toMatchObject({ year: FY, draft: true, own: true });
      expect(JSON.stringify(audit.after)).not.toMatch(/\d+\.\d{2}/);
      expect((await call(tok.hr!, "get", `/api/tax/me/form16/pdf?fy=${FY}`)).status).toBe(404); // not paid in the year
      const theirs = await binary(world.tokens.maker, `/api/tax/form16/${FY}/people/${who("b")}/pdf`);
      expect(theirs.status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: "payroll.form16.pdf_downloaded", entityId: who("b"), actorUserId: world.maker.userId } })).toBe(1);
      expect((await call(world.tokens.maker, "get", `/api/tax/form16/${FY}/people/${people.hr!.employeeId}/pdf`)).status).toBe(404);
    } finally {
      setBusinessTodayForTests(null);
    }
  }, 120_000);

  it("ST-21: the quarterly data exports as .csv and .xlsx with each person's paid figure exactly as the run, PAN by its last four, audited without a figure", async () => {
    const csv = await call(world.tokens.maker, "get", `/api/tax/quarterly/export?fy=${FY}&quarter=2&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: who("a") } });
    const line = csv.text.split("\n").find((l) => l.startsWith(world.named.a!.employeeCode))!;
    const cells = line.split(",");
    const header = csv.text.split("\n").find((l) => l.startsWith("Employee code"))!.split(",");
    expect(paise(cells[header.indexOf("2026-08 paid")]!)).toBe(paise(Number(item.gross.toString()).toFixed(2)));
    expect(cells[header.indexOf("PAN (last four)")]).toMatch(/^(…[A-Z0-9]{4}|Not on record)$/);
    const x = await binary(world.tokens.maker, `/api/tax/quarterly/export?fy=${FY}&quarter=2&format=xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getRow(1).values).toContain("2026-08 paid");
    const audits = await prisma.auditLog.findMany({ where: { action: "payroll.tax.quarterly_exported", actorUserId: world.maker.userId } });
    expect(audits.length).toBe(2);
    expect(JSON.stringify(audits.map((a) => a.after))).not.toMatch(/\d+\.\d{2}/);
    expect((await call(world.tokens.maker, "get", `/api/tax/quarterly/export?fy=${FY}&quarter=5&format=csv`)).status).toBe(400);
  });

  it("PY-27/28/29: the settlement guide shows the facts from their sources and every rule Not set; it proposes no amount", async () => {
    const g = await call(world.tokens.maker, "get", `/api/settlements/guide?separationId=${separationId}`);
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: who("c") } });
    expect(g.body.dateOfJoining).toBe(emp.dateOfJoining.toISOString().slice(0, 10));
    expect(g.body.service).toEqual(serviceLength(emp.dateOfJoining, utc("2026-09-30")));
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: who("c") } });
    expect(g.body.lastDrawn.cycle).toBe(CYCLE.label);
    expect(paise(g.body.lastDrawn.gross)).toBe(paise(Number(item.gross.toString()).toFixed(2)));
    const earnings = await prisma.payrollRunLine.findMany({ where: { runItemId: item.id, kind: "EARNING" } });
    expect(g.body.lastDrawn.earnings.map((e: { amount: string }) => paise(e.amount)).reduce((s: bigint, x: bigint) => s + x, 0n)).toBe(earnings.reduce((s, l) => s + paise(Number(l.amount.toString()).toFixed(2)), 0n));
    expect(g.body.rules.map((r: { key: string }) => r.key)).toEqual(["gratuity", "noticePeriod", "encashmentRate"]);
    for (const r of g.body.rules) expect(r).toMatchObject({ value: null, state: "Not set" });
    expect(Object.keys(g.body).sort()).toEqual(["dateOfJoining", "employeeCode", "lastDrawn", "lastWorkingDate", "leave", "note", "rules", "separationId", "service"]); // no amount field of its own
    for (const r of g.body.rules) expect(Object.keys(r).sort()).toEqual(["key", "label", "state", "value", "why"]);
    expect((await call(world.tokens.maker, "get", "/api/settlements/guide?separationId=nope")).status).toBe(404);
  });

  it("ST-03 / ST-06: a PF challan is sealed, shown by its last four, refused twice, confirmed only by a different director retyping it; the month compares the run's PF lines with confirmed deposits", async () => {
    const body = { kind: "PF", month: "2026-08", depositedOn: "2026-09-10", amount: "100.50", reference: "ZZTRRN12345678" };
    const a = await call(world.tokens.maker, "post", "/api/tax/statutory-challans", body);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    challanIds.push(a.body.id);
    expect((await call(world.tokens.maker, "post", "/api/tax/statutory-challans", body)).body.error.code).toBe("DUPLICATE_REFERENCE");
    const b = await call(world.tokens.maker, "post", "/api/tax/statutory-challans", { ...body, amount: "7.25", reference: "ZZTRRN99990000" });
    challanIds.push(b.body.id);
    expect((await call(world.tokens.maker, "post", "/api/tax/statutory-challans", { ...body, depositedOn: "2099-01-01", reference: "ZZTRRN55550000" })).status).toBe(400);
    const row = await prisma.statutoryChallan.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(JSON.stringify(row.reference)).not.toContain("12345678");
    expect((await call(world.tokens.maker, "post", `/api/tax/statutory-challans/${a.body.id}/confirm`, { amount: "100.50", reference: "ZZTRRN12345678" })).body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await call(world.tokens.checkerA, "post", `/api/tax/statutory-challans/${a.body.id}/confirm`, { amount: "100.50", reference: "ZZTRRN12345679" })).body.error.code).toBe("RETYPE_MISMATCH");
    expect((await call(world.tokens.checkerA, "post", `/api/tax/statutory-challans/${a.body.id}/confirm`, { amount: "100.5", reference: "zztrrn12345678" })).status).toBe(200);
    await expect(prisma.statutoryChallanConfirmation.create({ data: { challanId: b.body.id, confirmedByUserId: world.maker.userId } })).rejects.toThrow(/STATUTORY_CHALLAN_SAME_PERSON/);
    await expect(prisma.statutoryChallan.update({ where: { id: a.body.id }, data: { amount: "1" } })).rejects.toThrow(/STATUTORY_CHALLAN_IMMUTABLE/);
    const reg = await call(world.tokens.maker, "get", `/api/tax/statutory-challans?fy=${FY}&kind=PF`);
    expect(reg.body.challans.find((c: { id: string }) => c.id === a.body.id)).toMatchObject({ reference: "…5678", confirmed: true });
    expect(JSON.stringify(reg.body)).not.toContain("12345678");
    const aug = reg.body.months.find((m: { month: string }) => m.month === "2026-08");
    // Independent: every PF line of every finalised August run, in paise.
    const lines = await prisma.payrollRunLine.findMany({ where: { source: "PF", runItem: { status: { in: ["PAYABLE", "HELD"] } }, run: { status: "FINALISED", cycleEnd: { gte: utc("2026-08-01"), lte: utc("2026-08-31") } } } });
    const p2 = (v: { toString(): string }) => paise(Number(v.toString()).toFixed(2));
    expect(paise(aug.employee)).toBe(lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => s + p2(l.amount), 0n));
    expect(paise(aug.employer)).toBe(lines.filter((l) => l.kind === "EMPLOYER_CONTRIBUTION").reduce((s, l) => s + p2(l.amount), 0n));
    expect(paise(aug.deposited)).toBe(paise("100.50")); // the unconfirmed one does not count
    expect(paise(aug.difference)).toBe(paise(aug.workedOut) - paise(aug.deposited));
    expect(paise(aug.workedOut)).toBe(paise(aug.employee) + paise(aug.employer));
    const esi = await call(world.tokens.maker, "get", `/api/tax/statutory-challans?fy=${FY}&kind=ESI`);
    expect(esi.body.challans).toEqual([]);
    const audits = await prisma.auditLog.findMany({ where: { action: { startsWith: "payroll.statutory_challan." }, entityId: { in: challanIds } } });
    expect(audits.map((x) => x.action).sort()).toEqual(["payroll.statutory_challan.confirmed", "payroll.statutory_challan.entered", "payroll.statutory_challan.entered"]);
    expect(JSON.stringify(audits.map((x) => x.after))).not.toMatch(/12345678|100\.5/);
  });

  it("PY-37: the bank summary is a PDF for directors, audited; its page has the file's rows and total by bank code and no account number, name or person's pay", async () => {
    const r = await binary(world.tokens.maker, `/api/payroll/bank-batches/${batchId}/summary.pdf`);
    expect(r.status).toBe(200);
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    expect(await prisma.auditLog.count({ where: { action: "payroll.bank.summary_downloaded", entityId: batchId } })).toBe(1);
    const { html } = await bankSummaryHtml(batchId);
    const rows = await prisma.bankTransferRow.findMany({ where: { batchId } });
    const batch = await prisma.bankTransferBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(html).toContain(`₹ ${Number(batch.total.toString()).toFixed(2)}`);
    for (const row of rows) {
      expect(html).not.toContain(row.accountLast4);
      expect(html).not.toContain(row.narration);
    }
    for (const n of ["a", "b", "c"]) expect(html).not.toContain(world.named[n]!.employeeCode);
    expect((await call(world.tokens.maker, "get", "/api/payroll/bank-batches/nope/summary.pdf")).status).toBe(404);
  }, 120_000);

  it("PY-24: the person sees the claims a run paid them; another person sees none of them; directors see the month's statement", async () => {
    const mine = await call(tok.a!, "get", "/api/reimbursements/mine/statement");
    expect(mine.status).toBe(200);
    const aug = mine.body.runs.find((r: { runId: string }) => r.runId === runId);
    expect(aug.lines).toEqual([{ claimId, type: `${world.prefix}_T`, spentOn: "2026-07-20", amount: "1234.56" }]);
    expect(aug.total).toBe("1234.56");
    const other = await call(tok.b!, "get", "/api/reimbursements/mine/statement");
    expect(JSON.stringify(other.body)).not.toContain(claimId);
    const month = await call(world.tokens.maker, "get", "/api/reimbursements/statement?month=2026-08");
    const line = month.body.runs.flatMap((r: { lines: Array<{ claimId: string }> }) => r.lines).find((l: { claimId: string }) => l.claimId === claimId);
    expect(line).toMatchObject({ employeeCode: world.named.a!.employeeCode, amount: "1234.56" });
    expect((await call(world.tokens.maker, "get", "/api/reimbursements/statement?month=August")).status).toBe(400);
  });
});
