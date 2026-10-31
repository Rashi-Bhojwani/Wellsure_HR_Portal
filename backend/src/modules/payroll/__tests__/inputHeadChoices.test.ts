import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { setPayrollConsumptionCheck, setPayrollInputsListener, setPayrollLockCheck } from "../../../lib/effectiveDating";
import { payrollConsumption, payrollLockOn } from "../run/lock";
import { componentValueSchema } from "../salary/schemas";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, lockCycle, sidelineEveryoneBut, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary, makeComponent, type Person } from "./salaryTestHelpers";

// Decision D-31 (docs/plans/DECISIONS_FOR_OWNERS.md): every monthly input head carries two director choices, a direction (earning or deduction) and whether negative figures are
// allowed. Both are Not set until a director chooses; a head with either Not set takes no figure and blocks the run, naming it. Nothing is preloaded.

describe("monthly input heads: direction and negative figures are the directors' choice", () => {
  let w: RunWorld;
  let dev: Person;
  let restore: () => Promise<void>;
  let adjust = "";
  let recover = "";
  let blank = "";
  const id = (n: string) => w.named[n]!.employeeId;
  const maker = () => w.tokens.maker;
  const month = CYCLE.start;
  const post = (path: string, body: object, token = maker()) => request(app).post(`/api/payroll/monthly-inputs${path}`).set(...authHeader(token)).send(body);
  const get = (path: string, token = maker()) => request(app).get(`/api/payroll/monthly-inputs${path}`).set(...authHeader(token));
  const enter = (entries: Array<{ employeeId: string; head: string; amount: string | null }>) => post("/entries", { cycleStart: month, entries, reason: "Entered in the test" });

  beforeAll(async () => {
    setPayrollLockCheck(payrollLockOn);
    setPayrollConsumptionCheck(payrollConsumption);
    w = await buildRunWorld(["a", "b"]);
    dev = await createFullTestEmployee(w.org, { roleCode: DEVELOPER_ROLE_CODE });
    const everyone = [w.maker, w.checkerA, w.checkerB, w.outsider, dev, ...w.staff];
    restore = await sidelineEveryoneBut(everyone.map((p) => p.employeeId));
    for (const p of everyone) await lockCycle(p.employeeId, CYCLE.start, CYCLE.end);
    for (const n of ["a", "b"]) await giveSalary(w, id(n), "600000", FIRST_SALARY_DAY);
    adjust = `${w.prefix}_ADJ`;
    recover = `${w.prefix}_REC`;
    blank = `${w.prefix}_BLK`;
    await makeComponent(w, adjust, { name: `Adjust ${w.prefix}`, payslipOrder: 20, inputItem: true, pfApplicable: false, inputDirection: "EARNING", inputAllowNegative: true });
    await makeComponent(w, recover, { name: `Recover ${w.prefix}`, type: "DEDUCTION", payslipOrder: 21, inputItem: true, taxable: false, inputDirection: "DEDUCTION", inputAllowNegative: false });
    await makeComponent(w, blank, { name: `Blank ${w.prefix}`, payslipOrder: 22, inputItem: true, pfApplicable: false }); // neither choice made: Not set
  }, 300_000);
  afterAll(async () => {
    setPayrollLockCheck(null);
    setPayrollConsumptionCheck(null);
    setPayrollInputsListener(null);
    await restore?.();
    await cleanupFullTestEmployee(dev.employeeId);
    await teardownRunWorld(w);
  }, 120_000);

  it("the two choices are optional on the head (Not set), only for a monthly input, and the direction must match the head's type", () => {
    const base = { name: "Some head", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: false, payslipLabel: "Some head", payslipOrder: 5 } as const;
    expect(componentValueSchema.safeParse({ ...base, inputItem: true }).success).toBe(true); // Not set is allowed
    expect(componentValueSchema.safeParse({ ...base, inputItem: true, inputDirection: "EARNING", inputAllowNegative: false }).success).toBe(true);
    expect(componentValueSchema.safeParse({ ...base, inputItem: true, inputDirection: "DEDUCTION" }).success).toBe(false); // against the head's own type
    expect(componentValueSchema.safeParse({ ...base, inputDirection: "EARNING" }).success).toBe(false); // not a monthly input
    expect(componentValueSchema.safeParse({ ...base, inputAllowNegative: true }).success).toBe(false);
  });

  it("the month lists each head with its choices, and Not set where nothing was chosen", async () => {
    const m = await get(`/month?cycleStart=${month}`);
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    const by = (code: string) => m.body.heads.find((h: { code: string }) => h.code === code);
    expect([by(adjust).direction, by(adjust).allowNegative]).toEqual(["EARNING", true]);
    expect([by(recover).direction, by(recover).allowNegative]).toEqual(["DEDUCTION", false]);
    expect([by(blank).direction, by(blank).allowNegative]).toEqual([null, null]);
  });

  it("a head with a choice Not set takes no figure; a negative figure is taken only where the head allows it", async () => {
    const notSet = await enter([{ employeeId: id("a"), head: blank, amount: "10" }]);
    expect([notSet.status, notSet.body.error.message]).toEqual([400, expect.stringMatching(/Not set/)]);
    const refused = await enter([{ employeeId: id("a"), head: recover, amount: "-5" }]);
    expect([refused.status, refused.body.error.message]).toEqual([400, expect.stringMatching(/does not allow negative figures/)]);
    const bad = await enter([{ employeeId: id("a"), head: adjust, amount: "-1,5" }]);
    expect(bad.status).toBe(400);
    const ok = await enter([{ employeeId: id("a"), head: adjust, amount: "-250.50" }, { employeeId: id("b"), head: adjust, amount: "100" }]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const g = await get(`?cycleStart=${month}&employeeId=${id("a")}`);
    expect(g.body.rows[0].cells.find((c: { head: string }) => c.head === adjust).amount).toBe("-250.5");
    expect((await enter([{ employeeId: id("a"), head: adjust, amount: "-0" }])).status).toBe(201);
    expect((await get(`?cycleStart=${month}&employeeId=${id("a")}`)).body.rows[0].cells.find((c: { head: string }) => c.head === adjust).amount).toBe("0");
    expect((await enter([{ employeeId: id("a"), head: adjust, amount: "-250.50" }])).status).toBe(201);
  });

  it("a head with a choice Not set cannot be filled with zeros either", async () => {
    const r = await post("/fill-blanks", { cycleStart: month, head: blank, reason: "Nothing this month" });
    expect([r.status, r.body.error.message]).toEqual([400, expect.stringMatching(/Not set/)]);
  });

  it("the run refuses while a head has a choice Not set, naming it; once both are chosen it goes ahead, and a negative earning takes off", async () => {
    const cells = [
      { employeeId: id("a"), head: recover, amount: "0" }, { employeeId: id("b"), head: recover, amount: "50" },
      { employeeId: id("a"), head: blank, amount: "0" }, { employeeId: id("b"), head: blank, amount: "0" },
    ];
    const pre = await enter(cells.filter((c) => c.head === recover));
    expect(pre.status, JSON.stringify(pre.body)).toBe(201);
    // No run exists yet: ask for the check the run makes.
    const { assertReadyForRun } = await import("../inputs/service");
    await expect(assertReadyForRun(month, [id("a"), id("b")], "the month")).rejects.toMatchObject({ code: "MONTHLY_INPUTS_MISSING", message: expect.stringMatching(/Blank .* no direction or no choice about negative figures yet \(Not set\)/) });
    // The directors choose for it: a new version, confirmed by a different director.
    await makeComponent(w, blank, { name: `Blank ${w.prefix}`, payslipOrder: 22, inputItem: true, pfApplicable: false, inputDirection: "EARNING", inputAllowNegative: false });
    expect((await enter(cells.filter((c) => c.head === blank))).status).toBe(201);
    // Everybody else in the month has nothing entered: a director enters zeros for them in one deliberate act.
    for (const head of [adjust, recover, blank]) expect((await post("/fill-blanks", { cycleStart: month, head, reason: "Nothing this month" })).status).toBe(201);
    const preview = await post("/confirm-preview", { cycleStart: month });
    const submitted = await post("/confirm", { cycleStart: month, fingerprint: preview.body.fingerprint });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const seen = await post("/confirm-preview", { cycleStart: month }, w.tokens.checkerA);
    expect((await post(`/decision/${month}`, { decision: "APPROVE", fingerprint: seen.body.fingerprint }, w.tokens.checkerA)).status).toBe(200);
    const run = await calculateRun(w);
    const a = (await api(maker(), "get", `/runs/${run}/items/${id("a")}`)).body.lines as Array<{ code: string; kind: string; amount: string; source: string; basis: { signed?: string } }>;
    const adj = a.find((l) => l.code === adjust)!;
    expect([adj.kind, adj.amount, adj.source, adj.basis.signed]).toEqual(["DEDUCTION", "250.5", "MONTHLY_INPUT", "-250.5"]);
    const b = (await api(maker(), "get", `/runs/${run}/items/${id("b")}`)).body.lines as Array<{ code: string; kind: string; amount: string }>;
    expect([b.find((l) => l.code === adjust)!.kind, b.find((l) => l.code === adjust)!.amount]).toEqual(["EARNING", "100"]);
    expect([b.find((l) => l.code === recover)!.kind, b.find((l) => l.code === recover)!.amount]).toEqual(["DEDUCTION", "50"]);
    await calculateAgain(w, run);
  });

  it("directors only: the Developer role and the employee are refused", async () => {
    const devToken = await loginAs(dev.employeeCode);
    expect((await get(`/month?cycleStart=${month}`, devToken)).status).toBe(403);
    expect((await post("/entries", { cycleStart: month, entries: [], reason: "x" }, devToken)).status).toBe(403);
    const emp = await loginAs(w.named.a!.employeeCode);
    expect((await get(`/month?cycleStart=${month}`, emp)).status).toBe(403);
  });
});
