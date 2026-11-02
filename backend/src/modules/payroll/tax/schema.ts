import { z } from "zod";
import { ROUNDING_MODES, dec } from "../money";
import { decimalText, percent } from "../rules/schemas";

// A tax year as a governed item (docs/plans/STAGE_7_PLAN.md). Nothing in it is shipped: every value is entered by the owners, each with the note saying where it came
// from and the date it applies from, and a different director confirms the whole. A value that is absent is Not set, and nothing that needs it can be worked out.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is written year-month-day, for example 2027-04-01");
const note = z.string().trim().min(5, "Say where this number came from (a few words)").max(300);

/** One value with where it came from and the date it applies from. */
function entered<T extends z.ZodType>(value: T) {
  return z.object({ value, sourceNote: note, effectiveFrom: isoDate }).strict();
}

const slab = z.object({ from: decimalText, to: decimalText.nullable(), ratePercent: percent }).strict();
type SlabIn = z.infer<typeof slab>;

/** Slabs run on from one to the next with no gap and no overlap; the first starts at zero and the last has no end. */
function slabsProblems(slabs: SlabIn[], mustStartAtZero: boolean): string[] {
  const problems: string[] = [];
  slabs.forEach((s, i) => {
    if (i === 0 && mustStartAtZero && !dec(s.from).isZero()) problems.push("The first slab starts at 0");
    if (s.to !== null && dec(s.to).lessThanOrEqualTo(dec(s.from))) problems.push(`Slab ${i + 1} ends before it starts`);
    const next = slabs[i + 1];
    if (next && (s.to === null || !dec(next.from).equals(dec(s.to)))) problems.push(`Slab ${i + 2} must start where slab ${i + 1} ends`);
    if (!next && s.to !== null) problems.push("The last slab has no end (leave its end empty)");
  });
  return problems;
}
const slabTable = (mustStartAtZero: boolean) =>
  z.array(slab).min(1).max(20).superRefine((slabs, ctx) => {
    for (const message of slabsProblems(slabs, mustStartAtZero)) ctx.addIssue({ code: "custom", message });
  });

const regimeSchema = z
  .object({
    slabs: entered(slabTable(true)).optional(),
    standardDeduction: entered(decimalText).optional(),
    /** Tax is cancelled up to `maximum` when taxable income is at or below `thresholdIncome`. Marginal relief is not modelled. */
    rebate: entered(z.object({ thresholdIncome: decimalText, maximum: decimalText }).strict()).optional(),
  })
  .strict();

export const SECTION_CODE = /^[A-Z][A-Z0-9_]{1,19}$/;
export const sectionSchema = z
  .object({
    code: z.string().regex(SECTION_CODE, "A section code is capital letters, digits and underscores, starting with a letter"),
    /** What the employee sees. An editable label, never a section number from the code. */
    label: z.string().trim().min(2).max(80),
    appliesTo: z.enum(["OLD", "NEW", "BOTH"]),
    /** The most that counts for this line, or null for no cap of its own. */
    cap: decimalText.nullable(),
    /** One cap shared by several lines. */
    groupCap: z.object({ group: z.string().trim().min(1).max(20), cap: decimalText }).strict().nullable(),
    proofRequired: z.boolean(),
  })
  .strict();
export type SectionDef = z.infer<typeof sectionSchema>;

export const taxYearSchema = z
  .object({
    NEW: regimeSchema.optional(),
    OLD: regimeSchema.optional(),
    /** Surcharge on the tax by taxable income; an empty list means the owners entered "none". Marginal relief is not modelled. */
    surcharge: entered(z.array(slab).max(10).superRefine((s, ctx) => { for (const m of slabsProblems(s, false)) ctx.addIssue({ code: "custom", message: m }); })).optional(),
    cessPercent: entered(percent).optional(),
    defaultRegime: entered(z.enum(["NEW", "OLD"])).optional(),
    rounding: entered(z.object({ mode: z.enum(ROUNDING_MODES as unknown as [string, ...string[]]), scale: z.number().int().min(0).max(2) }).strict()).optional(),
    minimumMonthlyTds: entered(decimalText).optional(),
    /** How one-off pay (arrears, encashment, a bonus) is taxed. Only the month it is paid is built. */
    oneOffs: entered(z.enum(["MONTH_PAID"])).optional(),
    sections: entered(z.array(sectionSchema).max(60).superRefine((list, ctx) => {
      const seen = new Set<string>();
      for (const s of list) {
        if (seen.has(s.code)) ctx.addIssue({ code: "custom", message: `The section code ${s.code} is listed twice` });
        seen.add(s.code);
      }
    })).optional(),
  })
  .strict();
export type TaxYearValue = z.infer<typeof taxYearSchema>;

export class InvalidTaxValueError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
  }
}

export function parseTaxYearValue(raw: unknown): TaxYearValue {
  const r = taxYearSchema.safeParse(raw);
  if (!r.success) throw new InvalidTaxValueError(r.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`));
  return r.data;
}

/** What a tax year still lacks before a TDS can be worked out under the given regimes, in words. Empty when it has everything. */
export function missingForTds(v: TaxYearValue | null, regimes: readonly ("NEW" | "OLD")[] = ["NEW", "OLD"]): string[] {
  const out: string[] = [];
  if (!v) return ["the tax year has no values at all"];
  for (const r of regimes) {
    if (!v[r]?.slabs) out.push(`the ${r === "NEW" ? "new" : "old"} regime's slabs`);
    if (!v[r]?.standardDeduction) out.push(`the ${r === "NEW" ? "new" : "old"} regime's standard deduction`);
    if (!v[r]?.rebate) out.push(`the ${r === "NEW" ? "new" : "old"} regime's rebate`);
  }
  if (!v.surcharge) out.push("the surcharge table");
  if (!v.cessPercent) out.push("the cess percentage");
  if (!v.defaultRegime) out.push("the default regime");
  if (!v.rounding) out.push("the rounding of tax");
  if (!v.minimumMonthlyTds) out.push("the minimum monthly TDS");
  if (!v.oneOffs) out.push("how one-off pay is taxed");
  if (!v.sections) out.push("the section catalogue");
  return out;
}
