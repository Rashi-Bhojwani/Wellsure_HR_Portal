import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { computeAttendance } from "../../attendance/compute";
import { setRecomputeDatesHandler, setRecomputeHandler } from "../../attendance/recompute";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { buildRunWorld, calculateAgain, calculateRun, teardownRunWorld, type RunWorld } from "../../payroll/__tests__/runTestHelpers";
import { giveSalary, makeComponent } from "../../payroll/__tests__/salaryTestHelpers";
import { DEFAULT_RULE } from "../evaluate";

// GOLDEN, end to end into payroll (docs/plans/LATE_CHECKLIST.md §3): a lateness salary cut reaches the run as loss of pay (the EXISTING path), and a penalty is a
// labelled deduction line (the EXISTING adjustments path) valued against the day's short-hours loss of pay from the calculated run: the higher applies.
// October 2026; attendance is locked row by row (no period lock is left behind).

const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);

describe("lateness into payroll", () => {
  let world: RunWorld;
  let deviceId = "";
  let fine = "";
  const late = (token: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/lateness${path}`).set(...authHeader(token)).send(body);
  const purgeSettings = async () => deleteWithDependents("BehaviourProposal", (await prisma.behaviourProposal.findMany({ where: { key: { startsWith: "late." } }, select: { id: true } })).map((r) => r.id));

  beforeAll(async () => {
    setBusinessTodayForTests(new Date("2026-11-10T00:00:00Z"));
    setRecomputeHandler(null);
    setRecomputeDatesHandler(null);
    await purgeSettings();
    world = await buildRunWorld(["A"]);
    await giveSalary(world, world.named.A!.employeeId, "600000"); // Basic 20,000, HRA 10,000, Conveyance 1,600 (does not pro-rate), Special 18,400
    fine = `${world.prefix}_FINE`;
    await makeComponent(world, fine, { type: "DEDUCTION", taxable: false, prorates: false, payslipLabel: "Lateness penalty", payslipOrder: 9 });
    const a = world.named.A!;
    deviceId = (await prisma.device.create({ data: { serialNumber: `LATEP-${tag}`, name: "Lateness payroll device", locationId: world.org.locationId } })).id;
    const batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    const special: Record<string, [string, string]> = { "2026-10-06": ["10:35", "19:00"], "2026-10-07": ["10:25", "19:00"], "2026-10-08": ["10:25", "16:00"] };
    for (let d = 1; d <= 31; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      const [i, o] = special[date] ?? ["10:00", "19:00"];
      for (const time of [i, o]) await prisma.rawPunch.create({ data: { deviceId, deviceUserId: a.employeeCode, punchedAt: ist(date, time), localTime: `${date} ${time}:00`, businessDate: new Date(`${date}T00:00:00Z`), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: a.employeeId } });
    }
    // Band 2 (10:20 to 10:30): a ₹1,000 penalty every time. Band 3 (from 10:30): a 0.5-day cut every time.
    const value = { ...DEFAULT_RULE, effectiveFrom: "2026-10-01", active: true, penaltyHead: fine, bands: [DEFAULT_RULE.bands[0], { outcome: { kind: "PENALTY", amount: "1000" }, applies: { mode: "EVERY_TIME" } }, DEFAULT_RULE.bands[2]] };
    const prop = await late(world.tokens.maker, "post", "/settings/late.rule/proposals", { value, reason: "Owners' test rule" });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    expect((await late(world.tokens.checkerA, "post", `/settings/proposals/${prop.body.id}/confirm`)).status).toBe(200);
    await computeAttendance([a.employeeId], "2026-10-01", "2026-10-31");
    await prisma.dailyAttendance.updateMany({ where: { employeeId: a.employeeId, date: { gte: new Date("2026-10-01T00:00:00Z"), lte: new Date("2026-10-31T00:00:00Z") } }, data: { isLocked: true } });
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await purgeSettings();
    await teardownRunWorld(world);
    await deleteWithDependents("Device", [deviceId]);
  });

  it("GOLDEN the salary cut is loss of pay in the run; the penalty days are not; a half day with a penalty keeps its own 0.5", async () => {
    const lop = await prisma.dailyAttendance.findMany({ where: { employeeId: world.named.A!.employeeId, lopDays: { gt: 0 } }, orderBy: { date: "asc" } });
    expect(lop.map((d) => [d.date.toISOString().slice(0, 10), d.lopDays.toString()])).toEqual([["2026-10-06", "0.5"], ["2026-10-08", "0.5"]]);
    const runId = await calculateRun(world, "2026-10-01");
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: world.named.A!.employeeId } });
    expect(item.lopDays.toString()).toBe("1");
    expect((await prisma.payrollRunLine.count({ where: { runItemId: item.id, code: fine } }))).toBe(0);
  });

  it("GOLDEN posting: ₹1,000 on the full day; on the half day ₹1,000 less the ₹780.64 that day already loses (higher-of), never both added", async () => {
    const plan = (await late(world.tokens.maker, "get", "/penalties?month=2026-10")).body;
    const mine = plan.rows.filter((r: { employeeId: string }) => r.employeeId === world.named.A!.employeeId);
    // 0.5 day of the prorating heads (20,000 + 10,000 + 18,400) / 31 days, each to the paisa: 322.58 + 161.29 + 296.77 = 780.64
    expect(mine.map((r: { date: string; hoursLop: string; hoursValue: string; charge: string; status: string }) => [r.date, r.hoursLop, r.hoursValue, r.charge, r.status])).toEqual([
      ["2026-10-07", "0", "0", "1000", "TO_POST"],
      ["2026-10-08", "0.5", "780.64", "219.36", "TO_POST"],
    ]);
    expect((await late(world.tokens.maker, "post", "/penalties/post", { month: "2026-10", fingerprint: plan.fingerprint })).status).toBe(200);
    const runId = (await prisma.payrollRun.findFirstOrThrow({ where: { cycleStart: new Date("2026-10-01T00:00:00Z"), status: { not: "VOID" } }, orderBy: { createdAt: "desc" } })).id;
    await calculateAgain(world, runId);
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: world.named.A!.employeeId } });
    const lines = await prisma.payrollRunLine.findMany({ where: { runItemId: item.id, code: fine }, orderBy: { amount: "asc" } });
    expect(lines.map((l) => [l.kind, l.amount.toString()])).toEqual([["DEDUCTION", "219.36"], ["DEDUCTION", "1000"]]);
    expect(item.lopDays.toString()).toBe("1"); // the penalty never touched loss of pay
  });
});
