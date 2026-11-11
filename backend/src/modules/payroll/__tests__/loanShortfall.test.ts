import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { dec } from "../money";
import { applyLoanShortfall, type ShortfallRule } from "../run/loanShortfall";
import { buildSetupReport, readinessOf } from "../setup/status";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { Frac } from "./rational";
import { api, calculateAgain, calculateRun, lockCycle, setRules } from "./runTestHelpers";
import { makeComponent } from "./salaryTestHelpers";

// D-37 item 4 (docs/plans/D37_DEFAULTS.md): a loan instalment when net pay is too low, and the max-deduction percentage. Made-up figures only.
const paise = (s: string) => {
  const neg = s.startsWith("-");
  const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -v : v;
};
const money = (p: bigint) => `${p < 0n ? "-" : ""}${(p < 0n ? -p : p) / 100n}.${String((p < 0n ? -p : p) % 100n).padStart(2, "0")}`;

describe("D-37 item 4 — the rule against an independent exact-fraction model", () => {
  const RULES: ShortfallRule[] = ["STOP_RUN", "SKIP_AND_CARRY", "PARTIAL_AND_CARRY"];
  it("recovers each instalment in order only while it fits; the rule decides the rest; nothing ever goes beyond the room; the room respects the percentage", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 50_000_000n }),
        fc.bigInt({ min: 0n, max: 60_000_000n }),
        fc.array(fc.tuple(fc.bigInt({ min: 1n, max: 30_000_000n }), fc.constantFrom(...RULES)), { minLength: 1, maxLength: 6 }),
        fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: null }), // percent × 100
        (grossP, othersP, inst, pct) => {
          const out = applyLoanShortfall({ gross: dec(money(grossP)), otherDeductions: dec(money(othersP)), instalments: inst.map(([a, rule], k) => ({ adjustmentId: `a${k}`, amount: dec(money(a)), loanId: `L${k}`, typeKey: "T", rule })), maxPercent: pct === null ? null : dec(`${Math.floor(pct / 100)}.${String(pct % 100).padStart(2, "0")}`) });
          // The model, in exact fractions: room = min(gross − others, gross × pct/100 − others), at least 0, whole paise rounded down.
          let room = new Frac(grossP - othersP, 100n);
          if (pct !== null) {
            const cap = new Frac(grossP * BigInt(pct), 1_000_000n).minus(new Frac(othersP, 100n));
            if (cap.cmp(room) < 0) room = cap;
          }
          if (room.cmp(new Frac(0n)) < 0) room = new Frac(0n);
          let roomP = (room.n * 100n) / room.d; // floor to paise (non-negative)
          inst.forEach(([a, rule], k) => {
            const got = paise(out.recovered.get(`a${k}`)!.toFixed(2));
            if (a <= roomP) {
              expect(got).toBe(a);
              roomP -= a;
            } else {
              const take = rule === "PARTIAL_AND_CARRY" ? roomP : 0n;
              expect(got, `rule ${rule}`).toBe(take);
              roomP -= take;
              const d = out.decisions.find((x) => x.adjustmentId === `a${k}`)!;
              expect(paise(d.recovered) + paise(d.carried)).toBe(a);
              expect(out.blocking.includes(d)).toBe(rule === "STOP_RUN");
            }
          });
          expect(roomP >= 0n).toBe(true); // never beyond what is there: net pay is never pushed below zero by a loan
        },
      ),
      { numRuns: 500 },
    );
  });

  it("each option on one example, and the zero floor", () => {
    const one = (rule: ShortfallRule, gross = "1000", others = "700", max: string | null = null) => applyLoanShortfall({ gross: dec(gross), otherDeductions: dec(others), instalments: [{ adjustmentId: "x", amount: dec("500"), loanId: "L1", typeKey: "T", rule }], maxPercent: max ? dec(max) : null });
    expect(one("SKIP_AND_CARRY").recovered.get("x")!.toFixed(2)).toBe("0.00");
    expect(one("SKIP_AND_CARRY").decisions[0]).toMatchObject({ carried: "500", recovered: "0" });
    expect(one("PARTIAL_AND_CARRY").recovered.get("x")!.toFixed(2)).toBe("300.00");
    expect(one("PARTIAL_AND_CARRY").decisions[0]).toMatchObject({ carried: "200", recovered: "300" });
    expect(one("STOP_RUN").blocking).toHaveLength(1);
    expect(one("STOP_RUN").recovered.get("x")!.toFixed(2)).toBe("0.00");
    // Zero floor: other deductions already more than gross: no loan recovery at all, under any rule.
    for (const r of ["SKIP_AND_CARRY", "PARTIAL_AND_CARRY", "STOP_RUN"] as const) expect(one(r, "1000", "1200").recovered.get("x")!.toFixed(2)).toBe("0.00");
    // The percentage: 75% of 1000 = 750, less 700 others = 50 of room.
    expect(one("PARTIAL_AND_CARRY", "1000", "700", "75").recovered.get("x")!.toFixed(2)).toBe("50.00");
    // Fits whole: nothing is decided, nothing is warned.
    expect(one("SKIP_AND_CARRY", "2000", "700").decisions).toEqual([]);
  });
});

