import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addCalendarDays } from "../../../lib/businessDate";
import { cycleForRules } from "../../../lib/attendanceCycle";
import { dec, intDec, ROUNDING_MODES, type Money, type RoundingMode } from "../money";
import { resolveRule, type OverrideItem } from "../rules/overrides";
import { computeArrears, type ArrearsBasisProvider } from "../salary/arrears";
import { computeBreakup, type RoundingRule } from "../salary/breakup";
import { reversalAmounts, monthsBack } from "../salary/lopReversal";
import type { ComponentValue, StructureValue } from "../salary/schemas";
import { Frac } from "./rational";

// Stage 3.5: property tests against an independent reference model in exact fractions (BigInt), over random salary structures, proration, every rounding mode,
// arrears and loss-of-pay reversals, and the rule hierarchy; and boundary tests at month ends, leap day and financial-year start. The reference model shares no
// code with the payroll arithmetic, so agreement to the paisa means the formulas are right, not merely repeatable.

// ── The reference model ──
const ZERO_F = Frac.of(0);

/** Round a fraction to `scale` places by a named mode. Written from the definitions of the modes, not from the library the code uses. */
function refRound(x: Frac, scale: number, mode: RoundingMode): Frac {
  const f = 10n ** BigInt(scale);
  const s = x.times(new Frac(f));
  const neg = s.n < 0n;
  const absN = neg ? -s.n : s.n;
  const q = absN / s.d; // floor of the magnitude
  const r = absN % s.d;
  const exact = r === 0n;
  const twice = r * 2n;
  let mag: bigint; // magnitude after rounding
  switch (mode) {
    case "DOWN": // towards zero
      mag = q;
      break;
    case "UP": // away from zero
      mag = exact ? q : q + 1n;
      break;
    case "CEIL": // towards +infinity
      mag = neg ? q : exact ? q : q + 1n;
      break;
    case "FLOOR": // towards -infinity
      mag = neg ? (exact ? q : q + 1n) : q;
      break;
    case "HALF_UP": // ties away from zero
      mag = twice >= s.d ? q + 1n : q;
      break;
    case "HALF_EVEN": // ties to the even neighbour
      mag = twice > s.d ? q + 1n : twice < s.d ? q : q % 2n === 0n ? q : q + 1n;
      break;
  }
  return new Frac(neg ? -mag : mag, f);
}

const frac = (m: Money): Frac => Frac.of(m.toString());
const money = (f: Frac): string => f.toString();
const modes = fc.constantFrom(...ROUNDING_MODES);

describe("the reference model agrees with the definition of each mode", () => {
  it("rounds known ties and negatives as defined", () => {
    const t = (s: string, scale: number, mode: RoundingMode) => money(refRound(Frac.of(s), scale, mode));
    expect([t("2.5", 0, "HALF_UP"), t("2.5", 0, "HALF_EVEN"), t("3.5", 0, "HALF_EVEN"), t("-2.5", 0, "HALF_UP"), t("2.1", 0, "UP"), t("-2.1", 0, "UP"), t("2.9", 0, "DOWN"), t("-2.9", 0, "DOWN"), t("2.1", 0, "CEIL"), t("-2.1", 0, "CEIL"), t("2.1", 0, "FLOOR"), t("-2.1", 0, "FLOOR")]).toEqual(["3", "2", "4", "-3", "3", "-3", "2", "-2", "3", "-2", "2", "-3"]);
  });
});

