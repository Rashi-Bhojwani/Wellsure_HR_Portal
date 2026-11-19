import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACK_ECR_LAYOUT, PACK_RULES, PACK_TAX_YEARS, PACK_VERSION, entryOn } from "@shared/constants/statutoryDefaults";
import { BEHAVIOURS } from "../../behaviours/service";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { setSetting } from "../../../lib/settings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { dec, intDec } from "../money";
import { encashmentAmount, gratuityAmount, gratuityYears, noticeRecoveryAmount } from "../payPolicies/arith";
import { RuleContext, pinStatuses, type RulePin } from "../rules/context";
import { editRule, previewEdit } from "../rules/governed";
import { calculatePerson, inEsiCover } from "../run/person";
import { loadRunRules, type RunRules } from "../run/rules";
import { runNotices } from "../run/service";
import { parseLayout, renderLayout } from "../run/layout";
import { computeEsi, computePf } from "../run/statutory";
import type { CalcContext, PersonInput } from "../run/types";
import type { ComponentValue } from "../salary/schemas";
import { buildSetupReport, readinessOf } from "../setup/status";
import { assertPackAcknowledged, reviewDueReasons } from "../statutoryPack/service";
import { computeAnnualTax } from "../tax/engine";
import { parseTaxYearValue } from "../tax/schema";
import { cleanupPayrollRowsBy } from "./payrollTestHelpers";

// Standard statutory defaults pack (docs/plans/STATUTORY_DEFAULTS_PLAN.md §6). Each value group is checked against an INDEPENDENT reference written here from the
// sourced rules (docs/STATUTORY_DEFAULTS.md), with the figures retyped, not imported: just below, at and just above every ceiling, slab edge and rebate limit, and
// across the PF ceiling change on 17 September 2026. Then the rules that make the pack safe: effective dating, never overwriting a director's value, the refusal until
// both directors acknowledge, and the PY-43 guard against counting an employer line twice. Made-up people only.

// ── Independent arithmetic: whole rupees from exact integers, half up or up, never through floating point ──
const paise = (rupees: string): bigint => {
  const [r, p = ""] = rupees.split(".");
  return BigInt(r!) * 100n + BigInt((p + "00").slice(0, 2));
};
/** Rupees (whole) of `amountPaise` x `rateBasisPoints` / 10000 / 100, rounded half up. */
const halfUp = (num: bigint, den: bigint): bigint => (2n * num + den) / (2n * den);
const ceilDiv = (num: bigint, den: bigint): bigint => (num + den - 1n) / den;
const pctHalfUp = (rupees: string, bp: bigint) => halfUp(paise(rupees) * bp, 1_000_000n).toString();
const pctUp = (rupees: string, bp: bigint) => ceilDiv(paise(rupees) * bp, 1_000_000n).toString();

/** Company choices a run needs (owner-entered, never in the pack): TEST values. */
const COMPANY: Record<string, unknown> = {
  PAY_DAYS_BASIS: "CALENDAR_DAYS",
  LOP_DIVISOR: "SAME_AS_PAY_DAYS_BASIS",
  LINE_ROUNDING: { mode: "HALF_UP", scale: 0 },
  NET_PAY_ROUNDING: { mode: "NONE", scale: 0 },
  PF_CEILING_MODE: "CAP_AT_CEILING",
  PF_ELIGIBLE_TYPES: ["PERMANENT"],
  ESI_PERIOD_RULE: "MONTHLY",
  ESI_ELIGIBLE_TYPES: ["PERMANENT"],
  NEGATIVE_NET_POLICY: "BLOCK",
  LEAVER_PAYMENT_TIMING: "PAY_WITH_RUN",
  PAYMENT_DATE_RULE: { monthOffset: 0, day: "LAST" },
};
const rulesOn = (day: string, extra: Record<string, unknown> = {}): { rules: RunRules; ctx: RuleContext } => {
  const ctx = RuleContext.fromValuesForTests({ ...COMPANY, ...extra }, { packOn: day });
  return { rules: loadRunRules(ctx, { arrears: false, encashment: false }), ctx };
};

