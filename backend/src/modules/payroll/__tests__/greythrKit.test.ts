import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { DEVELOPER_FORBIDDEN_KEYS, DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { writeXls, type TestCell } from "../../../lib/__tests__/xlsWriter";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { setOverride } from "../../access/service";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { autoMapping, compareStatements, type SidePerson } from "../greythr/compare";
import { goldenSnapshot } from "./goldenHelpers";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { CYCLE, calculateRun, setRules } from "./runTestHelpers";

// Stage 8 (docs/plans/STAGE_8_PLAN.md, IE-12, PY-32): the parallel-run kit and the bank file check. Generated statements in the synthetic sample's own layout and
// made-up people only. The kit writes no payroll data; comparisons are saved encrypted; nothing is guessed.
const SAMPLES = path.join(__dirname, "..", "..", "..", "..", "..", "docs", "samples");
const person = (code: string, heads: Record<string, string>, over: Partial<SidePerson> = {}): SidePerson => ({ code, days: { workdays: "31", lop: "0" }, totals: { gross: "0", deductions: "0", net: "0" }, heads, ...over });

describe("Stage 8 — the comparison, against generated pairs and an independent reference", () => {
  const map = { BASIC: "B", HRA: "H" };
  const labels = { B: "Basic", H: "HRA" };
  it("an exact match, a one-rupee difference (which side is higher), a missing person, an extra head, a different LOP; a likely cause only where certain", () => {
    const g = [person("E1", { BASIC: "1000", HRA: "400" }), person("E2", { BASIC: "500", HRA: "200", BONUS: "50" }), person("E3", { BASIC: "1" }), person("E4", { BASIC: "10" }, { days: { workdays: "30", lop: "1" } })];
    const p = [person("E1", { B: "1000", H: "400" }), person("E2", { B: "501", H: "200" }), person("E4", { B: "10" }, { days: { workdays: "30", lop: "2" } }), person("E5", { B: "7" })];
    const r = compareStatements(g, p, map, labels, "0");
    const byCode = Object.fromEntries(r.people.map((x) => [x.code, x]));
    expect(byCode.E1!.matched).toBe(true);
    const basic = byCode.E2!.lines.find((l) => l.item === "Basic")!;
    expect([basic.difference, basic.higher, basic.matched, basic.hint]).toEqual(["1", "PORTAL", false, null]); // a plain difference: no cause guessed
    expect(byCode.E2!.lines.find((l) => l.item === "BONUS")!.hint).toMatch(/only in greytHR/);
    expect([byCode.E3!.side, byCode.E5!.side]).toEqual(["GREYTHR_ONLY", "PORTAL_ONLY"]);
    expect(byCode.E4!.lines.find((l) => l.item === "LOP days")).toMatchObject({ matched: false, hint: "LOP days differ: greytHR 1, the portal 2." });
    expect(r.heads.onlyInGreythr).toEqual(["BONUS"]);
    expect(r.counts).toEqual({ matchedPeople: 1, peopleWithDifferences: 2, greythrOnly: 1, portalOnly: 1, differences: 3 }); // E2: the rupee and BONUS; E4: LOP
    // The tolerance: a one-rupee allowance makes the rupee a match; days still compare exactly.
    const tol = compareStatements(g, p, map, labels, "1");
    expect(tol.people.find((x) => x.code === "E2")!.lines.find((l) => l.item === "Basic")!.matched).toBe(true);
    expect(tol.people.find((x) => x.code === "E4")!.lines.find((l) => l.item === "LOP days")!.matched).toBe(false);
  });

  it("people are matched by employee number only (a name or a row order never matters)", () => {
    const r = compareStatements([person("E1", { BASIC: "10" }), person("E2", { BASIC: "20" })], [person("E2", { B: "20" }), person("E1", { B: "10" })], map, labels, "0");
    expect(r.counts.matchedPeople).toBe(2);
  });

  it("names map only when they are the same once case and punctuation are ignored; two candidates are left for a director", () => {
    expect(autoMapping(["BASIC", "SPECIAL ALLOWANCE", "PF"], [{ code: "B", label: "Basic" }, { code: "S", label: "Special allowance" }, { code: "P1", label: "PF" }, { code: "P2", label: "P.F." }])).toEqual({ BASIC: "B", "SPECIAL ALLOWANCE": "S", PF: null });
  });

  it("property: every person, head and total agrees with a simple independent reference (paise integers, allowance in paise)", () => {
    const paise = fc.integer({ min: 0, max: 5_000_000 });
    const rupees = (n: number) => `${Math.trunc(n / 100)}.${String(n % 100).padStart(2, "0")}`;
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 30 }), paise, paise, fc.boolean(), fc.boolean()), { minLength: 1, maxLength: 25 }), fc.integer({ min: 0, max: 300 }), (rows, allowance) => {
        const seen = new Set<number>();
        const uniq = rows.filter(([id]) => (seen.has(id) ? false : (seen.add(id), true)));
        const g = uniq.filter((r) => r[3]).map(([id, a]) => person(`E${id}`, { BASIC: rupees(a) }));
        const p = uniq.filter((r) => r[4]).map(([id, , b]) => person(`E${id}`, { B: rupees(b) }));
        const r = compareStatements(g, p, { BASIC: "B" }, { B: "Basic" }, rupees(allowance));
        for (const [id, a, b, inG, inP] of uniq) {
          const got = r.people.find((x) => x.code === `E${id}`);
          if (!inG && !inP) {
            expect(got).toBeUndefined();
            continue;
          }
          expect(got!.side).toBe(inG && inP ? "BOTH" : inG ? "GREYTHR_ONLY" : "PORTAL_ONLY");
          if (inG && inP) {
            const l = got!.lines.find((x) => x.item === "Basic")!;
            expect(Math.round(Number(l.difference) * 100)).toBe(b - a); // allow-number: the reference's own paise
            expect(l.matched).toBe(Math.abs(b - a) <= allowance);
          }
        }
        const sumG = uniq.filter((x) => x[3]).reduce((s, x) => s + x[1], 0);
        const sumP = uniq.filter((x) => x[4]).reduce((s, x) => s + x[2], 0);
        expect(Math.round(Number(r.totals.find((t) => t.item === "Basic")?.difference ?? "0") * 100)).toBe(sumP - sumG); // allow-number: no Basic on either side = 0
      }),
      { numRuns: 300 },
    );
  });
});

