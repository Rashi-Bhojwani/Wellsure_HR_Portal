import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import puppeteer, { type Browser } from "puppeteer-core";
import { logger } from "../logger";

// HTML → PDF with headless Chromium (Phase 5 commit D2; payslips reuse it
// in Phase 6). Letters are legal documents, so rendering is locked down and
// made as reproducible as Chromium allows:
//   - JavaScript is disabled and EVERY network request is blocked — the
//     page is self-contained (embedded font, logo as a data: URI), so a
//     template can never make the server fetch anything (SSRF);
//   - one bundled font (Noto Sans, OFL — it has ₹), embedded, so output
//     doesn't depend on the machine's installed fonts;
//   - PDF metadata dates are fixed to the letter's own timestamp, so
//     re-rendering the same letter gives the same bytes on the same
//     Chromium version.

const require = createRequire(import.meta.url);

// Chromium location: CHROMIUM_PATH wins; otherwise the usual install paths
// (Alpine/Debian packages, Google Chrome, macOS, Windows, Playwright's
// bundled build). See docs/GETTING_STARTED.md.
const CANDIDATE_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/pw-browsers/chromium", // Playwright's bundled build (a symlink to the binary)
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

export class PdfRendererUnavailableError extends Error {}

export function resolveChromiumPath(): string {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new PdfRendererUnavailableError(`CHROMIUM_PATH is set to "${fromEnv}", which doesn't exist.`);
    return fromEnv;
  }
  const found = CANDIDATE_PATHS.find((p) => existsSync(p));
  if (found) return found;
  throw new PdfRendererUnavailableError("No Chromium/Chrome found for PDF rendering. Install Chrome or Chromium, or set CHROMIUM_PATH (docs/GETTING_STARTED.md).");
}

// ── The bundled font, embedded as data: URIs ───────────────────────────
const FONT_DIR = path.dirname(require.resolve("@fontsource/noto-sans/package.json"));
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
let fontCss: string | null = null;
export function embeddedFontCss(): string {
  if (fontCss) return fontCss;
  const faces: string[] = [];
  for (const [subset, range] of [["latin", LATIN], ["latin-ext", LATIN_EXT]] as const) {
    for (const weight of [400, 700]) {
      for (const style of ["normal", "italic"]) {
        const file = path.join(FONT_DIR, "files", `noto-sans-${subset}-${weight}-${style}.woff2`);
        const data = readFileSync(file).toString("base64");
        faces.push(`@font-face{font-family:"Letter Sans";font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range};}`);
      }
    }
  }
  fontCss = faces.join("\n");
  return fontCss;
}

// ── Browser lifecycle: one shared instance, closed when idle ────────────
let browserPromise: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
const IDLE_CLOSE_MS = 60_000;

async function getBrowser(): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer);
  browserPromise ??= puppeteer
    .launch({
      executablePath: resolveChromiumPath(),
      headless: true,
      // Root in a container (the current Dockerfile, not yet hardened) can't
      // use Chromium's sandbox; the page is locked down regardless (no JS,
      // no network, our own HTML only).
      args: [
        ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
        "--disable-extensions",
      ],
    })
    .catch((err: unknown) => {
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closePdfRenderer(), IDLE_CLOSE_MS);
  idleTimer.unref();
}

export async function closePdfRenderer(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  const pending = browserPromise;
  browserPromise = null;
  if (pending) await (await pending).close().catch((err: unknown) => logger.warn({ err }, "pdf renderer close failed"));
}

export interface RenderedPdf {
  pdf: Buffer;
  rendererVersion: string;
  blockedRequests: string[];
}

// Renders a complete, self-contained HTML document to an A4 PDF. `fixedDate`
// becomes the PDF's creation/modification date (the letter's own timestamp).
export async function renderPdf(html: string, fixedDate: Date): Promise<RenderedPdf> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const blockedRequests: string[] = [];
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") return void req.continue();
      blockedRequests.push(url);
      void req.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    const raw = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    const pdf = await normaliseMetadata(Buffer.from(raw), fixedDate);
    return { pdf, rendererVersion: await browser.version(), blockedRequests };
  } finally {
    await page.close().catch(() => undefined);
    scheduleIdleClose();
  }
}

async function normaliseMetadata(raw: Buffer, fixedDate: Date): Promise<Buffer> {
  const doc = await PDFDocument.load(raw, { updateMetadata: false });
  doc.setCreationDate(fixedDate);
  doc.setModificationDate(fixedDate);
  doc.setProducer("Wellsure HR Portal");
  doc.setCreator("Wellsure HR Portal — letters");
  return Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}
