import { RULE_BY_KEY } from "@shared/constants/payrollRules";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { loadItems, summarise } from "../items";
import type { RulePin } from "../rules/context";
import type { PayslipContent } from "./payslip";

// The payslip "Why?": for every line of a payslip, where the figure came from, in words, and for each rule the run read to get it: its value, the source note the
// directors wrote down, the date it applies from, who confirmed it and when, and whether it came from an override (and at which level). It is built from the final
// run's stored lines and the rule versions the run pinned, so it can never say something the run did not do. Nothing is looked up from today's rules.

export interface WhyRule {
  key: string;
  label: string;
  value: unknown;
  version: number;
  status: "CONFIRMED" | "PLACEHOLDER" | "NOT_SET";
  sourceNote: string | null;
  effectiveFrom: string | null;
  enteredBy: string | null;
  confirmedBy: string | null;
  confirmedOn: string | null;
  /** COMPANY unless a department or employee override supplied the value (Stage 3.4). */
  level: "COMPANY" | "DEPARTMENT" | "EMPLOYEE";
  overridden: boolean;
  registrationRef: string | null;
}

export interface WhyLine {
  code: string;
  label: string;
  kind: string;
  source: string;
  amount: string;
  /** What this line is, in sentences. */
  explanation: string[];
  /** The figures behind it, as the run recorded them. */
  working: Array<{ name: string; value: string }>;
  rules: WhyRule[];
}

/** The rules each kind of line is worked out from. Only those the run actually read (pinned) are shown. */
const RULES_FOR_SOURCE: Record<string, string[]> = {
  COMPONENT: ["PAY_DAYS_BASIS", "LOP_DIVISOR", "FIXED_DAYS_VALUE", "LINE_ROUNDING", "HEAD_ROUNDING"],
  ADJUSTMENT: [],
  ARREARS: ["ARREARS_PAYOUT", "ARREARS_PF_ESI", "ARREAR_ON_ARREAR", "LINE_ROUNDING"],
  LOP_REVERSAL: ["ARREARS_PF_ESI", "LOP_REVERSAL_LOOKBACK_MONTHS", "LOP_REVERSAL_OVERRIDE_ALLOWED", "LINE_ROUNDING", "HEAD_ROUNDING", "LOP_DIVISOR"],
  HOLD_RELEASE: [],
  ENCASHMENT: ["ENCASH_DAILY_RATE_FORMULA", "ENCASH_PF_APPLICABLE", "ENCASH_PAYOUT_RULE"],
  PF: ["PF_EMPLOYEE_RATE", "PF_EPS_RATE", "PF_EPF_ER_RATE", "PF_EDLI_RATE", "PF_ADMIN_RATE", "PF_WAGE_CEILING", "PF_CEILING_MODE", "PF_ELIGIBLE_TYPES", "PF_ROUNDING"],
  ESI: ["ESI_EMPLOYEE_RATE", "ESI_EMPLOYER_RATE", "ESI_WAGE_CEILING", "ESI_PERIOD_RULE", "ESI_ELIGIBLE_TYPES", "ESI_ROUNDING"],
  PT: ["PT_SLABS", "PT_STATE_OF_PLACEMENT", "STATE_NAME_MAP"],
  LWF: ["LWF_TABLE", "STATE_NAME_MAP"],
  NET_ROUNDING: ["NET_PAY_ROUNDING"],
};

const SENTENCE: Record<string, (l: { label: string; amount: string; basis: Record<string, unknown> }) => string[]> = {
  COMPONENT: (l) => {
    const b = l.basis;
    const prorated = b.prorates === true;
    return [prorated ? `${l.label} is its monthly amount for the days you were paid, worked out as an exact fraction of the month and rounded once.` : `${l.label} is paid in full for the month; it is not reduced for days.`];
  },
  ARREARS: (l) => [`${l.label} is the difference between what you should have been paid and what you were paid for a month that was already closed, after a salary revision dated into it.`],
  LOP_REVERSAL: (l) => [`${l.label} gives back (or takes) loss of pay for a month that was already closed, after attendance was corrected. The closed month itself was not changed.`],
  HOLD_RELEASE: (l) => [`${l.label}: that month's salary was held by a director and has now been released. Its deductions were worked out in that month, so nothing more is taken from it.`],
  ADJUSTMENT: (l) => [`${l.label} is a one-off amount added before this run.`],
  ENCASHMENT: (l) => [`${l.label} is the year-end encashment of leave, paid in this run.`],
  PF: (l) => [`${l.label} is worked out from the PF wages and the rates and ceiling below.`],
  ESI: (l) => [`${l.label} is worked out from the ESI wages and the rates and ceiling below.`],
  PT: (l) => [`${l.label} is the professional tax slab for your state and gross pay, from the table below.`],
  LWF: (l) => [`${l.label} is the labour welfare fund amount for your state and this month, from the table below.`],
  NET_ROUNDING: () => ["The rounding that took your net pay to its final figure, by the rule below."],
};

