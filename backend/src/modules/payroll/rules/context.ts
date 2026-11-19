import { RULE_BY_KEY, TEST_WATERMARK_TEXT } from "@shared/constants/payrollRules";
import { PACK_RULES, PACK_VERSION, entryOn } from "@shared/constants/statutoryDefaults";
import { businessToday } from "../../../lib/businessDate";
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

export type PinKind = "RULE" | "RULE_OVERRIDE" | "COMPONENT" | "STRUCTURE" | "TAX_YEAR" | "PACK" | "NOT_SET";

// What a run read, and the exact version it read. Absent `kind` means a rule and absent `live` means true, so a pin written before these existed hashes the same.
//   live: false   a figure that was FROZEN earlier and is not re-read: the structure, components and rounding a salary row was built under. A newer
//                 version of those does not make a run stale (people are deliberately left on the old one until a revision moves them), but if the
//                 version the row was frozen under is a Placeholder, the run is still a test.
//   kind NOT_SET  (owner decision 2026-11-17) professional tax or LWF with no director table: nothing is deducted and the run, payslip and Ready say "not set". It
//                 does not make a monthly run a test (owners decide these themselves; they do not block a month) and is stale once a director enters the table.
//   unset: true   a rule that has no value at all, and was allowed to count as nothing (PT slabs, LWF table): version 0. It counts as a Placeholder, so
//                 "zero because nobody set it" can never be mistaken for a confirmed figure.
export interface RulePin {
  key: string;
  version: number;
  valueHash: string;
  kind?: PinKind;
  live?: boolean;
  unset?: boolean;
}

export const UNSET_VALUE_HASH = "not-set";

// The Standard statutory defaults pack (docs/plans/STATUTORY_DEFAULTS_PLAN.md). A rule nobody has entered reads the pack's entry in force on the context's day; a
// director's value (confirmed or not) is always used instead, exactly as before. A pack value is pinned as kind PACK (key, pack version, the entry's hash) and counts as
// in force, never as a Placeholder, so standard values never make a run a test; a director's own unconfirmed value still does.
export const packPinHash = (key: string, entry: { from: string; value: unknown }): string => `pack:${PACK_VERSION}:${key}:${entry.from}:${JSON.stringify(entry.value)}`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

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
  /** Set when the value is the pack's (no confirmed director value): the entry's first day. */
  packFrom?: string;
}

export class RuleContext {
  private readonly pinned = new Map<string, RulePin>();
  private constructor(private readonly current: ReadonlyMap<string, Current>) {}

  /** `asOf`: the day whose pack values apply (a run passes its cycle's last day; anything else, today). */
  static async load(opts: { asOf?: Date } = {}): Promise<RuleContext> {
    const rows = await prisma.payrollItemVersion.findMany({ where: { kind: "RULE" }, orderBy: [{ key: "asc" }, { version: "asc" }] });
    const latest = new Map<string, Current>();
    // A version authored by nobody is a figure an older build shipped "from memory". It is never used: that rule is Not set until a director enters it.
    for (const r of rows) {
      if (r.authorUserId === null) continue;
      latest.set(r.key, { version: r.version, valueHash: r.valueHash, value: r.value });
    }
    // Standard defaults pack: only where no director has entered anything (never over a director's value, confirmed or not), the entry in force on the context's day.
    const day = isoDay(opts.asOf ?? businessToday());
    for (const [key, series] of Object.entries(PACK_RULES)) {
      if (latest.has(key)) continue;
      const entry = entryOn(series, day);
      if (entry) latest.set(key, { version: PACK_VERSION, valueHash: packPinHash(key, entry), value: entry.value, packFrom: entry.from });
    }
    return new RuleContext(latest);
  }

  /** The pack entry a covered rule is using (null when a director's confirmed value is in force, or the rule is not covered). */
  packFrom(key: string): string | null {
    return this.current.get(key)?.packFrom ?? null;
  }

  /**
   * A rule that may legitimately have no value yet. Returns null (and pins it as "not set", which the gate and the watermark treat as a Placeholder)
   * rather than stopping the calculation; once it has a value, the run is stale until it is calculated again.
   */
  /** A rule that is genuinely optional (nothing changes without it): its value if there is one, else null, and a missing value is NOT pinned as "not set", so it never turns a run into a test. */
  ifSet<T = unknown>(key: string): T | null {
    if (!RULE_BY_KEY[key]) throw new Error(`There is no payroll rule called ${key}`);
    return this.current.has(key) ? this.rule<T>(key) : null;
  }

