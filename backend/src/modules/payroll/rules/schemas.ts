import { z } from "zod";
import { RULE_BY_KEY, type RuleDef } from "@shared/constants/payrollRules";
import { parseFormula, FormulaError } from "../formula";
import { ROUNDING_MODES, canonicalDecimal, dec } from "../money";

// The validation of a rule's value, from the shape in the shared catalog. A value that passes comes out in its canonical form (decimals as
// canonical strings, lists sorted), so the same value always has the same hash, and "type the value again" can be compared exactly.

export const decimalText = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "A plain number, for example 12 or 8.33")
  .transform((s) => canonicalDecimal(dec(s)));

export const percent = decimalText.refine((s) => dec(s).lessThanOrEqualTo(dec("100")), "A percentage cannot be more than 100");
const stateKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "A state key is upper-case letters, digits and underscores, for example TAMIL_NADU");
const EMPLOYMENT_TYPES = ["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"] as const;

const roundingSchema = z
  .object({ mode: z.enum([...ROUNDING_MODES, "NONE"]), scale: z.number().int().min(0).max(6) })
  .strict();

const paymentDateSchema = z
  .object({ monthOffset: z.union([z.literal(0), z.literal(1)]), day: z.union([z.number().int().min(1).max(28), z.literal("LAST")]) })
  .strict();

const ptSlabs = z
  .object({
    states: z.record(
      stateKey,
      z
        .object({
          slabs: z.array(z.object({ fromGross: decimalText, toGross: decimalText.nullable(), monthlyAmount: decimalText }).strict()).min(1),
          monthOverrides: z.record(z.string().regex(/^(?:[1-9]|1[0-2])$/), decimalText).optional(),
        })
        .strict()
        .superRefine((state, ctx) => {
          // Slabs must start at zero, follow one another with no gap or overlap, and the last must be open-ended.
          let expectedFrom = "0";
          state.slabs.forEach((s, i) => {
            if (!dec(s.fromGross).equals(dec(expectedFrom))) ctx.addIssue({ code: "custom", message: `Slab ${i + 1} should start at ${expectedFrom} (slabs must follow each other with no gap or overlap)` });
            const last = i === state.slabs.length - 1;
            if (last && s.toGross !== null) ctx.addIssue({ code: "custom", message: "The last slab must have no upper limit (null)" });
            if (!last) {
              if (s.toGross === null) ctx.addIssue({ code: "custom", message: `Only the last slab can have no upper limit (slab ${i + 1})` });
              else if (dec(s.toGross).lessThanOrEqualTo(dec(s.fromGross))) ctx.addIssue({ code: "custom", message: `Slab ${i + 1} ends before it starts` });
              else expectedFrom = s.toGross;
            }
          });
        }),
    ),
  })
  .strict();

const lwfTable = z
  .object({
    states: z.record(
      stateKey,
      z
        .object({
          employee: decimalText,
          employer: decimalText,
          frequency: z.enum(["MONTHLY", "HALF_YEARLY", "ANNUAL"]),
          months: z.array(z.number().int().min(1).max(12)).min(1),
        })
        .strict(),
    ),
  })
  .strict();

const stateNameMap = z.record(z.string().trim().min(1).max(60), stateKey);
const payslipLayout = z.object({ showEmployerContributions: z.boolean(), showYearToDate: z.boolean() }).strict();

const JSON_SCHEMAS: Record<string, z.ZodType> = {
  PT_SLABS: ptSlabs,
  LWF_TABLE: lwfTable,
  STATE_NAME_MAP: stateNameMap,
  PAYSLIP_LAYOUT: payslipLayout,
};

const formulaSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .superRefine((text, ctx) => {
    try {
      parseFormula(text);
    } catch (err) {
      ctx.addIssue({ code: "custom", message: err instanceof FormulaError ? err.message : "Not a valid formula" });
    }
  });

export function valueSchemaFor(def: RuleDef): z.ZodType {
  const s = def.shape;
  switch (s.kind) {
    case "percent":
      return percent;
    case "money":
      return decimalText;
    case "integer":
      return z.number().int().min(s.min).max(s.max);
    case "choice":
      return z.enum(s.choices as [string, ...string[]]);
    case "boolean":
      return z.boolean();
    case "text":
      return z.string().trim().min(1).max(100);
    case "formula":
      return formulaSchema;
    case "rounding":
      return roundingSchema;
    case "paymentDate":
      return paymentDateSchema;
    case "employmentTypes":
      return z
        .array(z.enum(EMPLOYMENT_TYPES))
        .min(1)
        .transform((a) => [...new Set(a)].sort());
    case "json": {
      const schema = JSON_SCHEMAS[def.key];
      if (!schema) throw new Error(`No value schema for the structured rule ${def.key}`);
      return schema;
    }
  }
}

export class InvalidRuleValueError extends Error {
  constructor(
    public readonly key: string,
    public readonly issues: string[],
  ) {
    super(`${key}: ${issues.join("; ")}`);
  }
}

/** The canonical form of a value for a rule, or an InvalidRuleValueError that says what is wrong in words. */
export function parseRuleValue(key: string, raw: unknown): unknown {
  const def = RULE_BY_KEY[key];
  if (!def) throw new InvalidRuleValueError(key, ["There is no such rule."]);
  const result = valueSchemaFor(def).safeParse(raw);
  if (!result.success) throw new InvalidRuleValueError(key, result.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)));
  return result.data;
}
