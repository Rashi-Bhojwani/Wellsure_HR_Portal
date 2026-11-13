import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { encashmentAmount, overtimeAmount } from "../payPolicies/arith";
import { automaticLines } from "../settlements/service";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { goldenFixture, goldenSnapshot } from "./goldenHelpers";
import { Frac } from "./rational";
import { CYCLE, calculateRun, setRules } from "./runTestHelpers";

// Part 3 A2/A3 (docs/plans/A_PART3.md; owner decisions 2026-11-13): overtime pay and leave encashment. Every value is Not set by default; the arithmetic is checked with
// fake values labelled TEST against exact fractions; with the settings Not set the golden run is unchanged even with approved overtime and encashment present.
const paise = (s: string) => {
  const neg = s.startsWith("-");
  const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -v : v;
};
/** Half up to 2 places of a non-negative exact fraction, in paise. */
const halfUpPaise = (x: Frac) => (x.n * 100n * 2n + x.d) / (x.d * 2n);
const txt = (p: bigint) => `${p / 100n}.${String(p % 100n).padStart(2, "0")}`;

describe("A2/A3 — the arithmetic against exact fractions (TEST values)", () => {
  it("overtime: hours × flat rate, or hours × multiplier × (chosen heads ÷ hours a month); one rounding at the end", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 6000 }), fc.bigInt({ min: 0n, max: 50_000_000n }), fc.bigInt({ min: 0n, max: 30_000_000n }), fc.constantFrom("1.5", "2", "2.25"), fc.constantFrom("208", "200", "180.5"), fc.bigInt({ min: 1n, max: 99_999n }), (minutes, basic, other, mult, hours, flat) => {
        const lines = [{ componentCode: "TEST_BASIC", amount: txt(basic) }, { componentCode: "TEST_OTHER", amount: txt(other) }];
        const r = { mode: "HALF_UP" as const, scale: 2 };
        // multiplier: minutes/60 × mult × basic / hours  (basic in paise, so divide by 100)
        const fr = (s: string) => { const [w, f = ""] = s.split("."); return new Frac(BigInt(w + f), 10n ** BigInt(f.length)); };
        const m = fr(mult);
        const h = fr(hours);
        const exact = new Frac(BigInt(minutes) * m.n * basic * h.d, 60n * m.d * 100n * h.n);
        expect(paise(overtimeAmount(minutes, { mode: "MULTIPLIER", multiplier: mult, basisHeads: ["TEST_BASIC"], hoursPerMonth: hours }, lines, r).toFixed(2))).toBe(halfUpPaise(exact));
        const flatExact = new Frac(BigInt(minutes) * flat, 60n * 100n);
        expect(paise(overtimeAmount(minutes, { mode: "FLAT_PER_HOUR", perHour: txt(flat) }, lines, r).toFixed(2))).toBe(halfUpPaise(flatExact));
      }),
      { numRuns: 400 },
    );
  });
  it("encashment: days × (chosen heads ÷ divisor), a fixed divisor or the month's calendar days; one rounding at the end", () => {
    fc.assert(
      fc.property(fc.constantFrom("0.5", "1", "7.5", "15"), fc.bigInt({ min: 0n, max: 50_000_000n }), fc.constantFrom("26", "30"), fc.constantFrom(28, 30, 31), (days, basic, fixedDays, dim) => {
        const lines = [{ componentCode: "TEST_BASIC", amount: txt(basic) }];
        const r = { mode: "HALF_UP" as const, scale: 2 };
        const [w, f = ""] = days.split(".");
        const d = new Frac(BigInt(w + f), 10n ** BigInt(f.length));
        expect(paise(encashmentAmount(days, lines, ["TEST_BASIC"], { kind: "FIXED_DAYS", days: fixedDays }, dim, r).toFixed(2))).toBe(halfUpPaise(new Frac(d.n * basic, d.d * 100n * BigInt(fixedDays))));
        expect(paise(encashmentAmount(days, lines, ["TEST_BASIC"], { kind: "CALENDAR_DAYS" }, dim, r).toFixed(2))).toBe(halfUpPaise(new Frac(d.n * basic, d.d * 100n * BigInt(dim))));
      }),
      { numRuns: 300 },
    );
  });
});

