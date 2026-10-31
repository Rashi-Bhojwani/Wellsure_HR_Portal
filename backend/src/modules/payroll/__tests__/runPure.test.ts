import { describe, expect, it } from "vitest";
import type { ComponentValue } from "../salary/schemas";
import { Frac } from "./rational";
import { computeDayFigures, segmentFactor } from "../run/days";
import { calculatePerson } from "../run/person";
import type { RunRules } from "../run/rules";
import { computeEsi, computeLwf, computePf, computePt, contributionPeriodStart, resolveState, roundByRule } from "../run/statutory";
import type { AdjustmentIn, CalcContext, PersonInput } from "../run/types";
import { dec, intDec } from "../money";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const AUG = { start: d("2026-08-01"), end: d("2026-08-31"), label: "Aug 2026" };

export function rulesFor(over: Partial<RunRules> = {}): RunRules {
  return {
    payDaysBasis: "CALENDAR_DAYS",
    lopDivisor: "SAME_AS_PAY_DAYS_BASIS",
    fixedDays: null,
    lineRounding: { mode: "HALF_UP", scale: 0 },
    pfRounding: { mode: "HALF_UP", scale: 0 },
    esiRounding: { mode: "UP", scale: 0 },
    netRounding: { mode: "NONE", scale: 0 },
    pf: { employeeRate: dec("12"), epsRate: dec("8.33"), epfErRate: dec("3.67"), edliRate: dec("0.5"), adminRate: dec("0.5"), ceiling: dec("15000"), ceilingMode: "CAP_AT_CEILING", eligibleTypes: ["PERMANENT"] },
    esi: { employeeRate: dec("0.75"), employerRate: dec("3.25"), ceiling: dec("21000"), periodRule: "MONTHLY", eligibleTypes: ["PERMANENT"] },
    arrearOnArrear: null,
    lopReversal: null,
    headRounding: {},
    negativeNet: "BLOCK",
    leaverTiming: "PAY_WITH_RUN",
    paymentDate: { monthOffset: 0, day: "LAST" },
    ptSlabs: null,
    lwfTable: null,
    ptStateOfPlacement: null,
    stateNameMap: null,
    arrearsPfEsi: null,
    encashPfApplicable: null,
    encashPayoutRule: null,
    ...over,
  };
}

const flags = (over: Partial<ComponentValue>): ComponentValue => ({ name: "x", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "x", payslipOrder: 1, ...over });
const COMPONENTS = new Map<string, ComponentValue>([
  ["BASIC@1", flags({ pfApplicable: true, esiApplicable: true, payslipLabel: "Basic", payslipOrder: 1 })],
  ["HRA@1", flags({ esiApplicable: true, payslipLabel: "HRA", payslipOrder: 2 })],
  ["CONV@1", flags({ prorates: false, payslipLabel: "Conveyance", payslipOrder: 3 })],
  ["SPECIAL@1", flags({ esiApplicable: true, payslipLabel: "Special", payslipOrder: 4 })],
  ["DED@1", flags({ type: "DEDUCTION", payslipLabel: "Recovery", payslipOrder: 5 })],
  ["BONUS@1", flags({ pfApplicable: true, payslipLabel: "Bonus", payslipOrder: 6 })],
]);
const ctxOf = (rules: RunRules, month = 8, cycle = AUG): CalcContext => ({ cycle, payrollMonth: month, rules, components: { byVersion: COMPONENTS, current: new Map([...COMPONENTS].map(([k, v]) => [k.split("@")[0]!, { version: 1, value: v }])) } });

/** A month's lines for a monthly CTC of 50,000 (Basic 20,000, HRA 10,000, Conveyance 1,600, Special 18,400) or the amounts given. */
const lines = (amounts: Record<string, string> = { BASIC: "20000", HRA: "10000", CONV: "1600", SPECIAL: "18400" }) => Object.entries(amounts).map(([component, amount], order) => ({ component, version: 1, type: (component === "DED" ? "DEDUCTION" : "EARNING") as "EARNING" | "DEDUCTION", amount: dec(amount), order }));

interface Over {
  from?: string;
  to?: string;
  lop?: Record<string, string>;
  segments?: Array<{ from: string; to: string; amounts: Record<string, string> }>;
  adjustments?: AdjustmentIn[];
  type?: PersonInput["employmentType"];
  lastWorkingDate?: string | null;
  bank?: boolean;
  placement?: PersonInput["placement"];
  statusDay?: string;
}

