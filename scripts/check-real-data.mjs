#!/usr/bin/env node
// C4 (independent audit 2026-11-20): never commit real data. Fails (exit 1) when a tracked file looks like a real greytHR export, bank transfer sheet, salary
// statement or punch log, or holds a PAN-shaped, Aadhaar-shaped (Verhoeff-valid) or bank-account-shaped value, outside the tests' clearly fake fixtures.
//
//   node scripts/check-real-data.mjs            every tracked file (git ls-files)
//   node scripts/check-real-data.mjs <files...> just these (for a pre-commit hook)
//
// It prints the file, the line (or "binary") and the KIND of match, never the value. Run by scripts/peeps-check.sh and by CI.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Where clearly fake values are allowed: test files and fixtures, the made-up demo company, the development seed, and the synthetic samples (which must also
// say they are synthetic or DEMO). A real value must never be put in any of these either; they are exempt only from the pattern scan, not from review.
const FAKE_FIXTURE = [
  /(^|\/)__tests__\//,
  /\.test\.tsx?$/,
  /(^|\/)e2e\//,
  /^backend\/scripts\/demo\//,
  /^backend\/prisma\/seed\.ts$/,
  /^backend\/perf\//,
  /^biometric-agent\/(src|test)\/.*(fixture|sample|test)/i,
  /^docs\/samples\//,
  /^scripts\/check-real-data\.mjs$/,
];
const SKIP = [/(^|\/)node_modules\//, /package-lock\.json$/, /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|eot|mp4|webm|zip|gz|wasm|traineddata)$/i, /\.lock$/];

const EXPORT_NAME = /(salary|payroll|payslip|bank[ _-]?transfer|ortho|attlog|swipes?|statement|ecr|form[ _-]?16|greythr|attendance[ _-]?swipes)/i;
const DATA_EXT = /\.(xls|xlsx|xlsm|csv|dat|tsv|ods|pdf)$/i;
const BROWSER_DOWNLOAD = /\(\d+\)\.[a-z0-9]+$/i; // "Salary (38).xls": a file saved from a browser
const FAKE_MARKER = /(DEMO|synthetic|made[ -]?up|fake|sample|template)/i;

// A real PAN: five letters with the 4th one of the holder-type letters, four digits, a letter.
const PAN = /\b[A-Z]{3}[ABCFGHLJPTK][A-Z][0-9]{4}[A-Z]\b/g;
// Aadhaar: 12 digits (or 4-4-4), first digit 2-9, Verhoeff check digit valid.
const AADHAAR = /\b([2-9][0-9]{3})[ -]?([0-9]{4})[ -]?([0-9]{4})\b/g;
const ACCOUNT_WORDS = /(account|a\/c|acct|beneficiary|ifsc|bank)/i;
const ACCOUNT = /\b[0-9]{9,18}\b/g;

const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export function verhoeffValid(num) {
  let c = 0;
  const digits = num.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i += 1) c = D[c][P[i % 8][digits[i]]];
  return c === 0;
}
/** A number that is obviously a placeholder: mostly zeros, one repeated digit, or a plain run (123456789...). */
function placeholder(digits) {
  if (/^0{5,}/.test(digits)) return true;
  if (/^(\d)\1+$/.test(digits)) return true;
  if ("01234567890123456789".includes(digits) || "98765432109876543210".includes(digits)) return true;
  return false;
}

export function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(PAN)) hits.push({ line: i + 1, kind: "PAN-shaped value", at: m.index });
    for (const m of line.matchAll(AADHAAR)) {
      const d = m[1] + m[2] + m[3];
      if (!placeholder(d) && verhoeffValid(d)) hits.push({ line: i + 1, kind: "Aadhaar-shaped value (Verhoeff-valid)", at: m.index });
    }
    if (ACCOUNT_WORDS.test(line)) {
      for (const m of line.matchAll(ACCOUNT)) {
        if (placeholder(m[0])) continue;
        // A timestamp in milliseconds or a version string is not an account: skip 13-digit epoch-ms values near "Date"/"time" words.
        if (/^1[5-9]\d{11}$/.test(m[0]) && /(date|time|ms|epoch)/i.test(line)) continue;
        hits.push({ line: i + 1, kind: "account-number-shaped value next to a bank word", at: m.index });
      }
    }
  });
  return hits;
}

function textOf(file) {
  const abs = path.join(ROOT, file);
  const buf = readFileSync(abs);
  if (/\.(xlsx|xlsm|ods|docx)$/i.test(file)) {
    try {
      return { text: execFileSync("unzip", ["-p", abs], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8").replace(/<[^>]+>/g, "\n"), binary: true };
    } catch {
      return { text: buf.toString("latin1"), binary: true };
    }
  }
  const binary = buf.subarray(0, 8000).includes(0);
  return { text: binary ? buf.toString("latin1").replace(/[^\x20-\x7e\t]+/g, "\n") : buf.toString("utf8"), binary };
}

export function checkFiles(files) {
  const problems = [];
  for (const file of files) {
    if (SKIP.some((re) => re.test(file))) continue;
    const abs = path.join(ROOT, file);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    if (statSync(abs).size > 20 * 1024 * 1024) continue;
    const fake = FAKE_FIXTURE.some((re) => re.test(file));
    const base = path.basename(file);
    const { text, binary } = textOf(file);
    if (BROWSER_DOWNLOAD.test(base) && DATA_EXT.test(base)) problems.push(`${file}: a file saved from a browser download ("(n)" in its name). Real exports are never committed.`);
    if (EXPORT_NAME.test(base) && DATA_EXT.test(base) && !(fake && FAKE_MARKER.test(base + " " + text.slice(0, 20000)))) {
      problems.push(`${file}: looks like a payroll, bank, salary or punch export. Only clearly synthetic fixtures (DEMO / synthetic values) under docs/samples or a test folder may be committed.`);
    }
    if (fake) continue;
    for (const h of scanText(text)) problems.push(`${file}:${binary ? "binary" : h.line}: ${h.kind}`);
  }
  return problems;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  const files = args.length ? args : execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const problems = checkFiles(files);
  if (problems.length) {
    console.error(`Never commit real data (docs/ops/README.md, "Never commit real data"). ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("If a match is a made-up value in a test, move it into a __tests__ folder or a *.test.ts file, or make it an obvious placeholder (zeros, DEMO).");
    process.exit(1);
  }
  console.log(`check-real-data: ${files.length} tracked file(s), nothing that looks like real data.`);
}
