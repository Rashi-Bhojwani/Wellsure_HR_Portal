import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATUTORY_LINE_CODES } from "@shared/constants/payrollRun";
import { prisma } from "../../../lib/prisma";
import { pinStatuses, type RulePin } from "../rules/context";
import { buildPayslips } from "../run/payslip";
import { payslipHtml } from "../run/payslipHtml";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, staffWith, type Closing } from "./closeTestHelpers";
import { api, calculateAgain, calculateRun, setRules } from "./runTestHelpers";

// Owner decision 2026-11-17 (docs/plans/OWNER_EMPTY_SETTINGS.md): professional tax and LWF ship Not set (no state's values are loaded). Not set means NO deduction,
// and the run, the payslip and Ready say "Professional Tax: not set" so nobody reads it as "not levied". It does not make a monthly run a test or block it. Made-up people.

describe("Professional tax and LWF Not set: no deduction, said plainly on the run and the payslip, the month not blocked", () => {
  let world: Closing;
  let runId = "";

  beforeAll(async () => {
    world = await closingWorld(["a"]);
    await staffWith(world, ["a"]);
    runId = await calculateRun(world); // no PT or LWF table entered by anyone in this test
    await confirmAllPins(world, runId);
  }, 900_000);

  afterAll(async () => {
    await closeWorld(world);
  }, 300_000);

  it("the run deducts nothing for them, records NOT_SET (not a Placeholder), says \"not set\" and is not a test", async () => {
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const pins = run.pins as unknown as RulePin[];
    expect(pins.filter((p) => p.key === "PT_SLABS" || p.key === "LWF_TABLE").map((p) => [p.key, p.kind])).toEqual([["LWF_TABLE", "NOT_SET"], ["PT_SLABS", "NOT_SET"]]);
    const statuses = await pinStatuses(pins.filter((p) => p.kind === "NOT_SET"));
    expect(statuses.map((s) => [s.status, s.stale])).toEqual([["CONFIRMED", false], ["CONFIRMED", false]]);
    const lines = await prisma.payrollRunLine.findMany({ where: { runId, employeeId: world.named.a!.employeeId } });
    expect(lines.some((l) => l.code === STATUTORY_LINE_CODES.PT || l.code === STATUTORY_LINE_CODES.LWF_EMPLOYEE)).toBe(false);
    const view = await api(world.tokens.maker, "get", `/runs/${runId}`);
    expect(view.status).toBe(200);
    const notices = (view.body.notices as string[]).join(" ");
    expect(notices).toContain("Professional Tax: not set.");
    expect(notices).toContain("Labour Welfare Fund: not set.");
    expect(notices).not.toMatch(/not levied in/);
    expect(view.body.watermark.test).toBe(false); // a month is not made a test by them
  });

  it("every payslip says \"Professional Tax: not set\" and \"Labour Welfare Fund: not set\" (screen and PDF), with no deduction line for them", async () => {
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const slip = (await buildPayslips(run)).get(world.named.a!.employeeId)!;
    expect(slip.content.notices).toEqual(["Professional Tax: not set", "Labour Welfare Fund: not set"]);
    expect(slip.content.deductions.some((l) => l.code === STATUTORY_LINE_CODES.PT)).toBe(false);
    const html = payslipHtml(slip.content);
    expect(html).toContain("Professional Tax: not set");
    expect(html).toContain("Labour Welfare Fund: not set");
    expect(html).toContain("this is not the same as not levied");
  });

  it("once a director enters the tables the run is out of date, and calculated again it no longer says \"not set\"", async () => {
    await setRules(world.maker.userId, REAL_RULES); // TEST tables (no state levies anything here), entered by a director
    const before = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const stale = await pinStatuses((before.pins as unknown as RulePin[]).filter((p) => p.kind === "NOT_SET"));
    expect(stale.map((s) => s.stale)).toEqual([true, true]);
    await calculateAgain(world, runId);
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect((run.pins as unknown as RulePin[]).some((p) => p.kind === "NOT_SET")).toBe(false);
    expect((await buildPayslips(run)).get(world.named.a!.employeeId)!.content.notices).toBeUndefined();
  });
});
