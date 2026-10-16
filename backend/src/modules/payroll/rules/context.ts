import { RULE_BY_KEY, TEST_WATERMARK_TEXT } from "@shared/constants/payrollRules";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { dec, type Money } from "../money";

// How a payroll calculation reads a rule, and how a run proves what it used (docs/plans/PHASE_6.md §3, §1).
//
//   const ctx = await RuleContext.load();        // the current version of every rule, as it is now
//   const ceiling = ctx.decimal("PF_WAGE_CEILING");   // reads it, and PINS (key, version, value hash)
//   run.pins = ctx.pins();                       // exactly the rules that were read, nothing more, nothing less
//
// The pin is a side effect of the read, so a rule cannot be used without being pinned, and a rule that was not needed (PF switched off for
// everyone) is not pinned and therefore cannot block a run. A pin is judged against the LIVE state each time it is asked about:
//   - Confirmed or Placeholder is whether a confirmation exists for that exact version and value;
//   - stale is whether a newer version has since been written (the run must be recalculated before it can go any further).

export interface RulePin {
  key: string;
  version: number;
  valueHash: string;
}

export class RuleNotSetError extends HttpError {
  constructor(public readonly key: string) {
    super(409, `The rule "${RULE_BY_KEY[key]?.label ?? key}" has no value yet. An administrator needs to enter one (Payroll, Rules and setup) before this can be calculated.`, "RULE_NOT_SET", { key });
    this.name = "RuleNotSetError";
  }
}

interface Current {
  version: number;
  valueHash: string;
  value: unknown;
}

export class RuleContext {
  private readonly pinned = new Map<string, RulePin>();
  private constructor(private readonly current: ReadonlyMap<string, Current>) {}

  static async load(): Promise<RuleContext> {
    const rows = await prisma.payrollItemVersion.findMany({ where: { kind: "RULE" }, orderBy: [{ key: "asc" }, { version: "asc" }] });
    const latest = new Map<string, Current>();
    for (const r of rows) latest.set(r.key, { version: r.version, valueHash: r.valueHash, value: r.value });
    return new RuleContext(latest);
  }

  /** Test helper: a context over given values, so a calculation can be exercised without the database. Every value is version 1. */
  static fromValuesForTests(values: Record<string, unknown>): RuleContext {
    if (!process.env.VITEST) throw new Error("for tests only");
    return new RuleContext(new Map(Object.entries(values).map(([k, v]) => [k, { version: 1, valueHash: `test:${k}`, value: v }])));
  }

  /** Read a rule's value (its canonical stored form). Pins it. Throws RuleNotSetError if nobody has entered a value. */
  rule<T = unknown>(key: string): T {
    if (!RULE_BY_KEY[key]) throw new Error(`There is no payroll rule called ${key}`);
    const c = this.current.get(key);
    if (!c) throw new RuleNotSetError(key);
    this.pinned.set(key, { key, version: c.version, valueHash: c.valueHash });
    return c.value as T;
  }

  /** A money, percentage or integer rule as an exact decimal. */
  decimal(key: string): Money {
    const v = this.rule<unknown>(key);
    if (typeof v === "string") return dec(v);
    if (typeof v === "number" && Number.isInteger(v)) return dec(String(v));
    throw new Error(`The rule ${key} is not a number`);
  }

  isSet(key: string): boolean {
    return this.current.has(key);
  }

  /** Exactly the rules read so far, sorted by key. */
  pins(): RulePin[] {
    return [...this.pinned.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}

export interface PinStatus {
  pin: RulePin;
  label: string;
  status: "CONFIRMED" | "PLACEHOLDER";
  /** A newer version of this rule exists than the one the run used. */
  stale: boolean;
  currentVersion: number;
}

/** The live state of each pin: is the exact pinned version confirmed, and is it still the current one. */
export async function pinStatuses(pins: readonly RulePin[]): Promise<PinStatus[]> {
  if (pins.length === 0) return [];
  const keys = pins.map((p) => p.key);
  const [versions, confirmations] = await Promise.all([
    prisma.payrollItemVersion.groupBy({ by: ["key"], where: { kind: "RULE", key: { in: keys } }, _max: { version: true } }),
    prisma.payrollItemConfirmation.findMany({ where: { kind: "RULE", key: { in: keys } }, select: { key: true, version: true, valueHash: true } }),
  ]);
  const latest = new Map(versions.map((v) => [v.key, v._max.version ?? 0]));
  const confirmed = new Set(confirmations.map((c) => `${c.key}@${c.version}@${c.valueHash}`));
  return pins.map((pin) => ({
    pin,
    label: RULE_BY_KEY[pin.key]?.label ?? pin.key,
    status: confirmed.has(`${pin.key}@${pin.version}@${pin.valueHash}`) ? "CONFIRMED" : "PLACEHOLDER",
    stale: (latest.get(pin.key) ?? 0) > pin.version,
    currentVersion: latest.get(pin.key) ?? 0,
  }));
}

/**
 * The first line of every action that makes a run real: submit, approve, finalise, publish, bank file. A single Placeholder anywhere in what the
 * run used refuses it, naming each one; so does a run built on a rule that has since been edited.
 */
export async function assertRunIsReal(pins: readonly RulePin[], action: string): Promise<void> {
  const statuses = await pinStatuses(pins);
  const placeholders = statuses.filter((s) => s.status === "PLACEHOLDER");
  if (placeholders.length > 0) {
    throw new HttpError(
      409,
      `This cannot be ${action} while ${placeholders.length === 1 ? "a rule it used is" : `${placeholders.length} rules it used are`} still a Placeholder: ${placeholders.map((p) => p.label).join(", ")}. A different person has to confirm ${placeholders.length === 1 ? "it" : "them"}. A run on placeholder rules is a test.`,
      "PLACEHOLDER_RULES",
      { rules: placeholders.map((p) => ({ key: p.pin.key, label: p.label })) },
    );
  }
  const stale = statuses.filter((s) => s.stale);
  if (stale.length > 0) {
    throw new HttpError(409, `A rule this used has been changed since it was calculated: ${stale.map((s) => s.label).join(", ")}. Calculate it again first.`, "RULES_CHANGED", { rules: stale.map((s) => ({ key: s.pin.key, label: s.label })) });
  }
}

// ── The watermark ──

export interface Watermark {
  test: boolean;
  text: string;
  rules: Array<{ key: string; label: string }>;
}

/** What every screen, workbook and payslip preview of a run carries. `test` is true if any rule it used is a Placeholder. */
export function watermarkFromStatuses(statuses: readonly PinStatus[]): Watermark {
  const placeholders = statuses.filter((s) => s.status === "PLACEHOLDER");
  return { test: placeholders.length > 0, text: TEST_WATERMARK_TEXT, rules: placeholders.map((p) => ({ key: p.pin.key, label: p.label })) };
}

export async function watermarkFor(pins: readonly RulePin[]): Promise<Watermark> {
  return watermarkFromStatuses(await pinStatuses(pins));
}