describe("Standard defaults — golden against an independent reference", () => {
  describe("PF: rates and the dated ceiling (Rs 15,000 to 16 Sep 2026, Rs 25,000 from 17 Sep 2026)", () => {
    it("the ceiling in force is chosen by date, the month's last day deciding the whole month", () => {
      expect(entryOn(PACK_RULES.PF_WAGE_CEILING, "2026-09-16")?.value).toBe("15000");
      expect(entryOn(PACK_RULES.PF_WAGE_CEILING, "2026-09-17")?.value).toBe("25000");
      expect(rulesOn("2026-08-31").rules.pf.ceiling.toString()).toBe("15000"); // August 2026: the old ceiling
      expect(rulesOn("2026-09-30").rules.pf.ceiling.toString()).toBe("25000"); // September 2026 contains the date: its last day decides
      expect(rulesOn("2026-10-31").rules.pf.ceiling.toString()).toBe("25000");
    });
    for (const [day, ceiling] of [["2026-08-31", 15000], ["2026-09-30", 25000]] as const) {
      it(`every PF line below, at and above the ceiling (${day}) matches the reference`, () => {
        const { rules } = rulesOn(day);
        for (const w of [ceiling - 1, ceiling, ceiling + 1, ceiling + 10_000, 7_999]) {
          const pf = computePf(dec(String(w)), rules);
          const capped = String(Math.min(w, ceiling));
          expect(pf.cappedWages.toString(), `wages ${w}`).toBe(capped);
          expect([pf.employee, pf.eps, pf.epfEr, pf.edli, pf.admin].map((m) => m.toString()), `wages ${w} on ${day}`).toEqual([pctHalfUp(capped, 1200n), pctHalfUp(capped, 833n), pctHalfUp(capped, 367n), pctHalfUp(capped, 50n), pctHalfUp(capped, 50n)]);
        }
      });
    }
    it("the employer pension maximum is Rs 1,250 on the old ceiling and Rs 2,083 on the new one (PIB)", () => {
      expect(computePf(dec("90000"), rulesOn("2026-08-31").rules).eps.toString()).toBe("1250");
      expect(computePf(dec("90000"), rulesOn("2026-09-30").rules).eps.toString()).toBe("2083");
    });
  });

  describe("ESI: 0.75% and 3.25%, covered up to and including Rs 21,000", () => {
    it("coverage just below, at and just above the ceiling", () => {
      const { rules } = rulesOn("2026-10-31");
      expect(rules.esi.ceiling.toString()).toBe("21000");
      expect([20999, 21000, 21001].map((w) => inEsiCover(dec(String(w)), rules.esi.ceiling))).toEqual([true, true, false]);
      expect(inEsiCover(dec("0"), rules.esi.ceiling)).toBe(false);
    });
    it("contributions round up to the next rupee and match the reference", () => {
      const { rules } = rulesOn("2026-10-31");
      for (const w of ["20999", "21000", "15000.50", "9999", "1"]) {
        const esi = computeEsi(dec(w), rules);
        expect([esi.employee.toString(), esi.employer.toString()], w).toEqual([pctUp(w, 75n), pctUp(w, 325n)]);
      }
    });
  });

  // Changed 2026-11-17 (owner decision, CHANGED_TESTS.md): no state's PT or LWF is loaded. Not set means nothing is deducted and the run says "not set" (never "not
  // levied"), without making the month a test; a director's own table is used as before.
  describe("Professional tax and LWF: Not set by default (owner decision); a director's table is used", () => {
    it("with no director table: nothing is computed, the run records NOT_SET (in force, not a Placeholder) and says \"not set\", never \"not levied\"", async () => {
      const { rules, ctx } = rulesOn("2026-10-31");
      expect([rules.ptSlabs, rules.lwfTable, rules.notSet]).toEqual([null, null, ["PT", "LWF"]]);
      const pins = ctx.pins().filter((p) => p.key === "PT_SLABS" || p.key === "LWF_TABLE");
      expect(pins.map((p) => [p.key, p.kind])).toEqual([["LWF_TABLE", "NOT_SET"], ["PT_SLABS", "NOT_SET"]]);
      const statuses = await pinStatuses(pins);
      expect(statuses.map((st) => [st.label, st.status])).toEqual([["Labour Welfare Fund: not set", "CONFIRMED"], ["Professional Tax: not set", "CONFIRMED"]]);
      const notices = runNotices(true, true).join(" ");
      expect(notices).toContain("Professional Tax: not set.");
      expect(notices).toContain("Labour Welfare Fund: not set.");
      expect(notices).not.toMatch(/not levied in/);
    });
    it("a director's table is used (and pinned as a rule, not NOT_SET)", () => {
      const pt = { states: { TEST_STATE: { slabs: [{ fromGross: "0", toGross: null, monthlyAmount: "200" }] } } };
      const { rules, ctx } = rulesOn("2026-10-31", { PT_SLABS: pt, PT_STATE_OF_PLACEMENT: "LAST_DAY_OF_PERIOD", STATE_NAME_MAP: { "Test State": "TEST_STATE" } });
      expect(rules.ptSlabs).toEqual(pt);
      expect(rules.notSet).toEqual(["LWF"]);
      expect(ctx.pins().find((p) => p.key === "PT_SLABS")?.kind).toBeUndefined();
    });
  });

  describe("Income tax 2026-27, both regimes", () => {
    const year = parseTaxYearValue(PACK_TAX_YEARS["2026-27"]!.value);
    // The reference: the slabs, standard deduction, rebate, marginal relief, surcharge and cess as the sources state them, retyped here.
    const NEW = [[0, 400000, 0], [400000, 800000, 5], [800000, 1200000, 10], [1200000, 1600000, 15], [1600000, 2000000, 20], [2000000, 2400000, 25], [2400000, Infinity, 30]] as const;
    const OLD = [[0, 250000, 0], [250000, 500000, 5], [500000, 1000000, 20], [1000000, Infinity, 30]] as const;
    const slabTax = (income: number, slabs: readonly (readonly [number, number, number])[]): bigint => {
      let t = 0n; // in paise x 100 (rate in percent)
      for (const [from, to, rate] of slabs) {
        const top = Math.min(income, to);
        if (top > from) t += BigInt(top - from) * BigInt(rate);
      }
      return t; // rupees x 100
    };
    const reference = (regime: "NEW" | "OLD", income: number): string => {
      let tax = slabTax(income, regime === "NEW" ? NEW : OLD); // rupees x 100
      const threshold = regime === "NEW" ? 1200000 : 500000;
      const maxRebate = regime === "NEW" ? 6000000n : 1250000n; // x 100
      if (income <= threshold) tax -= tax < maxRebate ? tax : maxRebate;
      else if (regime === "NEW") {
        const excess = BigInt(income - threshold) * 100n;
        if (tax > excess) tax = excess; // marginal relief, the new regime's only
      }
      const surchargeRate = income > 20000000 ? 25n : income > 10000000 ? 15n : income > 5000000 ? 10n : 0n;
      const withSurcharge = tax * 100n + tax * surchargeRate; // x 10000
      const withCess = withSurcharge * 100n + withSurcharge * 4n; // x 1000000
      return halfUp(withCess, 1_000_000n).toString();
    };
    const points = {
      NEW: [399999, 400000, 400001, 800000, 800001, 1199999, 1200000, 1200001, 1210000, 1260000, 1600000, 2000000, 2400000, 2400001, 5000000, 5000001, 10000001, 20000001],
      OLD: [250000, 250001, 499999, 500000, 500001, 1000000, 1000001, 5000001],
    };
    for (const regime of ["NEW", "OLD"] as const) {
      it(`${regime === "NEW" ? "new" : "old"} regime: every slab edge, the rebate limit${regime === "NEW" ? ", marginal relief" : ""} and the surcharge thresholds`, () => {
        const sd = regime === "NEW" ? 75000 : 50000;
        for (const income of points[regime]) {
          const r = computeAnnualTax({ year, regime, taxablePay: String(income + sd), deductions: [] });
          expect(r.taxableIncome, `${regime} ${income}`).toBe(String(income));
          expect(r.annualTax, `${regime} taxable income ${income}`).toBe(reference(regime, income));
        }
      });
    }
    it("a salaried person on Rs 12,75,000 pays nothing in the new regime (12,00,000 after the standard deduction)", () => {
      expect(computeAnnualTax({ year, regime: "NEW", taxablePay: "1275000", deductions: [] }).annualTax).toBe("0");
      expect(computeAnnualTax({ year, regime: "NEW", taxablePay: "1275001", deductions: [] }).annualTax).toBe("1");
    });
  });

  // Changed 2026-11-17 (owner decision, CHANGED_TESTS.md): gratuity, notice and encashment are no longer loaded. The arithmetic is still checked against the reference,
  // with the reference figures (docs/STATUTORY_DEFAULTS.md, "Reference values, not loaded") typed here as TEST values; the settings themselves ship Not set.
  describe("Gratuity, notice and encashment: Not set by default; the arithmetic against the reference with TEST values", () => {
    it("the three settings and the state ship Not set (no hidden default)", () => {
      for (const k of ["payroll.gratuity", "payroll.noticeRecovery", "payroll.leaveEncashment", "statutory.state"] as const) {
        expect(BEHAVIOURS[k].defaultValue, k).toBeNull();
        expect("standard" in BEHAVIOURS[k], k).toBe(false);
      }
    });
    const g = { minYears: "5", partYear: "SIX_MONTHS_OR_MORE_COUNTS_AS_A_YEAR" as const, daysPerYear: "15", divisor: "26", ceiling: "2000000", rounding: { mode: "HALF_UP" as const, scale: 0 } };
    it("TEST values: 15 days' wages for each counted year, a part year counted from six months, capped at Rs 20 lakh", () => {
      const ref = (years: number, wage: bigint) => {
        const exact = (wage * 15n * BigInt(years) * 2n + 26n) / (26n * 2n); // half up, whole rupees
        return (exact > 2000000n ? 2000000n : exact).toString();
      };
      for (const [y, m, counted] of [[5, 0, 5], [5, 5, 5], [5, 6, 6], [5, 7, 6], [19, 11, 20]] as const) {
        expect(gratuityYears(y, m, g.partYear), `${y}y ${m}m`).toBe(counted);
        for (const wage of [26000n, 33333n, 200000n]) expect(gratuityAmount(counted, intDec(Number(wage)), g.daysPerYear, g.divisor, g.ceiling, g.rounding).toString(), `${counted} years, wage ${wage}`).toBe(ref(counted, wage));
      }
    });
    it("TEST values: notice shortfall days x head / 30; encashment days x head / 30 (half up)", () => {
      const r = { mode: "HALF_UP" as const, scale: 0 };
      for (const [days, basic] of [[1, 20000], [7, 23456], [30, 31000]] as const) {
        const ref = halfUp(BigInt(days) * BigInt(basic), 30n).toString();
        expect(noticeRecoveryAmount(days, intDec(basic), "30", r).toString()).toBe(ref);
        expect(encashmentAmount(String(days), [{ componentCode: "TEST_PAY", amount: String(basic) }], ["TEST_PAY"], { kind: "FIXED_DAYS", days: "30" }, 31, r).toString()).toBe(ref);
      }
    });
  });

  describe("PF ECR 2.0 (EPFO's published layout)", () => {
    it("one line per member, 11 fields in EPFO's order, #~# between them, whole rupees, no header", async () => {
      const layout = parseLayout("PF_ECR", PACK_ECR_LAYOUT.value);
      const row = { UAN: "100000000001", NAME: "Test Person", GROSS_WAGES: "30000", EPF_WAGES: "25000", EPS_WAGES: "25000", EDLI_WAGES: "25000", EPF_CONTRIBUTION: "3000", EPS_CONTRIBUTION: "2083", EPF_EPS_DIFF: "917", NCP_DAYS: "0", REFUND: "0" };
      const file = await renderLayout("PF_ECR", layout, [row], { count: 1, total: "3000", period: "Oct 2026" });
      expect(file.bytes.toString("utf8").trim()).toBe("100000000001#~#Test Person#~#30000#~#25000#~#25000#~#25000#~#3000#~#2083#~#917#~#0#~#0");
    });
  });

  describe("The review reminder", () => {
    it("is due after the interval since the last review, and when a value's effective date has passed since then", () => {
      expect(reviewDueReasons({ today: "2027-05-15", lastReviewed: "2026-11-16", intervalMonths: 6 })).toEqual([]);
      expect(reviewDueReasons({ today: "2027-05-16", lastReviewed: "2026-11-16", intervalMonths: 6 }).join(" ")).toMatch(/more than 6 months ago/);
      expect(reviewDueReasons({ today: "2026-09-20", lastReviewed: "2026-09-01", intervalMonths: 6 }).join(" ")).toMatch(/PF: monthly wage ceiling: a new value applies from 2026-09-17/);
    });
  });

  it("docs/STATUTORY_DEFAULTS.md is up to date with the pack (npm run docs:statutory-defaults)", async () => {
    const { STATUTORY_DOC } = await import("../../../../scripts/statutory-defaults-doc");
    expect(readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "docs", "STATUTORY_DEFAULTS.md"), "utf8")).toBe(STATUTORY_DOC);
  });
});

