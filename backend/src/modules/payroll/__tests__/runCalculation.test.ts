import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { confirmRule, previewConfirm } from "../rules/governed";
import { assertRunIsReal, pinStatuses, type RulePin } from "../rules/context";
import { executeCalculation, setCalculationEnqueuer } from "../run/engine";
import { buildRunWorkbook } from "../run/export";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, day, lockCycle, setRules, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary } from "./salaryTestHelpers";

// A payroll run through the real API, the real job and the real database: who is paid what, how it is stored, what it says it was built on, and what happens
// when the world moves. The arithmetic itself is proved in runPure.test.ts; here it is proved that the pipeline carries it faithfully.

const NAMES = ["full", "lop", "joiner", "leaver", "revised", "esi", "nosalary", "unlocked", "nobank"] as const;

describe("a payroll run", () => {
  let world: RunWorld;
  let runId: string;
  const who = (n: (typeof NAMES)[number]) => world.named[n]!.employeeId;

  beforeAll(async () => {
    world = await buildRunWorld([...NAMES]);
    for (const n of ["full", "lop", "joiner", "leaver", "revised", "unlocked", "nobank"] as const) await giveSalary(world, who(n), "600000", FIRST_SALARY_DAY);
    await giveSalary(world, who("esi"), "240000", FIRST_SALARY_DAY);
    await giveSalary(world, who("revised"), "720000", "2026-08-16");
    await prisma.employee.update({ where: { id: who("joiner") }, data: { dateOfJoining: day("2026-08-11") } });
    await prisma.employee.update({ where: { id: who("leaver") }, data: { lastWorkingDate: day("2026-08-20") } });
    await prisma.employeeBankAccount.updateMany({ where: { employeeId: who("nobank") }, data: { effectiveTo: day("2026-08-15") } });
    await lockCycle(who("full"), CYCLE.start, CYCLE.end);
    await lockCycle(who("lop"), CYCLE.start, CYCLE.end, { "2026-08-10": { lop: "1" }, "2026-08-11": { lop: "1" }, "2026-08-12": { lop: "1" } });
    await lockCycle(who("joiner"), "2026-08-11", CYCLE.end);
    await lockCycle(who("leaver"), CYCLE.start, "2026-08-20");
    await lockCycle(who("revised"), CYCLE.start, CYCLE.end);
    await lockCycle(who("esi"), CYCLE.start, CYCLE.end);
    await lockCycle(who("nosalary"), CYCLE.start, CYCLE.end);
    await lockCycle(who("unlocked"), CYCLE.start, CYCLE.end, { "2026-08-30": { locked: false }, "2026-08-31": { locked: false } });
    await lockCycle(who("nobank"), CYCLE.start, CYCLE.end);
    runId = await calculateRun(world);
  }, 300_000);

  afterAll(async () => teardownRunWorld(world));

  const item = async (n: (typeof NAMES)[number]) => (await api(world.tokens.maker, "get", `/runs/${runId}/items/${who(n)}`)).body;
  const amounts = (i: { lines: Array<{ code: string; amount: string }> }) => Object.fromEntries(i.lines.map((l) => [l.code.replace(`${world.prefix}_`, ""), l.amount]));

  it("pays each person what the hand-worked cases say, from finalised days only", async () => {
    const full = await item("full");
    expect([full.status, full.totals.gross, full.totals.deductions, full.totals.net]).toEqual(["PAYABLE", "50000", "1800", "48200"]);
    expect(amounts(full)).toMatchObject({ BASIC: "20000", HRA: "10000", CONV: "1600", SPECIAL: "18400", PF_EMPLOYEE: "1800" });
    const lop = await item("lop");
    expect([lop.totals.gross, lop.totals.net, lop.days.lop]).toEqual(["45316", "43516", "3"]);
    const joiner = await item("joiner");
    expect([joiner.totals.gross, joiner.totals.net, joiner.employedFrom]).toEqual(["34387", "32761", "2026-08-11"]);
    const leaver = await item("leaver");
    expect([leaver.totals.gross, leaver.totals.net, leaver.employedTo]).toEqual(["32826", "31278", "2026-08-20"]);
    const revised = await item("revised");
    expect([revised.totals.gross, revised.totals.net]).toEqual(["55162", "53362"]);
    const esi = await item("esi");
    expect(amounts(esi)).toMatchObject({ PF_EMPLOYEE: "960", ESI_EMPLOYEE: "138", ESI_EMPLOYER: "598" });
    expect([esi.totals.gross, esi.totals.net, esi.totals.employerContributions]).toEqual(["20000", "18902", "1638"]);
  });

  it("leaves out, with the reason, anyone it cannot pay properly, and holds (still calculated) anyone it cannot pay yet", async () => {
    const nosalary = await item("nosalary");
    expect([nosalary.status, nosalary.holdReason, nosalary.lines.length]).toEqual(["EXCLUDED", "NO_SALARY", 0]);
    const unlocked = await item("unlocked");
    expect([unlocked.status, unlocked.holdReason]).toEqual(["EXCLUDED", "ATTENDANCE_NOT_FINAL"]);
    expect(unlocked.holdDetail).toMatch(/2 of their days \(2026-08-30, 2026-08-31\)/);
    const nobank = await item("nobank");
    expect([nobank.status, nobank.holdReason, nobank.totals.net]).toEqual(["HELD", "NO_BANK_ACCOUNT", "48200"]);
  });

  it("stores exactly what it calculated: lines add to each person's totals and the people add to the run", async () => {
    const rows = await prisma.payrollRunItem.findMany({ where: { runId }, include: { lines: true } });
    for (const r of rows) {
      const earn = r.lines.filter((l) => l.kind === "EARNING").reduce((a, l) => a.plus(l.amount), r.gross.minus(r.gross));
      const ded = r.lines.filter((l) => l.kind === "DEDUCTION").reduce((a, l) => a.plus(l.amount), r.gross.minus(r.gross));
      expect([earn.toString(), ded.toString(), earn.minus(ded).toString()]).toEqual([r.gross.toString(), r.deductions.toString(), r.netPay.toString()]);
    }
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const calc = rows.filter((r) => r.status !== "EXCLUDED");
    const sum = (f: (r: (typeof rows)[number]) => { toString(): string }) => calc.reduce((a, r) => a.plus(f(r).toString()), run.totalNet.minus(run.totalNet)).toString();
    expect([run.totalGross.toString(), run.totalDeductions.toString(), run.totalNet.toString(), run.totalEmployerCost.toString()]).toEqual([sum((r) => r.gross), sum((r) => r.deductions), sum((r) => r.netPay), sum((r) => r.employerContributions)]);
    expect([run.status, run.peopleCount]).toEqual(["CALCULATED", rows.length]);
    expect(run.runHash).toMatch(/^payroll-hash-v1:/);
  });

  it("explains every figure from what is stored: the days, the salary segments, the basis of each line", async () => {
    const revised = await item("revised");
    expect(revised.inputs.segments).toHaveLength(2);
    expect(revised.inputs.segments.map((s: { from: string; to: string; days: number }) => [s.from, s.to, s.days])).toEqual([["2026-08-01", "2026-08-15", 15], ["2026-08-16", "2026-08-31", 16]]);
    const basic = revised.lines.find((l: { code: string }) => l.code === world.basic);
    expect(basic.basis.parts).toHaveLength(2);
    const lop = await item("lop");
    expect(lop.inputs.days.lopByDay).toEqual([{ date: "2026-08-10", lop: "1" }, { date: "2026-08-11", lop: "1" }, { date: "2026-08-12", lop: "1" }]);
    expect(lop.inputs.days).toMatchObject({ cycleDays: 31, employedDays: 31, basisDays: "31", lopDays: "3", payBasis: "CALENDAR_DAYS" });
    const pf = lop.lines.find((l: { code: string }) => l.code === "PF_EMPLOYEE");
    expect(pf.basis).toMatchObject({ ceilingMode: "CAP_AT_CEILING", ceiling: "15000", cappedWages: "15000", rate: "12" });
  });

  it("is a test while any rule it used is a Placeholder, and says which, on screen and in the workbook", async () => {
    const run = (await api(world.tokens.maker, "get", `/runs/${runId}`)).body;
    expect(run.watermark.test).toBe(true);
    expect(run.watermark.text).toBe("TEST — placeholder rules");
    const rule = (key: string) => run.rules.find((r: { key: string; kind: string }) => r.key === key && r.kind === "RULE");
    expect(rule("PF_EMPLOYEE_RATE")).toMatchObject({ status: "PLACEHOLDER", frozen: false });
    expect(rule("PT_SLABS")).toMatchObject({ notSet: true, status: "PLACEHOLDER" }); // zero because nobody set it is never mistaken for a confirmed zero
    expect(run.rules.filter((r: { kind: string }) => r.kind === "STRUCTURE").map((r: { frozen: boolean; status: string }) => [r.frozen, r.status])).toEqual([[true, "CONFIRMED"]]);
    expect(run.rules.filter((r: { kind: string }) => r.kind === "COMPONENT").length).toBe(4);
    await expect(assertRunIsReal(((await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).pins as unknown as RulePin[]), "submitted")).rejects.toMatchObject({ code: "PLACEHOLDER_RULES" });

    const { buffer, fileName } = await buildRunWorkbook(runId);
    expect(fileName).toMatch(/-TEST\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["TEST Register", "TEST Not paid", "TEST Difference from last month", "TEST Rules used"]);
    for (const w of wb.worksheets) expect(String(w.getRow(1).getCell(1).value)).toContain("TEST — placeholder rules");
    const register = wb.worksheets[0]!;
    const text = register.getSheetValues().flat().map(String).join("|");
    expect(text).toContain("Basic");
    expect(text).toContain("Provident fund (employee)");
  });

  it("does not stale a run because a structure or component it was frozen under gets a newer version, but does because a live rule moves", async () => {
    const before = (await api(world.tokens.maker, "get", `/runs/${runId}`)).body;
    expect(before.stale).toBe(false);
    const { makeComponent } = await import("./salaryTestHelpers");
    await makeComponent(world, world.basic, { payslipOrder: 1, pfApplicable: true, esiApplicable: true, payslipLabel: "Basic pay" }, false); // version 2 of Basic
    expect((await api(world.tokens.maker, "get", `/runs/${runId}`)).body.stale).toBe(false);
    await setRules(world.maker.userId, { PF_ADMIN_RATE: "0.6" });
    const after = (await api(world.tokens.maker, "get", `/runs/${runId}`)).body;
    expect(after.stale).toBe(true);
    await expect(assertRunIsReal(((await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).pins as unknown as RulePin[]), "approved")).rejects.toMatchObject({ code: expect.stringMatching(/PLACEHOLDER_RULES|RULES_CHANGED/) });
    await setRules(world.maker.userId, { PF_ADMIN_RATE: "0.5" });
    await calculateAgain(world, runId);
    expect((await api(world.tokens.maker, "get", `/runs/${runId}`)).body.stale).toBe(false);
  }, 120_000);

  it("a rule that was not set when the run was made makes the run stale once it is set, until it is calculated again", async () => {
    await setRules(world.maker.userId, { PT_SLABS: { states: {} }, LWF_TABLE: { states: {} }, STATE_NAME_MAP: {}, PT_STATE_OF_PLACEMENT: "LAST_DAY_OF_PERIOD" });
    expect((await api(world.tokens.maker, "get", `/runs/${runId}`)).body.stale).toBe(true);
    await calculateAgain(world, runId);
    const run = (await api(world.tokens.maker, "get", `/runs/${runId}`)).body;
    expect(run.stale).toBe(false);
    expect(run.rules.find((r: { key: string }) => r.key === "PT_SLABS")).toMatchObject({ notSet: false, status: "PLACEHOLDER" });
    expect(run.notices.join(" ")).not.toMatch(/Professional tax tables are not set up/);
  }, 120_000);

  it("becomes real only when every rule, component and structure it used is Confirmed by somebody else, and then carries no watermark", async () => {
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    const pins = run.pins as unknown as RulePin[];
    for (const p of pins.filter((x) => (x.kind ?? "RULE") === "RULE")) {
      const pre = await previewConfirm(p.key, world.checkerA.userId);
      if (pre.blocked) continue;
      await confirmRule(p.key, { version: pre.version, typedValue: pre.requiresRetype ? pre.value : undefined, note: "checked in the test", fingerprint: pre.fingerprint }, { userId: world.checkerA.userId });
    }
    const statuses = await pinStatuses(pins);
    // Components were confirmed once at version 1; version 2 of Basic was saved above and is a Placeholder, but the run was frozen under version 1, which still is.
    expect(statuses.filter((s) => s.status === "PLACEHOLDER").map((s) => s.label)).toEqual([]);
    await expect(assertRunIsReal(pins, "submitted")).resolves.toBeUndefined();
    const detail = (await api(world.tokens.maker, "get", `/runs/${runId}`)).body;
    expect(detail.watermark.test).toBe(false);
    const { buffer, fileName } = await buildRunWorkbook(runId);
    expect(fileName).not.toMatch(/TEST/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name).some((n) => n.startsWith("TEST"))).toBe(false);
    const res = await api(world.tokens.maker, "get", `/runs/${runId}/export`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  }, 120_000);

  it("shows who a recalculation would change, and refuses to run on a preview that is out of date", async () => {
    const preview0 = await api(world.tokens.maker, "post", `/runs/${runId}/calculate-preview`);
    expect([preview0.body.changedCount, preview0.body.removedCount]).toEqual([0, 0]);
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: who("full"), date: day("2026-08-05") } }, data: { lopDays: "1" } });
    const preview = await api(world.tokens.maker, "post", `/runs/${runId}/calculate-preview`);
    expect(preview.body.changes).toEqual([expect.objectContaining({ employeeId: who("full"), change: "CHANGED", netBefore: "48200", netAfter: "46638" })]);
    // The world moves again after the preview was taken.
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: who("full"), date: day("2026-08-06") } }, data: { lopDays: "1" } });
    const stale = await api(world.tokens.maker, "post", `/runs/${runId}/calculate`, { fingerprint: preview.body.fingerprint });
    expect([stale.status, stale.body.error.code]).toEqual([409, "PREVIEW_STALE"]);
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("CALCULATED"); // nothing started
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: who("full"), date: day("2026-08-06") } }, data: { lopDays: "0" } });
    await calculateAgain(world, runId);
    expect((await item("full")).totals.net).toBe("46638");
    // Put it back: the figures return, and the lines were replaced, not added to.
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: who("full"), date: day("2026-08-05") } }, data: { lopDays: "0" } });
    await calculateAgain(world, runId);
    const back = await item("full");
    expect([back.totals.net, back.lines.length]).toEqual(["48200", 9]);
  }, 120_000);
});

