// A visual check of every popover, dropdown and drawer of the app shell in both portals, at a phone width (390px) and at desktop width, in light and dark. Run against a running stack:
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

for (const theme of ["light", "dark"]) {
for (const [width, height] of [
  [390, 844],
  [1280, 800],
]) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("wellsure-theme-mode", t);
    } catch {
      /* private mode */
    }
  }, theme);
  const page = await ctx.newPage();
  await login(page);
  const where = `${width}px ${theme}`;
  const header = () => page.locator("header.ws-topbar").first();

  // ── Admin portal (the shared shell: sidebar, top bar, search, bell, avatar menu) ──
  await page.goto(`${BASE}/admin`);
  await page.locator("header.ws-topbar").waitFor({ timeout: 30000 });
  await check(page, where, "admin: notification bell", { open: () => header().locator(".ant-badge").first().click(), root: ".ant-popover, .ant-drawer-content-wrapper", surface: ".ant-popover-container, .ant-drawer-section" });
  await check(page, where, "admin: account menu", { open: () => header().locator(".ws-avatar-btn").click(), root: ".ant-dropdown", surface: ".ant-dropdown-menu" });
  await check(page, where, "admin: search", { open: () => header().getByRole("button", { name: "Search pages and actions" }).click(), root: ".ant-modal-wrap .ant-modal", surface: ".ant-modal-container" });
  if (phone) {
    await check(page, where, "admin: menu drawer", { open: () => page.getByRole("button", { name: "Open the menu" }).click(), root: ".ant-drawer-content-wrapper", surface: ".ant-drawer-section" });
  }

  // ── Employee portal ──
  await page.goto(`${BASE}/app/home`);
  await page.locator("header.ws-topbar").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await check(page, where, "employee: notification bell", { open: () => header().locator(".ant-badge").first().click(), root: ".ant-popover, .ant-drawer-content-wrapper", surface: ".ant-popover-container, .ant-drawer-section" });
  await check(page, where, "employee: account menu", { open: () => header().locator(".ws-avatar-btn").click(), root: ".ant-dropdown", surface: ".ant-dropdown-menu" });
  // PEEPS-BEGIN assets
  // The asset register's layers: a filter dropdown, and the settings drawer (always there for a director, set up or not).
  await page.goto(`${BASE}/admin/assets/register`);
  await page.locator("header.ws-topbar").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  // Phones put the filters in a sheet (FilterBar); desktops show them inline.
  if (phone) await check(page, where, "assets: filter sheet", { open: () => page.getByRole("button", { name: /filter/i }).first().click(), root: ".ant-drawer-content-wrapper", surface: ".ant-drawer-section" });
  else await check(page, where, "assets: holder filter", { open: () => page.locator(".ant-select").filter({ has: page.locator("[aria-label=Holder]") }).first().click(), root: ".ant-select-dropdown", surface: null });
  await page.goto(`${BASE}/admin/assets/settings`);
  await page.locator("header.ws-topbar").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  // A right-hand drawer always covers the right edge, where check() clicks "outside"; so this one is measured the same way, closed with Escape, and then
  // closed by clicking the mask on the left (on a phone it fills the screen and is closed with Escape or its close button instead).
  {
    const label = `${where} / assets: settings drawer`;
    const open = () => page.getByRole("button", { name: /^Change categories$/ }).click();
    const root = ".ant-drawer-content-wrapper";
    const surface = ".ant-drawer-section";
    console.log(label);
    await open();
    await page.waitForTimeout(700);
    const m = await measure(page, root, surface);
    if (!m) fail(label, "did not open (nothing visible)");
    else {
      await page.screenshot({ path: path.join(OUT, `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`) });
      if (m.alpha < 0.95) fail(label, `its surface is not opaque (background alpha ${m.alpha})`);
      if (!m.hasEdge) fail(label, "it has neither a border nor a shadow, so it does not read as a layer above the page");
      if (m.coveredPoints > 0) fail(label, `${m.coveredPoints} of ${m.checkedPoints} points inside it are covered by the page behind it`);
      if (m.rect.left < -0.5 || m.rect.right > m.viewport.w + 0.5) fail(label, "it does not fit the screen");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      if (await measure(page, root, surface)) fail(label, "it did not close on Escape");
      if (!phone) {
        await open();
        await page.waitForTimeout(700);
        await page.mouse.click(3, Math.round(m.viewport.h / 2));
        await page.waitForTimeout(1000);
        if (await measure(page, root, surface)) fail(label, "it did not close on a click outside it");
      }
    }
  }
  // PEEPS-END
  // PEEPS-BEGIN office-unmute
  // The Wellsure Office members page (the dev seed's 1000 is a director): its "Appoint a member" drawer, measured like the asset settings drawer above.
  {
    await page.goto(`${BASE}/app/office/members`);
    await page.locator("header.ws-topbar").waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const label = `${where} / office: appoint drawer`;
    const open = () => page.getByRole("button", { name: /Appoint a member/ }).first().click();
    const root = ".ant-drawer-content-wrapper";
    const surface = ".ant-drawer-section";
    console.log(label);
    await open();
    await page.waitForTimeout(700);
    const m = await measure(page, root, surface);
    if (!m) fail(label, "did not open (nothing visible)");
    else {
      if (m.alpha < 0.95) fail(label, `its surface is not opaque (background alpha ${m.alpha})`);
      if (!m.hasEdge) fail(label, "it has neither a border nor a shadow, so it does not read as a layer above the page");
      if (m.coveredPoints > 0) fail(label, `${m.coveredPoints} of ${m.checkedPoints} points inside it are covered by the page behind it`);
      if (m.rect.left < -0.5 || m.rect.right > m.viewport.w + 0.5) fail(label, "it does not fit the screen");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      if (await measure(page, root, surface)) fail(label, "it did not close on Escape");
      if (!phone) {
        await open();
        await page.waitForTimeout(700);
        await page.mouse.click(3, Math.round(m.viewport.h / 2));
        await page.waitForTimeout(1000);
        if (await measure(page, root, surface)) fail(label, "it did not close on a click outside it");
      }
    }
  }
  // PEEPS-END
  // PEEPS-BEGIN leave-types
  // The new leave types' "Prepare rules" drawer on Leave Types & Policies (the dev seed's 1000 is a director, so the panel is there).
  await page.goto(`${BASE}/admin/admin-tools/leave-policies`);
  await page.locator("header.ws-topbar").waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  {
    const label = `${where} / leave types: prepare rules drawer`;
    const root = ".ant-drawer-content-wrapper";
    const surface = ".ant-drawer-section";
    console.log(label);
    await page.getByRole("button", { name: /^(Prepare|Change) rules$/ }).first().click();
    await page.waitForTimeout(700);
    const m = await measure(page, root, surface);
    if (!m) fail(label, "did not open (nothing visible)");
    else {
      if (m.alpha < 0.95) fail(label, `its surface is not opaque (background alpha ${m.alpha})`);
      if (!m.hasEdge) fail(label, "it has neither a border nor a shadow, so it does not read as a layer above the page");
      if (m.coveredPoints > 0) fail(label, `${m.coveredPoints} of ${m.checkedPoints} points inside it are covered by the page behind it`);
      if (m.rect.left < -0.5 || m.rect.right > m.viewport.w + 0.5) fail(label, "it does not fit the screen");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      if (await measure(page, root, surface)) fail(label, "it did not close on Escape");
    }
  }
  // PEEPS-END
  // PEEPS-BEGIN avatars
  // The "Remove photo" dialog on someone else's admin profile (HR and the directors remove an inappropriate photo, with a reason). Seeded 1006 adds their
  // own photo first through the API (only the owner can), so the director (1000) has one to remove.
  {
    // One sign-in for the whole run (the login endpoint is rate-limited per address, and later CI steps sign in too).
    const API = process.env.API_URL ?? "http://localhost:4000";
    if (!globalThis.__photoSubject) {
      const login = await (await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeCode: "1006", password: PASSWORD }) })).json();
      const auth = { authorization: `Bearer ${login.accessToken}` };
      const me = await (await fetch(`${API}/api/auth/me`, { headers: auth })).json();
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      const form = new FormData();
      form.append("file", new Blob([png], { type: "image/png" }), "photo.png");
      const put = await fetch(`${API}/api/employees/me/photo`, { method: "PUT", headers: auth, body: form });
      if (!put.ok) fail(`${where} / avatars`, `seeded 1006 could not add their own photo (${put.status})`);
      globalThis.__photoSubject = me.employeeId;
    }
    // The dialog is only opened and closed here, never confirmed, so the photo stays for every theme and width.
    await page.goto(`${BASE}/admin/employee/profile/${globalThis.__photoSubject}`);
    await page.locator("header.ws-topbar").waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await check(page, where, "avatars: remove photo dialog", { open: () => page.getByRole("button", { name: /Remove photo/ }).first().click(), root: ".ant-modal-wrap .ant-modal", surface: ".ant-modal-container" });
  }
  // PEEPS-END
  await ctx.close();
}
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} problem(s):\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log("\nEvery popover is opaque, above the page, inside the screen, and closes on Escape and on a click outside.");