  optional<T = unknown>(key: string): T | null {
    if (!RULE_BY_KEY[key]) throw new Error(`There is no payroll rule called ${key}`);
    if (!this.current.has(key)) {
      this.pinned.set(key, { key, version: 0, valueHash: UNSET_VALUE_HASH, unset: true });
      return null;
    }
    return this.rule<T>(key);
  }

  /** Records a figure that was frozen earlier (a salary row's structure, component or rounding) so the run is judged on it too. Not re-read, so never stale. */
  addFrozenPin(pin: Required<Pick<RulePin, "kind" | "key" | "version" | "valueHash">>): void {
    this.pinned.set(`${pin.kind}|${pin.key}|${pin.version}`, { ...pin, live: false });
  }

  /** Records a pack value read outside the rule catalog (the tax year, a state's no-levy answer), so the run shows it and goes stale if it changes. */
  addPackPin(key: string, valueHash: string): void {
    this.pinned.set(`PACK|${key}`, { key, version: PACK_VERSION, valueHash, kind: "PACK" });
  }

  /** Owner decision 2026-11-17: professional tax or LWF that no director has set. Nothing is computed for it; the pin says so on the run and payslip. */
  addNotSetPin(key: "PT_SLABS" | "LWF_TABLE"): void {
    this.pinned.set(`NOT_SET|${key}`, { key, version: 0, valueHash: UNSET_VALUE_HASH, kind: "NOT_SET" });
  }

  /** Records a salary component read live (an adjustment's flags). */
  addLivePin(pin: Required<Pick<RulePin, "kind" | "key" | "version" | "valueHash">>): void {
    this.pinned.set(`${pin.kind}|${pin.key}|${pin.version}|live`, { ...pin, live: true });
  }

  /** The current version number of every rule that has one: the fingerprint of the rule set a calculation starts from. */
  versions(): Record<string, number> {
    return Object.fromEntries([...this.current].sort((a, b) => a[0].localeCompare(b[0])).map(([k, c]) => [k, c.version]));
  }

  /** Test helper: a context over given values, so a calculation can be exercised without the database. Every value is version 1. */
  static fromValuesForTests(values: Record<string, unknown>, opts: { packOn?: string } = {}): RuleContext {
    if (!process.env.VITEST) throw new Error("for tests only");
    const map = new Map<string, Current>(Object.entries(values).map(([k, v]) => [k, { version: 1, valueHash: `test:${k}`, value: v }]));
    // `packOn`: also fill every rule not given from the standard defaults pack, as load() does for that day.
    if (opts.packOn) for (const [key, series] of Object.entries(PACK_RULES)) {
      const entry = map.has(key) ? null : entryOn(series, opts.packOn);
      if (entry) map.set(key, { version: PACK_VERSION, valueHash: packPinHash(key, entry), value: entry.value, packFrom: entry.from });
    }
    return new RuleContext(map);
  }

  /** Read a rule's value (its canonical stored form). Pins it. Throws RuleNotSetError if nobody has entered a value. */
  rule<T = unknown>(key: string): T {
    if (!RULE_BY_KEY[key]) throw new Error(`There is no payroll rule called ${key}`);
    const c = this.current.get(key);
    if (!c) throw new RuleNotSetError(key);
    this.pinned.set(key, c.packFrom !== undefined ? { key, version: c.version, valueHash: c.valueHash, kind: "PACK" } : { key, version: c.version, valueHash: c.valueHash });
    return c.value as T;
  }

  /** A money, percentage or integer rule as an exact decimal. */
  decimal(key: string): Money {
    const v = this.rule<unknown>(key);
    if (typeof v === "string") return dec(v);
    if (typeof v === "number" && Number.isInteger(v)) return dec(String(v));
    throw new Error(`The rule ${key} is not a number`);
  }

  /** A rule's value if it has one, without pinning it: for deciding what to gather. The calculation proper reads it again through rule(), which pins. */
  peek<T = unknown>(key: string): T | undefined {
    return this.current.get(key)?.value as T | undefined;
  }

  isSet(key: string): boolean {
    return this.current.has(key);
  }