describe("A2/A3 — over a real run", () => {
  let world: Closing;
  let runId = "";
  let plId = "";
  let encReqId = "";
  let otherCode = "";
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const tok: Record<string, string> = {};
  const proposalIds: string[] = [];
  const who = (n: string) => world.named[n]!.employeeId;
  const call = (t: string, m: "get" | "post", path: string, body?: object) => request(app)[m](path).set(...authHeader(t)).send(body);
  const setBehaviour = async (key: string, value: unknown, base: "/api/behaviours" | "/api/policy-settings") => {
    const p = await call(world.tokens.maker, "post", `${base}/${key}/proposals`, { value, reason: "TEST values for the arithmetic test" });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    proposalIds.push(p.body.id);
    const c = await call(world.tokens.checkerA, "post", `${base}/proposals/${p.body.id}/confirm`);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
  };

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    plId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
    // Approved overtime and an approved encashment request exist BEFORE the run: with the settings Not set they must change nothing.
    await prisma.overtimeClaim.create({ data: { employeeId: who("a"), date: new Date("2026-08-10T00:00:00Z"), minutes: 150, approvedMinutes: 150, status: "APPROVED", decidedByUserId: world.maker.userId, decidedAt: new Date() } });
    encReqId = (await prisma.leaveEncashmentRequest.create({ data: { employeeId: who("b"), leaveTypeId: plId, leaveYear: 2026, days: "2.5", status: "APPROVED", decidedByUserId: world.maker.userId, decidedAt: new Date() } })).id;
    await prisma.leaveLedger.create({ data: { employeeId: who("c"), leaveTypeId: plId, leaveYear: 2026, entryDate: new Date("2026-01-01T00:00:00Z"), entryType: "GRANT", days: "3", referenceType: "MANUAL_GRANT" } });
    const otherType = await prisma.leaveType.findFirstOrThrow({ where: { code: { not: "PL" } }, orderBy: { code: "asc" } });
    otherCode = otherType.code;
    await prisma.leaveLedger.create({ data: { employeeId: who("c"), leaveTypeId: otherType.id, leaveYear: 2026, entryDate: new Date("2026-01-01T00:00:00Z"), entryType: "GRANT", days: "2", referenceType: "MANUAL_GRANT" } });
    const hold = await call(world.tokens.maker, "post", "/api/payroll/holds", { input: { employeeId: who("c"), cycleStart: CYCLE.start, reason: "Documents pending" } });
    expect(hold.status).toBe(201);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    for (const [k, role] of [["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      people[k] = await createFullTestEmployee(world.org, { roleCode: role });
      world.userIds.push(people[k]!.userId);
      tok[k] = await loginAs(people[k]!.employeeCode);
    }
    tok.a = await loginAs(world.named.a!.employeeCode);
  }, 900_000);

  afterAll(async () => {
    await deleteWithDependents("BehaviourProposal", proposalIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("golden: with the settings Not set, approved overtime and an approved encashment request leave the run's figures and payslips exactly as before part 3", async () => {
    expect(await goldenSnapshot(world, runId)).toEqual(goldenFixture());
    expect(await prisma.payrollAdjustment.count({ where: { employeeId: { in: [who("a"), who("b")] }, source: "MANUAL" } })).toBe(0);
  });

  it("HR, a manager, an employee and the Developer are refused every route; paying is refused while anything is Not set; a settlement shows leave in days only", async () => {
    for (const t of [tok.hr!, tok.mgr!, tok.a!, tok.dev!]) {
      expect((await call(t, "get", "/api/payroll-pay-policies/overtime?month=2026-08")).status).toBe(403);
      expect((await call(t, "post", "/api/payroll-pay-policies/overtime/post", { month: "2026-08" })).status).toBe(403);
      expect((await call(t, "get", "/api/payroll-pay-policies/encashment")).status).toBe(403);
      expect((await call(t, "post", "/api/payroll-pay-policies/encashment/pay", { requestId: encReqId })).status).toBe(403);
    }
    const pre = await call(world.tokens.maker, "get", "/api/payroll-pay-policies/overtime?month=2026-08");
    expect(pre.body.notSet.length).toBe(2);
    expect(pre.body.people.find((p: { employeeId: string }) => p.employeeId === who("a"))).toMatchObject({ minutes: 150, amount: null });
    expect((await call(world.tokens.maker, "post", "/api/payroll-pay-policies/overtime/post", { month: "2026-08" })).body.error.code).toBe("NOT_SET");
    expect((await call(world.tokens.maker, "post", "/api/payroll-pay-policies/encashment/pay", { requestId: encReqId })).body.error.code).toBe("NOT_SET");
    const leave = (await automaticLines(who("c"), new Date("2026-09-30T00:00:00Z"))).find((l) => l.kind === "LEAVE_BALANCE")!;
    expect(leave).toMatchObject({ amount: null, label: "Leave balance (PL), days only" });
  });

  it("with TEST values confirmed by two directors and the switches on: overtime and encashment are paid once each, exactly; the ledger records the days; the settlement gets its amount", async () => {
    const sal = await prisma.employeeSalary.findFirstOrThrow({ where: { employeeId: who("a") }, include: { lines: true } });
    const basicA = sal.lines.find((l) => l.componentCode === world.basic)!.amount.toString();
    await setBehaviour("policy.overtime", { active: true, minimumMinutes: 60, roundToMinutes: 30, approver: "DIRECTOR" }, "/api/policy-settings");
    await setBehaviour("payroll.overtimePay", { payHead: world.special, rate: { mode: "MULTIPLIER", multiplier: "2", basisHeads: [world.basic], hoursPerMonth: "208" }, rounding: { mode: "HALF_UP", scale: 2 }, sourceNote: "TEST value, not a real rate" }, "/api/behaviours");
    const pre = await call(world.tokens.maker, "get", "/api/payroll-pay-policies/overtime?month=2026-08");
    expect(pre.body.notSet).toEqual([]);
    const a = pre.body.people.find((p: { employeeId: string }) => p.employeeId === who("a"));
    const [bw, bf = ""] = basicA.split(".");
    const basicPaise = BigInt(bw!) * 100n + BigInt((bf + "00").slice(0, 2));
    expect(paise(a.amount)).toBe(halfUpPaise(new Frac(150n * 2n * basicPaise, 60n * 100n * 208n)));
    expect((await call(world.tokens.maker, "post", "/api/payroll-pay-policies/overtime/post", { month: "2026-08" })).body.created).toBe(1);
    expect((await call(world.tokens.checkerA, "post", "/api/payroll-pay-policies/overtime/post", { month: "2026-08" })).body.created).toBe(0); // the other director's click: none twice
    const adj = await prisma.payrollAdjustment.findFirstOrThrow({ where: { employeeId: who("a"), source: "MANUAL", sourceRef: `overtime:${who("a")}:2026-08` } });
    expect([adj.status, adj.componentCode, paise(Number(adj.amount.toString()).toFixed(2))]).toEqual(["PENDING", world.special, paise(a.amount)]);

    await setBehaviour("policy.encashmentRequests", { active: true, leaveTypes: ["PL"], keepAtLeast: 0, maxDaysPerYear: 10 }, "/api/policy-settings");
    await setBehaviour("payroll.leaveEncashment", { payHead: world.special, exitLeaveTypes: ["PL"], basisHeads: [world.basic], divisor: { kind: "FIXED_DAYS", days: "26" }, rounding: { mode: "HALF_UP", scale: 2 }, sourceNote: "TEST value, not a real formula" }, "/api/behaviours");
    const list = await call(world.tokens.maker, "get", "/api/payroll-pay-policies/encashment");
    const r = list.body.requests.find((x: { id: string }) => x.id === encReqId);
    const basicB = (await prisma.employeeSalary.findFirstOrThrow({ where: { employeeId: who("b") }, include: { lines: true } })).lines.find((l) => l.componentCode === world.basic)!.amount.toString();
    const [w2, f2 = ""] = basicB.split(".");
    expect(paise(r.amount)).toBe(halfUpPaise(new Frac(25n * (BigInt(w2!) * 100n + BigInt((f2 + "00").slice(0, 2))), 10n * 100n * 26n)));
    expect((await call(world.tokens.maker, "post", "/api/payroll-pay-policies/encashment/pay", { requestId: encReqId })).status).toBe(200);
    expect((await call(world.tokens.checkerA, "post", "/api/payroll-pay-policies/encashment/pay", { requestId: encReqId })).body.error.code).toBe("ALREADY_PAID");
    const ledger = await prisma.leaveLedger.findMany({ where: { referenceType: "ENCASHMENT_REQUEST", referenceId: encReqId } });
    expect(ledger.map((l) => [l.entryType, l.days.toString()])).toEqual([["ENCASHMENT", "-2.5"]]);
    const exitLines = (await automaticLines(who("c"), new Date("2026-09-30T00:00:00Z"))).filter((l) => l.kind === "LEAVE_BALANCE");
    const leave = exitLines.find((l) => l.label.includes("(PL)"))!;
    expect(leave.amount).not.toBeNull();
    expect(leave.label).toBe("Leave encashment (PL)");
    // A type not named for exit stays in days only.
    const other = exitLines.find((l) => l.label.includes(`(${otherCode})`))!;
    expect(other).toMatchObject({ amount: null, label: `Leave balance (${otherCode}), days only` });
    // The finalised August run is untouched by all of this.
    expect(await goldenSnapshot(world, runId)).toEqual(goldenFixture());
  });
});