describe("Stage 8 — the parallel-run kit and the bank file check over a finalised run", () => {
  let world: Closing;
  let runId = "";
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const tok: Record<string, string> = {};
  const comparisonIds: string[] = [];
  const proposalIds: string[] = [];
  const kit = (t: string, m: "get" | "post" | "delete", p: string) => request(app)[m](`/api/payroll-greythr${p}`).set(...authHeader(t));
  type Row = { code: string; paidDays: string; lopDays: string; gross: string; deductions: string; net: string; heads: Record<string, string> };
  let portal: Row[] = [];
  let headLabels: string[] = [];

  /** A salary statement in the synthetic sample's own layout (its header block and columns), from rows of figures. */
  function statement(rows: Row[], extraHeads: string[] = []): Buffer {
    const heads = [...headLabels, ...extraHeads];
    const header = ["EmployeeNo", "Name", "Department", "designation", "location", "Manager Name", "DAYS IN MONTH", "EMP EFFECTIVE WORKDAYS", "LOP", ...heads, "GROSS", "TOTAL DEDUCTIONS", "NET PAY", "ATTENDANCE LOP", "Latest Salary revision effective date", "BankAccNo", "IFSC Code", "Has Left The Organization?", "Leaving Date", "MONTHLY CTC"];
    const body: TestCell[][] = rows.map((r) => [r.code, "Test person", "Dept", "Designation", "Branch", "Manager", 31, Number(r.paidDays), Number(r.lopDays), ...heads.map((h) => (r.heads[h] === undefined ? 0 : Number(r.heads[h]))), Number(r.gross), Number(r.deductions), Number(r.net), 0, "No", "000099990000", "TEST0000001", "No", null, 50000]); // allow-number: generated cells
    return writeXls([{ name: "Report", rows: [[], ["TEST COMPANY (synthetic)"], [`Salary Statement - ${CYCLE.label} (synthetic)`], [], header, ...body] }], { sst: true });
  }
  const upload = (file: Buffer, t = world.tokens.maker, extra: Record<string, string> = {}) => {
    const r = kit(t, "post", "/parallel").field("runId", runId);
    for (const [k, v] of Object.entries(extra)) r.field(k, v);
    return r.attach("file", file, "Salary_Statement.xls");
  };

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    for (const [k, role] of [["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      people[k] = await createFullTestEmployee(world.org, { roleCode: role });
      world.userIds.push(people[k]!.userId);
      tok[k] = await loginAs(people[k]!.employeeCode);
    }
    tok.a = await loginAs(world.named.a!.employeeCode);
    const items = await prisma.payrollRunItem.findMany({ where: { runId, status: { in: ["PAYABLE", "HELD"] } }, include: { employee: { select: { employeeCode: true } }, lines: true } });
    const labelOf = (l: { label: string; kind: string }) => (l.kind === "EMPLOYER_CONTRIBUTION" ? `${l.label} (employer)` : l.label);
    headLabels = [...new Set(items.flatMap((i) => i.lines.filter((l) => l.kind !== "ROUNDING").map(labelOf)))];
    portal = items.map((i) => ({ code: i.employee.employeeCode, paidDays: i.paidDays.toString(), lopDays: i.lopDays.toString(), gross: i.gross.toString(), deductions: i.deductions.toString(), net: i.netPay.toString(), heads: Object.fromEntries(i.lines.filter((l) => l.kind !== "ROUNDING").map((l) => [labelOf(l), l.amount.toString()])) }));
  }, 900_000);

  afterAll(async () => {
    await deleteWithDependents("PayrollParallelComparison", [...comparisonIds, ...(await prisma.payrollParallelComparison.findMany({ where: { runId }, select: { id: true } })).map((x) => x.id)]);
    await deleteWithDependents("BehaviourProposal", proposalIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await closeWorld(world);
    await purgeAppendOnly("AuditLog", { action: { startsWith: "payroll.greythr." }, actorUserId: world.maker.userId });
  }, 300_000);

  it("a statement built from the run's own figures matches exactly; the result is saved encrypted; the audit names the month and counts, never a figure; no payroll data changes", async () => {
    const before = await goldenSnapshot(world, runId);
    const counts = async () => [await prisma.payrollRunItem.count(), await prisma.payrollRunLine.count(), await prisma.payrollAdjustment.count(), await prisma.payrollMonthlyInput.count()];
    const countsBefore = await counts();
    const r = await upload(statement(portal));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    comparisonIds.push(r.body.id);
    expect(r.body.result.counts).toEqual({ matchedPeople: portal.length, peopleWithDifferences: 0, greythrOnly: 0, portalOnly: 0, differences: 0 });
    expect(r.body.result.heads.onlyInGreythr).toEqual([]);
    expect(r.body.statement.notCompared).toEqual(expect.arrayContaining(["ATTENDANCE LOP", "MONTHLY CTC"]));
    expect(JSON.stringify(r.body)).not.toContain("000099990000"); // the bank account column is never read
    const row = await prisma.payrollParallelComparison.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(Buffer.from(row.resultEncrypted).toString("latin1")).not.toContain(portal[0]!.net.split(".")[0]!.slice(0, 5) + "."); // ciphertext, not figures
    expect(row.counts).toEqual(r.body.result.counts);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: r.body.id, action: "payroll.parallel.compared" } });
    const nets = portal.map((p) => p.net.split(".")[0] ?? "").filter((n) => n.length > 2);
    if (nets.length) expect(JSON.stringify(audit.after)).not.toMatch(new RegExp(nets.join("|")));
    expect(await goldenSnapshot(world, runId)).toEqual(before);
    expect(await counts()).toEqual(countsBefore);
  });

  it("a one-rupee difference, a missing person, an extra head and a different LOP are each shown; a director's tolerance makes the rupee a match", async () => {
    const [first, ...rest] = portal;
    const tweaked: Row = { ...first!, net: (Number(first!.net) + 1).toFixed(2), lopDays: "2", heads: { ...first!.heads, [headLabels[0]!]: (Number(first!.heads[headLabels[0]!] ?? 0) + 1).toFixed(2) } }; // allow-number: generated
    const file = statement([tweaked, ...rest.slice(1), { ...first!, code: `GHOST${world.prefix}` }], ["EXTRA BONUS"]);
    const r = await upload(file);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    comparisonIds.push(r.body.id);
    const me = r.body.result.people.find((x: { code: string }) => x.code === first!.code);
    const lop = me.lines.find((l: { item: string }) => l.item === "LOP days");
    expect([lop.matched, lop.hint]).toEqual([false, expect.stringMatching(/LOP days differ/)]);
    const net = me.lines.find((l: { item: string }) => l.item === "Net pay");
    expect([net.difference, net.higher]).toEqual(["-1", "GREYTHR"]);
    expect(r.body.result.people.find((x: { code: string }) => x.code === `GHOST${world.prefix}`).side).toBe("GREYTHR_ONLY");
    expect(r.body.result.people.find((x: { code: string }) => x.code === rest[0]!.code).side).toBe("PORTAL_ONLY");
    expect(r.body.result.heads.onlyInGreythr).toEqual(["EXTRA BONUS"]); // a column greytHR has and the portal does not: listed
    expect(me.lines.some((l: { item: string }) => l.item === "EXTRA BONUS")).toBe(false); // but every amount in it is 0, so no person shows a difference for it
    // Tolerance 1 rupee, proposed by one director and confirmed by a different one.
    const prop = await request(app).post("/api/behaviours/payroll.parallelTolerance/proposals").set(...authHeader(world.tokens.maker)).send({ value: { allowance: "1" }, reason: "a rupee of rounding (test)" });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    proposalIds.push(prop.body.id);
    expect((await request(app).post(`/api/behaviours/proposals/${prop.body.id}/confirm`).set(...authHeader(world.tokens.checkerA))).status).toBe(200);
    const again = await kit(world.tokens.maker, "post", `/parallel/${r.body.id}/recompare`).send({ mapping: {} });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const me2 = again.body.result.people.find((x: { code: string }) => x.code === first!.code);
    expect(me2.lines.find((l: { item: string }) => l.item === "Net pay").matched).toBe(true);
    expect(me2.lines.find((l: { item: string }) => l.item === "LOP days").matched).toBe(false); // days always exact
    // A director maps a greytHR column by hand; an unknown portal head is refused.
    expect((await kit(world.tokens.maker, "post", `/parallel/${r.body.id}/recompare`).send({ mapping: { "EXTRA BONUS": "NO_SUCH_HEAD" } })).status).toBe(400);
  });

  it("exports the differences as .csv and .xlsx; each export is audited without a figure; a director can delete a comparison; the retention a director sets is applied", async () => {
    const id = comparisonIds[1]!;
    const csv = await kit(world.tokens.maker, "get", `/parallel/${id}/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("LOP days differ");
    const xlsx = await kit(world.tokens.maker, "get", `/parallel/${id}/export?format=xlsx`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Differences", "Totals"]);
    const exported = await prisma.auditLog.findMany({ where: { entityId: id, action: "payroll.parallel.exported" } });
    expect(exported).toHaveLength(2);
    expect(JSON.stringify(exported.map((e) => e.after))).not.toMatch(/\d{4,}\.\d{2}/);
    // Retention: a director sets 30 days (two directors); a comparison older than that is deleted when the list is read.
    const prop = await request(app).post("/api/behaviours/payroll.parallelRetentionDays/proposals").set(...authHeader(world.tokens.maker)).send({ value: 30, reason: "keep a month (test)" });
    proposalIds.push(prop.body.id);
    await request(app).post(`/api/behaviours/proposals/${prop.body.id}/confirm`).set(...authHeader(world.tokens.checkerA));
    await prisma.payrollParallelComparison.update({ where: { id: comparisonIds[0]! }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const list = await kit(world.tokens.maker, "get", "/parallel");
    expect(list.body.retentionDays).toBe(30);
    expect(list.body.comparisons.map((c: { id: string }) => c.id)).not.toContain(comparisonIds[0]);
    expect((await kit(world.tokens.maker, "delete", `/parallel/${id}`)).status).toBe(204);
    expect((await kit(world.tokens.maker, "get", `/parallel/${id}`)).status).toBe(404);
  });

  it("refuses the wrong file, an empty statement, a damaged one, duplicate employee numbers and a run that is not finalised or TEST", async () => {
    const code = async (b: Buffer, name = "s.xls") => (await kit(world.tokens.maker, "post", "/parallel").field("runId", runId).attach("file", b, name)).body.error?.code;
    expect(await code(readFileSync(path.join(SAMPLES, "Bank_Transfer_template.xls")))).toBe("WRONG_COLUMNS");
    expect(await code(Buffer.from("EmployeeNo,NET PAY\n1,2"), "s.csv")).toBe("WRONG_FILE_TYPE");
    expect(await code(statement([]))).toBe("EMPTY_FILE");
    const damaged = Buffer.from(statement(portal));
    damaged.fill(0x41, 520, 1400);
    expect(await code(damaged)).toBe("UNREADABLE_FILE");
    expect(await code(statement([portal[0]!, portal[0]!]))).toBe("FILE_HAS_INVALID_ROWS");
    expect((await kit(world.tokens.maker, "post", "/parallel").field("runId", "no-such-run").attach("file", statement(portal), "s.xls")).status).toBe(404);
  });

  it("the synthetic sample statement is read (its header block, its columns), and its unknown employee is shown on the greytHR side only", async () => {
    const r = await upload(readFileSync(path.join(SAMPLES, "Salary_Statement_template.xls")));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    comparisonIds.push(r.body.id);
    expect(r.body.statement.title).toMatch(/Salary Statement/);
    expect(r.body.statement.headColumns).toEqual(expect.arrayContaining(["BASIC", "HRA", "SPECIAL ALLOWANCE", "PF", "EMPLOYERS PF CONTRIBUTION"]));
    expect(r.body.result.people.find((x: { code: string }) => x.code === "DEMO001")?.side ?? "GREYTHR_ONLY").toBe("GREYTHR_ONLY");
    expect(JSON.stringify(r.body)).not.toContain("DEMO0000001"); // IFSC never read
  });

  it("the bank file check: the sample's 21 headers against the (unset) layout; the notes; a suggested layout with only certain fields; no value from the file is returned", async () => {
    const r = await kit(world.tokens.maker, "post", "/bank-check").attach("file", readFileSync(path.join(SAMPLES, "Bank_Transfer_template.xls")), "Bank_Transfer_template.xls");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.columns).toHaveLength(21);
    expect(r.body.dataRows).toBe(1);
    expect(r.body.notes.join(" ")).toMatch(/\.xls/);
    expect(r.body.notes.join(" ")).toMatch(/capitals/);
    const fields = Object.fromEntries(r.body.suggestedLayout.columns.map((c: { header: string; source: string; value: string }) => [c.header, c.source === "FIELD" ? c.value : "NOT SET"]));
    expect(fields).toMatchObject({ "From A/C No.": "DEBIT_ACCOUNT", "A/C no. ": "ACCOUNT_NUMBER", "Beneficiary Name": "NAME", Amount: "AMOUNT", Date: "PAYMENT_DATE", "IFSC code": "IFSC", "Payment Mode": "NOT SET", Remark: "NOT SET" });
    expect(JSON.stringify(r.body)).not.toMatch(/000000000001|Demo Employee 01|18800|DEMO0000001/);
  });

  it("HR, a manager, an employee and the Developer are refused every kit route; request 13: the Developer is refused the rule values and the layouts even called directly", async () => {
    for (const t of [tok.hr!, tok.mgr!, tok.a!, tok.dev!]) {
      for (const [m, p] of [["get", "/parallel"], ["get", "/parallel/runs"], ["get", "/parallel/x"], ["delete", "/parallel/x"], ["get", "/parallel/x/export?format=csv"]] as const) expect((await kit(t, m, p)).status, `${m} ${p}`).toBe(403);
      expect((await kit(t, "post", "/parallel").field("runId", runId).attach("file", statement(portal), "s.xls")).status).toBe(403);
      expect((await kit(t, "post", "/bank-check").attach("file", Buffer.from("x"), "b.xls")).status).toBe(403);
    }
    for (const p of ["/api/payroll/rules", "/api/payroll/rules/PF_WAGE_CEILING", "/api/payroll/rule-overrides", "/api/payroll/layouts", "/api/payroll/layouts/BANK_TEMPLATE"]) {
      const res = await request(app).get(p).set(...authHeader(tok.dev!));
      expect([res.status, p]).toEqual([403, p]);
    }
    expect((await request(app).get("/api/payroll/rules").set(...authHeader(world.tokens.maker))).status).toBe(200);
    expect((await request(app).get("/api/payroll/layouts").set(...authHeader(world.tokens.maker))).status).toBe(200);
  });

  it("every report key is a Developer ceiling: a personal, audited grant of one is refused, and a row that got past everything grants nothing", async () => {
    const reportKeys = PERMISSION_KEYS.filter((k) => k.startsWith("reports."));
    expect(reportKeys.length).toBeGreaterThan(3);
    for (const k of reportKeys) expect(DEVELOPER_FORBIDDEN_KEYS).toContain(k);
    const sup = await resolveAccess(world.sup.userId);
    const actor = { userId: world.sup.userId, employeeId: world.sup.employeeId, roleCodes: sup.roleCodes, permissions: sup.permissions, dataScope: sup.dataScope };
    const meta = { actorUserId: world.sup.userId, ipAddress: null, userAgent: null };
    for (const k of reportKeys) await expect(setOverride(people.dev!.employeeId, k, { effect: "GRANT", reason: "test grant" }, actor, meta), k).rejects.toMatchObject({ code: "DEVELOPER_CEILING" });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "reports.view" } });
    const raw = await prisma.userPermissionOverride.create({ data: { userId: people.dev!.userId, permissionId: permission.id, effect: "GRANT", reason: "raw row", createdByUserId: world.sup.userId } });
    try {
      expect((await resolveAccess(people.dev!.userId)).permissions.has("reports.view")).toBe(false);
    } finally {
      await deleteWithDependents("UserPermissionOverride", [raw.id]);
    }
  });
});
