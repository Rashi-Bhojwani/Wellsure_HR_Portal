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
const EXTRA_ALLOWED: Record<string, number[]> = {
  "rules/schemas.ts": [28, 31, 39, 60],
  "validators.ts": [25, 60],
  // Salary: lengths of form fields (a name, a reason), how many rows a page or a search shows, and the highest payslip position. None is a payroll figure.
  "salary/schemas.ts": [60, 999],
  // Tax: lengths of labels, notes, codes and a year label (2026-27 is 7 characters), a link's lifetime in seconds, and how many sections a year lists. None is a tax figure: every tax value is entered by the owners.
  "tax/declarations.ts": [20, 60, 120, 300],
  "tax/routes.ts": [20],
  "tax/schema.ts": [19, 20, 60, 80, 300],
  "salary/validators.ts": [20, 25, 60, 300],
  "salary/adjustments.ts": [300],
  "salary/employees.ts": [20, 25, 60],
  // How long the one transaction that applies a whole revision may run, in milliseconds. Not money.
  "salary/revisions.ts": [15000, 120000],
  // Runs: how many people one calculation chunk writes in a transaction, how long a calculation holds its lease (milliseconds), the width of workbook columns, and
  // the lengths of search and reason fields. None is a payroll figure.
  "run/engine.ts": [50, 120000],
  "run/export.ts": [28, 50, 60, 80],
  "run/service.ts": [20, 50, 60],
  // Closing: how many flagged people the submit preview lists before it says "and more" (a display limit), and the lengths of reason and note fields.
  "run/closing.ts": [25],
  "run/validators.ts": [20, 25, 50, 60, 300, 500],
  // Release (P6-5): how long the one transaction that writes every payslip or every bank row may run (milliseconds), the pause between payslip emails (milliseconds), and
  // the limits of a layout (how many columns or header rows, how wide a column or a text field is). None is a payroll figure.
  "run/release.ts": [120000],
  "run/payslipDelivery.ts": [250, 300],
  "run/payslipAccess.ts": [300],
  "run/bankBatches.ts": [80, 300, 5000000],
  "run/outputs.ts": [300],
  "run/layout.ts": [20, 60, 80, 500],
  "run/layouts.ts": [20, 500],
  // The register comparison (P6-6): the length limits of the upload's text fields and its size in megabytes, the most rows a register may have, an HTTP status, and the widths of the
  // result workbook's columns. None is a payroll figure.
  "compare/controller.ts": [20, 40, 80, 1024, 4000],
  "compare/parse.ts": [501, 20000],
  "compare/service.ts": [28, 36, 46, 50],
  // The sign-off lists at most this many names of people still missing a detail.
  "setup/signoffs.ts": [25],
};

export function numericLiteralsIn(src: string, extra: number[] = []): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  codeOnly(src)
    .split("\n")
    .forEach((line, idx) => {
      // A literal is a run starting with a digit. Written plainly it is checked against the allowlist; written any other way (1_000 with separators,
      // 1e6, 0xFF, 100n, a decimal) it is flagged outright, because those spellings are exactly how a figure would slip past a scan for plain digits.
      for (const m of line.matchAll(/(?<![\w.$])(\d[\w.]*)/g)) {
        const raw = m[1]!.replace(/[._]+$/, ""); // a trailing . or _ is punctuation, as in the [0-9_] of a regular expression
        const plain = raw.replace(/(?<=\d)_(?=\d)/g, "");
        const isPlainInteger = /^\d+$/.test(plain);
        if (!isPlainInteger || !(ALLOWED_INTEGERS.has(Number(plain)) || extra.includes(Number(plain)))) found.push({ line: idx + 1, text: plain });
      }
    });
  return found;
}

