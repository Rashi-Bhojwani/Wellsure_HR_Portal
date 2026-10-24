// Screenshot sets for the UI pass (docs/DESIGN_SYSTEM.md): signs in as a demo-company user and captures the given routes at the given widths and themes.
// Demo company only — never real data. Run against a running stack that has had `npm run seed:demo-company` (backend/):
//
//   node e2e/screenshots.mjs --out ../docs/design/compare/ui-2 --user DEMO004 --routes /app/home,/admin --widths 1280,390 --themes light,dark
//
// Options: --user (default DEMO004, the demo HR Admin), --routes (comma-separated; "/login" is captured signed out), --widths, --themes, --full (whole page, not just the viewport),
// --quality (JPEG quality, default 72). Files are <out>/<route-slug>-<width>-<theme>.jpg.
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(here, "../../biometric-agent/node_modules/playwright-core"));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : acc), []),
);
const BASE = process.env.WEB_URL ?? "http://localhost:5173";
const PASSWORD = process.env.SIM_PASSWORD ?? "Wellsure@123";
const OUT = path.resolve(process.cwd(), args.out ?? path.join(here, "out", "screens"));
const USER = args.user ?? "DEMO004";
const ROUTES = (args.routes ?? "/app/home").split(",").filter(Boolean);
const WIDTHS = (args.widths ?? "1280,390").split(",").map(Number);
const THEMES = (args.themes ?? "light,dark").split(",");
const QUALITY = Number(args.quality ?? 72);
mkdirSync(OUT, { recursive: true });

const CHROME = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, "/usr/bin/google-chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find((p) => p && existsSync(p));
const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] });

const slug = (r) => r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "") || "root";

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 }, deviceScaleFactor: 1, colorScheme: theme === "dark" ? "dark" : "light" });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("wellsure-theme-mode", t);
      } catch {
        /* private mode */
      }
    }, theme);
    const page = await ctx.newPage();
    let signedIn = false;
    for (const route of ROUTES) {
      if (route !== "/login" && !signedIn) {
        await page.goto(`${BASE}/login`);
        await page.getByPlaceholder("e.g. 1042").fill(USER);
        await page.getByPlaceholder("Password").fill(PASSWORD);
        await page.getByRole("button", { name: /sign in|log in/i }).click();
        await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 });
        signedIn = true;
      }
      await page.goto(`${BASE}${route}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(900);
      const file = path.join(OUT, `${slug(route)}-${width}-${theme}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: QUALITY, fullPage: args.full === "true" });
      console.log(file);
    }
    await ctx.close();
  }
}
await browser.close();
