import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
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
    const snap = { run: await goldenSnapshot(world, runId), reports: await reportsSnapshot() };
    if (process.env.GOLDEN_WRITE === "1") {
      if (!existsSync(path.dirname(FIXTURE))) mkdirSync(path.dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(snap, null, 2)}\n`);
    }
    expect(JSON.stringify(snap, null, 2)).toBe(JSON.stringify(JSON.parse(readFileSync(FIXTURE, "utf8")), null, 2));
  });
});
