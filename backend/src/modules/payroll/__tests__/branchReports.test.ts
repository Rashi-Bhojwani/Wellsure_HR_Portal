import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import ExcelJS from "exceljs";
import { NO_BRANCH, branchOf } from "../reports/definitions";
import { goldenSnapshot } from "./goldenHelpers";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { CYCLE, calculateRun, setRules } from "./runTestHelpers";

// Cleanup block C1: the payroll reports filtered and grouped by branch (Organisation Setup -> Branches, the Location table; not Divisions). Golden regression:
// fixtures/branch-reports.json was written ONCE from the code as it was before the branch work (GOLDEN_WRITE=1): the run's figures and payslips and the eight
// reports with no branch filter must stay byte-for-byte identical. Three made-up people: a at the world's branch, b at a second branch, c held (and with no job history after the run).
const FIXTURE = path.join(__dirname, "fixtures", "branch-reports.json");
const month = CYCLE.start.slice(0, 7);
// The reports this block covers, each with the filters that open it on the run's month (variance compares the month with itself: only one finalised run exists).
export const BRANCH_REPORTS: Array<[string, string]> = [
  ["payroll-summary", `fromMonth=${month}&toMonth=${month}`],
  ["department-cost", `month=${month}`],
  ["head-wise", `month=${month}`],
  ["variance", `month=${month}&compareMonth=${month}`],
  ["statutory-summary", `month=${month}`],
  ["register-wages", `month=${month}`],
  ["register-deductions", `month=${month}`],
  ["register-overtime", `month=${month}`],
];

