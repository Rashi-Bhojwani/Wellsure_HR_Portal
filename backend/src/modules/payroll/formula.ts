import { HUNDRED, dec, roundTo, type Money } from "./money";

// The expression language for salary structures and the leave-encashment rate (Phase 6 §4). Small on purpose, parsed by hand, never
// eval'd, evaluated in exact decimals:
//
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := '-' unary | primary
//   primary := NUMBER ['%'] | IDENT | FUNC '(' expr (',' expr)* ')' | '(' expr ')'
//
// NUMBER is plain decimal digits ("40", "0.5"); a trailing % divides by 100 ("CTC * 40%"). IDENT is an upper-case name (a component
// code, or CTC); the caller says which names exist. Functions: MIN, MAX (two or more arguments), ROUND(x, n) (half-up to n places, n a
// whole-number literal), CEIL(x), FLOOR(x) (to whole numbers). Nothing else is callable. Limits on length, depth and size make a
// pathological formula an error rather than a hang.

export type FormulaErrorCode = "SYNTAX" | "UNKNOWN_IDENTIFIER" | "UNKNOWN_FUNCTION" | "DIVISION_BY_ZERO" | "TOO_COMPLEX" | "BAD_ARGUMENT";
export class FormulaError extends Error {
  constructor(
    public readonly code: FormulaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FormulaError";
  }
}

const MAX_LENGTH = 500;
const MAX_DEPTH = 32;
const MAX_NODES = 200;

export type Node =
  | { t: "num"; v: string }
  | { t: "id"; name: string }
  | { t: "neg"; x: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; l: Node; r: Node }
  | { t: "call"; fn: "MIN" | "MAX" | "ROUND" | "CEIL" | "FLOOR"; args: Node[] };

type Tok = { k: "num" | "id" | "op" | "end"; text: string; at: number };

function tokenise(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new FormulaError("TOO_COMPLEX", `A formula is at most ${MAX_LENGTH} characters.`);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i += 1;
    } else if (/\d/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i))!;
      out.push({ k: "num", text: m[0], at: i });
      i += m[0].length;
    } else if (/[A-Z]/.test(c)) {
      const m = /^[A-Z][A-Z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: "id", text: m[0], at: i });
      i += m[0].length;
    } else if ("+-*/(),%".includes(c)) {
      out.push({ k: "op", text: c, at: i });
      i += 1;
    } else {
      throw new FormulaError("SYNTAX", `Unexpected "${c}" at position ${i + 1}. Names are upper-case (BASIC, CTC); numbers are plain digits.`);
    }
  }
  out.push({ k: "end", text: "", at: src.length });
  return out;
}

const FUNCTIONS = new Set(["MIN", "MAX", "ROUND", "CEIL", "FLOOR"]);