/** Plain figures out of a line's recorded working: strings, numbers and booleans at the top level (nested tables are not repeated). */
function workingOf(basis: Record<string, unknown>): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const [k, v] of Object.entries(basis)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.push({ name: k, value: String(v) });
    else if (v && typeof v === "object" && !Array.isArray(v) && "mode" in v && "scale" in v) out.push({ name: k, value: `${(v as { mode: string }).mode}, ${(v as { scale: number }).scale} places` });
  }
  return out;
}

async function ruleFacts(pins: RulePin[], wanted: Set<string>): Promise<Map<string, WhyRule>> {
  const used = pins.filter((p) => (p.kind ?? "RULE") === "RULE" && !p.unset && wanted.has(p.key));
  const out = new Map<string, WhyRule>();
  if (used.length === 0) return out;
  const data = await loadItems("RULE", used.map((p) => p.key));
  for (const pin of used) {
    const history = summarise(data, pin.key).history;
    const v = history.find((h) => h.version === pin.version);
    if (!v) continue;
    out.set(pin.key, {
      key: pin.key,
      label: RULE_BY_KEY[pin.key]?.label ?? pin.key,
      value: RULE_BY_KEY[pin.key]?.sensitiveClass ? null : v.value,
      version: v.version,
      status: v.confirmation ? "CONFIRMED" : "PLACEHOLDER",
      sourceNote: v.sourceNote || null,
      effectiveFrom: v.effectiveFrom,
      enteredBy: v.authorUserId ? v.authorName : null,
      confirmedBy: v.confirmation?.confirmedByName ?? null,
      confirmedOn: v.confirmation ? v.confirmation.confirmedAt.slice(0, 10) : null,
      level: "COMPANY",
      overridden: false,
      registrationRef: null,
    });
  }
  return out;
}

export interface PayslipWhy {
  payslipId: string;
  cycleLabel: string;
  lines: WhyLine[];
}

export async function whyForPayslip(payslip: { id: string; runItemId: string; runId: string; cycleLabel: string; content: unknown }): Promise<PayslipWhy> {
  const run = await prisma.payrollRun.findUnique({ where: { id: payslip.runId }, select: { pins: true } });
  if (!run) throw new HttpError(404, "There is no such payslip.", "NOT_FOUND");
  const lines = await prisma.payrollRunLine.findMany({ where: { runItemId: payslip.runItemId }, orderBy: { sortOrder: "asc" } });
  const pins = (run.pins as unknown as RulePin[]) ?? [];
  const showsEmployer = ((payslip.content as PayslipContent).employerContributions ?? []).length > 0;
  const wanted = new Set(Object.values(RULES_FOR_SOURCE).flat());
  const facts = await ruleFacts(pins, wanted);
  const out: WhyLine[] = [];
  for (const l of lines) {
    if (l.kind === "EMPLOYER_CONTRIBUTION" && !showsEmployer) continue;
    const basis = (l.basis as Record<string, unknown>) ?? {};
    const keys = RULES_FOR_SOURCE[l.source] ?? [];
    const rules = keys.map((k) => facts.get(k)).filter((r): r is WhyRule => r !== undefined);
    // A head with its own rounding shows that rule; the general rule is shown otherwise.
    const headRounded = rules.find((r) => r.key === "HEAD_ROUNDING" && r.value && typeof r.value === "object" && l.code in (r.value as Record<string, unknown>));
    const shown = rules.filter((r) => r.key !== "HEAD_ROUNDING" || r === headRounded);
    out.push({
      code: l.code,
      label: l.label,
      kind: l.kind,
      source: l.source,
      amount: l.amount.toString(),
      explanation: (SENTENCE[l.source] ?? (() => []))({ label: l.label, amount: l.amount.toString(), basis }),
      working: workingOf(basis),
      rules: shown,
    });
  }
  return { payslipId: payslip.id, cycleLabel: payslip.cycleLabel, lines: out };
}
