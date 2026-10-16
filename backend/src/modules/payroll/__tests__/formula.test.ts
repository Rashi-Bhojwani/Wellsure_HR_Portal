import { describe, expect, it } from "vitest";
import { FormulaError, evaluateFormula, parseFormula, validateFormula } from "../formula";
import { dec, type Money } from "../money";

const vars = (o: Record<string, string>): Record<string, Money> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, dec(v)]));
const calc = (f: string, v: Record<string, string> = {}) => evaluateFormula(f, vars(v)).toFixed();

describe("formulas", () => {
  it("does the arithmetic with the usual precedence", () => {
    expect(calc("1 + 2 * 3")).toBe("7");
    expect(calc("(1 + 2) * 3")).toBe("9");
    expect(calc("10 - 4 - 3")).toBe("3"); // left to right
    expect(calc("100 / 4 / 5")).toBe("5");
    expect(calc("-2 * -3")).toBe("6");
    expect(calc("- (1 + 2)")).toBe("-3");
  });

  it("reads percentages, names and functions", () => {
    expect(calc("CTC * 40%", { CTC: "600000" })).toBe("240000");
    expect(calc("BASIC / 30", { BASIC: "30000" })).toBe("1000");
    expect(calc("MIN(BASIC, 15000)", { BASIC: "20000" })).toBe("15000");
    expect(calc("MAX(1, 2, 3)")).toBe("3");
    expect(calc("ROUND(BASIC / 7, 2)", { BASIC: "100" })).toBe("14.29");
    expect(calc("CEIL(2.01)")).toBe("3");
    expect(calc("FLOOR(2.99)")).toBe("2");
    expect(calc("0.5 + 0.25")).toBe("0.75");
  });

  it("is exact where floats are not", () => {
    expect(calc("0.1 + 0.2")).toBe("0.3");
    expect(calc("CTC * 12.5%", { CTC: "80000" })).toBe("10000");
  });

  it("lists the names it uses, and refuses names that do not exist", () => {
    expect(parseFormula("CTC * 40% + MIN(HRA, BASIC)").identifiers).toEqual(["BASIC", "CTC", "HRA"]);
    expect(validateFormula("BASIC * 50%", new Set(["BASIC", "CTC"]))).toEqual(["BASIC"]);
    expect(() => validateFormula("BASIC + GROSS", new Set(["BASIC"]))).toThrow(/Unknown name: GROSS/);
    expect(() => evaluateFormula("A + 1", {})).toThrow(FormulaError);
  });

  it.each([
    ["1 +", "SYNTAX"],
    ["(1 + 2", "SYNTAX"],
    ["1 2", "SYNTAX"],
    ["basic * 2", "SYNTAX"], // names are upper-case
    ["1 $ 2", "SYNTAX"],
    ["SQRT(4)", "UNKNOWN_FUNCTION"],
    ["MIN(1)", "BAD_ARGUMENT"],
    ["ROUND(1)", "BAD_ARGUMENT"],
    ["ROUND(1, 9)", "BAD_ARGUMENT"],
    ["ROUND(1, X)", "BAD_ARGUMENT"],
    ["CEIL(1, 2)", "BAD_ARGUMENT"],
    ["1 / (2 - 2)", "DIVISION_BY_ZERO"],
    ["a".repeat(501), "TOO_COMPLEX"],
    ["(".repeat(40) + "1" + ")".repeat(40), "TOO_COMPLEX"],
  ])("refuses %j with %s", (f, code) => {
    try {
      evaluateFormula(f, {});
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError);
      expect((e as FormulaError).code).toBe(code);
    }
  });

  it("cannot execute anything: there is no way to name a function or property that is not on the list", () => {
    for (const evil of ["constructor", "process.exit(1)", "require('fs')", "__proto__", "this", "globalThis.x", "(() => 1)()"]) {
      expect(() => evaluateFormula(evil, {})).toThrow(FormulaError);
    }
    expect(() => evaluateFormula("TOSTRING", {})).toThrow(/has no value/);
  });
});

// ── Property test against an independent reference ──
// Random expression trees are rendered to text for the engine and, separately, evaluated in exact rational arithmetic (BigInt fractions)
// straight from the tree. The two never share code, so a bug in either shows up as a difference.
type Frac = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));
const frac = (n: bigint, d = 1n): Frac => {
  const g = gcd(n, d) || 1n;
  const s = d < 0n ? -1n : 1n;
  return { n: (s * n) / g, d: (s * d) / g };
};
const fromDecimalText = (t: string): Frac => {
  const neg = t.startsWith("-");
  const [i, f = ""] = t.replace("-", "").split(".");
  const r = frac(BigInt(i! + f), 10n ** BigInt(f.length));
  return neg ? frac(-r.n, r.d) : r;
};
const add = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Frac, b: Frac) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);
const div = (a: Frac, b: Frac) => frac(a.n * b.d, a.d * b.n);

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

type Tree = { k: "lit"; text: string } | { k: "var"; name: string } | { k: "bin"; op: "+" | "-" | "*" | "/"; l: Tree; r: Tree };
const VARS: Record<string, string> = { A: "1234.56", B: "7", C: "0.375", D: "99999.99" };

function gen(rand: () => number, depth: number): Tree {
  if (depth === 0 || rand() < 0.25) {
    if (rand() < 0.4) return { k: "var", name: Object.keys(VARS)[Math.floor(rand() * 4)]! };
    const whole = Math.floor(rand() * 1000) + 1;
    const cents = Math.floor(rand() * 1000);
    return { k: "lit", text: rand() < 0.5 ? String(whole) : `${whole}.${String(cents).padStart(3, "0")}` };
  }
  const op = (["+", "-", "*", "/"] as const)[Math.floor(rand() * 4)]!;
  return { k: "bin", op, l: gen(rand, depth - 1), r: gen(rand, depth - 1) };
}
const render = (t: Tree): string => (t.k === "lit" ? t.text : t.k === "var" ? t.name : `(${render(t.l)} ${t.op} ${render(t.r)})`);
function exact(t: Tree): Frac | null {
  if (t.k === "lit") return fromDecimalText(t.text);
  if (t.k === "var") return fromDecimalText(VARS[t.name]!);
  const l = exact(t.l);
  const r = exact(t.r);
  if (!l || !r) return null;
  if (t.op === "+") return add(l, r);
  if (t.op === "-") return sub(l, r);
  if (t.op === "*") return mul(l, r);
  return r.n === 0n ? null : div(l, r);
}

describe("formulas agree with exact rational arithmetic", () => {
  it("on 400 random expressions", () => {
    const rand = rng(20261016);
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const tree = gen(rand, 4);
      const want = exact(tree);
      if (!want) continue; // a division by an exact zero: the engine's refusal is tested above
      const got = fromDecimalText(evaluateFormula(render(tree), vars(VARS)).toFixed());
      // 40 significant digits: the engine must be within one part in 10^30 of the larger of 1 and the exact magnitude.
      const diff = sub(got, want);
      const mag = (want.n < 0n ? -want.n : want.n) / want.d;
      const scaleUp = mag < 1n ? 1n : mag;
      const absDiffN = diff.n < 0n ? -diff.n : diff.n;
      expect(absDiffN * 10n ** 30n <= diff.d * scaleUp, `${render(tree)} → ${got.n}/${got.d} vs ${want.n}/${want.d}`).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(350);
  });
});