  /** Exactly what has been read or recorded so far, in a stable order. */
  pins(): RulePin[] {
    return [...this.pinned.values()].sort((a, b) => `${a.kind ?? "RULE"}|${a.key}|${a.version}|${a.live === false ? 0 : 1}`.localeCompare(`${b.kind ?? "RULE"}|${b.key}|${b.version}|${b.live === false ? 0 : 1}`));
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

const pinKind = (p: RulePin): PinKind => p.kind ?? "RULE";

function pinLabel(p: RulePin): string {
  const kind = pinKind(p);
  if (kind === "NOT_SET") return `${p.key === "PT_SLABS" ? "Professional Tax" : "Labour Welfare Fund"}: not set`;
  const base = kind === "PACK" ? `${RULE_BY_KEY[p.key]?.label ?? p.key} (standard default)` : kind === "RULE" ? (RULE_BY_KEY[p.key]?.label ?? p.key) : kind === "RULE_OVERRIDE" ? `Rule override ${p.key.split("~").slice(0, 3).join(" / ")} (version ${p.version})` : kind === "COMPONENT" ? `Salary component ${p.key} (version ${p.version})` : `Salary structure ${p.key} (version ${p.version})`;
  return p.unset ? `${base} (not set)` : base;
}

/** The live state of each pin: is the exact pinned version confirmed, and (for a pin that is read live) is it still the current one. */
export async function pinStatuses(pins: readonly RulePin[]): Promise<PinStatus[]> {
  if (pins.length === 0) return [];
  const kinds = [...new Set(pins.map(pinKind).filter((k) => k !== "PACK" && k !== "NOT_SET"))];
  const keys = [...new Set(pins.map((p) => p.key))];
  // A pack pin is replaced (goes stale) once a director enters a value: a rule (its own key) or a tax year ("TAX_YEAR:<year>").
  const packRuleKeys = pins.filter((p) => (pinKind(p) === "PACK" || pinKind(p) === "NOT_SET") && !p.key.startsWith("TAX_YEAR:")).map((p) => p.key);
  const packYears = pins.filter((p) => pinKind(p) === "PACK" && p.key.startsWith("TAX_YEAR:")).map((p) => p.key.slice("TAX_YEAR:".length));
  const [versions, confirmations, entered] = await Promise.all([
    prisma.payrollItemVersion.groupBy({ by: ["kind", "key"], where: { kind: { in: kinds as never }, key: { in: keys } }, _max: { version: true } }),
    prisma.payrollItemConfirmation.findMany({ where: { kind: { in: kinds as never }, key: { in: keys } }, select: { kind: true, key: true, version: true, valueHash: true } }),
    packRuleKeys.length || packYears.length
      ? prisma.payrollItemVersion.groupBy({ by: ["kind", "key"], where: { authorUserId: { not: null }, OR: [{ kind: "RULE", key: { in: packRuleKeys } }, { kind: "TAX_YEAR", key: { in: packYears } }] }, _max: { version: true } })
      : Promise.resolve([] as Array<{ kind: string; key: string; _max: { version: number | null } }>),
  ]);
  const latest = new Map(versions.map((v) => [`${v.kind}|${v.key}`, v._max.version ?? 0]));
  const confirmed = new Set(confirmations.map((c) => `${c.kind}|${c.key}@${c.version}@${c.valueHash}`));
  const directorEntered = new Set(entered.map((e) => (e.kind === "TAX_YEAR" ? `TAX_YEAR:${e.key}` : e.key)));
  return pins.map((pin) => {
    const kind = pinKind(pin);
    if (kind === "NOT_SET") {
      // Not set by the owners' decision: not a Placeholder (a month is not blocked by it). Stale once a director enters the table.
      return { pin, label: pinLabel(pin), status: "CONFIRMED", stale: directorEntered.has(pin.key), currentVersion: 0 };
    }
    if (kind === "PACK") {
      // In force by the owners' decision. Stale once a director enters a value for it, or the pack itself was updated since the run was calculated.
      return { pin, label: pinLabel(pin), status: "CONFIRMED", stale: pin.version !== PACK_VERSION || directorEntered.has(pin.key), currentVersion: pin.version };
    }
    const newest = latest.get(`${kind}|${pin.key}`) ?? 0;
    return {
      pin,
      label: pinLabel(pin),
      status: !pin.unset && confirmed.has(`${kind}|${pin.key}@${pin.version}@${pin.valueHash}`) ? "CONFIRMED" : "PLACEHOLDER",
      // A frozen pin is never stale. An unset pin is stale once the rule has been given a value; any other live pin once a newer version exists.
      stale: pin.live === false ? false : newest > pin.version,
      currentVersion: newest,
    };
  });
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
  // Standard statutory values: in force, but a run that used them is made real only after both directors have acknowledged them once (the demo company is exempt).
  const { assertPackAcknowledged } = await import("../statutoryPack/service");
  await assertPackAcknowledged(pins);
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
