import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source scans over modules/payroll (docs/plans/PHASE_6.md §1). They exist because the principles are about what the code must NOT contain, and a principle
// nobody checks is a hope. Each scan strips comments and string contents first, so prose and messages can say anything; only code is judged.
//
//   1. No rate, ceiling, slab, divisor or percentage written into code: a number in code is one of a short list of structural constants.
//   2. No float or number conversion near money (Number(), parseFloat(), parseInt(), toNumber()), unless a line says why with `allow-number`.
//   3. No clock reads for a business date (`new Date()`, Date.now()), unless a line says it is an instant with `allow-clock`.
//   4. Nothing that can reach a bank or the network: no HTTP client, no AWS SDK (storage goes through StorageService), no fetch.
// History tables are guarded by lib/__tests__/currentRowGuard.test.ts, which covers modules/payroll too.

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/** Source with comments removed and the inside of every string/template literal blanked, line structure preserved. */
export function codeOnly(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i += 1;
    } else if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
          // keep the expression inside ${...} as code
          let depth = 1;
          out += "${";
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth += 1;
            if (src[i] === "}") depth -= 1;
            out += src[i];
            i += 1;
          }
          continue;
        }
        out += src[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += quote;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// The structural constants code may contain. 0 to 10 and 12 (months) are everyday; 100 converts a percentage; 40 is the arithmetic precision; the
// rest are HTTP status codes and hard limits on sizes (formula length, nodes, depth, hash and key lengths), none of which is a payroll rate.
const ALLOWED_INTEGERS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 32, 40, 64, 100, 200, 201, 202, 204, 400, 401, 403, 404, 409, 422, 500, 1000]);
// Value-shape bounds that belong to a rule's own validation (a payment day is 1 to 28, a month is 1 to 12, a state key is short).
const EXTRA_ALLOWED: Record<string, number[]> = { "rules/schemas.ts": [28, 31, 39, 60], "validators.ts": [25, 60] };

export function numericLiteralsIn(src: string, extra: number[] = []): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  codeOnly(src)
    .split("\n")
    .forEach((line, idx) => {
      for (const m of line.matchAll(/(?<![\w.$])(\d+(?:\.\d+)?)(?![\w])/g)) {
        const text = m[1]!;
        const isDecimal = text.includes(".");
        if (isDecimal || !(ALLOWED_INTEGERS.has(Number(text)) || extra.includes(Number(text)))) found.push({ line: idx + 1, text });
      }
    });
  return found;
}

describe("the scanner itself", () => {
  it("ignores comments and strings but sees code, including inside template expressions", () => {
    const src = ['// the rate is 12.5 and the ceiling 15000', 'const m = "a 0.75 message"; /* 21000 */', "const ok = 12 * 100;", "const bad = amount * 0.12;", "const ceil = 15000;", "const t = `x ${y * 21000} z`;"].join("\n");
    expect(numericLiteralsIn(src)).toEqual([{ line: 4, text: "0.12" }, { line: 5, text: "15000" }, { line: 6, text: "21000" }]);
  });
  it("does not mistake identifiers or property digits for numbers", () => {
    expect(numericLiteralsIn("const a1 = b2.c3 + x_4; foo(v5);")).toEqual([]);
  });
});

describe("modules/payroll", () => {
  const files = walk(ROOT).map((f) => ({ rel: path.relative(ROOT, f).split(path.sep).join("/"), src: readFileSync(f, "utf8") }));

  it("is being scanned (a rename must not silently turn these checks off)", () => {
    expect(files.length).toBeGreaterThan(8);
    expect(files.map((f) => f.rel)).toEqual(expect.arrayContaining(["money.ts", "formula.ts", "approvals.ts", "rules/governed.ts", "rules/context.ts"]));
  });

  it("holds no rate, ceiling, slab or percentage as a literal: every such figure is a rule", () => {
    const offenders = files.flatMap((f) => numericLiteralsIn(f.src, EXTRA_ALLOWED[f.rel] ?? []).map((n) => `${f.rel}:${n.line}: ${n.text}`));
    expect(offenders, "A figure that changes money belongs in the rules catalog (shared/constants/payrollRules.ts), read through RuleContext. A structural constant can be added to the allowlist in this test, with a reason.").toEqual([]);
  });

  it("converts nothing to a JavaScript number near money", () => {
    const pattern = /\bNumber\(|\bparseFloat\(|\bparseInt\(|\.toNumber\(|\bMath\.(?:round|floor|ceil|trunc)\(/;
    const offenders = files.flatMap((f) =>
      f.src.split("\n").flatMap((raw, i) => {
        const code = codeOnly(raw);
        return pattern.test(code) && !raw.includes("allow-number") ? [`${f.rel}:${i + 1}: ${raw.trim()}`] : [];
      }),
    );
    expect(offenders, "Use Decimal (money.ts). If it is not money (a version number, a page number), say so on the line with `allow-number: <why>`.").toEqual([]);
  });

  it("never reads the clock for a business date", () => {
    const pattern = /\bnew Date\(\)|\bDate\.now\(\)/;
    const offenders = files.flatMap((f) =>
      f.src.split("\n").flatMap((raw, i) => (pattern.test(codeOnly(raw)) && !raw.includes("allow-clock") ? [`${f.rel}:${i + 1}: ${raw.trim()}`] : [])),
    );
    expect(offenders, "A business date comes from businessToday() or an explicit day. An instant (when a decision was made) may be marked `allow-clock: an instant`.").toEqual([]);
  });

  it("cannot reach a bank or the network", () => {
    const banned = /from\s+["'](?:node:)?(?:https?|net|tls|dgram|http2)["']|from\s+["'](?:axios|node-fetch|undici|got|superagent|ky|request)["']|from\s+["']@aws-sdk\/|\bfetch\(|XMLHttpRequest|WebSocket\(/;
    const offenders = files.flatMap((f) => f.src.split("\n").flatMap((raw, i) => (banned.test(raw) ? [`${f.rel}:${i + 1}: ${raw.trim()}`] : [])));
    expect(offenders, "Payroll talks to storage through StorageService and to nothing else. The bank file is for a person to upload; nothing here sends money.").toEqual([]);
  });

  it("has no state that means money was sent, in code, in string values, or in the database schema", () => {
    // A state is usually a string value in a union or an enum member, which codeOnly() blanks, so look at the text with comments stripped but strings kept.
    const meansSent = /\b(?:SENT_TO_BANK|TRANSFERRED|DISBURSED_BY_API|payViaBank|initiatePayment)\b/i;
    const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/(^|\s)\/\/.*$/, "")).join("\n");
    for (const f of files) expect(withoutComments(f.src), f.rel).not.toMatch(meansSent);
    expect(withoutComments(readFileSync(path.join(__dirname, "../../../../prisma/schema.prisma"), "utf8").replace(/\/\/\/.*$/gm, "")), "prisma/schema.prisma").not.toMatch(meansSent);
  });
});