describe("the scanner itself", () => {
  it("ignores comments and strings but sees code, including inside template expressions", () => {
    const src = ['// the rate is 12.5 and the ceiling 15000', 'const m = "a 0.75 message"; /* 21000 */', "const ok = 12 * 100;", "const bad = amount * 0.12;", "const ceil = 15000;", "const t = `x ${y * 21000} z`;"].join("\n");
    expect(numericLiteralsIn(src)).toEqual([{ line: 4, text: "0.12" }, { line: 5, text: "15000" }, { line: 6, text: "21000" }]);
  });
  it("sees a figure however it is spelled: separators, exponents, hex, bigint, decimals", () => {
    expect(numericLiteralsIn("const a = 120_000; const b = 1e6; const c = 0xFF; const d = 100n; const e = 12.5; const f = 12; const g = 1_0;").map((n) => n.text)).toEqual(["120000", "1e6", "0xFF", "100n", "12.5"]);
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

  it("only the finaliser can make a run final or unlock one: no other code sets the switches or writes the FINALISED status", () => {
    // The database refuses FINALISED unless the transaction sets `payroll.finalising`, and refuses to take a run out of it unless it sets `payroll.unlocking`. The one file
    // that does either is the finaliser (P6-4); this keeps it to that one file.
    const ALLOWED_FINALISERS: string[] = ["src/modules/payroll/run/finaliser.ts"];
    const backend = path.resolve(ROOT, "../../..");
    const hits: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "__tests__" && name !== "node_modules") scan(full);
        } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
          const raw = readFileSync(full, "utf8").replace(/\/\/.*$/gm, "");
          // The switch itself, or a write of the status (a `data: { ... status: "FINALISED" }`). Reading the status in a `where` is how the arrears reader finds a final run.
          if (/payroll\.(?:finalising|unlocking)/.test(raw) || /data:\s*\{[^}]*status:\s*["']FINALISED["']/.test(raw)) hits.push(path.relative(backend, full).split(path.sep).join("/"));
        }
      }
    };
    scan(backend);
    expect(hits.sort()).toEqual(ALLOWED_FINALISERS);
  });

  it("only release.ts writes payslips, bank batches and release rows; account numbers are decrypted only there and in the statutory outputs", () => {
    const backend = path.resolve(ROOT, "../../..");
    const creators: string[] = [];
    const decrypters: string[] = [];
    const scan = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) scan(full);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
          const raw = readFileSync(full, "utf8").replace(/\/\/.*$/gm, "");
          const rel = path.relative(backend, full).split(path.sep).join("/");
          if (/(?:payslip|bankTransferBatch|bankTransferRow|payrollRunRelease)\.(?:create|createMany|upsert)\(/.test(raw)) creators.push(rel);
          if (/accountNumberEncrypted/.test(raw) && /decryptField\(/.test(raw)) decrypters.push(rel);
        }
      }
    };
    scan(path.join(backend, "src/modules/payroll"));
    expect(creators.sort()).toEqual(["src/modules/payroll/run/release.ts"]);
    // The employee module's own audited reveal is outside payroll; inside payroll the bank file's generation is the only place an account number is read.
    expect(decrypters.sort()).toEqual(["src/modules/payroll/run/release.ts"]);
  });

  it("an owner's secret is opened in only three places: the rule Reveal, the layout module, and the sealing module itself", () => {
    const backend = path.resolve(ROOT, "../../..");
    const hits: string[] = [];
    const scan = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) scan(full);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) {
          const raw = readFileSync(full, "utf8").replace(/\/\/.*$/gm, "");
          if (/\bunseal(?:<[^>]*>)?\(/.test(raw)) hits.push(path.relative(backend, full).split(path.sep).join("/"));
        }
      }
    };
    scan(path.join(backend, "src"));
    expect(hits.sort()).toEqual(["src/modules/payroll/rules/governed.ts", "src/modules/payroll/run/layouts.ts", "src/modules/payroll/sealed.ts"]);
  });

  it("the payroll-lock bypass for back-dated salary has exactly one caller, the revision apply step, and that step creates the arrears in the same transaction", () => {
    const backend = path.resolve(ROOT, "../../..");
    const hits: string[] = [];
    const scan = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) scan(full);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && readFileSync(full, "utf8").includes("writeBackdatedSalaryChange")) hits.push(path.relative(backend, full).split(path.sep).join("/"));
      }
    };
    for (const top of ["src", "scripts", "prisma"]) scan(path.join(backend, top));
    expect(hits.sort()).toEqual(["src/lib/effectiveDating.ts", "src/modules/payroll/salary/revisions.ts"]);
    const revisions = readFileSync(path.join(ROOT, "salary/revisions.ts"), "utf8");
    expect(revisions.match(/writeBackdatedSalaryChange/g)!.length).toBe(2); // the import and the one choice between it and the ordinary writer
    expect(revisions).toMatch(/const backdated = person\.lockedCycles\.length > 0;\s+const write = backdated \? writeBackdatedSalaryChange : writeSalaryChange;/);
    expect(revisions).toMatch(/for \(const a of person\.arrears\) \{\s+const direction[\s\S]*?tx\.payrollAdjustment\.create/); // the arrears are made inside the same transaction, right after the write
  });
});
