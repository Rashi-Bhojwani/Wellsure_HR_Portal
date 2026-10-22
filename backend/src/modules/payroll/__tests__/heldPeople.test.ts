import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../lib/prisma";
import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, driveToFinal, requestStep, resetSeams, staffWith, step, type Closing } from "./closeTestHelpers";
import { api, calculateRun, setRules } from "./runTestHelpers";

// Held people on the one publish screen: the person who publishes sees, before anything is released, who will get no payslip and why, and the same list is still there afterwards.

describe("who is held and why, at publish time and after", () => {
  let world: Closing;
  let runId: string;
  beforeAll(async () => {
    world = await closingWorld(["a", "b", "d"]);
    await staffWith(world, ["a", "b", "d"]);
    // d has no bank account in force: calculated, but not payable.
    await prisma.employeeBankAccount.deleteMany({ where: { employeeId: world.named.d!.employeeId } });
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
  }, 600_000);
  afterAll(async () => {
    resetSeams();
    vi.restoreAllMocks();
    await closeWorld(world);
  });

  it("the publish preview names every person who will get no payslip, with the reason in words and what to do", async () => {
    const p = await step(world.tokens.maker, runId, "publish", "preview");
    expect(p.status).toBe(200);
    expect(p.body.payslips).toBe(2);
    expect(p.body.noPayslip).toHaveLength(1);
    expect(p.body.noPayslip[0]).toMatchObject({
      employeeId: world.named.d!.employeeId,
      employeeCode: world.named.d!.employeeCode,
      kind: "HELD",
      reason: "NO_BANK_ACCOUNT",
      reasonLabel: "No bank account on the payment date",
    });
    expect(p.body.noPayslip[0].name).toBeTruthy();
    expect(p.body.noPayslip[0].action).toMatch(/bank account/i);
  });

  it("after publishing, the run's payslip list still carries the same held people, and the held person has no payslip", async () => {
    await requestStep(world.tokens.maker, runId, "publish");
    await approve(world, world.tokens.checkerA, runId, "publish");
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`);
    expect([done.status, done.body.published]).toEqual([201, 2]);
    expect(await prisma.payslip.count({ where: { runId, employeeId: world.named.d!.employeeId } })).toBe(0);
    const list = await api(world.tokens.maker, "get", `/runs/${runId}/payslips`);
    expect(list.status).toBe(200);
    expect(list.body.payslips).toHaveLength(2);
    expect(list.body.noPayslip.map((n: { employeeCode: string; reason: string }) => [n.employeeCode, n.reason])).toEqual([[world.named.d!.employeeCode, "NO_BANK_ACCOUNT"]]);
  });
});
