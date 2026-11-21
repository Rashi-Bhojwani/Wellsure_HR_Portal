// FIX-M10 (independent audit 2026-11-20): a keyboard check of the Apply leave dates, in a real browser. The audit found focus trapped in the "From" box: Tab x4 and
// Esc then Tab x3 all stayed on it. Run against a running stack (API, worker and `npm run dev`, the seeded accounts, Chrome):
//
//   npm run check:keyboard-leave      (from frontend/)
//
// At 1280 wide (light) and 390 wide (dark) it signs in, opens Apply leave, puts focus on "From" and checks that Tab moves to "To" and then off both boxes, that
// Shift+Tab comes back, and that Esc closes an open calendar and Tab then leaves the box. Exit code 1 lists every failure.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, "../../biometric-agent/node_modules/playwright-core"));
const BASE = process.env.WEB_URL ?? "http://localhost:5173";
const USER = process.env.SIM_USER ?? "1006";
const PASSWORD = process.env.SIM_PASSWORD ?? "Wellsure@123";
const CHROME = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/opt/pw-browsers/chromium", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] });
const failures = [];
const focusedId = (page) => page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName ?? "");

for (const [width, scheme] of [[1280, "light"], [390, "dark"]]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  const where = `${width} ${scheme}`;
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("e.g. 1042").fill(USER);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 });
  await page.goto(`${BASE}/app/leave/apply`);
  await page.locator("#leave-from").waitFor({ timeout: 30000 });
  await page.locator("#leave-from").focus();
  await page.keyboard.press("Tab");
  if ((await focusedId(page)) !== "leave-to") failures.push(`${where}: Tab from From went to "${await focusedId(page)}", not To`);
  await page.keyboard.press("Shift+Tab");
  if ((await focusedId(page)) !== "leave-from") failures.push(`${where}: Shift+Tab from To went to "${await focusedId(page)}", not From`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const after = await focusedId(page);
  if (after === "leave-from" || after === "leave-to") failures.push(`${where}: Tab x2 from From is still on a date box (${after})`);
  // Esc closes an open calendar and Tab then leaves the box.
  await page.locator("#leave-from").click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const open = await page.locator(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)").count();
  if (open > 0) failures.push(`${where}: Esc did not close the calendar`);
  await page.keyboard.press("Tab");
  if ((await focusedId(page)) === "leave-from") failures.push(`${where}: after Esc, Tab stayed on From`);
  console.log(`  ${where}: checked`);
  await context.close();
}
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nKeyboard check of Apply leave: all passed.");
