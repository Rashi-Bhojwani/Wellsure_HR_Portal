import { RULE_BY_KEY } from "@shared/constants/payrollRules";
import { HttpError } from "../../../middleware/errorHandler";
import type { Money } from "../money";
import { dec } from "../money";
import { RuleContext, RuleNotSetError } from "../rules/context";
import type { RoundingRule } from "../salary/breakup";

// The rules one calculation reads, as typed values, and the one place that reads them (docs/plans/PHASE_6.md §14D). Every rate, ceiling, slab and basis in
// a payroll figure arrives here through RuleContext, so each is pinned by the act of being read. A rule the calculation needs and nobody has set is not
// thrown one at a time: all of them are collected and reported together, so the person setting up sees the whole list.

export type PayDaysBasis = "CALENDAR_DAYS" | "FIXED_DAYS" | "WORKING_DAYS";
export type LopDivisor = "SAME_AS_PAY_DAYS_BASIS" | PayDaysBasis;

export interface PtTable {
  states: Record<string, { slabs: Array<{ fromGross: string; toGross: string | null; monthlyAmount: string; monthOverrides?: Record<string, string> }> }>;
}
export interface LwfTable {
  states: Record<string, { employee: string; employer: string; frequency: "MONTHLY" | "HALF_YEARLY" | "ANNUAL"; months: number[] }>;
}

export interface RunRules {
  payDaysBasis: PayDaysBasis;
  lopDivisor: LopDivisor;
  fixedDays: number | null;
  lineRounding: RoundingRule;
  pfRounding: RoundingRule;
  esiRounding: RoundingRule;
  netRounding: RoundingRule;
  pf: { employeeRate: Money; epsRate: Money; epfErRate: Money; edliRate: Money; adminRate: Money; ceiling: Money; ceilingMode: "CAP_AT_CEILING" | "ACTUAL_WAGE"; eligibleTypes: string[] };
  esi: { employeeRate: Money; employerRate: Money; ceiling: Money; periodRule: "MONTHLY" | "STICKY_HALF_YEAR"; eligibleTypes: string[] };
  negativeNet: "BLOCK" | "HOLD_PAYMENT";
  leaverTiming: "PAY_WITH_RUN" | "HOLD_FOR_FNF";
  paymentDate: { monthOffset: 0 | 1; day: number | "LAST" };
  /** Null when nobody has set them: the run records them as not set and charges nothing, saying so. */
  ptSlabs: PtTable | null;
  lwfTable: LwfTable | null;
  /** Needed only when a table above is set. */
  ptStateOfPlacement: "LAST_DAY_OF_PERIOD" | "FIRST_DAY_OF_PERIOD" | null;
  stateNameMap: Record<string, string> | null;
  /** Needed only when the run has arrears / a year-end encashment in it. */
  arrearsPfEsi: "FOLLOW_COMPONENT_FLAGS" | "EXCLUDE" | null;
  encashPfApplicable: boolean | null;
  encashPayoutRule: "FIRST_RUN_AFTER_COMMIT" | "SAME_MONTH_AS_COMMIT" | null;
  /** Needed only when the run has arrears in it: whether an arrear on a base head feeds heads that are a percentage of it. */
  arrearOnArrear: boolean | null;
  /** Needed only when the run pays loss of pay back. */
  lopReversal: { lookbackMonths: number; overrideAllowed: boolean } | null;
  /** Heads rounded differently from the general rule; absent heads use `lineRounding`. */
  headRounding: Record<string, RoundingRule>;
}

export interface RuleNeeds {
  /** The run pays loss of pay back (Stage 3.3b). */
  reversals?: boolean;
  arrears: boolean;
  encashment: boolean;
}

export interface MissingRule {
  key: string;
  label: string;
}

export class RulesMissingError extends HttpError {
  constructor(public readonly missing: MissingRule[]) {
    super(409, `${missing.length === 1 ? "A rule" : `${missing.length} rules`} the calculation needs ${missing.length === 1 ? "has" : "have"} no value yet: ${missing.map((m) => m.label).join("; ")}. Enter ${missing.length === 1 ? "it" : "them"} under Rules and setup first.`, "RULES_MISSING", { missing });
    this.name = "RulesMissingError";
  }
}

