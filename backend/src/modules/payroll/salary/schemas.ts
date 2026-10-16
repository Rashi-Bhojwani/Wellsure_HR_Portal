import { z } from "zod";
import { COMPONENT_TYPES, ITEM_CODE_PATTERN, RESERVED_COMPONENT_CODES, type ComponentType } from "@shared/constants/payrollSalary";
import { FormulaError, parseFormula } from "../formula";
import { decimalText, percent } from "../rules/schemas";

// What a salary component and a salary structure look like as stored values (docs/plans/PHASE_6.md §14B). A value that passes comes out in canonical
// form (decimals as canonical strings, text trimmed), so the same value always has the same hash.
//   a COMPONENT says what a line IS: its name, whether it is an earning or a deduction, and which statutory and tax treatments apply to it.
//   a STRUCTURE says how much each line gets: percentages, fixed amounts, per-person amounts, formulas, and the balance.

export class InvalidSalaryValueError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
  }
}

const code = z
  .string()
  .regex(ITEM_CODE_PATTERN, "A code is capital letters, digits and underscores, starting with a letter (for example BASIC or SPECIAL_ALLOWANCE)")
  .refine((c) => !(RESERVED_COMPONENT_CODES as readonly string[]).includes(c), "That code is reserved: PF, ESI, PT, LWF and TDS are produced by the calculator from rules, and CTC and ARREARS have fixed meanings");

export const componentValueSchema = z
  .object({
    name: z.string().trim().min(2, "Give it a name").max(60),
    type: z.enum(COMPONENT_TYPES),
    taxable: z.boolean(),
    pfApplicable: z.boolean(),
    esiApplicable: z.boolean(),
    prorates: z.boolean(),
    payslipLabel: z.string().trim().min(1, "Say what it is called on the payslip").max(60),
    payslipOrder: z.number().int().min(1).max(999),
  })
  .strict();
export type ComponentValue = z.infer<typeof componentValueSchema>;

const calcSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("PERCENT"), of: z.string().min(1), percent }).strict(),
  z.object({ method: z.literal("FIXED_AMOUNT"), amount: decimalText }).strict(),
  z.object({ method: z.literal("PER_PERSON") }).strict(),
  z.object({ method: z.literal("FORMULA"), formula: z.string().trim().min(1).max(200) }).strict(),
  z.object({ method: z.literal("BALANCE") }).strict(),
]);
export type LineCalc = z.infer<typeof calcSchema>;

const lineSchema = z.object({ component: code, componentVersion: z.number().int().min(1), componentHash: z.string().min(8), calc: calcSchema }).strict();
export type StructureLine = z.infer<typeof lineSchema>;

export const structureValueSchema = z
  .object({
    name: z.string().trim().min(2, "Give it a name").max(60),
    description: z.string().trim().max(200).default(""),
    /** Which component types count toward CTC. The lines of these types must add up to CTC. */
    ctcIncludes: z.array(z.enum(COMPONENT_TYPES)).min(1, "Say which kinds of line count toward CTC"),
    lines: z.array(lineSchema).min(1, "A structure needs at least one line").max(40),
  })
  .strict();
export type StructureValue = z.infer<typeof structureValueSchema>;

const issuesOf = (err: z.ZodError): string[] => err.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`);

export function parseComponentValue(raw: unknown): ComponentValue {
  const r = componentValueSchema.safeParse(raw);
  if (!r.success) throw new InvalidSalaryValueError(issuesOf(r.error));
  return r.data;
}

export function parseItemCode(raw: unknown): string {
  const r = code.safeParse(raw);
  if (!r.success) throw new InvalidSalaryValueError(issuesOf(r.error));
  return r.data;
}

/** The names a structure formula or percentage may use besides earlier lines. */
export const STRUCTURE_BASE_NAMES = ["CTC", "ANNUAL_CTC"] as const;

/**
 * The shape of a structure, and the rules that need no database: unique components, a line may refer only to an earlier line, at most one balance
 * line and nothing may refer to it, formulas parse and use only known names, ctcIncludes has no repeats. (That every component exists, and that the
 * lines add up to CTC, are checked where the components and a sample CTC are known: salary/structures.ts.)
 */
export function parseStructureValue(raw: unknown, typeOf: (componentCode: string) => ComponentType | undefined): StructureValue {
  const r = structureValueSchema.safeParse(raw);
  if (!r.success) throw new InvalidSalaryValueError(issuesOf(r.error));
  const v = r.data;
  const problems: string[] = [];
  if (new Set(v.ctcIncludes).size !== v.ctcIncludes.length) problems.push("ctcIncludes: each kind once");
  const seen = new Set<string>();
  let balance: string | null = null;
  for (const [i, line] of v.lines.entries()) {
    const at = `line ${i + 1} (${line.component})`;
    if (seen.has(line.component)) problems.push(`${at}: this component is already in the structure`);
    if (line.calc.method === "BALANCE") {
      if (balance) problems.push(`${at}: only one line can be the balance (${balance} already is)`);
      balance = line.component;
      const t = typeOf(line.component);
      if (t && !v.ctcIncludes.includes(t)) problems.push(`${at}: the balance line has to be a kind that counts toward CTC`);
    }
    if (line.calc.method === "PERCENT") {
      const of = line.calc.of;
      if (of !== "CTC" && !seen.has(of)) problems.push(`${at}: a percentage can be of CTC or of a line above it, and "${of}" is neither`);
    }
    if (line.calc.method === "FORMULA") {
      try {
        const { identifiers } = parseFormula(line.calc.formula);
        const unknown = identifiers.filter((n) => !(STRUCTURE_BASE_NAMES as readonly string[]).includes(n) && !seen.has(n));
        if (unknown.length) problems.push(`${at}: the formula uses ${unknown.join(", ")}, which ${unknown.length > 1 ? "are" : "is"} neither CTC nor a line above it`);
      } catch (err) {
        if (!(err instanceof FormulaError)) throw err;
        problems.push(`${at}: ${err.message}`);
      }
    }
    seen.add(line.component);
  }
  if (balance) {
    for (const [i, line] of v.lines.entries()) {
      const refs = line.calc.method === "PERCENT" ? [line.calc.of] : line.calc.method === "FORMULA" ? safeIdentifiers(line.calc.formula) : [];
      if (refs.includes(balance)) problems.push(`line ${i + 1} (${line.component}): nothing can be worked out from the balance line, because the balance depends on every other line`);
    }
  }
  if (problems.length) throw new InvalidSalaryValueError(problems);
  return v;
}

function safeIdentifiers(formula: string): string[] {
  try {
    return parseFormula(formula).identifiers;
  } catch {
    return [];
  }
}