// ── PY-43: a structure line that stands for the statutory employer PF never adds to the run ──

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const flags = (over: Partial<ComponentValue>): ComponentValue => ({ name: "x", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "x", payslipOrder: 1, ...over });
function personWith(employerLine: boolean): { input: PersonInput; ctx: CalcContext } {
  const comps = new Map<string, ComponentValue>([
    ["BASIC@1", flags({ pfApplicable: true, payslipLabel: "Basic", payslipOrder: 1 })],
    ["SPECIAL@1", flags({ payslipLabel: "Special", payslipOrder: 2 })],
    ["ERPF@1", flags({ type: "EMPLOYER_CONTRIBUTION", standsFor: "PF_EMPLOYER", payslipLabel: "Employer PF (in CTC)", payslipOrder: 3, taxable: null })],
  ]);
  const amounts: Record<string, string> = { BASIC: "20000", SPECIAL: "30000", ...(employerLine ? { ERPF: "1800" } : {}) };
  const days = [];
  for (let t = d("2026-10-01"); t <= d("2026-10-31"); t = new Date(t.getTime() + 86_400_000)) days.push({ date: t, status: "P", lopDays: dec("0") });
  const input: PersonInput = {
    employeeId: "e1", employeeCode: "E1", employmentType: "PERMANENT", dateOfJoining: d("2024-01-01"), lastWorkingDate: null, span: { from: d("2026-10-01"), to: d("2026-10-31") }, days, missingDays: [],
    segments: [{ from: d("2026-10-01"), to: d("2026-10-31"), salaryId: "s0", structureKey: "STD", structureVersion: 1, structureHash: "h", roundingPin: null, lines: Object.entries(amounts).map(([component, amount], order) => ({ component, version: 1, type: comps.get(`${component}@1`)!.type, amount: dec(amount), order })) }],
    salaryGapDays: [], placement: { locationId: "l", locationState: "Rajasthan", departmentId: "dep", gradeId: null, costCentreId: null }, placementDay: d("2026-10-31"), hasBankAccount: true, adjustments: [], esiPeriodStartEntitlement: null,
  } as PersonInput;
  const { rules } = rulesOn("2026-10-31");
  const ctx = { cycle: { start: d("2026-10-01"), end: d("2026-10-31"), label: "Oct 2026" }, payrollMonth: 10, rules, components: { byVersion: comps, current: new Map([...comps].map(([k, v]) => [k.split("@")[0]!, { version: 1, value: v }])) } } as unknown as CalcContext;
  return { input, ctx };
}

