import fc from "fast-check";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { Frac } from "../../payroll/__tests__/rational";
import { daysWorkedInLeavingMonth, leavingMonthTarget, type LeavingRule } from "../leavingMonth";

// D-37 item 5 (docs/plans/D37_DEFAULTS.md): leave accrual in the month of leaving. Made-up people only. Fake clock: "today" is 15 Nov 2026.
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const P = (s: string | number) => new Prisma.Decimal(s);

describe("D-37 item 5 — the rule against an independent model", () => {
  it("each option, for any days worked, matches exact fractions; pro-rata waits for rounding only when it is not exact to two decimals", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 28, max: 31 }),
        fc.integer({ min: 0, max: 31 }),
        fc.integer({ min: 1, max: 300 }), // the full accrual × 100
        fc.constantFrom<LeavingRule["mode"]>("NONE", "FULL_MONTH", "PRO_RATA_DAYS_WORKED", "FULL_IF_MIN_DAYS"),
        fc.integer({ min: 1, max: 31 }),
        (dim, workedRaw, full100, mode, n) => {
          const worked = Math.min(workedRaw, dim);
          const full = new Frac(BigInt(full100), 100n);
          const rule = (mode === "FULL_IF_MIN_DAYS" ? { mode, minDays: n } : { mode }) as LeavingRule;
          const got = leavingMonthTarget({ rule, full: P(full100).dividedBy(100), daysWorked: worked, daysInMonth: dim, rounding: null });
          const asFrac = (x: Prisma.Decimal) => Frac.of(x.toString());
          if (mode === "NONE") expect(asFrac(got.days!).cmp(new Frac(0n))).toBe(0);
          if (mode === "FULL_MONTH") expect(asFrac(got.days!).cmp(full)).toBe(0);
          if (mode === "FULL_IF_MIN_DAYS") expect(asFrac(got.days!).cmp(worked >= n ? full : new Frac(0n))).toBe(0);
          if (mode === "PRO_RATA_DAYS_WORKED") {
            const exact = full.times(new Frac(BigInt(worked))).div(new Frac(BigInt(dim)));
            const exactToTwo = (exact.n * 100n) % exact.d === 0n;
            if (worked === 0) expect(asFrac(got.days!).cmp(new Frac(0n))).toBe(0);
            else if (exactToTwo) expect(asFrac(got.days!).cmp(exact)).toBe(0);
            else expect(got.waiting).toMatch(/Not set/);
          }
        },
      ),
      { numRuns: 600 },
    );
  });

  it("zero days worked; rounding when set; days worked from the 1st or the date of joining", () => {
    for (const mode of ["NONE", "PRO_RATA_DAYS_WORKED"] as const) expect(leavingMonthTarget({ rule: { mode }, full: P(1), daysWorked: 0, daysInMonth: 30, rounding: null }).days!.toNumber()).toBe(0);
    expect(leavingMonthTarget({ rule: { mode: "FULL_IF_MIN_DAYS", minDays: 1 }, full: P(1), daysWorked: 0, daysInMonth: 30, rounding: null }).days!.toNumber()).toBe(0);
    expect(leavingMonthTarget({ rule: { mode: "FULL_MONTH" }, full: P(1), daysWorked: 0, daysInMonth: 30, rounding: null }).days!.toNumber()).toBe(1);
    expect(leavingMonthTarget({ rule: { mode: "PRO_RATA_DAYS_WORKED" }, full: P(1), daysWorked: 20, daysInMonth: 30, rounding: { mode: "HALF_UP", scale: 2 } }).days!.toString()).toBe("0.67");
    expect(leavingMonthTarget({ rule: { mode: "PRO_RATA_DAYS_WORKED" }, full: P(1), daysWorked: 20, daysInMonth: 30, rounding: { mode: "DOWN", scale: 1 } }).days!.toString()).toBe("0.6");
    expect(leavingMonthTarget({ rule: { mode: "PRO_RATA_DAYS_WORKED" }, full: P(1), daysWorked: 15, daysInMonth: 30, rounding: null }).days!.toString()).toBe("0.5");
    expect(daysWorkedInLeavingMonth(d("2020-01-01"), d("2026-09-15"))).toMatchObject({ daysWorked: 15, daysInMonth: 30 });
    expect(daysWorkedInLeavingMonth(d("2026-09-10"), d("2026-09-15"))).toMatchObject({ daysWorked: 6 });
    expect(daysWorkedInLeavingMonth(d("2026-09-20"), d("2026-09-15"))).toMatchObject({ daysWorked: 0 });
    expect(daysWorkedInLeavingMonth(d("2020-01-01"), d("2028-02-29"))).toMatchObject({ daysWorked: 29, daysInMonth: 29 });
  });
});

