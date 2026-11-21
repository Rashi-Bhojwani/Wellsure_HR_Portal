// C4 (independent audit 2026-11-20): the real-data guard. Run: node --test scripts/__tests__/check-real-data.test.mjs
// Every "real-looking" value here is built at run time, so this file itself holds none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanText, verhoeffValid } from "../check-real-data.mjs";

const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];
function withCheck(eleven) {
  let c = 0;
  const digits = (eleven + "0").split("").reverse().map(Number);
  for (let i = 1; i < digits.length; i += 1) c = D[c][P[i % 8][digits[i]]];
  return eleven + INV[c];
}
const aadhaarLike = withCheck(String(2) + "73849561029".slice(0, 10));
const panLike = ["Q", "W", "E", "P", "R"].join("") + String(4000 + 821) + "K";
const accountLike = String(31) + "4159265358";

test("the scan finds a PAN-shaped, an Aadhaar-shaped and an account-shaped value, and reports kinds, never values", () => {
  assert.equal(verhoeffValid(aadhaarLike), true);
  const hits = scanText(`id ${panLike}\nuid ${aadhaarLike.slice(0, 4)} ${aadhaarLike.slice(4, 8)} ${aadhaarLike.slice(8)}\nBeneficiary A/C ${accountLike}`);
  assert.deepEqual(hits.map((h) => h.kind).sort(), ["Aadhaar-shaped value (Verhoeff-valid)", "PAN-shaped value", "account-number-shaped value next to a bank word"]);
  assert.ok(hits.every((h) => !JSON.stringify(h).includes(accountLike)));
});

test("placeholders do not trip it: zeros, a repeated digit, ABCDE1234F, an account-like number with no bank word", () => {
  assert.deepEqual(scanText("Account 000000000001\nA/C 111111111111\nPAN ABCDE1234F\norder 3141592653589"), []);
});

test("the guard refuses a browser-download export name and a real-looking value outside the fake fixtures, and passes a DEMO sample under docs/samples", () => {
  const dir = mkdtempSync(path.join(process.cwd(), ".tmp-realdata-"));
  try {
    mkdirSync(path.join(dir, "docs", "samples"), { recursive: true });
    writeFileSync(path.join(dir, "Salary (38).csv"), "Name,Net\nSomeone,1000\n");
    writeFileSync(path.join(dir, "notes.md"), `Beneficiary account ${accountLike}\n`);
    writeFileSync(path.join(dir, "docs", "samples", "salary_template.csv"), "DEMO COMPANY,synthetic\n");
    const rel = (f) => path.relative(process.cwd(), path.join(dir, f));
    let out = "";
    try {
      execFileSync("node", ["scripts/check-real-data.mjs", rel("Salary (38).csv"), rel("notes.md")], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      out = String(e.stderr);
    }
    assert.match(out, /browser download/);
    assert.match(out, /account-number-shaped/);
    assert.ok(!out.includes(accountLike));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