// ── Loss-of-pay reversal ──
describe("loss-of-pay reversal against the reference model (property)", () => {
  it("every head's amount is its monthly amount x days / divisor, in exact fractions, rounded once by its own mode", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ monthly: fc.integer({ min: 0, max: 5_000_000 }), mode: modes, scale: fc.integer({ min: 0, max: 2 }), prorates: fc.boolean() }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.constantFrom("-1", "-0.5", "0.5", "1"), { minLength: 1, maxLength: 6 }),
        fc.constantFrom(28, 29, 30, 31),
        (heads, restored, divisor) => {
          const days = restored.map((r, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, restored: r }));
          const input = {
            heads: heads.map((h, i) => ({ code: `H${i}`, prorates: h.prorates, parts: [{ from: "2026-08-01", to: "2026-08-31", monthly: String(h.monthly) }] })),
            days,
            divisor: intDec(divisor),
            rounding: (code: string) => ({ mode: heads[Number(code.slice(1))]!.mode, scale: heads[Number(code.slice(1))]!.scale }),
          };
          const got = new Map(reversalAmounts(input).map((a) => [a.component, a.amount.toString()]));
          heads.forEach((h, i) => {
            const exact = days.reduce((s, d) => s.plus(Frac.of(h.monthly).times(Frac.of(d.restored)).div(Frac.of(divisor))), ZERO_F);
            const want = h.prorates ? refRound(exact, h.scale, h.mode) : ZERO_F;
            const have = got.get(`H${i}`);
            expect(have ?? "0", `H${i}`).toBe(money(want));
          });
        },
      ),
      { numRuns: 400 },
    );
  });

  it("restoring a whole day and then taking it back nets to nothing before rounding", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5_000_000 }), fc.constantFrom(28, 29, 30, 31), (monthly, divisor) => {
        const heads = [{ code: "A", prorates: true, parts: [{ from: "2026-08-01", to: "2026-08-31", monthly: String(monthly) }] }];
        const rounding = () => ({ mode: "HALF_UP" as const, scale: 6 });
        const up = reversalAmounts({ heads, days: [{ date: "2026-08-10", restored: "1" }], divisor: intDec(divisor), rounding })[0]?.exact ?? dec("0");
        const down = reversalAmounts({ heads, days: [{ date: "2026-08-10", restored: "-1" }], divisor: intDec(divisor), rounding })[0]?.exact ?? dec("0");
        expect(up.plus(down).isZero()).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// ── Arrears ──
describe("arrears against the reference model (property)", () => {
  const rounding = { mode: "HALF_UP" as const, scale: 0 };
  const calendar: ArrearsBasisProvider = {
    async paidShare(_e, c, from, to) {
      const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
      return { paid: intDec(days(from, to)), basis: intDec(days(c.start, c.end)) };
    },
  };
  const cyc = (label: string, start: string, end: string) => ({ label, start: new Date(`${start}T00:00:00Z`), end: new Date(`${end}T00:00:00Z`), startDay: 1 });

  it("a difference over part of a month is difference x days in the part / days in the month, rounded once, and leaving out dependent heads leaves out exactly their amounts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 400_000 }),
        fc.integer({ min: 0, max: 400_000 }),
        fc.integer({ min: 1, max: 31 }),
        fc.boolean(),
        async (oldBasic, newBasic, fromDay, leaveOutHra) => {
          const old = new Map([["BASIC", dec(String(oldBasic))], ["HRA", dec(String(Math.floor(oldBasic / 2)))]]);
          const next = new Map([["BASIC", dec(String(newBasic))], ["HRA", dec(String(Math.floor(newBasic / 2)))]]);
          const out = await computeArrears({
            employeeId: "e",
            effectiveFrom: new Date(`2026-08-${String(fromDay).padStart(2, "0")}T00:00:00Z`),
            old,
            next,
            prorates: new Map([["BASIC", true], ["HRA", true]]),
            lockedCycles: [cyc("Aug 2026", "2026-08-01", "2026-08-31")],
            rounding,
            provider: calendar,
            ...(leaveOutHra ? { dependentHeads: new Set(["HRA"]) } : {}),
          });
          const days = 31 - fromDay + 1;
          const line = (o: number, n: number) => refRound(Frac.of(n - o).times(Frac.of(days)).div(Frac.of(31)), 0, "HALF_UP");
          const wantBasic = line(oldBasic, newBasic);
          const wantHra = leaveOutHra ? ZERO_F : line(Math.floor(oldBasic / 2), Math.floor(newBasic / 2));
          const got = new Map((out[0]?.lines ?? []).map((l) => [l.component, l.amount.toString()]));
          expect(got.get("BASIC") ?? "0").toBe(money(wantBasic));
          expect(got.get("HRA") ?? "0").toBe(money(wantHra));
          expect(out[0]?.total.toString() ?? "0").toBe(money(wantBasic.plus(wantHra)));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("a whole share is exactly the whole difference, even when the rounding mode would punish a speck (multiply, then divide once)", async () => {
    const three = { label: "Three days", start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-03T00:00:00Z"), startDay: 1 };
    for (const mode of ["DOWN", "FLOOR", "UP", "CEIL", "HALF_EVEN", "HALF_UP"] as const) {
      const out = await computeArrears({ employeeId: "e", effectiveFrom: new Date("2026-08-01T00:00:00Z"), old: new Map([["BASIC", dec("0")]]), next: new Map([["BASIC", dec("1")]]), prorates: new Map([["BASIC", true]]), lockedCycles: [three], rounding: { mode, scale: 0 }, provider: calendar });
      expect(out[0]?.total.toString(), mode).toBe("1");
    }
  });

  it("boundaries: the first and last day of a month, leap day, and the start of the financial year", async () => {
    const owed = async (cycle: ReturnType<typeof cyc>, from: string) =>
      (await computeArrears({ employeeId: "e", effectiveFrom: new Date(`${from}T00:00:00Z`), old: new Map([["BASIC", dec("30000")]]), next: new Map([["BASIC", dec("31000")]]), prorates: new Map([["BASIC", true]]), lockedCycles: [cycle], rounding, provider: calendar }))[0]?.total.toString();
    expect(await owed(cyc("Feb 2028", "2028-02-01", "2028-02-29"), "2028-02-29")).toBe("34"); // 1000 x 1/29 = 34.48 on leap day
    expect(await owed(cyc("Feb 2027", "2027-02-01", "2027-02-28"), "2027-02-28")).toBe("36"); // 1000 x 1/28 = 35.71
    expect(await owed(cyc("Feb 2028", "2028-02-01", "2028-02-29"), "2028-02-01")).toBe("1000"); // the whole month, whatever its length
    expect(await owed(cyc("Aug 2026", "2026-08-01", "2026-08-31"), "2026-08-31")).toBe("32"); // 1000 x 1/31 = 32.26
    expect(await owed(cyc("Apr 2027", "2027-04-01", "2027-04-30"), "2027-04-01")).toBe("1000"); // financial year starts on a cycle's first day
    expect(await owed(cyc("Mar 2027", "2027-03-01", "2027-03-31"), "2027-04-01")).toBeUndefined(); // a revision dated the next day owes nothing for March
  });
});

// ── Salary breakup, proration inputs and rounding ──
describe("a salary breakup against the reference model (property)", () => {
  const comp = (): ComponentValue => ({ name: "Head", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "Head", payslipOrder: 1 });
  const pin = (code: string) => ({ component: code, componentVersion: 1, componentHash: `hash-${code}` });

  it("each percentage line is rounded by its own head's rule, later lines see earlier lines as rounded, and the balance makes the lines add up exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 120_000, max: 90_000_000 }), fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 99 }), modes, modes, fc.constantFrom(0, 1, 2), (annual, basicPct, hraPct, generalMode, hraMode, scale) => {
        const structure: StructureValue = {
          name: "Property structure",
          description: "",
          ctcIncludes: ["EARNING"],
          lines: [
            { ...pin("BASIC"), calc: { method: "PERCENT", of: "CTC", percent: String(basicPct) } },
            { ...pin("HRA"), calc: { method: "PERCENT", of: "BASIC", percent: String(hraPct) } },
            { ...pin("REST"), calc: { method: "BALANCE" } },
          ],
        };
        const rule: RoundingRule = { mode: generalMode, scale, perHead: { HRA: { mode: hraMode, scale } } };
        const components = new Map(["BASIC", "HRA", "REST"].map((c) => [c, { version: 1, value: comp() }]));
        let b;
        try {
          b = computeBreakup({ annualCtc: dec(String(annual)), structure, components, rounding: rule });
        } catch (err) {
          // The balance would be negative: basic + HRA more than CTC. That is a refusal, never a wrong figure.
          expect((err as { code?: string }).code).toBe("BALANCE_NEGATIVE");
          return;
        }
        const monthly = refRound(Frac.of(annual).div(Frac.of(12)), scale, generalMode);
        const basic = refRound(monthly.times(Frac.of(basicPct)).div(Frac.of(100)), scale, generalMode);
        const hra = refRound(basic.times(Frac.of(hraPct)).div(Frac.of(100)), scale, hraMode);
        const rest = monthly.minus(basic).minus(hra);
        const got = Object.fromEntries(b.lines.map((l) => [l.component, l.amount.toString()]));
        expect(got).toEqual({ BASIC: money(basic), HRA: money(hra), REST: money(rest) });
        expect(frac(b.monthlyCtc).cmp(basic.plus(hra).plus(rest))).toBe(0);
      }),
      { numRuns: 500 },
    );
  });
});

