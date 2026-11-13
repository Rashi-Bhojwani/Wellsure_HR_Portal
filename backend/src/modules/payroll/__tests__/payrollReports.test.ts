import ExcelJS from "exceljs";
import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAYROLL_REPORTS, PAYROLL_REPORT_KEYS } from "@shared/constants/payrollReports";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { dec } from "../money";
import { varianceOf } from "../reports/definitions";
import { csvOf } from "../reports/service";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { Frac } from "./rational";
import { CYCLE, calculateRun, setRules } from "./runTestHelpers";

// Stage 6 (docs/plans/STAGE_6_PAYROLL_REPORTS.md): payroll reports over a real finalised run. Made-up people and figures only.
const paise = (s: string | number) => {
  const t = String(s);
  const neg = t.startsWith("-");
  const [w, f = ""] = (neg ? t.slice(1) : t).split(".");
  const v = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -v : v;
};
const sumP = (xs: Array<string | number>) => xs.reduce((s, x) => s + paise(x), 0n);
const r2 = (d: { toFixed: (n: number) => string }) => d.toFixed(2);

describe("Stage 6 — variance arithmetic against exact fractions", () => {
  it("change is exact; change % is change × 100 ÷ before, half up to two places; none when before is zero", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000_00n }), fc.bigInt({ min: 0n, max: 10_000_000_00n }), (bp, np) => {
        const m = (p: bigint) => `${p / 100n}.${String(p % 100n).padStart(2, "0")}`;
        const v = varianceOf(dec(m(bp)), dec(m(np)));
        expect(paise(v.change.toFixed(2))).toBe(np - bp);
        if (bp === 0n) expect(v.percent).toBeNull();
        else {
          const exact = new Frac((np - bp) * 100n, bp); // per cent, exact
          // Half up to 2 places, sign-aware: round |x|·100 + ½ down, then restore the sign.
          const scaled = new Frac(exact.n * 100n, exact.d);
          const neg = scaled.n < 0n;
          const absN = neg ? -scaled.n : scaled.n;
          const rounded = (absN * 2n + scaled.d) / (scaled.d * 2n);
          expect(paise(v.percent!.toFixed(2))).toBe(neg ? -rounded : rounded);
        }
      }),
      { numRuns: 500 },
    );
  });
  it("CSV quotes what needs quoting and disarms formulas in text cells", () => {
    const out = csvOf([{ key: "a", header: "Name", type: "text" }, { key: "b", header: "Amount", type: "money" }], [{ a: "=SUM(A1)", b: "-12.50" }, { a: 'Say "hi", ok', b: "3.00" }], ["Title"]);
    expect(out).toContain(`"'=SUM(A1)",-12.50`);
    expect(out).toContain(`"Say ""hi"", ok",3.00`);
  });
});