function person(o: Over = {}): PersonInput {
  const from = d(o.from ?? "2026-08-01");
  const to = d(o.to ?? "2026-08-31");
  const days = [];
  for (let t = from; t <= to; t = new Date(t.getTime() + 86_400_000)) days.push({ date: t, status: "P", lopDays: dec(o.lop?.[t.toISOString().slice(0, 10)] ?? "0") });
  const segs = o.segments ?? [{ from: o.from ?? "2026-08-01", to: o.to ?? "2026-08-31", amounts: { BASIC: "20000", HRA: "10000", CONV: "1600", SPECIAL: "18400" } }];
  return {
    employeeId: "e1",
    employeeCode: "E1",
    employmentType: o.type ?? "PERMANENT",
    dateOfJoining: d("2024-01-01"),
    lastWorkingDate: o.lastWorkingDate === undefined ? null : o.lastWorkingDate === null ? null : d(o.lastWorkingDate),
    span: { from, to },
    days,
    missingDays: [],
    segments: segs.map((s, i) => ({ from: d(s.from), to: d(s.to), salaryId: `s${i}`, structureKey: "STD", structureVersion: 1, structureHash: "h", roundingPin: null, lines: lines(s.amounts) })),
    salaryGapDays: [],
    placement: o.placement === undefined ? { locationId: "l", locationState: "Test State", departmentId: "d", gradeId: null, costCentreId: null } : o.placement,
    placementDay: to,
    hasBankAccount: o.bank ?? true,
    adjustments: o.adjustments ?? [],
    esiPeriodStartEntitlement: null,
  };
}

const amountsOf = (r: ReturnType<typeof calculatePerson>) => Object.fromEntries(r.lines.map((l) => [l.code, l.amount.toString()]));

describe("days and shares", () => {
  const fig = (o: { from?: string; to?: string; lop?: Record<string, string>; basis?: "CALENDAR_DAYS" | "FIXED_DAYS" | "WORKING_DAYS"; lopDivisor?: "SAME_AS_PAY_DAYS_BASIS" | "CALENDAR_DAYS" | "FIXED_DAYS" | "WORKING_DAYS"; fixed?: number | null; status?: Record<string, string> } = {}) => {
    const p = person({ ...(o.from ? { from: o.from } : {}), ...(o.to ? { to: o.to } : {}), ...(o.lop ? { lop: o.lop } : {}) });
    const days = p.days.map((x) => ({ ...x, status: o.status?.[x.date.toISOString().slice(0, 10)] ?? x.status }));
    return computeDayFigures({ cycle: AUG, span: p.span, days, basis: o.basis ?? "CALENDAR_DAYS", lopDivisor: o.lopDivisor ?? "SAME_AS_PAY_DAYS_BASIS", fixedDays: o.fixed ?? null });
  };

  it("a full month with no loss of pay is paid in full", () => {
    const f = fig();
    expect([f.cycleDays, f.employedDays, f.notEmployedDays, f.factor.toString(), f.paidDays.toString()]).toEqual([31, 31, 0, "1", "31"]);
  });
  it("a joiner on the 11th is paid for the 21 days they were here; a leaver on the 20th for 20", () => {
    expect(fig({ from: "2026-08-11" }).employedShare.times(31).toFixed(6)).toBe("21.000000");
    expect(fig({ to: "2026-08-20" }).employedShare.times(31).toFixed(6)).toBe("20.000000");
  });
  it("loss of pay comes off the employed share, by the divisor the company chose", () => {
    const f = fig({ lop: { "2026-08-10": "1", "2026-08-11": "0.5" } });
    expect(f.lopDays.toString()).toBe("1.5");
    expect(f.factor.times(31).toFixed(6)).toBe("29.500000");
    // A fixed 30-day divisor makes a day of LOP cost a thirtieth, on a calendar basis.
    const g = fig({ lop: { "2026-08-10": "1" }, lopDivisor: "FIXED_DAYS", fixed: 30 });
    expect(g.factor.toFixed(10)).toBe(dec("1").minus(dec("1").dividedBy(30)).toFixed(10));
  });
  it("a fixed 30-day basis pays a full month in full whatever the month's length, and a joiner for 30 less the days missed", () => {
    expect(fig({ basis: "FIXED_DAYS", fixed: 30 }).factor.toString()).toBe("1");
    const joiner = fig({ basis: "FIXED_DAYS", fixed: 30, from: "2026-08-11" });
    expect(joiner.paidDays.toFixed(6)).toBe("20.000000"); // 30 less the 10 days not employed
  });
  it("a working-days basis counts the days that are not holidays or week offs, for someone here the whole month", () => {
    const f = fig({ basis: "WORKING_DAYS", status: { "2026-08-02": "O", "2026-08-09": "O", "2026-08-15": "H" } });
    expect(f.basisDays.toString()).toBe("28");
    expect(f.hold).toBeNull();
  });
  it("a working-days basis for part of a month cannot be worked out, and says so instead of guessing", () => {
    const f = fig({ basis: "WORKING_DAYS", from: "2026-08-11" });
    expect(f.hold?.reason).toBe("WORKING_DAYS_PART_MONTH");
    expect(f.factor.toString()).toBe("0");
  });
  it("loss of pay never makes the factor negative, and more LOP than days is flagged", () => {
    const f = fig({ from: "2026-08-30", lop: { "2026-08-30": "1", "2026-08-31": "1" } });
    expect(f.factor.isNegative()).toBe(false);
    const g = fig({ from: "2026-08-30", lop: { "2026-08-30": "1", "2026-08-31": "1.5" } });
    expect(g.lopExceedsDays).toBe(true);
    expect(g.factor.isNegative()).toBe(false); // more loss of pay than days is flagged, and pays nothing: it never pays a negative share
    expect(g.factorNum.isNegative()).toBe(false);
  });
  it("the segments of a revision on the 16th add up to the person's factor", () => {
    const p = person({ lop: { "2026-08-10": "1", "2026-08-20": "2" } });
    const f = computeDayFigures({ cycle: AUG, span: p.span, days: p.days, basis: "CALENDAR_DAYS", lopDivisor: "SAME_AS_PAY_DAYS_BASIS", fixedDays: null });
    const a = segmentFactor(f, { from: d("2026-08-01"), to: d("2026-08-15") }, p.days);
    const b = segmentFactor(f, { from: d("2026-08-16"), to: d("2026-08-31") }, p.days);
    expect([a.days, b.days]).toEqual([15, 16]);
    expect(a.factor.plus(b.factor).toFixed(20)).toBe(f.factor.toFixed(20));
    expect(a.lop.toString()).toBe("1");
    expect(b.lop.toString()).toBe("2");
  });
});

