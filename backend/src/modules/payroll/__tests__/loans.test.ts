import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { loanSchedule } from "../loans/schedule";
import { recoveryOf } from "../loans/service";
import { dec } from "../money";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { calculateRun, setRules } from "./runTestHelpers";
import { makeComponent } from "./salaryTestHelpers";

// P7-4 (docs/plans/P7_4_LOANS.md): loans through the real API, a real run and the real database. Made-up figures only.

// ── An independent model of the schedule, in BigInt paise and exact fractions ──
const paise = (s: string) => {
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
};
/** round half up of num/den (both positive), in paise */
const halfUp = (num: bigint, den: bigint) => (num * 2n + den) / (den * 2n);

describe("P7-4 — the schedule against an independent model", () => {
  it("parts sum to the principal; zero rate splits equally (rounded down, the last takes the rest); otherwise reducing balance with a constant instalment", () => {
    let seed = 99;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 300; i += 1) {
      const principalPaise = BigInt(1 + rnd(50_000_000));
      const n = 1 + rnd(48);
      const rateBasis = rnd(3) === 0 ? 0 : rnd(240_000); // percent × 10_000, so 0 to 24% with four decimals
      const principal = `${principalPaise / 100n}.${String(principalPaise % 100n).padStart(2, "0")}`;
      const rate = `${Math.floor(rateBasis / 10_000)}.${String(rateBasis % 10_000).padStart(4, "0")}`;
      const rows = loanSchedule(principal, rate, n, "2027-01-01");
      expect(rows).toHaveLength(n);
      const parts = rows.map((r) => paise(r.principal.toFixed(2)));
      expect(parts.reduce((a, b) => a + b, 0n), `${principal} ${rate} ${n}`).toBe(principalPaise);
      expect(rows.at(-1)!.balanceAfter.isZero()).toBe(true);
      if (rateBasis === 0) {
        const each = principalPaise / BigInt(n);
        for (const p of parts.slice(0, -1)) expect(p).toBe(each);
        rows.forEach((r) => expect(r.interest.isZero()).toBe(true));
      } else {
        // Each month's interest is the opening balance × rate / 1200, rounded half up to the paisa (rate as an exact fraction over 1_000_000).
        let balance = principalPaise;
        rows.forEach((r, k) => {
          expect(paise(r.interest.toFixed(2)), `interest ${k}`).toBe(halfUp(balance * BigInt(rateBasis), 1_200n * 10_000n));
          balance -= parts[k]!;
        });
        // The instalment is the same every month but the last.
        const totals = rows.map((r) => paise(r.principal.plus(r.interest).toFixed(2)));
        for (const t of totals.slice(0, -1)) expect(t).toBe(totals[0]);
      }
      expect(rows.map((r) => r.month).slice(0, 2)).toEqual(n > 1 ? ["2027-01-01", "2027-02-01"] : ["2027-01-01"]);
    }
  });
});

describe("loan recovery state (2026-11-11 walk)", () => {
  it("is read from what happened: not paid out, recovering, stopped, fully recovered, recovered at exit", () => {
    const base = { status: "SANCTIONED", disbursed: true, balance: dec("100"), recoveredAtExit: dec("0"), effective: [] as Array<{ kind: string }> };
    expect(recoveryOf({ ...base, status: "WAITING" })).toBe("NOT_SANCTIONED");
    expect(recoveryOf({ ...base, disbursed: false })).toBe("NOT_PAID_OUT");
    expect(recoveryOf(base)).toBe("RECOVERING");
    expect(recoveryOf({ ...base, effective: [{ kind: "CANCEL_PENDING" }] })).toBe("STOPPED");
    expect(recoveryOf({ ...base, effective: [{ kind: "PREPAID" }] })).toBe("RECOVERING");
    expect(recoveryOf({ ...base, balance: dec("0") })).toBe("FULLY_RECOVERED");
    expect(recoveryOf({ ...base, balance: dec("0"), recoveredAtExit: dec("100") })).toBe("RECOVERED_AT_EXIT");
  });
});

