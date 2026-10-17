import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadCycleRules } from "../../../lib/attendanceCycle";
import { salaryHistory, setPayrollLockCheck } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { ZERO, dec, intDec, type Money } from "../money";
import { applyShare, computeArrears, lockedCyclesFrom, setArrearsBasisProvider, type ArrearsBasisProvider } from "../salary/arrears";
import { FIRST_SALARY_DAY, buildSalaryWorld, giveSalary, teardownSalaryWorld, type SalaryWorld } from "./salaryTestHelpers";

// Arrears on a back-dated revision. The payroll lock and the record of what each person was paid are the seams the calculation commit fills in; here
// they are faked, so the arithmetic and the rules around it are proved now.

const d = (s: string) => new Date(s);
const cycle = (label: string, start: string, end: string) => ({ label, start: d(start), end: d(end), startDay: 1 });
const JULY = cycle("Jul 2026", "2026-07-01", "2026-07-31");
const AUGUST = cycle("Aug 2026", "2026-08-01", "2026-08-31");
const rounding = { mode: "HALF_UP" as const, scale: 0 };

/** Pays every calendar day: paid = days in the part covered, basis = days in the cycle. */
const calendarProvider: ArrearsBasisProvider = {
  async paidShare(_e, c, from, to) {
    const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
    return { paid: intDec(days(from, to)), basis: intDec(days(c.start, c.end)) };
  },
};

afterEach(() => {
  setPayrollLockCheck(null);
  setArrearsBasisProvider(null);
});

describe("the arrears arithmetic", () => {
  const amounts = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, dec(v)] as [string, Money]));
  const base = { employeeId: "e", old: amounts({ BASIC: "40000", HRA: "20000" }), next: amounts({ BASIC: "44000", HRA: "22000" }), prorates: new Map([["BASIC", true], ["HRA", true]]), rounding, provider: calendarProvider };

  it("a date part-way through a cycle owes only the days from it, a full later cycle owes the whole difference", async () => {
    const r = await computeArrears({ ...base, effectiveFrom: d("2026-07-16"), lockedCycles: [JULY, AUGUST] });
    // July 16 to 31 is 16 of 31 days: 4000 x 16/31 = 2064.5 -> 2065; 2000 x 16/31 = 1032.3 -> 1032.
    expect(r.map((c) => [c.cycleLabel, c.total.toString(), c.lines.map((l) => `${l.component}:${l.amount}`).join(",")])).toEqual([
      ["Jul 2026", "3097", "BASIC:2065,HRA:1032"],
      ["Aug 2026", "6000", "BASIC:4000,HRA:2000"],
    ]);
  });

  it("a decrease is owed back, a line that does not pro-rate is all-or-nothing, and lines that cancel owe nothing", async () => {
    const down = await computeArrears({ ...base, effectiveFrom: d("2026-08-01"), old: base.next, next: base.old, lockedCycles: [AUGUST] });
    expect(down[0]!.total.toString()).toBe("-6000");
    const flat = new Map([["CONV", false]]);
    const nonProrating = await computeArrears({ ...base, effectiveFrom: d("2026-07-16"), old: amounts({ CONV: "1000" }), next: amounts({ CONV: "1600" }), prorates: flat, lockedCycles: [JULY] });
    expect(nonProrating[0]!.total.toString()).toBe("600"); // the whole 600, not 16/31 of it
    const cancel = await computeArrears({ ...base, effectiveFrom: d("2026-08-01"), old: amounts({ BASIC: "40000", HRA: "20000" }), next: amounts({ BASIC: "30000", HRA: "30000" }), lockedCycles: [AUGUST] });
    expect(cancel).toEqual([]); // -10000 and +10000
    const unchanged = await computeArrears({ ...base, effectiveFrom: d("2026-08-01"), next: base.old, lockedCycles: [AUGUST] });
    expect(unchanged).toEqual([]);
  });

  it("someone who was paid nothing in a cycle owes nothing for a line that pro-rates, and a line that does not is all-or-nothing on that", async () => {
    const unpaid: ArrearsBasisProvider = { paidShare: async () => ({ paid: ZERO, basis: intDec(31) }) };
    expect(await computeArrears({ ...base, effectiveFrom: d("2026-07-01"), lockedCycles: [JULY], provider: unpaid })).toEqual([]);
    expect(applyShare(dec("100"), false, { paid: ZERO, basis: intDec(31) }).toString()).toBe("0");
    expect(applyShare(dec("90"), true, { paid: intDec(10), basis: intDec(30) }).toString()).toBe("30");
    expect(() => applyShare(dec("1"), true, { paid: intDec(1), basis: ZERO })).toThrow(/zero/);
  });

  it("a finalised cycle with no record of the person refuses, naming the cycle: arrears are never guessed", async () => {
    const none: ArrearsBasisProvider = { paidShare: async () => null };
    await expect(computeArrears({ ...base, effectiveFrom: d("2026-07-16"), lockedCycles: [JULY], provider: none })).rejects.toMatchObject({ code: "ARREARS_BASIS_UNAVAILABLE", message: expect.stringMatching(/Jul 2026 is closed.*no finalised payroll run on record.*The revision itself is fine/s) });
  });

  it("finds the locked cycles between the effective date and today, and none for a date that is not in the past", async () => {
    setPayrollLockCheck(async (day) => (day <= d("2026-08-31") ? { locked: true } : { locked: false }));
    const rules = await loadCycleRules();
    expect((await lockedCyclesFrom(rules, d("2026-06-20"), d("2026-10-16"))).map((c) => c.label)).toEqual(["Jun 2026", "Jul 2026", "Aug 2026"]);
    expect((await lockedCyclesFrom(rules, d("2026-09-10"), d("2026-10-16"))).map((c) => c.label)).toEqual([]); // inside an open cycle: the next run uses it
    expect(await lockedCyclesFrom(rules, d("2026-11-01"), d("2026-10-16"))).toEqual([]); // the future
  });
});