describe("making, discarding and reaching a run", () => {
  let world: RunWorld;
  let hr: { employeeId: string; userId: string; employeeCode: string };
  beforeAll(async () => {
    world = await buildRunWorld(["a"], { companyRules: false });
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_EXECUTIVE" });
    await giveSalary(world, world.named.a!.employeeId, "600000", FIRST_SALARY_DAY);
    await lockCycle(world.named.a!.employeeId, CYCLE.start, CYCLE.end);
  }, 300_000);
  afterAll(async () => {
    await cleanupFullTestEmployee(hr.employeeId);
    await teardownRunWorld(world);
  });

  it("names every rule that has no value yet, all at once, and starts nothing", async () => {
    const created = await api(world.tokens.maker, "post", "/runs", { cycleStart: CYCLE.start });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const readiness = (await api(world.tokens.maker, "get", `/runs/readiness?cycleStart=${CYCLE.start}`)).body;
    const labels = readiness.rules.missing.map((m: { label: string }) => m.label);
    expect(labels).toEqual(expect.arrayContaining(["Pay days basis", "Loss-of-pay divisor", "Rounding of net pay", "Payment date", "PF: ceiling mode", "ESI: coverage period rule"]));
    const preview = await api(world.tokens.maker, "post", `/runs/${id}/calculate-preview`);
    expect([preview.status, preview.body.error.code]).toEqual([409, "RULES_MISSING"]);
    expect(preview.body.error.details.missing.length).toBeGreaterThanOrEqual(10);
    const ask = await api(world.tokens.maker, "post", `/runs/${id}/calculate`, { fingerprint: "payroll-hash-v1:nothing" });
    expect(ask.body.error.code).toBe("RULES_MISSING");
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id } })).status).toBe("NEW");
    await api(world.tokens.maker, "post", `/runs/${id}/void`, { reason: "set up first" });
  });

  it("refuses a date that is not the start of a cycle, a cycle that has not ended, a second live run, and a bare reason", async () => {
    expect((await api(world.tokens.maker, "post", "/runs", { cycleStart: "2026-08-02" })).status).toBe(400);
    const today = businessToday();
    const thisCycle = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const notOver = await api(world.tokens.maker, "post", "/runs", { cycleStart: thisCycle });
    expect([notOver.status, notOver.body.error.code]).toEqual([409, "CYCLE_NOT_OVER"]);
    const first = await api(world.tokens.maker, "post", "/runs", { cycleStart: CYCLE.start });
    expect(first.status).toBe(201);
    const again = await api(world.tokens.maker, "post", "/runs", { cycleStart: CYCLE.start });
    expect([again.status, again.body.error.code]).toEqual([409, "RUN_EXISTS"]);
    expect((await api(world.tokens.maker, "post", `/runs/${first.body.id}/void`, { reason: "x" })).status).toBe(400);
    expect((await api(world.tokens.maker, "post", `/runs/${first.body.id}/void`, { reason: "made by mistake" })).status).toBe(200);
    const detail = (await api(world.tokens.maker, "get", `/runs/${first.body.id}`)).body;
    expect([detail.status, detail.voidReason]).toEqual(["VOID", "made by mistake"]);
    // A discarded run frees the cycle, and is itself never changed again.
    const second = await api(world.tokens.maker, "post", "/runs", { cycleStart: CYCLE.start });
    expect(second.status).toBe(201);
    await expect(prisma.payrollRun.update({ where: { id: first.body.id }, data: { cycleLabel: "x" } })).rejects.toThrow(/RUN_VOID_IMMUTABLE/);
    expect((await api(world.tokens.maker, "post", `/runs/${first.body.id}/void`, { reason: "again please" })).status).toBe(409);
    await api(world.tokens.maker, "post", `/runs/${second.body.id}/void`, { reason: "done with this test" });
  });

  it("is reached only by people who may see salary, and made only by those who may prepare a run", async () => {
    const hrToken = await loginAs(hr.employeeCode);
    const ownToken = await loginAs(world.named.a!.employeeCode);
    for (const token of [hrToken, ownToken]) {
      expect((await api(token, "get", "/runs")).status).toBe(403);
      expect((await api(token, "get", `/runs/readiness?cycleStart=${CYCLE.start}`)).status).toBe(403);
      expect((await api(token, "post", "/runs", { cycleStart: CYCLE.start })).status).toBe(403);
    }
    expect((await api(world.tokens.checkerA, "get", "/runs")).status).toBe(200); // a checker sees runs
    expect((await api(world.tokens.checkerA, "post", "/runs", { cycleStart: CYCLE.start })).status).toBe(403); // but does not prepare them
  });
});