describe("statutory arithmetic", () => {
  const rules = rulesFor();
  it("PF: below, at and above the ceiling, and on the actual wage when the company says so", () => {
    expect(computePf(dec("14000"), rules).employee.toString()).toBe("1680");
    expect(computePf(dec("15000"), rules).employee.toString()).toBe("1800");
    expect(computePf(dec("30000"), rules).employee.toString()).toBe("1800"); // capped at 15,000
    const actual = rulesFor({ pf: { ...rules.pf, ceilingMode: "ACTUAL_WAGE" } });
    expect(computePf(dec("30000"), actual).employee.toString()).toBe("3600");
    const split = computePf(dec("15000"), rules);
    expect([split.eps, split.epfEr, split.edli, split.admin].map(String)).toEqual(["1250", "551", "75", "75"]); // 1249.5 and 550.5 round half up
  });
  it("PF on a negative or zero wage is nothing", () => {
    expect(computePf(dec("-50"), rules).employee.toString()).toBe("0");
  });
  it("ESI contributions round up to the rupee", () => {
    const e = computeEsi(dec("18400"), rules);
    expect([e.employee.toString(), e.employer.toString()]).toEqual(["138", "598"]);
    const odd = computeEsi(dec("18401"), rules);
    expect([odd.employee.toString(), odd.employer.toString()]).toEqual(["139", "599"]); // 138.0075 and 598.0325 round up
  });
  it("a rounding rule that says not to round is honoured only while the figure fits the stored precision", () => {
    expect(roundByRule(dec("12.5"), { mode: "NONE", scale: 0 }, "x").toString()).toBe("12.5");
    expect(() => roundByRule(dec("1").dividedBy(3), { mode: "NONE", scale: 0 }, "Net pay")).toThrow(/does not round|not to round/i);
  });
  it("PT: the slab edges are from-inclusive, to-exclusive, and a month override replaces only its own slab", () => {
    const table = { states: { KA: { slabs: [{ fromGross: "0", toGross: "15000", monthlyAmount: "0" }, { fromGross: "15000", toGross: null, monthlyAmount: "200", monthOverrides: { "2": "300" } }] } } };
    expect(computePt(table, "KA", dec("14999.99"), 8)!.amount.toString()).toBe("0");
    expect(computePt(table, "KA", dec("15000"), 8)!.amount.toString()).toBe("200");
    expect(computePt(table, "KA", dec("90000"), 2)!.amount.toString()).toBe("300");
    expect(computePt(table, "KA", dec("90000"), 2)!.overridden).toBe(true);
    expect(computePt(table, "KA", dec("10000"), 2)!.amount.toString()).toBe("0"); // February's exception is on the top slab only
    expect(computePt(table, "ZZ", dec("90000"), 8)).toBeNull();
  });
  it("LWF: the amounts in the listed months and nothing in the others", () => {
    const table = { states: { KA: { employee: "10", employer: "20", frequency: "HALF_YEARLY" as const, months: [6, 12] } } };
    expect(computeLwf(table, "KA", 6)!.employee.toString()).toBe("10");
    expect(computeLwf(table, "KA", 8)!.employer.toString()).toBe("0");
    expect(computeLwf(table, "ZZ", 6)).toBeNull();
  });
  it("the ESI contribution period runs April to September and October to March", () => {
    expect(contributionPeriodStart(2026, 8)).toEqual({ year: 2026, month: 4 });
    expect(contributionPeriodStart(2026, 10)).toEqual({ year: 2026, month: 10 });
    expect(contributionPeriodStart(2026, 12)).toEqual({ year: 2026, month: 10 });
    expect(contributionPeriodStart(2026, 2)).toEqual({ year: 2025, month: 10 });
    expect(contributionPeriodStart(2026, 4)).toEqual({ year: 2026, month: 4 });
  });
  it("a state name matches whatever its case or spacing", () => {
    expect(resolveState("  tamilnadu ", { Tamilnadu: "TAMIL_NADU" })).toBe("TAMIL_NADU");
    expect(resolveState("Goa", { Tamilnadu: "TAMIL_NADU" })).toBeNull();
  });
});

