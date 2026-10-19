// A visual check of every popover, dropdown and drawer in both portals, at a phone width (390px) and at desktop width. Run against a running stack:
//
//   npm run check:popovers            (from frontend/; needs the API, the worker and `npm run dev` up, the seeded accounts, and Chrome)
//
// For each one it opens it and then checks what a person would see, not how it is built:
//   - it is OPAQUE: its own surface has a background (a menu drawn straight over the page is the bug this exists to catch);
//   - it has a border or shadow, so it reads as a layer above the page;
//   - it sits ABOVE the page: points inside it hit the popup itself, never the breadcrumb or the content behind;
//   - it FITS the screen: no part of it is outside the viewport (at 390px too);
//   - it CLOSES on Escape and on a click outside it.
// A screenshot of each is written to e2e/out/ (kept as a CI artifact). Exit code 1 lists every failure.
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// The Playwright driver already installed for the biometric agent's latency test; the frontend takes no new dependency for this.
const { chromium } = require(path.resolve(here, "../../biometric-agent/node_modules/playwright-core"));

const BASE = process.env.WEB_URL ?? "http://localhost:5173";
const USER = process.env.SIM_USER ?? "1000";
const PASSWORD = process.env.SIM_PASSWORD ?? "Wellsure@123";
const OUT = process.env.POPOVER_OUT ?? path.join(here, "out");
mkdirSync(OUT, { recursive: true });

const CHROME = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/google-chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => p && existsSync(p));
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] });

const failures = [];
const fail = (where, what) => {
  failures.push(`${where}: ${what}`);
  console.log(`  FAIL ${what}`);
};

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("e.g. 1042").fill(USER);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 });
}

/** What the opened layer looks like, measured in the page. `root` is the layer, `surface` the element that should carry its background. */
async function measure(page, root, surface) {
  return page.evaluate(
    ({ root, surface }) => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest(".ant-dropdown-hidden, .ant-popover-hidden, .ant-drawer-hidden, .ant-slide-up-leave");
      };
      const el = [...document.querySelectorAll(root)].find(visible);
      if (!el) return null;
      const s = (surface ? el.querySelector(surface) ?? (el.matches(surface) ? el : null) : el) ?? el;
      const cs = getComputedStyle(s);
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
      const parts = m ? m[1].split(",").map((x) => parseFloat(x)) : [0, 0, 0, 0];
      const alpha = parts.length > 3 ? parts[3] : 1;
      const rect = el.getBoundingClientRect();
      const inside = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && el.contains(hit);
      };
      const pad = 8;
      const points = [
        [rect.left + pad, rect.top + pad],
        [rect.right - pad, rect.top + pad],
        [rect.left + pad, rect.bottom - pad],
        [rect.right - pad, rect.bottom - pad],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ].filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
      return {
        alpha,
        hasEdge: [el, s, ...el.querySelectorAll("*")].slice(0, 12).some((e) => [null, "::before", "::after"].some((pseudo) => {
          const c = getComputedStyle(e, pseudo);
          return c.boxShadow !== "none" || (parseFloat(c.borderTopWidth) > 0 && c.borderTopStyle !== "none") || (c.filter && c.filter.includes("drop-shadow"));
        })),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        viewport: { w: innerWidth, h: innerHeight },
        coveredPoints: points.filter(([x, y]) => !inside(x, y)).length,
        checkedPoints: points.length,
      };
    },
    { root, surface },
  );
}

async function check(page, where, name, { open, root, surface, closeByEscape = true }) {
  const label = `${where} / ${name}`;
  console.log(label);
  await open();
  await page.waitForTimeout(500);
  const m = await measure(page, root, surface);
  if (!m) return fail(label, "did not open (nothing visible)");
  await page.screenshot({ path: path.join(OUT, `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`) });
  if (m.alpha < 0.95) fail(label, `its surface is not opaque (background alpha ${m.alpha})`);
  if (!m.hasEdge) fail(label, "it has neither a border nor a shadow, so it does not read as a layer above the page");
  if (m.coveredPoints > 0) fail(label, `${m.coveredPoints} of ${m.checkedPoints} points inside it are covered by the page behind it`);
  const { rect, viewport } = m;
  if (rect.left < -0.5 || rect.top < -0.5 || rect.right > viewport.w + 0.5 || rect.bottom > viewport.h + 0.5) {
    fail(label, `it does not fit the screen (${Math.round(rect.left)},${Math.round(rect.top)} to ${Math.round(rect.right)},${Math.round(rect.bottom)} in ${viewport.w}x${viewport.h})`);
  }
  if (closeByEscape) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000); // a drawer slides away before it is gone
    if (await measure(page, root, surface)) fail(label, "it did not close on Escape");
    await open();
    await page.waitForTimeout(500);
  }
  await page.mouse.click(Math.max(2, viewport.w - 3), Math.round(viewport.h / 2)); // a click outside it, at the right edge (the dev quick-login box sits in the bottom corner)
  await page.waitForTimeout(1000);
  if (await measure(page, root, surface)) fail(label, "it did not close on a click outside it");
}

for (const [width, height] of [
  [390, 844],
  [1280, 800],
]) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await login(page);
  const where = `${width}px`;

  // ── Admin portal ──
  await page.goto(`${BASE}/admin`);
  await page.getByText("Wellsure HR Portal v0.1.0").waitFor({ timeout: 30000 });
  const header = page.locator("header").first();
  await check(page, where, "admin: Your Apps", { open: () => header.getByRole("button", { name: "Your apps" }).click(), root: ".ant-dropdown", surface: "[data-testid=app-switcher-panel]" });
  await check(page, where, "admin: notification bell", { open: () => header.locator(".ant-badge").first().click(), root: ".ant-popover, .ant-drawer-content-wrapper", surface: ".ant-popover-container, .ant-drawer-section" });
  await check(page, where, "admin: settings menu", { open: () => header.locator(".anticon-setting").first().click(), root: ".ant-dropdown", surface: ".ant-dropdown-menu" });

  await page.goto(`${BASE}/admin/workforce`);
  await page.getByText("Wellsure HR Portal v0.1.0").waitFor({ timeout: 30000 });
  if (phone) {
    await check(page, where, "admin: menu drawer (Leave and Attendance)", { open: () => page.getByRole("button", { name: "Open the menu" }).click(), root: ".ant-drawer-content-wrapper", surface: ".ant-drawer-section" });
  } else {
    for (const group of ["Leave", "Attendance"]) {
      await check(page, where, `admin: ${group} menu`, { open: () => page.locator("header a", { hasText: group }).first().hover(), root: ".ant-dropdown", surface: ".ant-dropdown-menu" });
    }
  }

  // ── Employee portal ──
  await page.goto(`${BASE}/app/home`);
  await page.waitForTimeout(1500);
  const eHeader = page.locator("header").first();
  await check(page, where, "employee: notification bell", { open: () => eHeader.locator(".ant-badge").first().click(), root: ".ant-popover, .ant-drawer-content-wrapper", surface: ".ant-popover-container, .ant-drawer-section" });
  if (!phone) await check(page, where, "employee: Quick Links", { open: () => eHeader.locator("a", { hasText: "Quick Links" }).hover(), root: ".ant-dropdown", surface: ".ant-dropdown-menu" });
  await ctx.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} problem(s):\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log("\nEvery popover is opaque, above the page, inside the screen, and closes on Escape and on a click outside.");