describe("P7-4 — loans over the routes and a payroll run", () => {
  let world: Closing;
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let hr: { employeeId: string; userId: string; employeeCode: string };
  const tok: Record<string, string> = {};
  let loanId = "";
  const typeKey = `TL${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const call = (t: string, method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](`/api/loans${path}`).set(...authHeader(t)).send(body);

  beforeAll(async () => {
    world = await closingWorld(["a", "b"]);
    await staffWith(world, ["a", "b"]);
    await setRules(world.maker.userId, REAL_RULES);
    await makeComponent(world, `${world.prefix}_LOANPAY`, { name: "Loan paid out", payslipLabel: "Loan paid out", payslipOrder: 30, taxable: false, prorates: false });
    await makeComponent(world, `${world.prefix}_LOANPRIN`, { name: "Principal Part", type: "DEDUCTION", payslipLabel: "Principal Part", payslipOrder: 31, taxable: false, prorates: false });
    await makeComponent(world, `${world.prefix}_LOANINT`, { name: "Interest Part", type: "DEDUCTION", payslipLabel: "Interest Part", payslipOrder: 32, taxable: false, prorates: false });
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    world.userIds.push(dev.userId, hr.userId);
    // They join after the test month, so the August run is not theirs to pay.
    await prisma.employee.updateMany({ where: { id: { in: [dev.employeeId, hr.employeeId] } }, data: { dateOfJoining: new Date("2026-09-01T00:00:00Z") } });
    tok.dev = await loginAs(dev.employeeCode);
    tok.hr = await loginAs(hr.employeeCode);
    tok.a = await loginAs(world.named.a!.employeeCode);
    tok.b = await loginAs(world.named.b!.employeeCode);
  }, 600_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
      await tx.loanTypeVersion.deleteMany({ where: { typeKey } });
    });
    await cleanupFullTestEmployee(dev.employeeId);
    await cleanupFullTestEmployee(hr.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("HR, the Developer role and an employee are refused the directors' routes; no sign-in is refused", async () => {
    for (const t of ["hr", "dev", "a"]) {
      expect((await call(tok[t]!, "get", "")).status, t).toBe(403);
      expect((await call(tok[t]!, "put", "/types", { typeKey, name: "x" })).status, t).toBe(403);
    }
    expect((await call(tok.dev!, "get", "/mine")).status).toBe(403);
    expect((await request(app).get("/api/loans/mine")).status).toBe(401);
  });

  it("a type is Not set until a director chooses every value; a loan of an unready type is refused", async () => {
    const half = await call(world.tokens.maker, "put", "/types", { typeKey, name: "Test advance", maxAmount: null, maxInstalments: null, ratePercent: null, employeesMayRequest: null, disbursementHead: null, principalHead: null, interestHead: null, reason: "made up for a test" });
    expect(half.body.gaps.length).toBe(7);
    setBusinessTodayForTests(new Date("2026-08-10T00:00:00Z"));
    expect((await call(world.tokens.maker, "post", "", { employeeId: world.named.a!.employeeId, typeKey, principal: "1000", instalments: 2, firstMonth: "2026-08-01", purpose: "test" })).body.error.code).toBe("TYPE_NOT_SET");
    const wrongHead = await call(world.tokens.maker, "put", "/types", { typeKey, name: "Test advance", maxAmount: "100000", maxInstalments: 12, ratePercent: "12", employeesMayRequest: true, disbursementHead: `${world.prefix}_LOANPRIN`, principalHead: `${world.prefix}_LOANPRIN`, interestHead: `${world.prefix}_LOANINT`, reason: "made up" });
    expect(wrongHead.status).toBe(400); // the money is paid under an earning head
    const ok = await call(world.tokens.maker, "put", "/types", { typeKey, name: "Test advance", maxAmount: "100000", maxInstalments: 12, ratePercent: "12", employeesMayRequest: true, disbursementHead: `${world.prefix}_LOANPAY`, principalHead: `${world.prefix}_LOANPRIN`, interestHead: `${world.prefix}_LOANINT`, reason: "made up" });
    expect(ok.body.gaps).toEqual([]);
  });

  it("the employee asks for their own; another director prepares it and a different one sanctions; nobody acts on their own loan; nothing moves before the sanction", async () => {
    expect((await call(tok.a!, "post", "/mine", { typeKey, principal: "200000", instalments: 3, firstMonth: "2026-08-01", purpose: "too much" })).body.error.code).toBe("OVER_MAXIMUM");
    const asked = await call(tok.a!, "post", "/mine", { employeeId: world.named.b!.employeeId, typeKey, principal: "30000", instalments: 3, firstMonth: "2026-08-01", purpose: "a made-up need" });
    expect(asked.status).toBe(201);
    loanId = asked.body.id;
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loanId } })).employeeId).toBe(world.named.a!.employeeId); // an id in the body is ignored
    expect((await call(tok.b!, "get", `/mine/${loanId}`)).status).toBe(404); // someone else's
    const mine = await call(tok.a!, "get", `/mine/${loanId}`);
    expect([mine.body.status, mine.body.schedule.length]).toEqual(["DRAFT", 3]);
    expect(await prisma.payrollAdjustment.count({ where: { sourceRef: { startsWith: loanId } } })).toBe(0);
    const view = await call(world.tokens.maker, "get", `/${loanId}`);
    expect((await call(world.tokens.maker, "post", `/${loanId}/sanction`, { fingerprint: view.body.fingerprint })).status).toBe(200);
    expect((await call(world.tokens.maker, "post", `/${loanId}/sanction/decision`, { fingerprint: view.body.fingerprint, decision: "APPROVE" })).body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await call(world.tokens.checkerA, "post", `/${loanId}/sanction/decision`, { fingerprint: view.body.fingerprint, decision: "APPROVE" })).status).toBe(200);
    const adjustments = await prisma.payrollAdjustment.findMany({ where: { sourceRef: { startsWith: loanId } }, orderBy: { sourceRef: "asc" } });
    expect(adjustments.map((a) => a.source).sort()).toEqual(["LOAN_DISBURSEMENT", "LOAN_INTEREST", "LOAN_INTEREST", "LOAN_INTEREST", "LOAN_PRINCIPAL", "LOAN_PRINCIPAL", "LOAN_PRINCIPAL"]);
    await expect(prisma.loan.update({ where: { id: loanId }, data: { purpose: "rewritten" } })).rejects.toThrow(/LOAN_RECORD_IMMUTABLE/);
    setBusinessTodayForTests(null);
  });

  it("the August run pays the loan out and recovers only August's instalment; finalising consumes them; the statement's balance is principal less what was recovered", async () => {
    const runId = await calculateRun(world);
    const lines = await prisma.payrollRunLine.findMany({ where: { runId, employeeId: world.named.a!.employeeId } });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: loanId } });
    const schedule = loan.schedule as Array<{ principal: string; interest: string }>;
    const amountOf = (code: string) => lines.filter((l) => l.code === code).map((l) => l.amount.toFixed(2));
    expect(amountOf(`${world.prefix}_LOANPAY`)).toEqual(["30000.00"]);
    expect(amountOf(`${world.prefix}_LOANPRIN`)).toEqual([schedule[0]!.principal]);
    expect(amountOf(`${world.prefix}_LOANINT`)).toEqual([schedule[0]!.interest]);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    const statement = await call(tok.a!, "get", `/mine/${loanId}`);
    expect(statement.body.status).toBe("SANCTIONED");
    expect(statement.body.disbursed).toBe(true);
    expect(paise(statement.body.recovered)).toBe(paise(schedule[0]!.principal));
    expect(paise(statement.body.balance)).toBe(paise("30000") - paise(schedule[0]!.principal));
    expect(statement.body.schedule.map((r: { state: string }) => r.state)).toEqual(["CONSUMED", "PENDING", "PENDING"]);
  });
});