describe("one person's month, hand worked", () => {
  const ctx = ctxOf(rulesFor());

  it("a full month at 50,000: lines, PF and net", () => {
    const r = calculatePerson(person(), ctx);
    expect(amountsOf(r)).toMatchObject({ BASIC: "20000", HRA: "10000", CONV: "1600", SPECIAL: "18400", PF_EMPLOYEE: "1800", PF_EPS: "1250", PF_EPF_ER: "551", PF_EDLI: "75", PF_ADMIN: "75" });
    expect([r.status, r.gross.toString(), r.deductions.toString(), r.netPay.toString(), r.employerContributions.toString()]).toEqual(["PAYABLE", "50000", "1800", "48200", "1951"]);
  });

  it("three days of loss of pay: 28/31 of every line that pro-rates, the conveyance in full", () => {
    const r = calculatePerson(person({ lop: { "2026-08-10": "1", "2026-08-11": "1", "2026-08-12": "1" } }), ctx);
    // 20000x28/31 = 18064.52 -> 18065; 10000x28/31 = 9032.26 -> 9032; 18400x28/31 = 16619.35 -> 16619; conveyance does not pro-rate.
    expect(amountsOf(r)).toMatchObject({ BASIC: "18065", HRA: "9032", CONV: "1600", SPECIAL: "16619", PF_EMPLOYEE: "1800" });
    expect([r.gross.toString(), r.netPay.toString()]).toEqual(["45316", "43516"]);
  });

  it("a joiner on the 11th: 21/31, PF under the ceiling", () => {
    const r = calculatePerson(person({ from: "2026-08-11" }), ctx);
    expect(amountsOf(r)).toMatchObject({ BASIC: "13548", HRA: "6774", CONV: "1600", SPECIAL: "12465", PF_EMPLOYEE: "1626" });
    expect([r.gross.toString(), r.netPay.toString()]).toEqual(["34387", "32761"]);
  });

  it("a leaver on the 20th: 20/31", () => {
    const r = calculatePerson(person({ to: "2026-08-20", lastWorkingDate: "2026-08-20" }), ctx);
    expect(amountsOf(r)).toMatchObject({ BASIC: "12903", HRA: "6452", CONV: "1600", SPECIAL: "11871", PF_EMPLOYEE: "1548" });
    expect([r.gross.toString(), r.netPay.toString()]).toEqual(["32826", "31278"]);
  });

  it("a revision on the 16th is summed over two segments and rounded once", () => {
    const r = calculatePerson(
      person({
        segments: [
          { from: "2026-08-01", to: "2026-08-15", amounts: { BASIC: "20000", HRA: "10000", CONV: "1600", SPECIAL: "18400" } },
          { from: "2026-08-16", to: "2026-08-31", amounts: { BASIC: "24000", HRA: "12000", CONV: "1600", SPECIAL: "22400" } },
        ],
      }),
      ctx,
    );
    // (20000x15 + 24000x16)/31 = 22064.52; (10000x15 + 12000x16)/31 = 11032.26; (18400x15 + 22400x16)/31 = 20464.52; conveyance from the later segment.
    expect(amountsOf(r)).toMatchObject({ BASIC: "22065", HRA: "11032", CONV: "1600", SPECIAL: "20465", PF_EMPLOYEE: "1800" });
    expect([r.gross.toString(), r.netPay.toString()]).toEqual(["55162", "53362"]);
    const basic = r.lines.find((l) => l.code === "BASIC")!;
    expect((basic.basis as { parts: unknown[] }).parts).toHaveLength(2); // the explanation shows both segments
  });

  it("ESI: covered below the ceiling on the full-month entitlement, with PF below its ceiling too", () => {
    const r = calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "8000", HRA: "4000", CONV: "1600", SPECIAL: "6400" } }] }), ctx);
    expect(amountsOf(r)).toMatchObject({ PF_EMPLOYEE: "960", ESI_EMPLOYEE: "138", ESI_EMPLOYER: "598", PF_EPS: "666", PF_EPF_ER: "294", PF_EDLI: "40", PF_ADMIN: "40" });
    expect([r.gross.toString(), r.deductions.toString(), r.netPay.toString(), r.employerContributions.toString()]).toEqual(["20000", "1098", "18902", "1638"]);
  });

  it("ESI: exactly at the ceiling is covered, a rupee over is not, and loss of pay does not change who is covered", () => {
    const at = calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "21000" } }] }), ctx);
    expect(amountsOf(at).ESI_EMPLOYEE).toBe("158"); // 157.5 rounds up
    const over = calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "21001" } }] }), ctx);
    expect(amountsOf(over).ESI_EMPLOYEE).toBeUndefined();
    const lop = calculatePerson(person({ lop: { "2026-08-10": "10" }, segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "30000" } }] }), ctx);
    expect(amountsOf(lop).ESI_EMPLOYEE).toBeUndefined(); // earned 20,323 is under the ceiling, but the entitlement of 30,000 is not
  });

  it("PF and ESI apply only to the employment types the company named", () => {
    const r = calculatePerson(person({ type: "CONTRACT" }), ctx);
    expect(amountsOf(r).PF_EMPLOYEE).toBeUndefined();
    expect(r.notices.join(" ")).toMatch(/Provident fund does not apply/);
    expect(r.netPay.toString()).toBe("50000");
  });

  it("professional tax by the state of the branch, at the slab edges", () => {
    const rules = rulesFor({
      ptSlabs: { states: { TEST_STATE: { slabs: [{ fromGross: "0", toGross: "15000", monthlyAmount: "0" }, { fromGross: "15000", toGross: null, monthlyAmount: "200", monthOverrides: { "2": "300" } }] } } },
      ptStateOfPlacement: "LAST_DAY_OF_PERIOD",
      stateNameMap: { "Test State": "TEST_STATE" },
    });
    expect(amountsOf(calculatePerson(person(), ctxOf(rules))).PT).toBe("200");
    expect(amountsOf(calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "14999" } }] }), ctxOf(rules))).PT).toBeUndefined();
    expect(amountsOf(calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "15000" } }] }), ctxOf(rules))).PT).toBe("200");
    const feb = { start: d("2026-02-01"), end: d("2026-02-28"), label: "Feb 2026" };
    const febPerson = { ...person({ from: "2026-02-01", to: "2026-02-28", segments: [{ from: "2026-02-01", to: "2026-02-28", amounts: { BASIC: "50000" } }] }) };
    expect(amountsOf(calculatePerson(febPerson, ctxOf(rules, 2, feb))).PT).toBe("300");
  });

  it("a branch whose state is not in the map is a blocking exception, never a guess", () => {
    const rules = rulesFor({ ptSlabs: { states: { X: { slabs: [{ fromGross: "0", toGross: null, monthlyAmount: "1" }] } } }, ptStateOfPlacement: "LAST_DAY_OF_PERIOD", stateNameMap: { Goa: "GOA" } });
    const r = calculatePerson(person(), ctxOf(rules));
    expect(r.exceptions.map((x) => [x.code, x.severity])).toEqual([["STATE_UNMAPPED", "BLOCKING"]]);
    expect(amountsOf(r).PT).toBeUndefined();
  });

  it("a mapped state the PT table does not list is charged nothing, with a notice", () => {
    const rules = rulesFor({ ptSlabs: { states: { OTHER: { slabs: [{ fromGross: "0", toGross: null, monthlyAmount: "1" }] } } }, ptStateOfPlacement: "LAST_DAY_OF_PERIOD", stateNameMap: { "Test State": "TEST_STATE" } });
    const r = calculatePerson(person(), ctxOf(rules));
    expect(r.exceptions).toEqual([]);
    expect(r.notices.join(" ")).toMatch(/nothing for TEST_STATE/);
  });

  it("labour welfare fund in its months, employee deducted and employer shown", () => {
    const rules = rulesFor({ lwfTable: { states: { TEST_STATE: { employee: "10", employer: "20", frequency: "HALF_YEARLY", months: [6, 12] } } }, stateNameMap: { "Test State": "TEST_STATE" } });
    const june = { start: d("2026-06-01"), end: d("2026-06-30"), label: "Jun 2026" };
    const r = calculatePerson(person({ from: "2026-06-01", to: "2026-06-30", segments: [{ from: "2026-06-01", to: "2026-06-30", amounts: { BASIC: "20000" } }] }), ctxOf(rules, 6, june));
    expect(amountsOf(r)).toMatchObject({ LWF_EMPLOYEE: "10", LWF_EMPLOYER: "20" });
    expect(amountsOf(calculatePerson(person(), ctxOf(rules))).LWF_EMPLOYEE).toBeUndefined(); // August
  });

  it("net pay is rounded as the rule says, with the difference as a line of its own", () => {
    const rules = rulesFor({ netRounding: { mode: "HALF_UP", scale: 0 }, lineRounding: { mode: "HALF_UP", scale: 2 } });
    const p = person({ lop: { "2026-08-10": "1" }, segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "20000" } }] });
    const r = calculatePerson(p, ctxOf(rules));
    // 20000 x 30/31 = 19354.84; PF 12% of 15000 = 1800; ESI 0.75% of 19354.84 = 145.16 rounds up to 146 -> 17408.84, rounded to 17409 with +0.16 as rounding.
    expect([r.netBeforeRounding.toString(), r.netPay.toString(), r.roundingAdjustment.toString()]).toEqual(["17408.84", "17409", "0.16"]);
    expect(r.lines.at(-1)).toMatchObject({ code: "NET_ROUNDING", kind: "ROUNDING" });
    expect(r.lines.at(-1)!.amount.toString()).toBe("0.16");
  });

  it("deductions above earnings: blocked under BLOCK (an exception), held under HOLD_PAYMENT", () => {
    const amounts = { BASIC: "1000", DED: "4000" };
    const seg = [{ from: "2026-08-01", to: "2026-08-31", amounts }];
    const block = calculatePerson(person({ segments: seg }), ctxOf(rulesFor({ negativeNet: "BLOCK" })));
    expect(block.netPay.isNegative()).toBe(true);
    expect(block.status).toBe("PAYABLE");
    expect(block.exceptions.map((x) => [x.code, x.severity])).toEqual([["NEGATIVE_NET", "BLOCKING"]]);
    const hold = calculatePerson(person({ segments: seg }), ctxOf(rulesFor({ negativeNet: "HOLD_PAYMENT" })));
    expect([hold.status, hold.holdReason]).toEqual(["HELD", "NEGATIVE_NET"]);
  });

  it("holds: a leaver kept for final settlement, nil net, no bank account", () => {
    const leaver = calculatePerson(person({ to: "2026-08-20", lastWorkingDate: "2026-08-20" }), ctxOf(rulesFor({ leaverTiming: "HOLD_FOR_FNF" })));
    expect([leaver.status, leaver.holdReason]).toEqual(["HELD", "FINAL_SETTLEMENT"]);
    const nil = calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "0" } }] }), ctx);
    expect([nil.status, nil.holdReason]).toEqual(["HELD", "ZERO_NET"]);
    const noBank = calculatePerson(person({ bank: false }), ctx);
    expect([noBank.status, noBank.holdReason]).toEqual(["HELD", "NO_BANK_ACCOUNT"]);
    expect(noBank.netPay.toString()).toBe("48200"); // still calculated
  });

  it("not paid zero silently: a day without a locked attendance row, or without a salary, leaves the person out and says why", () => {
    const base = person();
    const unlocked = calculatePerson({ ...base, missingDays: ["2026-08-05", "2026-08-06"] }, ctx);
    expect([unlocked.status, unlocked.holdReason, unlocked.lines.length]).toEqual(["EXCLUDED", "ATTENDANCE_NOT_FINAL", 0]);
    expect(unlocked.holdDetail).toMatch(/2 of their days/);
    const nosal = calculatePerson({ ...base, salaryGapDays: ["2026-08-01"], segments: [] }, ctx);
    expect([nosal.status, nosal.holdReason]).toEqual(["EXCLUDED", "NO_SALARY"]);
  });

  it("adjustments, arrears and encashment are lines of their own; PF follows the component's flag, arrears the rule, encashment its rule", () => {
    const rules = rulesFor({ arrearsPfEsi: "FOLLOW_COMPONENT_FLAGS", encashPfApplicable: true });
    const adjustments: AdjustmentIn[] = [
      { id: "a1", source: "MANUAL", sourceRef: null, componentCode: "BONUS", direction: "EARNING", amount: dec("5000"), reason: "bonus" },
      { id: "a2", source: "MANUAL", sourceRef: null, componentCode: "DED", direction: "DEDUCTION", amount: dec("700"), reason: "recovery" },
      { id: "a3", source: "SALARY_ARREARS", sourceRef: "rev:e1:2026-07-01", componentCode: "ARREARS", direction: "EARNING", amount: dec("3000"), reason: "arrears", periodLabel: "Jul 2026", breakdown: [{ component: "BASIC", amount: dec("2000") }, { component: "HRA", amount: dec("1000") }] },
      { id: null, source: "YEAR_END_ENCASHMENT", sourceRef: "item1", componentCode: "LEAVE_ENCASHMENT", direction: "EARNING", amount: dec("9000"), reason: "year end" },
    ];
    // PF wages: BASIC 20000 + bonus 5000 + arrears BASIC part 2000 + encashment 9000 = 36000, capped at 15000 -> 1800.
    const base = calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "2000" } }], adjustments }), ctxOf(rules));
    // BASIC 2000 + bonus 5000 + arrears 2000 + encashment 9000 = 18000, capped at 15000.
    expect(base.lines.find((l) => l.code === "PF_EMPLOYEE")!.amount.toString()).toBe("1800");
    expect(base.lines.filter((l) => ["ADJUSTMENT", "ARREARS", "ENCASHMENT"].includes(l.source)).map((l) => [l.code, l.source, l.sourceRef, l.amount.toString()])).toEqual([
      ["BONUS", "ADJUSTMENT", "a1", "5000"],
      ["ARREARS", "ARREARS", "a3", "3000"],
      ["LEAVE_ENCASHMENT", "ENCASHMENT", "item1", "9000"],
      ["DED", "ADJUSTMENT", "a2", "700"],
    ]);
    expect(base.gross.toString()).toBe("19000".replace("19000", "19000")); // 2000 + 5000 + 3000 + 9000
    const excluded = calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "2000" } }], adjustments }), ctxOf(rulesFor({ arrearsPfEsi: "EXCLUDE", encashPfApplicable: false })));
    // BASIC 2000 + bonus 5000 only = 7000 -> 840.
    expect(excluded.lines.find((l) => l.code === "PF_EMPLOYEE")!.amount.toString()).toBe("840");
  });

  it("is a pure function: the same inputs give the same hash, and one changed paisa gives another", () => {
    const a = calculatePerson(person(), ctx);
    expect(calculatePerson(person(), ctx).itemHash).toBe(a.itemHash);
    const moved = calculatePerson(person({ segments: [{ from: "2026-08-01", to: "2026-08-31", amounts: { BASIC: "20000.01", HRA: "10000", CONV: "1600", SPECIAL: "18400" } }] }), ctxOf(rulesFor({ lineRounding: { mode: "HALF_UP", scale: 2 } })));
    expect(moved.itemHash).not.toBe(calculatePerson(person(), ctxOf(rulesFor({ lineRounding: { mode: "HALF_UP", scale: 2 } }))).itemHash);
  });
});

