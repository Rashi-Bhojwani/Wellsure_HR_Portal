// The browser half of the sensitive-data scan (docs/plans/PHASE_6.md §14J). Signed in as the developer and as an ordinary employee, on a stack that holds the demo company, it opens every
// page of both portals and checks what a person would SEE and what a screenshot would CONTAIN:
//   - none of the demo company's secrets is anywhere in the page: a bank account, a PAN, a UAN, the debit account, a company identifier, the bank layout's text;
//   - the DEMO COMPANY banner is on the page, so a screenshot of it cannot be taken for the real thing.
// Run against a running stack that has had `npm run seed:demo-company` (backend/):
//
//   npm run check:sensitive-ui         (from frontend/; needs the API, the worker and `npm run dev` up, and Chrome)
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, "../../biometric-agent/node_modules/playwright-core"));

const BASE = process.env.WEB_URL ?? "http://localhost:5173";
const PASSWORD = process.env.SIM_PASSWORD ?? "Wellsure@123";
const OUT = process.env.POPOVER_OUT ?? path.join(here, "out");
mkdirSync(OUT, { recursive: true });
const CHROME = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/google-chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && existsSync(p));

// What must never be on a page. The demo company's secrets follow fixed patterns: accounts begin 9999, PANs DEMOX, UANs 99990000, the debit account is 999900000000.
const SECRETS = [
  { label: "a bank account number", re: /\b9999\d{8}\b/ },
  { label: "a PAN", re: /\bDEMOX\d{4}Z\b/ },
  { label: "a UAN", re: /\b99990000\d{4}\b/ },
  { label: "the debit account", re: /\b999900000000\b/ },
  { label: "a company identifier", re: /DEMO\/PF\/00001|DEMO-ESI-00001|DEMO-PT-00001|DEMO-LWF-00001|DEMOT00001D/ },
  { label: "the bank layout's text", re: /DEMO BANK BULK TRANSFER/ },
];

// The pages: every menu path in the two menu configurations (the item paths, in the source, are the routes).
function pathsOf(file) {
  const src = readFileSync(path.resolve(here, "../src/routes", file), "utf8");
  return [...src.matchAll(/\{\s*key: "[^"]+",\s*label: "[^"]+",\s*path: "([^"]+)"/g)].map((m) => m[1]);
}
const adminPaths = pathsOf("adminMenu.config.tsx");
const employeePaths = pathsOf("employeeMenu.config.tsx");

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] });
const problems = [];
let pages = 0;

async function visit(user, label, base, paths) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("e.g. 1042").fill(user);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 });
  for (const p of paths) {
    const url = `${BASE}${base}/${p}`; if (process.env.SENSITIVE_UI_VERBOSE) console.log("visit", label, url);
    // A navigation can be aborted when the previous page was still redirecting (a menu path that sends you on); it is tried again, never skipped.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await page.goto(url);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        await page.waitForTimeout(800);
      }
    }
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(600);
    pages += 1;
    const text = await page.evaluate(() => document.body.innerText + "\n" + document.body.innerHTML);
    for (const s of SECRETS) if (s.re.test(text)) problems.push(`${label} on ${base}/${p}: the page shows ${s.label}`);
    if (!(await page.getByTestId("demo-company-banner").first().isVisible().catch(() => false))) problems.push(`${label} on ${base}/${p}: the DEMO COMPANY banner is not on the page`);
  }
  await page.screenshot({ path: path.join(OUT, `sensitive-ui-${label.replace(/\W+/g, "-")}.png`) });
  await ctx.close();
}

await visit("DEMO005", "the developer", "/admin", adminPaths);
await visit("DEMO005", "the developer (own portal)", "/app", employeePaths);
await visit("DEMO006", "an ordinary employee", "/app", employeePaths);
// Added with the master build (Stage 0.2): the people who are allowed to see most of the system must not see the demo's secrets on a page either: pay details are masked
// by default and shown only through an audited Reveal, never printed on a page.
await visit("DEMO004", "an HR Admin", "/admin", adminPaths);
await visit("DEMO004", "an HR Admin (own portal)", "/app", employeePaths);
await visit("DEMO001", "a director", "/admin", adminPaths);
await visit("DEMO001", "a director (own portal)", "/app", employeePaths);
await browser.close();

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in ${pages} pages:\n - ${problems.join("\n - ")}`);
  process.exit(1);
}
console.log(`\nNo secret on any of ${pages} pages, and the DEMO COMPANY banner on every one.`);
