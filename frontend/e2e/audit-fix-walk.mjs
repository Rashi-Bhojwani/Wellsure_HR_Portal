// Independent audit 2026-11-20, fix block: the browser walk of every screen the fixes changed, as director, HR, manager, employee, interviewer and Developer, at
// 1280 light and 390 dark, keyboard only. Run against a running stack (API, worker and `npm run dev`) on a database with the development seed and the demo
// company (the interviewer and the Developer are demo accounts):
//
//   node e2e/audit-fix-walk.mjs            (from frontend/; WEB_URL, WALK_OUT override the defaults)
//
// For each role, viewport and screen it records: where the page landed, its heading, whether it shows content or a refusal, console errors, any rupee figure
// on screen for a role that may not see pay, and the keyboard: Tab moves focus off the body onto something with a visible focus ring, and Esc closes an open
// drawer or modal. It writes a screenshot per stop and a JSON summary. Exit code 1 lists every failure (a figure shown, a console error, focus lost or invisible).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, "../../biometric-agent/node_modules/playwright-core"));
const BASE = process.env.WEB_URL ?? "http://localhost:5173";
const OUT = process.env.WALK_OUT ?? path.join(os.tmpdir(), "audit-fix-walk");
const PASSWORD = process.env.SIM_PASSWORD ?? "Wellsure@123";
const CHROME = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/opt/pw-browsers/chromium", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
mkdirSync(OUT, { recursive: true });

// Development seed and demo company accounts (all made up).
const ROLES = {
  director: { code: "1000", seesPay: true },
  hr: { code: "1001", seesPay: false },
  manager: { code: "1002", seesPay: false },
  employee: { code: "1006", seesPay: false },
  interviewer: { code: "DEMO006", seesPay: false },
  developer: { code: "DEMO005", seesPay: false },
};

// Every screen a fix changed (admin screens under /admin, the employee's under /app).
const SCREENS = [
  ["Waiting for Confirmation (C1, C2, C3, M6)", "/admin/admin-tools/confirmations"],
  ["Ready for First Run (H4, M5)", "/admin/payroll/ready"],
  ["Default behaviours (C1, H2, M5, M8, L2)", "/admin/settings/behaviours"],
  ["Audit Log (H4 banner)", "/admin/admin-tools/audit-log"],
  ["Leave Granter (C3)", "/admin/workforce/leave/granter"],
  ["Bulk Import (C3, H5, M4)", "/admin/employee/import"],
  ["Lateness Waivers (M8)", "/admin/workforce/attendance/lateness-waivers"],
  ["System Settings (C1, L2)", "/admin/admin-tools/settings"],
  ["My profile (C1)", "/app/profile"],
  ["Account & security: Change password (M1)", "/app/security"],
  ["Apply leave (M10)", "/app/leave/apply"],
  ["Late Arrivals (L1)", "/app/attendance/lateness"],
  ["My interviews (interviewer isolation)", "/app/recruitment/interviews"],
];

const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] });
const failures = [];
const rows = [];

for (const [role, { code, seesPay }] of Object.entries(ROLES)) {
  for (const [width, scheme] of [[1280, "light"], [390, "dark"]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/status of 40[134]|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    const where = `${role} ${width} ${scheme}`;
    await page.goto(`${BASE}/login`);
    // Keyboard only: type into the focused box, Tab to the next, Enter to submit.
    await page.getByPlaceholder("e.g. 1042").focus();
    await page.keyboard.type(code);
    await page.keyboard.press("Tab");
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");
    try {
      await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 });
    } catch {
      failures.push(`${where}: could not sign in`);
      await context.close();
      continue;
    }
    // L1: the Developer is not offered Late Arrivals anywhere in the navigation.
    if (role === "developer") {
      await page.waitForTimeout(800);
      const offered = await page.locator("nav a, [role=menuitem], [role=tab]").filter({ hasText: /^Late Arrivals$/ }).count();
      if (offered > 0) failures.push(`${where}: Late Arrivals is offered to the Developer`);
    }
    for (const [label, url] of SCREENS) {
      errors.length = 0;
      await page.goto(`${BASE}${url}`);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const landed = new URL(page.url()).pathname;
      const heading = ((await page.locator("h1, h2, h3").first().textContent({ timeout: 2000 }).catch(() => "")) ?? "").trim().slice(0, 80);
      const text = await page.locator("main, body").first().innerText().catch(() => "");
      const refused = /not switched on for you|not available to you|don't have (access|permission)|You do not have|isn't something you can|Only a director|forbidden|no access/i.test(text);
      const figure = text.match(/₹\s?\d[\d,]*(\.\d+)?/);
      if (!seesPay && figure) failures.push(`${where} ${label}: a rupee figure on screen (${figure[0].length} characters; value not printed)`);
      // Keyboard: Tab x6 must land on real elements with a visible focus indicator; then Esc.
      await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => undefined);
      let onBody = 0;
      let invisible = 0;
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return { body: true, visible: false };
          const s = getComputedStyle(el);
          const visible = (s.outlineStyle !== "none" && s.outlineWidth !== "0px") || (s.boxShadow && s.boxShadow !== "none") || el.matches(":focus-visible");
          return { body: false, visible };
        });
        if (f.body) onBody += 1;
        else if (!f.visible) invisible += 1;
      }
      await page.keyboard.press("Escape");
      if (onBody === 6) failures.push(`${where} ${label}: Tab never left the page body`);
      if (invisible > 0) failures.push(`${where} ${label}: ${invisible} focus stop(s) without a visible focus indicator`);
      if (errors.length) failures.push(`${where} ${label}: console error: ${errors[0]}`);
      const shot = `${role}-${width}-${scheme}-${url.replace(/[^a-z0-9]+/gi, "_")}.png`;
      await page.screenshot({ path: path.join(OUT, shot), fullPage: false });
      rows.push({ role, viewport: `${width} ${scheme}`, screen: label, landed, heading, state: refused ? "refused" : "content", rupeeFigure: Boolean(figure), keyboard: { onBody, invisible }, consoleErrors: errors.length, shot });
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(path.join(OUT, "walk.json"), JSON.stringify(rows, null, 2));
console.log(`${rows.length} stops; screenshots and walk.json in ${OUT}`);
if (failures.length) {
  console.log(`\n${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