describe("Stage 6 — payroll reports over a finalised run", () => {
  let world: Closing;
  let runId = "";
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let mgr: { employeeId: string; userId: string; employeeCode: string };
  const tok: Record<string, string> = {};
  const r = (t: string, method: "get" | "put", path: string, body?: object) => request(app)[method](`/api/payroll-reports${path}`).set(...authHeader(t)).send(body);
  const month = CYCLE.start.slice(0, 7);

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    // One person held by a director: held pay counts in the month reports (and in "people held").
    const hold = await request(app).post("/api/payroll/holds").set(...authHeader(world.tokens.maker)).send({ input: { employeeId: world.named.c!.employeeId, cycleStart: CYCLE.start, reason: "Documents pending" } });
    expect(hold.status).toBe(201);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    mgr = await createFullTestEmployee(world.org, { roleCode: "MANAGER" });
    world.userIds.push(hr.userId, dev.userId, mgr.userId);
    await prisma.employee.updateMany({ where: { id: { in: [hr.employeeId, dev.employeeId, mgr.employeeId] } }, data: { dateOfJoining: new Date("2026-10-01T00:00:00Z") } });
    tok.hr = await loginAs(hr.employeeCode);
    tok.dev = await loginAs(dev.employeeCode);
    tok.mgr = await loginAs(mgr.employeeCode);
    tok.emp = await loginAs(world.named.a!.employeeCode);
  }, 900_000);

  afterAll(async () => {
    await deleteWithDependents("PayrollReportLayout", (await prisma.payrollReportLayout.findMany({ where: { setByUserId: world.maker.userId }, select: { id: true } })).map((x) => x.id));
    for (const x of [hr, dev, mgr]) if (x) await cleanupFullTestEmployee(x.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("HR, a manager, an employee and the Developer are refused every route; no sign-in is refused", async () => {
    for (const who of ["hr", "mgr", "emp", "dev"]) {
      expect((await r(tok[who]!, "get", "")).status, who).toBe(403);
      for (const k of PAYROLL_REPORT_KEYS) expect((await r(tok[who]!, "get", `/${k}`)).status, `${who} ${k}`).toBe(403);
      expect((await r(tok[who]!, "get", "/payroll-summary/export?format=csv")).status, who).toBe(403);
      expect((await r(tok[who]!, "put", "/payroll-summary/layout", { columns: ["cycle"], reason: "nope" })).status, who).toBe(403);
    }
    expect((await request(app).get("/api/payroll-reports")).status).toBe(401);
  });

  it("every report opens for a director, with the conventional layout labelled 'Default, change in settings'", async () => {
    const cat = await r(world.tokens.maker, "get", "");
    expect(cat.body.reports.map((x: { key: string }) => x.key)).toEqual([...PAYROLL_REPORT_KEYS]);
    expect(cat.body.reports[0].layout).toMatchObject({ isDefault: true, label: "Default, change in settings" });
    for (const k of PAYROLL_REPORT_KEYS) {
      const q = k === "variance" ? "" : PAYROLL_REPORTS[k].filters.includes("month") ? `?month=${month}` : "";
      const res = await r(world.tokens.maker, "get", `/${k}${q}`);
      if (k === "variance") expect(res.body.error.code).toBe("NO_FINAL_RUN"); // only one finalised run exists
      else expect(res.status, `${k} ${JSON.stringify(res.body)}`).toBe(200);
    }
    expect((await r(world.tokens.maker, "get", "/head-wise?asOf=2026-01-01")).status).toBe(400); // a filter the report does not take
    expect((await r(world.tokens.maker, "get", "/nope")).status).toBe(404);
  });

  it("the totals match an independent sum of the run's own rows, to the paisa", async () => {
    const items = await prisma.payrollRunItem.findMany({ where: { runId, status: { in: ["PAYABLE", "HELD"] } } });
    const lines = await prisma.payrollRunLine.findMany({ where: { runId } });
    const gross = sumP(items.map((i) => r2(i.gross)));
    const deductions = sumP(items.map((i) => r2(i.deductions)));
    const employer = sumP(items.map((i) => r2(i.employerContributions)));
    const summary = (await r(world.tokens.maker, "get", `/payroll-summary?fromMonth=${month}&toMonth=${month}`)).body;
    expect(summary.rows).toHaveLength(1);
    expect([paise(summary.rows[0].gross), paise(summary.rows[0].deductions), paise(summary.rows[0].employer), paise(summary.rows[0].cost)]).toEqual([gross, deductions, employer, gross + employer]);
    expect(summary.rows[0].paid + summary.rows[0].held).toBe(items.length);
    expect(summary.rows[0].held).toBe(1);
    const dept = (await r(world.tokens.maker, "get", `/department-cost?month=${month}`)).body;
    expect([paise(dept.totals.gross), paise(dept.totals.cost), dept.totals.people]).toEqual([gross, gross + employer, items.length]);
    const heads = (await r(world.tokens.maker, "get", `/head-wise?month=${month}`)).body;
    const byKind = (kind: string) => sumP(heads.rows.filter((h: { kind: string }) => h.kind === kind).map((h: { total: string }) => h.total));
    expect(byKind("earning")).toBe(sumP(lines.filter((l) => l.kind === "EARNING").map((l) => r2(l.amount))));
    expect(byKind("employer contribution")).toBe(employer);
    const stat = (await r(world.tokens.maker, "get", `/statutory-by-person?month=${month}`)).body;
    expect(stat.rows).toHaveLength(items.length);
    const pfEe = sumP(lines.filter((l) => l.source === "PF" && l.kind !== "EMPLOYER_CONTRIBUTION").map((l) => r2(l.amount)));
    expect(paise(stat.totals.pfEmployee)).toBe(pfEe);
    const sumStat = (await r(world.tokens.maker, "get", `/statutory-summary?month=${month}`)).body;
    expect(sumP(sumStat.rows.filter((x: { statute: string }) => x.statute === "PF").map((x: { employee: string }) => x.employee))).toBe(pfEe);
    // The department filter: the company's department keeps everyone, another keeps no one.
    expect((await r(world.tokens.maker, "get", `/department-cost?month=${month}&department=${world.org.departmentId}`)).body.totals.people).toBe(items.length);
    expect((await r(world.tokens.maker, "get", `/statutory-by-person?month=${month}&department=no-such-department`)).body.rows).toEqual([]);
    // CTC: the salaries in force for the three staff.
    const ctc = (await r(world.tokens.maker, "get", `/ctc?asOf=${CYCLE.end}`)).body;
    for (const n of ["a", "b", "c"]) {
      const sal = await prisma.employeeSalary.findFirstOrThrow({ where: { employeeId: world.named[n]!.employeeId } });
      expect(ctc.rows.find((x: { employeeCode: string }) => x.employeeCode === world.named[n]!.employeeCode).annualCtc).toBe(sal.annualCtc.toFixed(2));
    }
  });

  it("B1: the company filter splits people by company (no row = the main company); with no filter the report is exactly as before", async () => {
    const all = await r(world.tokens.maker, "get", `/statutory-by-person?month=${month}`);
    const entity = await prisma.legalEntity.create({ data: { code: `ZZ${world.prefix}`, name: "ZZ Test Company Two", createdByUserId: world.maker.userId } });
    await prisma.employeeLegalEntity.create({ data: { employeeId: world.named.b!.employeeId, legalEntityId: entity.id, setByUserId: world.maker.userId } });
    try {
      const codes = (res: { body: { rows: Array<{ employeeCode: string }> } }) => res.body.rows.map((x) => x.employeeCode).sort();
      const main = await r(world.tokens.maker, "get", `/statutory-by-person?month=${month}&company=MAIN`);
      const two = await r(world.tokens.maker, "get", `/statutory-by-person?month=${month}&company=${entity.id}`);
      expect(codes(two)).toEqual([world.named.b!.employeeCode]);
      expect(codes(main)).not.toContain(world.named.b!.employeeCode);
      expect([...codes(main), ...codes(two)].sort()).toEqual(codes(all));
      expect(two.body.filtersApplied).toContain("Company: ZZ Test Company Two");
      const again = await r(world.tokens.maker, "get", `/statutory-by-person?month=${month}`);
      expect(again.body.rows).toEqual(all.body.rows);
      expect(again.body.totals).toEqual(all.body.totals);
    } finally {
      await deleteWithDependents("LegalEntity", [entity.id]);
    }
  });

  it("exports carry only the chosen columns, as .csv and .xlsx, and every export is audited (never a figure in the audit row)", async () => {
    const csv = await r(world.tokens.maker, "get", `/department-cost/export?format=csv&month=${month}&columns=department,cost`);
    expect(csv.status).toBe(200);
    const text = csv.text;
    expect(text).toContain("Department,Cost to company");
    expect(text).not.toContain("Gross");
    const xlsx = await request(app).get(`/api/payroll-reports/ctc/export?format=xlsx&asOf=${CYCLE.end}&columns=employeeCode,annualCtc`).set(...authHeader(world.tokens.maker)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as unknown as ArrayBuffer);
    const headerRow = (wb.worksheets[0]!.getRow(1).values as unknown[]).filter(Boolean).map(String);
    expect(headerRow.join("|")).toMatch(/Employee code\|Annual CTC/);
    const audits = await prisma.auditLog.findMany({ where: { action: "payroll.report.exported", actorUserId: world.maker.userId }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => (a.after as { format: string }).format)).toEqual(expect.arrayContaining(["csv", "xlsx"]));
    for (const a of audits) expect(JSON.stringify(a.after)).not.toMatch(/\d+\.\d{2}/);
    // No bank account number in any export: the bank-transfer summary lists files, never accounts.
    const bank = await r(world.tokens.maker, "get", "/bank-transfer/export?format=csv");
    const accounts = (await prisma.employeeBankAccount.findMany({ where: { employeeId: { in: Object.values(world.named).map((p) => p.employeeId) } } })).map((b) => b.accountNumberLast4);
    expect(accounts.length).toBeGreaterThan(0);
    expect(bank.text).not.toMatch(/\d{9,}/);
    expect((await r(world.tokens.maker, "get", `/ctc/export?format=csv&columns=nope`)).status).toBe(400);
  });

  it("a director saves the company's layout (audited, append-only); the default label goes away", async () => {
    expect((await r(world.tokens.maker, "put", "/loans/layout", { columns: ["name", "nope"], reason: "made up" })).status).toBe(400);
    const saved = await r(world.tokens.maker, "put", "/loans/layout", { columns: ["balance", "name"], reason: "made up for a test" });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ isDefault: false, label: null, columns: ["name", "balance"] });
    const row = await prisma.payrollReportLayout.findFirstOrThrow({ where: { reportKey: "loans" } });
    await expect(prisma.payrollReportLayout.update({ where: { id: row.id }, data: { reason: "changed" } })).rejects.toThrow(/PAYROLL_REPORT_LAYOUT_APPEND_ONLY/);
    expect(await prisma.auditLog.count({ where: { action: "payroll.report.layout_saved", entityId: "loans" } })).toBe(1);
    // The saved layout decides the export when no columns are named.
    const csv = await r(world.tokens.maker, "get", "/loans/export?format=csv");
    expect(csv.text).toContain("Name,Balance");
  });
});