// ── The rule hierarchy ──
describe("the rule hierarchy against a brute-force reference (property)", () => {
  const days = ["2026-03-31", "2026-04-01", "2026-04-30", "2026-08-31", "2027-03-31", "2027-04-01"];
  const itemArb = fc.record({
    level: fc.constantFrom("DEPARTMENT" as const, "EMPLOYEE" as const),
    target: fc.constantFrom("a", "b", "d1", "d2"),
    from: fc.constantFrom(...days),
    to: fc.option(fc.constantFrom(...days), { nil: null }),
    value: fc.integer({ min: 1, max: 99 }),
  });

  it("the person's own override beats the department's, which beats the company's; an override counts only inside its dates", () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 8 }), fc.constantFrom("a", "b"), fc.constantFrom("d1", "d2", null), fc.constantFrom(...days), (raw, employeeId, departmentId, day) => {
        const items: OverrideItem[] = raw
          .filter((r) => r.to === null || r.to >= r.from)
          .map((r, i) => ({ itemKey: `k${i}`, ruleKey: "PF_EMPLOYEE_RATE", level: r.level, targetId: r.target, effectiveFrom: r.from, effectiveTo: r.to, version: 1, valueHash: "h", value: String(r.value), confirmed: true, registrationRef: null, sourceNote: "n", reason: "r" }));
        const inWindow = (i: OverrideItem) => i.effectiveFrom <= day && (i.effectiveTo === null || i.effectiveTo >= day);
        const mine = items.filter((i) => i.level === "EMPLOYEE" && i.targetId === employeeId && inWindow(i));
        const dept = items.filter((i) => i.level === "DEPARTMENT" && departmentId !== null && i.targetId === departmentId && inWindow(i));
        const want = mine[0] ?? dept[0] ?? null;
        const got = resolveRule(items, "PF_EMPLOYEE_RATE", { employeeId, departmentId }, day);
        expect(got?.level ?? "COMPANY").toBe(want?.level ?? "COMPANY");
        if (mine.length > 0) expect(got?.level).toBe("EMPLOYEE");
        else if (dept.length > 0) expect(got?.level).toBe("DEPARTMENT");
        else expect(got).toBeNull();
      }),
      { numRuns: 500 },
    );
  });
});