describe("PY-43 — employer PF and ESI inside CTC are never counted twice", () => {
  it("a structure line standing for the statutory employer PF is not paid or costed: the employer cost is the statutory PF alone", () => {
    const withLine = calculatePerson(personWith(true).input, personWith(true).ctx);
    const without = calculatePerson(personWith(false).input, personWith(false).ctx);
    expect(withLine.lines.some((l) => l.code === "ERPF")).toBe(false);
    expect(withLine.employerContributions.toString()).toBe(without.employerContributions.toString());
    expect(withLine.lines.filter((l) => l.kind === "EMPLOYER_CONTRIBUTION").map((l) => l.code).sort()).toEqual(["PF_ADMIN", "PF_EDLI", "PF_EPF_ER", "PF_EPS"]);
    expect(withLine.notices.join(" ")).toMatch(/stands for the statutory employer PF/);
  });
});

// ── The database rules: dating, never overwriting, the acknowledgement, the screens ──

describe("Standard defaults in the database", () => {
  let org: TestOrgMasters;
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const tok: Record<string, string> = {};
  const startedAt = new Date();
  const api = (t: string) => ({ get: (p: string) => request(app).get(`/api/payroll-statutory-pack${p}`).set(...authHeader(t)), post: (p: string) => request(app).post(`/api/payroll-statutory-pack${p}`).set(...authHeader(t)).send({}) });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, role] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["mgr", "MANAGER"], ["emp", "EMPLOYEE"], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      people[k] = await createFullTestEmployee(org, { roleCode: role });
      tok[k] = await loginAs(people[k]!.employeeCode);
    }
  }, 120_000);

  afterAll(async () => {
    await setSetting("demo.company", false, people.d1!.userId).catch(() => undefined);
    const ids = Object.values(people).map((p) => p.userId);
    await deleteWithDependents("StatutoryPackReview", (await prisma.statutoryPackReview.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((r) => r.id));
    await purgeAppendOnly("AuditLog", { entityType: "StatutoryPack", createdAt: { gte: startedAt } });
    await cleanupPayrollRowsBy(ids);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("with nobody's value entered, a run reads the dated standard value, pinned as in force (not a Placeholder)", async () => {
    expect(await prisma.payrollItemVersion.count({ where: { kind: "RULE", key: "PF_WAGE_CEILING", authorUserId: { not: null } } })).toBe(0);
    const aug = await RuleContext.load({ asOf: d("2026-08-31") });
    const sep = await RuleContext.load({ asOf: d("2026-09-30") });
    expect([aug.decimal("PF_WAGE_CEILING").toString(), sep.decimal("PF_WAGE_CEILING").toString()]).toEqual(["15000", "25000"]);
    const pin = sep.pins().find((p) => p.key === "PF_WAGE_CEILING")!;
    expect([pin.kind, pin.version]).toEqual(["PACK", PACK_VERSION]);
    const [st] = await pinStatuses([pin]);
    expect([st!.status, st!.stale]).toEqual(["CONFIRMED", false]);
  });

  it("a director's value is never overwritten: entered (even unconfirmed) it is used, and a run on the standard value goes stale", async () => {
    const before = await RuleContext.load({ asOf: d("2026-10-31") });
    before.decimal("PF_WAGE_CEILING");
    const oldPin = before.pins().find((p) => p.key === "PF_WAGE_CEILING")!;
    const pre = await previewEdit("PF_WAGE_CEILING", "18000");
    await editRule("PF_WAGE_CEILING", { value: "18000", sourceNote: "TEST: a director's own figure", effectiveFrom: "2026-10-01", fingerprint: pre.fingerprint }, { userId: people.d1!.userId });
    const after = await RuleContext.load({ asOf: d("2026-10-31") });
    expect(after.decimal("PF_WAGE_CEILING").toString()).toBe("18000");
    const newPin = after.pins().find((p) => p.key === "PF_WAGE_CEILING")!;
    expect(newPin.kind).toBeUndefined();
    const [oldSt, newSt] = await pinStatuses([oldPin, newPin]);
    expect([oldSt!.stale, newSt!.status]).toEqual([true, "PLACEHOLDER"]);
  });

  it("HR, a manager, an employee and the Developer are refused the standard values; a director sees them with sources", async () => {
    for (const k of ["hr", "mgr", "emp", "dev"]) {
      expect((await api(tok[k]!).get("/")).status, k).toBe(403);
      expect((await api(tok[k]!).post("/acknowledge")).status, k).toBe(403);
      expect((await api(tok[k]!).post("/review")).status, k).toBe(403);
    }
    const res = await api(tok.d1!).get("/");
    expect(res.status).toBe(200);
    expect(res.body.state).toMatchObject({ key: null, label: "Not set", loaded: false, professionalTax: null }); // changed 2026-11-17: the state ships Not set
    expect(res.body.rules.find((r: { key: string }) => r.key === "ESI_WAGE_CEILING").today).toMatchObject({ value: "21000", verification: "OFFICIAL" });
  });

  it("a run that used standard values is refused until both directors acknowledge; the demo company is exempt; each director once", async () => {
    const pins: RulePin[] = [{ key: "PF_WAGE_CEILING", version: PACK_VERSION, valueHash: "x", kind: "PACK" }];
    await expect(assertPackAcknowledged(pins)).rejects.toMatchObject({ status: 409, code: "STANDARD_VALUES_NOT_ACKNOWLEDGED" });
    await assertPackAcknowledged([{ key: "PF_WAGE_CEILING", version: 1, valueHash: "x" }]); // no standard value used: nothing to acknowledge
    await setSetting("demo.company", true, people.d1!.userId);
    await assertPackAcknowledged(pins);
    await setSetting("demo.company", false, people.d1!.userId);
    expect((await api(tok.d1!).post("/acknowledge")).status).toBe(201);
    expect((await api(tok.d1!).post("/acknowledge")).body.error.code).toBe("ALREADY_ACKNOWLEDGED");
    await expect(assertPackAcknowledged(pins)).rejects.toMatchObject({ code: "STANDARD_VALUES_NOT_ACKNOWLEDGED" });
    expect((await api(tok.d2!).post("/acknowledge")).status).toBe(201);
    await assertPackAcknowledged(pins);
    expect((await api(tok.d2!).post("/review")).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: { in: ["payroll.statutory_pack.acknowledged", "payroll.statutory_pack.reviewed"] }, createdAt: { gte: startedAt } } })).toBe(3);
  });

  it("Ready for First Run: a non-blocking 'Using standard statutory values' row, the acknowledgement row, and the covered rules standing on their sources", async () => {
    const report = await buildSetupReport();
    const items = report.sections.flatMap((s) => s.items);
    const status = items.find((i) => i.id === "pack:status")!;
    expect([status.required, status.warning?.startsWith("Using standard statutory values, last reviewed on")]).toEqual([false, true]);
    expect(items.find((i) => i.id === "pack:acknowledgement")!.required).toBe(true);
    // Changed 2026-11-17: PT and LWF are the owners' tables, never required for the first run, and a non-blocking row says they are not set.
    const pt = items.find((i) => i.id === "rule:PT_SLABS")!;
    expect([pt.required, pt.notRequiredReason]).toEqual([false, expect.stringMatching(/set by the owners/)]);
    const row = readinessOf(report).behaviours.find((b) => b.itemId === "statutory:ptlwf")!;
    expect([row.title, row.state]).toEqual(["Professional Tax and LWF: not set", "NOT_SET"]);
    expect(readinessOf(report).blockers.some((b) => b.itemId === "statutory:ptlwf" || b.itemId === "rule:PT_SLABS" || b.itemId === "rule:LWF_TABLE")).toBe(false);
    expect(items.find((i) => i.id === "rule:ESI_EMPLOYEE_RATE")!.detail).toMatch(/Standard default, change in settings: 0\.75/);
  });
});