describe("D-37 item 5 — through the leaver recalculation", () => {
  let org: TestOrgMasters;
  type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let plId = "";
  let separationId = "";
  const sept = async () => Number((await prisma.leaveLedger.aggregate({ where: { employeeId: p.leaver!.employeeId, leaveTypeId: plId, OR: [{ accrualMonth: d("2026-09-01") }, { referenceType: "LEAVING_MONTH" }] }, _sum: { days: true } }))._sum.days ?? 0);
  const apply = async () => {
    const r = await request(app).post(`/api/workforce/leavers/${separationId}/apply`).set(...authHeader(tok.hr!));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.actions as Array<{ type: string; days: number; accrualMonth: string }>;
  };
  const setRule = async (value: object) => {
    const prop = await request(app).post("/api/behaviours/leave.leavingMonthAccrual/proposals").set(...authHeader(tok.d1!)).send({ value, reason: "made up for a test" });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    expect((await request(app).post(`/api/behaviours/proposals/${prop.body.id}/confirm`).set(...authHeader(tok.d2!))).status).toBe(200);
  };

  beforeAll(async () => {
    setBusinessTodayForTests(d("2026-11-15"));
    org = await createEmployeeTestOrgMasters();
    p.d1 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.d2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.leaver = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    plId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
    await prisma.leaveLedger.create({ data: { employeeId: p.leaver.employeeId, leaveTypeId: plId, leaveYear: 2026, entryDate: d("2026-09-01"), accrualMonth: d("2026-09-01"), entryType: "ACCRUAL", days: 1, referenceType: "ACCRUAL_JOB" } });
    // 15 of 30 days: pro-rata is exactly 0.5, so the default needs no rounding.
    separationId = (await prisma.separation.create({ data: { employeeId: p.leaver.employeeId, lastWorkingDate: d("2026-09-15"), reason: "test", initiatedByUserId: p.hr.userId } })).id;
  }, 180_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await deleteWithDependents("BehaviourProposal", (await prisma.behaviourProposal.findMany({ where: { proposedByUserId: p.d1!.userId } , select: { id: true } })).map((x) => x.id));
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("the default (pro-rata by days worked) brings September from 1 to 0.5 with a correction entry, never editing the accrual; applying again changes nothing", async () => {
    expect(await sept()).toBe(1);
    const actions = await apply();
    expect(actions.find((a) => a.accrualMonth === "2026-09-01")).toMatchObject({ type: "LEAVING_MONTH", days: -0.5 });
    expect(await sept()).toBe(0.5);
    expect((await apply()).filter((a) => a.accrualMonth === "2026-09-01")).toEqual([]);
    expect(await prisma.leaveLedger.count({ where: { employeeId: p.leaver!.employeeId, accrualMonth: d("2026-09-01"), entryType: "ACCRUAL", days: 1 } })).toBe(1);
  });

  it("each other option, confirmed by a different director, moves September to its own figure", async () => {
    await setRule({ mode: "NONE" });
    await apply();
    expect(await sept()).toBe(0);
    await setRule({ mode: "FULL_MONTH" });
    await apply();
    expect(await sept()).toBe(1);
    await setRule({ mode: "FULL_IF_MIN_DAYS", minDays: 20 }); // 15 days worked: under N
    await apply();
    expect(await sept()).toBe(0);
    await setRule({ mode: "FULL_IF_MIN_DAYS", minDays: 15 }); // exactly N
    await apply();
    expect(await sept()).toBe(1);
    const bad = await request(app).post("/api/behaviours/leave.leavingMonthAccrual/proposals").set(...authHeader(tok.d1!)).send({ value: { mode: "FULL_IF_MIN_DAYS" }, reason: "no N" });
    expect(bad.status).toBe(400); // N has no default
  });
});
