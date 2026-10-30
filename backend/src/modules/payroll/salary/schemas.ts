import { z } from "zod";
import { COMPONENT_TYPES, HEAD_KINDS, HEAD_KINDS_NOT_IN_STRUCTURE, ITEM_CODE_PATTERN, RESERVED_COMPONENT_CODES, type ComponentType } from "@shared/constants/payrollSalary";
import { FormulaError, parseFormula } from "../formula";
import { dec } from "../money";
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is written year-month-day, for example 2027-04-01");

// A pay head. The first block is what a component has always had. The second is what the directors may add; every one of them is optional so that a stored
// version from before them still reads, and "absent" always means Not set, never a default. `taxable: null` is "Not set": a head in that state cannot go into a
// structure or a salary.
export const componentValueSchema = z
  .object({
    name: z.string().trim().min(2, "Give it a name").max(60),
    type: z.enum(COMPONENT_TYPES),
    taxable: z.boolean().nullable(),
    pfApplicable: z.boolean(),
    esiApplicable: z.boolean(),
    prorates: z.boolean(),
    payslipLabel: z.string().trim().min(1, "Say what it is called on the payslip").max(60),
    payslipOrder: z.number().int().min(1).max(999),
    headKind: z.enum(HEAD_KINDS).optional(),
    oneTime: z.boolean().optional(),
    carryForward: z.boolean().optional(),
    reimbursement: z.boolean().optional(),
    ctcGroup: z.string().trim().min(1).max(40).optional(),
    ytd: z.boolean().optional(),
    bankTransfer: z.boolean().optional(),
    payslipVisible: z.boolean().optional(),
    activeFrom: isoDate.optional(),
    activeTo: isoDate.optional(),
    arrearsHead: code.optional(),
    reversalHead: code.optional(),
    /** Takes its value from the Monthly Inputs grid each month (Stage 4 builds a column for it); it is not worked out from CTC, so it is never a structure line. */
    inputItem: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.activeFrom && v.activeTo && v.activeTo < v.activeFrom) ctx.addIssue({ code: "custom", path: ["activeTo"], message: "The last day cannot be before the first day" });
    if (v.reimbursement && v.headKind && v.headKind !== "REIMBURSEMENT" && v.headKind !== "EARNING") ctx.addIssue({ code: "custom", path: ["reimbursement"], message: "Only an earning or a reimbursement can be flagged as a reimbursement" });
  });
export type ComponentValue = z.infer<typeof componentValueSchema>;

// A lookup table: the first slab whose from <= value < to applies (to = null is open-ended). Entered by the directors; nothing is shipped.
const slabSchema = z.object({ from: decimalText, to: decimalText.nullable(), amount: decimalText }).strict();
const calcSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("PERCENT"), of: z.string().min(1), percent }).strict(),
  z.object({ method: z.literal("FIXED_AMOUNT"), amount: decimalText }).strict(),
  z.object({ method: z.literal("PER_PERSON") }).strict(),
  z.object({ method: z.literal("FORMULA"), formula: z.string().trim().min(1).max(200) }).strict(),
  z.object({ method: z.literal("BALANCE") }).strict(),
  z.object({ method: z.literal("SLAB"), of: z.string().min(1), slabs: z.array(slabSchema).min(1).max(40) }).strict(),
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

/** What has to be chosen before a head can be used in a structure or a salary. Empty when nothing is Not set. */
export function notSetChoices(v: ComponentValue): string[] {
  const out: string[] = [];
  if (v.taxable === null) out.push("whether it is taxable");
  return out;
}

/** A head is active on a day when that day is inside its from/to dates (a missing date is open on that side). */
export function isActiveOn(v: Pick<ComponentValue, "activeFrom" | "activeTo">, day: string): boolean {
  return (!v.activeFrom || v.activeFrom <= day) && (!v.activeTo || v.activeTo >= day);
}

/** Why a head cannot be a line of a structure, or null. Pure: the caller supplies the day. */
export function unusableInStructure(code: string, v: ComponentValue, day: string): string | null {
  if (v.headKind && HEAD_KINDS_NOT_IN_STRUCTURE.includes(v.headKind)) {
    return `${code} is a ${v.headKind === "COUNTER" ? "counter, which feeds formulas and is not a paid line" : "statutory head, which the calculator produces from rules"}, so it cannot be a line of a structure.`;
  }
  if (v.inputItem) return `${code} takes its value from Monthly Inputs each month, so it is not worked out from CTC and cannot be a line of a structure.`;
  const missing = notSetChoices(v);
  if (missing.length) return `${code} has ${missing.join(" and ")} not set yet. Choose it (and have a different director confirm) before using the head.`;
  if (!isActiveOn(v, day)) return `${code} is not active on ${day} (it runs ${v.activeFrom ?? "from the start"} to ${v.activeTo ?? "no end date"}).`;
  return null;
}

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
    if (line.calc.method === "SLAB") {
      const of = line.calc.of;
      if (of !== "CTC" && !seen.has(of)) problems.push(`${at}: a table is looked up by CTC or by a line above it, and "${of}" is neither`);
      const slabs = line.calc.slabs;
      for (const [k, sl] of slabs.entries()) {
        if (sl.to !== null && !dec(sl.to).greaterThan(dec(sl.from))) problems.push(`${at}, row ${k + 1}: "up to" has to be more than "from"`);
        if (sl.to === null && k !== slabs.length - 1) problems.push(`${at}, row ${k + 1}: only the last row can have no upper limit`);
        const prev = slabs[k - 1];
        if (prev && (prev.to === null || dec(sl.from).lessThan(dec(prev.to)))) problems.push(`${at}, row ${k + 1}: rows must not overlap and must be in order`);
      }
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
      const refs = line.calc.method === "PERCENT" || line.calc.method === "SLAB" ? [line.calc.of] : line.calc.method === "FORMULA" ? safeIdentifiers(line.calc.formula) : [];
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

export interface CalculationStep {
  component: string;
  /** Position in the order the lines are worked out (1 first). */
  step: number;
  /** The earlier lines (and CTC) this line reads. */
  dependsOn: string[];
}

/**
 * The order a structure's lines are worked out in, derived from what each reads (a percentage's base, a table's key, the names in a formula), not from how it was
 * typed. A line can read only CTC or a line above it, so the typed order is always valid; this shows the dependencies and orders by them, ties by typed position.
 */
export function calculationOrder(structure: StructureValue): CalculationStep[] {
  const codes = structure.lines.map((l) => l.component);
  const deps = structure.lines.map((l) => {
    const c = l.calc;
    const names = c.method === "PERCENT" || c.method === "SLAB" ? [c.of] : c.method === "FORMULA" ? safeIdentifiers(c.formula) : c.method === "BALANCE" ? codes.filter((x) => x !== l.component) : [];
    return [...new Set(names)].filter((n) => n === "CTC" || n === "ANNUAL_CTC" || codes.includes(n)).sort();
  });
  const done = new Set<string>();
  const out: CalculationStep[] = [];
  const remaining = structure.lines.map((l, i) => i);
  while (remaining.length) {
    const ready = remaining.find((i) => deps[i]!.every((d) => d === "CTC" || d === "ANNUAL_CTC" || done.has(d)));
    const pick = ready ?? remaining[0]!; // cannot happen for a valid structure; keeps the function total
    remaining.splice(remaining.indexOf(pick), 1);
    done.add(codes[pick]!);
    out.push({ component: codes[pick]!, step: out.length + 1, dependsOn: deps[pick]! });
  }
  return out;
}