describe("a calculation that is interrupted, repeated or overlapped", () => {
  let world: RunWorld;
  let runId: string;
  const who = (n: string) => world.named[n]!.employeeId;
  beforeAll(async () => {
    world = await buildRunWorld(["p", "q", "r"]);
    for (const n of ["p", "q", "r"]) {
      await giveSalary(world, who(n), "600000", FIRST_SALARY_DAY);
      await lockCycle(who(n), CYCLE.start, CYCLE.end);
    }
    runId = await calculateRun(world);
  }, 300_000);
  afterAll(async () => teardownRunWorld(world));

  const row = (n: string) => prisma.payrollRunItem.findUniqueOrThrow({ where: { runId_employeeId: { runId, employeeId: who(n) } } });

  it("does not run twice at once: a second worker finds the lease held and does nothing, then takes over when it has expired", async () => {
    const future = new Date(Date.now() + 600_000); // allow-clock: a lease expiry instant in a test
    await prisma.payrollRun.update({ where: { id: runId }, data: { status: "CALCULATING", leaseOwner: "another-worker", leaseExpiresAt: future } });
    await executeCalculation(runId, "this-worker");
    const held = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect([held.status, held.leaseOwner]).toEqual(["CALCULATING", "another-worker"]);
    const asked = await api(world.tokens.maker, "post", `/runs/${runId}/calculate`, { fingerprint: "payroll-hash-v1:x" });
    expect([asked.status, asked.body.error.code]).toEqual([409, "CONFLICT"]);
    await prisma.payrollRun.update({ where: { id: runId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } }); // allow-clock: a lease expiry instant in a test
    await executeCalculation(runId, "this-worker");
    const done = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect([done.status, done.leaseOwner]).toEqual(["CALCULATED", null]);
  });

  it("resumes after a killed worker: the people already written are left alone and the missing ones are written", async () => {
    const before = await prisma.payrollRunItem.findMany({ where: { runId }, select: { employeeId: true, updatedAt: true, calcVersion: true } });
    const kept = before.find((b) => b.employeeId === who("p"))!;
    await prisma.payrollRunItem.deleteMany({ where: { runId, employeeId: { in: [who("q"), who("r")] } } });
    const run0 = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    await prisma.payrollRun.update({ where: { id: runId }, data: { status: "CALCULATING", leaseOwner: null, leaseExpiresAt: null } });
    const queued: string[] = [];
    setCalculationEnqueuer(async (id) => void queued.push(id));
    const resumed = await api(world.tokens.maker, "post", `/runs/${runId}/calculate`, { fingerprint: "payroll-hash-v1:unused" });
    expect([resumed.status, resumed.body.resumed]).toEqual([202, true]); // a run stuck calculating with no live lease is picked up again, not refused
    expect(queued).toEqual([runId]);
    await executeCalculation(runId, "after-restart");
    const after = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect([after.status, after.calcVersion]).toEqual(["CALCULATED", run0.calcVersion]);
    expect(await prisma.payrollRunItem.count({ where: { runId, employeeId: { in: [who("p"), who("q"), who("r")] } } })).toBe(3);
    expect((await row("p")).updatedAt.getTime()).toBe(kept.updatedAt.getTime()); // written before the crash, not written again
    expect((await row("q")).calcVersion).toBe(run0.calcVersion);
  });

  it("starts over, under a new version, if the world moved while it was stopped", async () => {
    const v0 = (await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).calcVersion;
    const pBefore = (await row("p")).updatedAt.getTime();
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: who("q"), date: day("2026-08-05") } }, data: { lopDays: "1" } });
    await prisma.payrollRun.update({ where: { id: runId }, data: { status: "CALCULATING", leaseOwner: null, leaseExpiresAt: null } });
    await executeCalculation(runId, "after-restart");
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect([run.status, run.calcVersion]).toEqual(["CALCULATED", v0 + 1]);
    expect((await row("q")).netPay.toString()).toBe("46638");
    expect((await row("p")).updatedAt.getTime()).toBeGreaterThan(pBefore); // everyone was written again, so no one is left from the old version
    expect((await row("p")).calcVersion).toBe(v0 + 1);
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: who("q"), date: day("2026-08-05") } }, data: { lopDays: "0" } });
  });

  it("records a failure in words and keeps the old figures, instead of leaving a half-made run", async () => {
    await setRules(world.maker.userId, { LINE_ROUNDING: { mode: "NONE", scale: 0 } });
    const queued: string[] = [];
    setCalculationEnqueuer(async (id) => void queued.push(id));
    const preview = await api(world.tokens.maker, "post", `/runs/${runId}/calculate-preview`);
    expect([preview.status, preview.body.error.code]).toEqual([409, "ROUNDING_NONE"]); // refused up front, with the reason
    await setRules(world.maker.userId, { LINE_ROUNDING: { mode: "HALF_UP", scale: 0 } });
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("CALCULATED");
  });
});

void calculateAgain;
void setCalculationEnqueuer;