describe("a back-dated revision, end to end", () => {
  let w: SalaryWorld;
  const api = (token: string) => ({
    get: (p: string) => request(app).get(`/api/payroll${p}`).set(...authHeader(token)),
    post: (p: string, b: object = {}) => request(app).post(`/api/payroll${p}`).set(...authHeader(token)).send(b),
  });
  beforeAll(async () => {
    w = await buildSalaryWorld();
    for (const e of w.staff) await giveSalary(w, e.employeeId, "1200000");
  });
  afterAll(async () => {
    await teardownSalaryWorld(w);
  });

  const raise = (employeeId: string, annual: string, effectiveFrom: string) => ({ selection: { kind: "EMPLOYEES", employeeIds: [employeeId] }, change: { ctc: { mode: "SET", annual } }, effectiveFrom, note: "back-dated raise" });
  const lockThroughAugust = () => setPayrollLockCheck(async (day) => (day <= d("2026-08-31") ? { locked: true, period: "to Aug 2026" } : { locked: false }));

  it("inside an open period there is no arrears: it is simply written, and the next run uses it", async () => {
    const e = w.staff[0]!;
    lockThroughAugust();
    setArrearsBasisProvider(calendarProvider);
    const input = raise(e.employeeId, "1260000", "2026-09-10");
    const p = await api(w.tokens.maker).post("/salary/revisions/preview", { input });
    expect(p.body.blockers).toEqual([]);
    expect(p.body.people[0].lockedCycles).toEqual([]);
    expect(p.body.people[0].arrears).toEqual([]);
    expect((await prisma.payrollAdjustment.count({ where: { employeeId: e.employeeId } }))).toBe(0);
  });

  it("without the record of what was paid, a revision that needs arrears is refused with the reason, never guessed", async () => {
    const e = w.staff[0]!;
    lockThroughAugust();
    const input = raise(e.employeeId, "1320000", "2026-07-16");
    const p = await api(w.tokens.maker).post("/salary/revisions/preview", { input });
    expect(p.body.canSubmit).toBe(false);
    expect(p.body.blockers.join(" ")).toMatch(/already closed \(Jul 2026, Aug 2026\).*Nothing is wrong with the revision itself.*waiting only because payroll runs have not been finalised/s);
    expect((await api(w.tokens.maker).post("/salary/revisions", { input, fingerprint: p.body.fingerprint })).body.error.code).toBe("REVISION_BLOCKED");
    expect((await salaryHistory(e.employeeId)).length).toBe(1);
  });

  it("is written with its true date inside the finalised period, pays the difference as pending arrears per cycle, and each arrears line can exist once", async () => {
    const e = w.staff[1]!;
    lockThroughAugust();
    setArrearsBasisProvider(calendarProvider);
    const input = raise(e.employeeId, "1320000", "2026-07-16");
    const p = await api(w.tokens.maker).post("/salary/revisions/preview", { input });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.blockers).toEqual([]);
    const person = p.body.people[0];
    expect(person.lockedCycles).toEqual(["Jul 2026", "Aug 2026"]);
    // 1,200,000 -> 1,320,000 is 10,000 a month: basic +4000, HRA +2000, special +4000. July from the 16th: 16/31 of each, rounded per line.
    expect(person.arrears.map((a: { cycle: string; total: string }) => [a.cycle, a.total])).toEqual([["Jul 2026", "5162"], ["Aug 2026", "10000"]]);
    expect(person.arrears[0].lines.map((l: { component: string; amount: string }) => [l.component, l.amount])).toEqual([[w.basic, "2065"], [w.hra, "1032"], [w.special, "2065"]]);

    const created = await api(w.tokens.maker).post("/salary/revisions", { input, fingerprint: p.body.fingerprint });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const seen = await api(w.tokens.checkerA).get(`/salary/revisions/${id}`);
    expect((await api(w.tokens.checkerA).post(`/salary/revisions/${id}/decision`, { decision: "APPROVE", note: "arrears checked", fingerprint: seen.body.fingerprint })).status).toBe(200);
    const applied = await api(w.tokens.maker).post(`/salary/revisions/${id}/apply`);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);

    // The salary timeline carries the true date; the closed months were not rewritten (no row before it changed), the money owed is separate.
    const history = await salaryHistory(e.employeeId);
    expect(history.map((r) => [r.effectiveFrom.toISOString().slice(0, 10), r.annualCtc.toString()])).toEqual([["2026-07-16", "1320000"], [FIRST_SALARY_DAY, "1200000"]]);
    const adjustments = await prisma.payrollAdjustment.findMany({ where: { employeeId: e.employeeId, source: "SALARY_ARREARS" }, orderBy: { periodStart: "asc" } });
    expect(adjustments.map((a) => [a.periodStart!.toISOString().slice(0, 10), a.periodEnd!.toISOString().slice(0, 10), a.direction, a.amount.toString(), a.status, a.componentCode])).toEqual([
      ["2026-07-01", "2026-07-31", "EARNING", "5162", "PENDING", "ARREARS"],
      ["2026-08-01", "2026-08-31", "EARNING", "10000", "PENDING", "ARREARS"],
    ]);
    expect(adjustments[0]!.sourceRef).toBe(`${id}:${e.employeeId}:2026-07-01`);
    expect(adjustments[0]!.breakdown).toEqual([{ component: w.basic, amount: "2065" }, { component: w.hra, amount: "1032" }, { component: w.special, amount: "2065" }]);
    // An applied revision reads back with its arrears exactly as they were made, not recomputed.
    const shown = (await api(w.tokens.maker).get(`/salary/revisions/${id}`)).body;
    expect(shown.status).toBe("APPLIED");
    expect(shown.plan.people[0].arrears.map((a: { cycle: string; total: string }) => [a.cycle, a.total])).toEqual([["Jul 2026", "5162"], ["Aug 2026", "10000"]]);
    expect(shown.plan.people[0].lockedCycles).toEqual(["Jul 2026", "Aug 2026"]);
    // The same arrears cannot be added twice.
    await expect(prisma.payrollAdjustment.create({ data: { employeeId: e.employeeId, componentCode: "ARREARS", direction: "EARNING", amount: "1", reason: "again", source: "SALARY_ARREARS", sourceRef: adjustments[0]!.sourceRef!, periodStart: d("2026-07-01"), periodEnd: d("2026-07-31"), breakdown: [], createdByUserId: w.maker.userId } })).rejects.toThrow(/Unique constraint/);
    // The audit row says there were arrears and how many cycles, not how much.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.salary.revised", entityId: history[0]!.id } });
    expect(audit.after).toMatchObject({ arrearsCycles: 2, amounts: "redacted" });
  });

  it("a decrease is owed back as a deduction", async () => {
    const e = w.staff[2]!;
    lockThroughAugust();
    setArrearsBasisProvider(calendarProvider);
    await giveSalary(w, e.employeeId, "1080000", "2026-08-01"); // 100000 -> 90000 a month from 1 August
    const rows = await prisma.payrollAdjustment.findMany({ where: { employeeId: e.employeeId, source: "SALARY_ARREARS" } });
    expect(rows.map((r) => [r.direction, r.amount.toString()])).toEqual([["DEDUCTION", "10000"]]);
  });

  it("the finalised cycle is not rewritten by an ordinary revision: without the bypass the lock still refuses", async () => {
    const e = w.staff[0]!;
    lockThroughAugust();
    const { writeSalaryChange } = await import("../../../lib/effectiveDating");
    await expect(
      prisma.$transaction((tx) =>
        writeSalaryChange(tx, e.employeeId, d("2026-08-10"), { reason: "REVISION", annualCtc: "1", monthlyCtc: "1", structureKey: "S", structureVersion: 1, structureHash: "h", roundingPin: {}, revisionId: null, note: "", lines: [] }, { createdByUserId: w.maker.userId }),
      ),
    ).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
  });
});