export function parseFormula(src: string): { ast: Node; identifiers: string[] } {
  const toks = tokenise(src);
  let p = 0;
  let nodes = 0;
  const identifiers = new Set<string>();
  const peek = () => toks[p]!;
  const take = () => toks[p++]!;
  const fail = (msg: string, at: number): never => {
    throw new FormulaError("SYNTAX", `${msg} (position ${at + 1})`);
  };
  const count = () => {
    nodes += 1;
    if (nodes > MAX_NODES) throw new FormulaError("TOO_COMPLEX", "This formula is too long.");
  };
  const expr = (depth: number): Node => {
    if (depth > MAX_DEPTH) throw new FormulaError("TOO_COMPLEX", "This formula is nested too deeply.");
    let left = term(depth);
    while (peek().k === "op" && (peek().text === "+" || peek().text === "-")) {
      const op = take().text as "+" | "-";
      left = { t: "bin", op, l: left, r: term(depth) };
      count();
    }
    return left;
  };
  const term = (depth: number): Node => {
    let left = unary(depth);
    while (peek().k === "op" && (peek().text === "*" || peek().text === "/")) {
      const op = take().text as "*" | "/";
      left = { t: "bin", op, l: left, r: unary(depth) };
      count();
    }
    return left;
  };
  const unary = (depth: number): Node => {
    if (peek().k === "op" && peek().text === "-") {
      take();
      count();
      return { t: "neg", x: unary(depth + 1) };
    }
    return primary(depth);
  };
  const primary = (depth: number): Node => {
    const t = take();
    count();
    if (t.k === "num") {
      if (peek().k === "op" && peek().text === "%") {
        take();
        return { t: "bin", op: "/", l: { t: "num", v: t.text }, r: { t: "num", v: HUNDRED.toFixed() } };
      }
      return { t: "num", v: t.text };
    }
    if (t.k === "id") {
      if (peek().k === "op" && peek().text === "(") {
        if (!FUNCTIONS.has(t.text)) throw new FormulaError("UNKNOWN_FUNCTION", `${t.text}() is not a function. Available: MIN, MAX, ROUND, CEIL, FLOOR.`);
        take();
        const args: Node[] = [expr(depth + 1)];
        while (peek().k === "op" && peek().text === ",") {
          take();
          args.push(expr(depth + 1));
        }
        if (!(peek().k === "op" && peek().text === ")")) fail("Expected ) to close the function call", peek().at);
        take();
        const fn = t.text as "MIN" | "MAX" | "ROUND" | "CEIL" | "FLOOR";
        if ((fn === "MIN" || fn === "MAX") && args.length < 2) throw new FormulaError("BAD_ARGUMENT", `${fn} needs at least two values.`);
        if (fn === "ROUND" && (args.length !== 2 || args[1]!.t !== "num" || !/^[0-6]$/.test((args[1] as { v: string }).v))) {
          throw new FormulaError("BAD_ARGUMENT", "ROUND takes a value and a whole number of decimal places from 0 to 6, for example ROUND(BASIC * 40%, 0).");
        }
        if ((fn === "CEIL" || fn === "FLOOR") && args.length !== 1) throw new FormulaError("BAD_ARGUMENT", `${fn} takes one value.`);
        return { t: "call", fn, args };
      }
      identifiers.add(t.text);
      return { t: "id", name: t.text };
    }
    if (t.k === "op" && t.text === "(") {
      const inner = expr(depth + 1);
      if (!(peek().k === "op" && peek().text === ")")) fail("Expected ) to close the bracket", peek().at);
      take();
      return inner;
    }
    return fail(t.k === "end" ? "The formula ends too soon" : `Unexpected "${t.text}"`, t.at);
  };
  const ast = expr(0);
  if (peek().k !== "end") fail(`Unexpected "${peek().text}"`, peek().at);
  return { ast, identifiers: [...identifiers].sort() };
}

/** Parse and check every name against what exists. Returns the names used, so a structure can tell which components depend on which. */
export function validateFormula(src: string, allowed: ReadonlySet<string>): string[] {
  const { identifiers } = parseFormula(src);
  const unknown = identifiers.filter((n) => !allowed.has(n));
  if (unknown.length) throw new FormulaError("UNKNOWN_IDENTIFIER", `Unknown name${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`);
  return identifiers;
}

export function evaluate(ast: Node, vars: Readonly<Record<string, Money>>): Money {
  switch (ast.t) {
    case "num":
      return dec(ast.v);
    case "id": {
      const v = vars[ast.name];
      if (!v) throw new FormulaError("UNKNOWN_IDENTIFIER", `${ast.name} has no value here.`);
      return v;
    }
    case "neg":
      return evaluate(ast.x, vars).negated();
    case "bin": {
      const l = evaluate(ast.l, vars);
      const r = evaluate(ast.r, vars);
      if (ast.op === "+") return l.plus(r);
      if (ast.op === "-") return l.minus(r);
      if (ast.op === "*") return l.times(r);
      if (r.isZero()) throw new FormulaError("DIVISION_BY_ZERO", "A formula divides by zero.");
      return l.dividedBy(r);
    }
    case "call": {
      if (ast.fn === "ROUND") {
        // The place count was checked at parse time to be one digit, 0 to 6; reading it as an index into the digits needs no number conversion.
        const places = "0123456".indexOf((ast.args[1] as { v: string }).v);
        return roundTo(evaluate(ast.args[0]!, vars), places, "HALF_UP");
      }
      const args = ast.args.map((a) => evaluate(a, vars));
      if (ast.fn === "MIN") return args.reduce((a, b) => (b.lessThan(a) ? b : a));
      if (ast.fn === "MAX") return args.reduce((a, b) => (b.greaterThan(a) ? b : a));
      if (ast.fn === "CEIL") return roundTo(args[0]!, 0, "CEIL");
      return roundTo(args[0]!, 0, "FLOOR");
    }
  }
}

export function evaluateFormula(src: string, vars: Readonly<Record<string, Money>>): Money {
  return evaluate(parseFormula(src).ast, vars);
}