describe("the arithmetic against an independent model", () => {
  // The shadow calculation: the same specification, written again in exact rational arithmetic on BigInt, with none of the code's decimal handling.
  function shadow(monthly: Record<string, string>, employedDays: number, lopDays: number) {
    const cycleDays = 31;
    const share = Frac.of(cycleDays - (cycleDays - employedDays)).div(Frac.of(cycleDays)).minus(Frac.of(lopDays).div(Frac.of(cycleDays)));
    const factor = share.cmp(Frac.of(0)) < 0 ? Frac.of(0) : share;
    const out: Record<string, Frac> = {};
    for (const [code, amount] of Object.entries(monthly)) out[code] = code === "CONV" ? (factor.cmp(Frac.of(0)) > 0 ? Frac.of(amount) : Frac.of(0)) : Frac.of(amount).times(factor).roundHalfUp(0);
    const pfWages = out.BASIC!.min(Frac.of(15000));
    const pf = pfWages.times(Frac.of(12)).div(Frac.of(100)).roundHalfUp(0);
    const gross = Object.values(out).reduce((a, b) => a.plus(b), Frac.of(0));
    // ESI: covered when the full-month entitlement (Basic + HRA + Special, not the conveyance) is within 21,000; the contribution is on what was earned, rounded up.
    const entitlement = Frac.of(monthly.BASIC!).plus(Frac.of(monthly.HRA!)).plus(Frac.of(monthly.SPECIAL!));
    const earned = out.BASIC!.plus(out.HRA!).plus(out.SPECIAL!);
    const esi = entitlement.cmp(Frac.of(21000)) <= 0 ? earned.times(Frac.of("0.75")).div(Frac.of(100)).ceil(0) : Frac.of(0);
    return { out, pf, esi, gross, net: gross.minus(pf).minus(esi) };
  }

  it("agrees to the paisa across 300 random months: joiners, leavers, loss of pay, any CTC", () => {
    let seed = 12345;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const ctx = ctxOf(rulesFor());
    for (let i = 0; i < 300; i += 1) {
      const basic = 5000 + next(60000);
      const hra = next(30000);
      const special = next(40000);
      const conv = next(3000);
      const employed = 5 + next(27); // 5..31 days
      const startOffset = 31 - employed;
      const from = `2026-08-${String(1 + startOffset).padStart(2, "0")}`;
      const lopDays = next(Math.min(employed, 6) + 1);
      const lop: Record<string, string> = {};
      for (let k = 0; k < lopDays; k += 1) lop[`2026-08-${String(1 + startOffset + k).padStart(2, "0")}`] = "1";
      const monthly = { BASIC: String(basic), HRA: String(hra), CONV: String(conv), SPECIAL: String(special) };
      const r = calculatePerson(person({ from, lop, segments: [{ from, to: "2026-08-31", amounts: monthly }] }), ctx);
      const s = shadow(monthly, employed, lopDays);
      expect({ gross: r.gross.toString(), pf: r.lines.find((l) => l.code === "PF_EMPLOYEE")?.amount.toString() ?? "0", esi: r.lines.find((l) => l.code === "ESI_EMPLOYEE")?.amount.toString() ?? "0", net: r.netPay.toString() }).toEqual({ gross: s.gross.toString(), pf: s.pf.toString(), esi: s.esi.toString(), net: s.net.toString() });
      // And the lines always add up to the totals.
      const earn = r.lines.filter((l) => l.kind === "EARNING").reduce((a, l) => a.plus(l.amount), dec("0"));
      const ded = r.lines.filter((l) => l.kind === "DEDUCTION").reduce((a, l) => a.plus(l.amount), dec("0"));
      expect([earn.toString(), ded.toString(), earn.minus(ded).toString()]).toEqual([r.gross.toString(), r.deductions.toString(), r.netPay.toString()]);
    }
  });
});