const labelOf = (key: string) => RULE_BY_KEY[key]?.label ?? key;

/** Reads every rule the calculation needs through `ctx` (pinning each). Throws RulesMissingError listing ALL that have no value. */
export function loadRunRules(ctx: RuleContext, needs: RuleNeeds): RunRules {
  const missing: MissingRule[] = [];
  const take = <T>(key: string): T | null => {
    try {
      return ctx.rule<T>(key);
    } catch (err) {
      if (err instanceof RuleNotSetError) {
        missing.push({ key, label: labelOf(key) });
        return null;
      }
      throw err;
    }
  };
  const money = (key: string): Money => {
    try {
      return ctx.decimal(key);
    } catch (err) {
      if (err instanceof RuleNotSetError) {
        missing.push({ key, label: labelOf(key) });
        return dec("0");
      }
      throw err;
    }
  };
  const payDaysBasis = take<PayDaysBasis>("PAY_DAYS_BASIS");
  const lopDivisor = take<LopDivisor>("LOP_DIVISOR");
  const fixedDays = payDaysBasis === "FIXED_DAYS" || lopDivisor === "FIXED_DAYS" ? take<number>("FIXED_DAYS_VALUE") : null;
  const ptSlabs = ctx.optional<PtTable>("PT_SLABS");
  const lwfTable = ctx.optional<LwfTable>("LWF_TABLE");
  const needsState = ptSlabs !== null || lwfTable !== null;
  const rules: RunRules = {
    payDaysBasis: payDaysBasis ?? "CALENDAR_DAYS",
    lopDivisor: lopDivisor ?? "SAME_AS_PAY_DAYS_BASIS",
    fixedDays,
    lineRounding: take<RoundingRule>("LINE_ROUNDING") ?? { mode: "HALF_UP", scale: 0 },
    pfRounding: take<RoundingRule>("PF_ROUNDING") ?? { mode: "HALF_UP", scale: 0 },
    esiRounding: take<RoundingRule>("ESI_ROUNDING") ?? { mode: "UP", scale: 0 },
    netRounding: take<RoundingRule>("NET_PAY_ROUNDING") ?? { mode: "NONE", scale: 0 },
    pf: {
      employeeRate: money("PF_EMPLOYEE_RATE"),
      epsRate: money("PF_EPS_RATE"),
      epfErRate: money("PF_EPF_ER_RATE"),
      edliRate: money("PF_EDLI_RATE"),
      adminRate: money("PF_ADMIN_RATE"),
      ceiling: money("PF_WAGE_CEILING"),
      ceilingMode: take<"CAP_AT_CEILING" | "ACTUAL_WAGE">("PF_CEILING_MODE") ?? "CAP_AT_CEILING",
      eligibleTypes: take<string[]>("PF_ELIGIBLE_TYPES") ?? [],
    },
    esi: {
      employeeRate: money("ESI_EMPLOYEE_RATE"),
      employerRate: money("ESI_EMPLOYER_RATE"),
      ceiling: money("ESI_WAGE_CEILING"),
      periodRule: take<"MONTHLY" | "STICKY_HALF_YEAR">("ESI_PERIOD_RULE") ?? "MONTHLY",
      eligibleTypes: take<string[]>("ESI_ELIGIBLE_TYPES") ?? [],
    },
    negativeNet: take<"BLOCK" | "HOLD_PAYMENT">("NEGATIVE_NET_POLICY") ?? "BLOCK",
    leaverTiming: take<"PAY_WITH_RUN" | "HOLD_FOR_FNF">("LEAVER_PAYMENT_TIMING") ?? "PAY_WITH_RUN",
    paymentDate: take<{ monthOffset: 0 | 1; day: number | "LAST" }>("PAYMENT_DATE_RULE") ?? { monthOffset: 0, day: "LAST" },
    ptSlabs,
    lwfTable,
    ptStateOfPlacement: ptSlabs ? take<"LAST_DAY_OF_PERIOD" | "FIRST_DAY_OF_PERIOD">("PT_STATE_OF_PLACEMENT") : null,
    stateNameMap: needsState ? take<Record<string, string>>("STATE_NAME_MAP") : null,
    arrearsPfEsi: needs.arrears ? take<"FOLLOW_COMPONENT_FLAGS" | "EXCLUDE">("ARREARS_PF_ESI") : null,
    encashPfApplicable: needs.encashment ? take<boolean>("ENCASH_PF_APPLICABLE") : null,
    encashPayoutRule: needs.encashment ? take<"FIRST_RUN_AFTER_COMMIT" | "SAME_MONTH_AS_COMMIT">("ENCASH_PAYOUT_RULE") : null,
    arrearOnArrear: needs.arrears ? take<boolean>("ARREAR_ON_ARREAR") : null,
    lopReversal: needs.reversals ? { lookbackMonths: take<number>("LOP_REVERSAL_LOOKBACK_MONTHS") ?? 0, overrideAllowed: take<boolean>("LOP_REVERSAL_OVERRIDE_ALLOWED") ?? false } : null,
    headRounding: ctx.ifSet<Record<string, RoundingRule>>("HEAD_ROUNDING") ?? {},
  };
  if (missing.length) throw new RulesMissingError(missing);
  return rules;
}