describe("C1 — payroll reports by branch", () => {
  let world: Closing;
  let runId = "";
  let otherBranch = "";
  const get = (q: string) => request(app).get(`/api/payroll-reports/${q}`).set(...authHeader(world.tokens.maker));
  // Random test prefixes and codes are replaced so the fixture does not depend on them.
  // Normalising touches only the test's own random values (prefixes, each person's code suffix, the org's name suffix) and the order of per-person rows,
  // which the reports sort by those random codes; every figure, label and column is compared exactly.
  let swaps: Array<[string, string]> = [];
  const norm = (v: unknown) => {
    let t = JSON.stringify(v);
    for (const [from, to] of swaps) t = t.split(from).join(to);
    const out = JSON.parse(t);
    if (Array.isArray(out.rows) && out.rows.some((r: { employeeCode?: string }) => r.employeeCode))
      out.rows.sort((x: Record<string, string>, y: Record<string, string>) => `${x.employeeCode}|${x.date ?? ""}|${x.headCode ?? ""}`.localeCompare(`${y.employeeCode}|${y.date ?? ""}|${y.headCode ?? ""}`));
    return out;
  };
  const reportsSnapshot = async () => {
    const out: Record<string, unknown> = {};
    for (const [key, q] of BRANCH_REPORTS) {
      const res = await get(`${key}?${q}`);
      expect(res.status, `${key} ${JSON.stringify(res.body)}`).toBe(200);
      const { generatedAt: _g, layout: _l, ...rest } = res.body;
      out[key] = norm(rest);
    }
    return out;
  };

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    const base = await prisma.location.findUniqueOrThrow({ where: { id: world.org.locationId } });
    const dept = await prisma.department.findUniqueOrThrow({ where: { id: world.org.departmentId } });
    swaps = [[base.name, "Branch A"], [dept.name, "Department A"], ...Object.entries(world.named).map(([k, v]) => [v.employeeCode.split("-").pop()!, k] as [string, string]), [world.prefix, "P"]];
    otherBranch = (await prisma.location.create({ data: { code: `B2${world.prefix}`, name: `Second branch ${world.prefix}`, addressLine1: "1 Test Road", city: base.city, state: base.state, pincode: base.pincode, cityId: base.cityId } })).id;
    await prisma.employeeJobHistory.updateMany({ where: { employeeId: world.named.b!.employeeId }, data: { locationId: otherBranch } });
    const hold = await request(app).post("/api/payroll/holds").set(...authHeader(world.tokens.maker)).send({ input: { employeeId: world.named.c!.employeeId, cycleStart: CYCLE.start, reason: "Documents pending" } });
    expect(hold.status).toBe(201);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    // A finalised run never holds anyone without a placement (NO_PLACEMENT blocks it), so "No branch" is shown where a report reads today's job history:
    // c's job history is removed after the run, and a and c have approved overtime in the month (the overtime register places people from job history).
    await prisma.employeeJobHistory.deleteMany({ where: { employeeId: world.named.c!.employeeId } });
    for (const [n, d] of [["a", "05"], ["c", "06"]] as const)
      await prisma.overtimeClaim.create({ data: { employeeId: world.named[n]!.employeeId, date: new Date(`${month}-${d}T00:00:00Z`), minutes: 90, approvedMinutes: 60, status: "APPROVED", decidedByUserId: world.maker.userId, decidedAt: new Date(`${month}-28T10:00:00Z`) } });
  }, 900_000);

  afterAll(async () => {
    await closeWorld(world);
    await deleteWithDependents("Location", [otherBranch]);
  }, 300_000);

  it("golden: with no branch filter the run's figures, its payslips and the eight reports are byte-for-byte as before the branch work", async () => {
    // The run's items and payslips are keyed by person letter; the database returns them in no fixed order, so the letters are put in order (values untouched).
    const byLetter = <T,>(m: Record<string, T>) => Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]!]));
    const run = await goldenSnapshot(world, runId);
    const snap = { run: { items: byLetter(run.items), payslips: byLetter(run.payslips) }, reports: await reportsSnapshot() };
    if (process.env.GOLDEN_WRITE === "1") {
      if (!existsSync(path.dirname(FIXTURE))) mkdirSync(path.dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(snap, null, 2)}\n`);
    }
    expect(JSON.stringify(snap, null, 2)).toBe(JSON.stringify(JSON.parse(readFileSync(FIXTURE, "utf8")), null, 2));
  });

  const paise = (v: string | number) => {
    const t = String(v);
    const neg = t.startsWith("-");
    const [w, f = ""] = (neg ? t.slice(1) : t).split(".");
    const p = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
    return neg ? -p : p;
  };
  type Group = { key: string; branch: string; rows: number; totals: Record<string, string | number> };

  it("grouped by branch: the rows and totals are the ungrouped ones; each branch's totals add up exactly to the report's total; no branch is 'No branch'", async () => {
    for (const [key, q] of BRANCH_REPORTS) {
      const plain = (await get(`${key}?${q}`)).body;
      const res = await get(`${key}?${q}&groupBy=branch`);
      expect(res.status, `${key} ${JSON.stringify(res.body)}`).toBe(200);
      expect([res.body.rows, res.body.totals, res.body.columns], key).toEqual([plain.rows, plain.totals, plain.columns]);
      expect(res.body.filtersApplied.at(-1)).toMatch(/^Grouped by branch/);
      const groups = res.body.groups as Group[];
      // Per-person reports: each row is in exactly one branch. Aggregate reports (a row per month, department, head or line) have rows in several branches.
      if (["variance", "register-wages", "register-deductions", "register-overtime"].includes(key)) expect(groups.reduce((n, g) => n + g.rows, 0), key).toBe(plain.rows.length);
      for (const [col, total] of Object.entries(plain.totals as Record<string, string | number>)) {
        if (typeof total === "number") expect(groups.reduce((n, g) => n + Number(g.totals[col] ?? 0), 0), `${key} ${col}`).toBe(total);
        else expect(groups.reduce((n, g) => n + paise(g.totals[col] ?? "0"), 0n), `${key} ${col}`).toBe(paise(total));
      }
      const labels = groups.map((g) => g.branch.split(world.prefix).join("P").replace(/^Test Location .*/, "Branch A"));
      if (key === "register-overtime") expect(labels.sort(), key).toEqual(["Branch A", "No branch"]); // c has no job history now
      else expect(labels.sort(), key).toEqual(["Branch A", "Second branch P"]); // the run placed everyone; b at the second branch
    }
  });

  it("the branch filter: payroll summary and statutory summary now take it; each branch alone equals its group; 'NONE' keeps only people with no branch", async () => {
    for (const key of ["payroll-summary", "statutory-summary", "department-cost", "head-wise", "variance", "register-wages", "register-deductions"]) {
      const q = BRANCH_REPORTS.find(([k]) => k === key)![1];
      const groups = (await get(`${key}?${q}&groupBy=branch`)).body.groups as Group[];
      const second = groups.find((g) => g.key === otherBranch)!;
      const only = (await get(`${key}?${q}&location=${otherBranch}`)).body;
      expect(only.totals, key).toEqual(second.totals);
      expect(only.filtersApplied, key).toContain(`Branch: Second branch ${world.prefix}`);
    }
    const summaryB = (await get(`payroll-summary?fromMonth=${month}&toMonth=${month}&location=${otherBranch}`)).body;
    const itemB = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: world.named.b!.employeeId } });
    expect([summaryB.rows[0].paid, summaryB.rows[0].held, paise(summaryB.rows[0].gross)]).toEqual([1, 0, paise(itemB.gross.toFixed(2))]);
    const none = (await get(`register-overtime?month=${month}&location=${NO_BRANCH}`)).body;
    expect(none.rows.map((r: { employeeCode: string }) => r.employeeCode)).toEqual([world.named.c!.employeeCode]);
    expect(none.filtersApplied).toContain("Branch: No branch");
    expect((await get(`bank-transfer?groupBy=branch`)).status).toBe(400); // a report this block does not cover refuses it
    expect((await get(`head-wise?month=${month}&groupBy=division`)).status).toBe(400);
  });

  it("a placement counts under its branch only while the branch is on record; otherwise under 'No branch'", () => {
    const known = new Set(["L1"]);
    expect([branchOf({ locationId: "L1" }, known), branchOf({}, known), branchOf({ locationId: "gone" }, known)]).toEqual(["L1", NO_BRANCH, NO_BRANCH]);
  });

  it("exports carry each branch's totals: CSV rows after the total, a 'By branch' sheet in the workbook", async () => {
    const csv = await get(`head-wise/export?format=csv&month=${month}&groupBy=branch`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("Grouped by branch");
    expect(csv.text).toContain(`Branch: Second branch ${world.prefix}`);
    const plainCsv = await get(`head-wise/export?format=csv&month=${month}`);
    expect(plainCsv.text).not.toContain("Branch: ");
    const xlsx = await get(`register-wages/export?format=xlsx&month=${month}&groupBy=branch`).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(2);
    const sheet = wb.worksheets[1]!;
    expect(sheet.name).toBe("By branch");
    expect(sheet.getColumn(1).values.filter(Boolean).map(String)).toEqual(expect.arrayContaining(["Branch", `Second branch ${world.prefix}`, "Total"]));
  });
});