void intDec;

describe("a person who lost every day", () => {
  it("is paid nothing, not even a line that does not pro-rate", () => {
    const lop: Record<string, string> = {};
    for (let n = 27; n <= 31; n += 1) lop[`2026-08-${n}`] = "1";
    const r = calculatePerson(person({ from: "2026-08-27", lop, segments: [{ from: "2026-08-27", to: "2026-08-31", amounts: { BASIC: "20000", CONV: "1600" } }] }), ctxOf(rulesFor()));
    expect(amountsOf(r)).toMatchObject({ BASIC: "0", CONV: "0" });
    expect([r.gross.toString(), r.status, r.holdReason]).toEqual(["0", "HELD", "ZERO_NET"]);
  });
});

describe("per-head rounding", () => {
  const lop = { "2026-08-31": "1" }; // one day of loss of pay in a 31-day month: Basic 20,000 x 30/31 = 19,354.83...
  const calc = (headRounding: RunRules["headRounding"]) => amountsOf(calculatePerson(person({ lop }), ctxOf(rulesFor({ headRounding }))));

  it("a head not listed uses the general rule; a head listed uses its own", () => {
    const general = calc({});
    expect(general.BASIC).toBe("19355"); // half up
    const own = calc({ BASIC: { mode: "DOWN", scale: 0 } });
    expect(own.BASIC).toBe("19354");
    expect(own.HRA).toBe(general.HRA); // untouched
  });

  it("the place is the head's own as well", () => {
    expect(calc({ BASIC: { mode: "HALF_UP", scale: 2 } }).BASIC).toBe("19354.84");
  });
});