describe("D-37 item 4 — over the routes and two real runs", () => {
  let world: Closing;
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let dev: { employeeId: string; userId: string; employeeCode: string };
  const tok: Record<string, string> = {};
  const typeKey = `TS${Date.now().toString(36).slice(-5).toUpperCase()}`;
  let loanId = "";
  let septRun = "";
  let septJoiners: Array<{ id: string; dateOfJoining: Date }> = [];
  const b = (t: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/behaviours${path}`).set(...authHeader(t)).send(body);
  const loans = (t: string, method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](`/api/loans${path}`).set(...authHeader(t)).send(body);
  const setRule = async (value: object, reason = "made up for a test") => {
    const p = await b(world.tokens.maker, "post", "/loan.shortfall/proposals", { value, reason });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect((await b(world.tokens.checkerA, "post", `/proposals/${p.body.id}/confirm`)).status).toBe(200);
  };

  beforeAll(async () => {
    world = await closingWorld(["a"]);
    await staffWith(world, ["a"]);
    await lockCycle(world.named.a!.employeeId, "2026-09-01", "2026-09-30");
    // The world sidelines everyone else for August; anyone seeded to join in September is set aside too (and put back afterwards).
    septJoiners = await prisma.employee.findMany({ where: { dateOfJoining: { gte: new Date("2026-09-01T00:00:00Z"), lte: new Date("2026-09-30T00:00:00Z") } }, select: { id: true, dateOfJoining: true } });
    await prisma.employee.updateMany({ where: { id: { in: septJoiners.map((e) => e.id) } }, data: { dateOfJoining: new Date("2026-12-01T00:00:00Z") } });
    await setRules(world.maker.userId, REAL_RULES);
    await makeComponent(world, `${world.prefix}_LOANPAY`, { name: "Loan paid out", payslipLabel: "Loan paid out", payslipOrder: 30, taxable: false, prorates: false });
    await makeComponent(world, `${world.prefix}_LOANPRIN`, { name: "Principal Part", type: "DEDUCTION", payslipLabel: "Principal Part", payslipOrder: 31, taxable: false, prorates: false });
    await makeComponent(world, `${world.prefix}_LOANINT`, { name: "Interest Part", type: "DEDUCTION", payslipLabel: "Interest Part", payslipOrder: 32, taxable: false, prorates: false });
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    world.userIds.push(hr.userId, dev.userId);
    await prisma.employee.updateMany({ where: { id: { in: [dev.employeeId, hr.employeeId] } }, data: { dateOfJoining: new Date("2026-10-01T00:00:00Z") } });
    tok.hr = await loginAs(hr.employeeCode);
    tok.dev = await loginAs(dev.employeeCode);
    tok.a = await loginAs(world.named.a!.employeeCode);
    // A loan paid out in August, one instalment of 90,000 due in September: more than September's net pay.
    expect((await loans(world.tokens.maker, "put", "/types", { typeKey, name: "Test advance", maxAmount: "100000", maxInstalments: 12, ratePercent: "0", employeesMayRequest: false, disbursementHead: `${world.prefix}_LOANPAY`, principalHead: `${world.prefix}_LOANPRIN`, interestHead: `${world.prefix}_LOANINT`, reason: "made up" })).status).toBe(200);
    setBusinessTodayForTests(new Date("2026-08-10T00:00:00Z"));
    const made = await loans(world.tokens.checkerB, "post", "", { employeeId: world.named.a!.employeeId, typeKey, principal: "90000", instalments: 1, firstMonth: "2026-09-01", purpose: "test" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    loanId = made.body.id;
    const view = await loans(world.tokens.checkerB, "get", `/${loanId}`);
    expect((await loans(world.tokens.checkerB, "post", `/${loanId}/sanction`, { fingerprint: view.body.fingerprint })).status).toBe(200);
    expect((await loans(world.tokens.checkerA, "post", `/${loanId}/sanction/decision`, { fingerprint: view.body.fingerprint, decision: "APPROVE" })).status).toBe(200);
    setBusinessTodayForTests(null);
    const aug = await calculateRun(world);
    await confirmAllPins(world, aug);
    await driveToFinal(world, aug);
  }, 900_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await deleteWithDependents("BehaviourProposal", (await prisma.behaviourProposal.findMany({ where: { proposedByUserId: { in: [world.maker.userId, world.checkerA.userId] } }, select: { id: true } })).map((p) => p.id));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
      await tx.loanTypeVersion.deleteMany({ where: { typeKey } });
    });
    for (const e of septJoiners) await prisma.employee.update({ where: { id: e.id }, data: { dateOfJoining: e.dateOfJoining } });
    for (const x of [hr, dev]) if (x) await cleanupFullTestEmployee(x.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("HR, the Developer role and an employee are refused the settings routes; no sign-in is refused", async () => {
    for (const t of ["hr", "dev", "a"]) {
      expect((await b(tok[t]!, "get", "")).status, t).toBe(403);
      expect((await b(tok[t]!, "post", "/loan.shortfall/proposals", { value: {}, reason: "nope" })).status, t).toBe(403);
      expect((await b(tok[t]!, "post", "/proposals/x/confirm")).status, t).toBe(403);
    }
    expect((await request(app).get("/api/behaviours")).status).toBe(401);
  });

  it("the defaults are labelled and informational on the Ready list; the percentage is Not set", async () => {
    const list = (await b(world.tokens.maker, "get", "")).body.behaviours as Array<{ key: string; state: string; label: string | null }>;
    expect(list.find((x) => x.key === "loan.shortfall")).toMatchObject({ state: "DEFAULT", label: "Default, change in settings" });
    expect(list.find((x) => x.key === "loan.maxTotalDeductionPercent")).toMatchObject({ state: "NOT_SET", label: "Not set" });
    const ready = readinessOf(await buildSetupReport());
    expect(ready.behaviours.map((x) => x.itemId)).toEqual(expect.arrayContaining(["behaviour:loan.shortfall", "behaviour:leave.leavingMonthAccrual", "behaviour:access.developerSeesSwipes", "behaviour:loan.maxTotalDeductionPercent"]));
    expect(ready.blockers.some((x) => x.itemId.startsWith("behaviour:"))).toBe(false);
    expect(ready.notRequiredYet.some((x) => x.itemId.startsWith("behaviour:"))).toBe(false);
  });

  it("by default the September instalment is skipped and carried with a warning naming the loan; net pay stays positive", async () => {
    septRun = await calculateRun(world, "2026-09-01");
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: septRun, employeeId: world.named.a!.employeeId } });
    expect(item.netPay.greaterThan(0)).toBe(true);
    const lines = await prisma.payrollRunLine.findMany({ where: { runId: septRun, employeeId: world.named.a!.employeeId, code: `${world.prefix}_LOANPRIN` } });
    expect(lines).toHaveLength(0);
    const ex = item.exceptions as Array<{ code: string; severity: string; message: string }>;
    expect(ex.find((e) => e.code === "LOAN_SHORTFALL")).toMatchObject({ severity: "WARNING" });
    expect(ex.find((e) => e.code === "LOAN_SHORTFALL")!.message).toContain(loanId);
  });

  it("a change needs a different director; the database refuses a self-confirmation and any change to the history", async () => {
    const p = await b(world.tokens.maker, "post", "/loan.shortfall/proposals", { value: { [typeKey]: "STOP_RUN" }, reason: "made up for a test" });
    expect((await b(world.tokens.maker, "post", `/proposals/${p.body.id}/confirm`)).body.error.code).toBe("CHECKER_IS_MAKER");
    await expect(prisma.behaviourConfirmation.create({ data: { proposalId: p.body.id, confirmedByUserId: world.maker.userId } })).rejects.toThrow(/BEHAVIOUR_SAME_PERSON/);
    await expect(prisma.behaviourProposal.update({ where: { id: p.body.id }, data: { reason: "rewritten" } })).rejects.toThrow(/BEHAVIOUR_APPEND_ONLY/);
    expect((await b(world.tokens.maker, "post", "/loan.shortfall/proposals", { value: { [typeKey]: "MAYBE" }, reason: "made up" })).status).toBe(400);
    expect((await b(world.tokens.checkerA, "post", `/proposals/${p.body.id}/confirm`)).status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: "settings.behaviour.confirmed", entityId: p.body.id } });
    expect(audit).not.toBeNull();
  });

  it("STOP_RUN blocks the run, naming the loan", async () => {
    await calculateAgain(world, septRun);
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: septRun, employeeId: world.named.a!.employeeId } });
    expect((item.exceptions as Array<{ code: string; severity: string }>).find((e) => e.code === "LOAN_SHORTFALL")).toMatchObject({ severity: "BLOCKING" });
    const preview = await api(world.tokens.maker, "post", `/runs/${septRun}/approvals/run/preview`);
    expect(preview.body.canRequest).toBe(false);
  });

  it("PARTIAL_AND_CARRY recovers what net pay allows within the directors' 90% limit; finalising pays that part and carries the rest to October; the loan's balance reads it", async () => {
    await setRule({ [typeKey]: "PARTIAL_AND_CARRY" });
    const pct = await b(world.tokens.maker, "post", "/loan.maxTotalDeductionPercent/proposals", { value: { percent: "90", sourceNote: "made up for a test" }, reason: "made up for a test" });
    expect((await b(world.tokens.checkerA, "post", `/proposals/${pct.body.id}/confirm`)).status).toBe(200);
    await calculateAgain(world, septRun);
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: septRun, employeeId: world.named.a!.employeeId } });
    const line = await prisma.payrollRunLine.findFirstOrThrow({ where: { runId: septRun, employeeId: world.named.a!.employeeId, code: `${world.prefix}_LOANPRIN` } });
    const recovered = line.amount.toFixed(2);
    // Independently: deductions may take at most 90% of gross; everything else first; the loan takes the rest of that, in whole paise rounded down.
    const gross = paise(item.gross.toFixed(2));
    const others = paise(item.deductions.toFixed(2)) - paise(recovered);
    expect(paise(recovered)).toBe((gross * 90n) / 100n - others);
    expect(paise(item.netPay.toFixed(2))).toBe(gross - others - paise(recovered));
    expect(paise(item.netPay.toFixed(2)) > 0n).toBe(true);
    await confirmAllPins(world, septRun);
    await driveToFinal(world, septRun);
    const rows = await prisma.payrollAdjustment.findMany({ where: { source: "LOAN_PRINCIPAL", sourceRef: { startsWith: loanId } }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status).sort()).toEqual(["CANCELLED", "CONSUMED", "PENDING"]);
    const part = rows.find((r) => r.status === "CONSUMED")!;
    const carry = rows.find((r) => r.status === "PENDING")!;
    expect(paise(part.amount.toFixed(2))).toBe(paise(recovered));
    expect(paise(part.amount.toFixed(2)) + paise(carry.amount.toFixed(2))).toBe(paise("90000"));
    expect(carry.periodStart!.toISOString().slice(0, 10)).toBe("2026-10-01");
    const statement = await loans(tok.a!, "get", `/mine/${loanId}`);
    expect(paise(statement.body.balance)).toBe(paise("90000") - paise(recovered));
  });
});
