// C-2 walkthrough on the fictional DEMO company. No real data or production stack.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome node e2e/helpdesk.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("../../biometric-agent/node_modules/playwright-core");
const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const API = process.env.API_URL ?? "http://localhost:4000";
const PASSWORD = process.env.SIM_PASSWORD ?? "Wellsure@123";
const OUT = process.env.HELPDESK_OUT ?? "/tmp/c2-helpdesk-walkthrough";
mkdirSync(OUT, { recursive: true });
const login = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeCode: "DEMO001", password: PASSWORD }) });
assert.equal(login.status, 200);
const token = (await login.json()).accessToken;
const queue = await fetch(`${API}/api/helpdesk/queue?page=1&pageSize=100`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
const privateTicket = queue.items.find((t) => t.subject === "DEMO-C2-PRIVATE");
const hrTicket = queue.items.find((t) => t.subject === "DEMO-C2-HR-VISIBLE");
assert(privateTicket && hrTicket, "Seed the C-2 DEMO tickets first");
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const checks = [];
const sessions = new Map();
try {
  for (const width of [1280, 390]) for (const theme of ["light", "dark"]) {
    for (const code of ["DEMO001", "DEMO004", "DEMO006", "DEMO009"]) {
      let page = sessions.get(code);
      const fresh = !page;
      if (!page) {
        const context = await browser.newContext();
        page = await context.newPage();
        sessions.set(code, page);
      }
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: theme });
      const visit = async (route) => { await page.goto(`${WEB}${route}`); await page.waitForLoadState("networkidle"); };
      const text = () => page.locator("body").innerText();
      const snap = async (label) => {
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${code} ${width} ${theme} ${label}: horizontal overflow`);
        await page.screenshot({ path: path.join(OUT, `${code}-${width}-${theme}-${label}.png`), fullPage: true });
      };
      if (fresh) {
      await visit("/login");
      await page.getByPlaceholder("e.g. 1042").fill(code);
      await page.getByPlaceholder("Password").fill(PASSWORD);
      await page.getByRole("button", { name: /sign in|log in/i }).click();
      await page.waitForURL((u) => !u.pathname.includes("login"));
      }
      await page.evaluate((mode) => localStorage.setItem("wellsure-theme-mode", mode), theme);
      if (code === "DEMO001") {
        await visit("/admin/employee/helpdesk");
        assert((await text()).includes("DEMO-C2-PRIVATE"));
        await visit("/admin/admin-tools/helpdesk-categories");
        await page.getByRole("button", { name: "Who can see this", exact: true }).first().click();
        await page.getByTestId("helpdesk-category-visibility").waitFor();
        await snap("visibility");
        await page.keyboard.press("Escape");
        await page.getByTestId("helpdesk-category-visibility").waitFor({ state: "hidden" });
      } else if (code === "DEMO004") {
        await visit("/admin/employee/helpdesk");
        assert((await text()).includes("DEMO-C2-HR-VISIBLE"));
        assert(!(await text()).includes("DEMO-C2-PRIVATE"));
        await visit(`/admin/employee/helpdesk/${hrTicket.id}`);
        await page.getByRole("button", { name: "Move", exact: true }).click();
        await page.getByText("Your access may end", { exact: true }).waitFor();
        await snap("move");
        await page.keyboard.press("Escape");
        await visit(`/admin/employee/helpdesk/${privateTicket.id}`);
        assert(!(await text()).includes("DEMO-C2-PRIVATE"));
        assert((await text()).includes("Ticket not found"));
        await snap("outside-category");
        await visit("/admin/admin-tools/helpdesk-categories");
        assert.equal(await page.getByRole("button", { name: "Who can see this", exact: true }).count(), 0);
      } else {
        await visit("/app/helpdesk");
        assert.equal((await text()).includes("DEMO-C2-PRIVATE"), code === "DEMO006");
        await visit(`/app/helpdesk/${privateTicket.id}`);
        assert.equal((await text()).includes("DEMO-C2-PRIVATE"), code === "DEMO006");
        await snap(code === "DEMO006" ? "raiser-thread" : "other-employee");
      }
      checks.push({ code, width, theme, passed: true });

    }
  }
} finally { await browser.close(); }
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(checks, null, 2));
console.log(`Helpdesk walkthrough passed: ${checks.length} role/theme/width cases; director panel, Move, HR visibility, employee isolation and overflow. Screenshots: ${OUT}`);