/** The rules a calculation cannot start without, whatever the run holds, for the readiness list: those with no value now. */
export function missingRulesFor(ctx: RuleContext, needs: RuleNeeds): MissingRule[] {
  try {
    loadRunRules(ctx, needs);
    return [];
  } catch (err) {
    if (err instanceof RulesMissingError) return err.missing;
    throw err;
  }
}

/**
 * The rules one person is calculated under: the company's, with any department or employee override laid over the parameter it names. Pure. The company's own values are
 * never touched; an override that names no rule this function knows is ignored (the service only lets the overridable ones in).
 */
export function applyRuleOverrides(rules: RunRules, overrides: ReadonlyArray<{ ruleKey: string; value: unknown }> | undefined): RunRules {
  if (!overrides || overrides.length === 0) return rules;
  const out: RunRules = { ...rules, pf: { ...rules.pf }, esi: { ...rules.esi } };
  for (const o of overrides) {
    const v = o.value;
    switch (o.ruleKey) {
      case "PF_EMPLOYEE_RATE": out.pf.employeeRate = dec(v as string); break;
      case "PF_EPS_RATE": out.pf.epsRate = dec(v as string); break;
      case "PF_EPF_ER_RATE": out.pf.epfErRate = dec(v as string); break;
      case "PF_EDLI_RATE": out.pf.edliRate = dec(v as string); break;
      case "PF_ADMIN_RATE": out.pf.adminRate = dec(v as string); break;
      case "PF_WAGE_CEILING": out.pf.ceiling = dec(v as string); break;
      case "PF_CEILING_MODE": out.pf.ceilingMode = v as RunRules["pf"]["ceilingMode"]; break;
      case "PF_ELIGIBLE_TYPES": out.pf.eligibleTypes = v as string[]; break;
      case "ESI_EMPLOYEE_RATE": out.esi.employeeRate = dec(v as string); break;
      case "ESI_EMPLOYER_RATE": out.esi.employerRate = dec(v as string); break;
      case "ESI_WAGE_CEILING": out.esi.ceiling = dec(v as string); break;
      case "ESI_PERIOD_RULE": out.esi.periodRule = v as RunRules["esi"]["periodRule"]; break;
      case "ESI_ELIGIBLE_TYPES": out.esi.eligibleTypes = v as string[]; break;
      case "PT_SLABS": out.ptSlabs = v as PtTable; break;
      case "LWF_TABLE": out.lwfTable = v as LwfTable; break;
      default: break;
    }
  }
  return out;
}