// ── Boundaries in time ──
describe("month ends, leap day and the start of the financial year", () => {
  it("counts months back across a year end and a leap year", () => {
    expect(monthsBack("2028-02-01", "2028-02-29")).toBe(0);
    expect(monthsBack("2028-02-01", "2028-03-01")).toBe(1);
    expect(monthsBack("2027-03-01", "2027-04-01")).toBe(1); // across the financial year start
    expect(monthsBack("2026-12-01", "2027-01-31")).toBe(1);
    expect(monthsBack("2026-04-01", "2027-03-31")).toBe(11);
    expect(monthsBack("2026-04-01", "2027-04-01")).toBe(12);
  });

  it("a day of loss of pay is 1/29 of a leap February and 1/28 of an ordinary one, exactly", () => {
    const heads = [{ code: "A", prorates: true, parts: [{ from: "2028-02-01", to: "2028-02-29", monthly: "29000" }] }];
    const day = (d: string, divisor: number) => reversalAmounts({ heads, days: [{ date: d, restored: "1" }], divisor: intDec(divisor), rounding: () => ({ mode: "HALF_UP", scale: 0 }) })[0]!.amount.toString();
    expect(day("2028-02-29", 29)).toBe("1000"); // the leap day itself
    const ordinary = [{ code: "A", prorates: true, parts: [{ from: "2027-02-01", to: "2027-02-28", monthly: "28000" }] }];
    expect(reversalAmounts({ heads: ordinary, days: [{ date: "2027-02-28", restored: "1" }], divisor: intDec(28), rounding: () => ({ mode: "HALF_UP", scale: 0 }) })[0]!.amount.toString()).toBe("1000");
  });

  it("a cycle that starts on the 1st ends on the last day of every month, including 29 February", () => {
    const rules = [{ startDay: 1 }] as unknown as Parameters<typeof cycleForRules>[0];
    const end = (d: string) => cycleForRules(rules, new Date(`${d}T00:00:00Z`)).end.toISOString().slice(0, 10);
    expect([end("2028-02-10"), end("2027-02-10"), end("2027-04-01"), end("2027-03-31"), end("2026-12-31")]).toEqual(["2028-02-29", "2027-02-28", "2027-04-30", "2027-03-31", "2026-12-31"]);
    expect(addCalendarDays(new Date("2028-02-28T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(addCalendarDays(new Date("2027-03-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2027-04-01");
  });
});
