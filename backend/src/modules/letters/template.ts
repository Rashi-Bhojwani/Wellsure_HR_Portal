import sanitizeHtml from "sanitize-html";
import {
  LETTER_EXTRA_FIELD_KEY_PATTERN,
  LETTER_PLACEHOLDER_PATTERN,
  LETTER_PLACEHOLDERS,
  type LetterExtraField,
} from "@shared/constants/letters";
import { embeddedFontCss } from "../../lib/pdf/renderer";
import { HttpError } from "../../middleware/errorHandler";

// Template bodies are HTML from the TipTap editor. They're sanitized on save
// to a small formatting allowlist (no scripts, links, images, iframes, event
// handlers or arbitrary styles) — the renderer also blocks JS and network,
// this is the first of the two locks.
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "hr"],
  allowedAttributes: { p: ["style"], h1: ["style"], h2: ["style"], h3: ["style"] },
  allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  disallowedTagsMode: "discard",
};

export function sanitizeTemplateHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE).trim();
}

const textOnly = (html: string) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });

// Every {{…}} must be a known placeholder, written in one piece (a token
// half-bolded in the editor would never be replaced and would print as
// literal braces in a legal document — refused at save, not discovered on
// a letter).
export function validatePlaceholders(html: string, extraFields: LetterExtraField[]): void {
  const extras = new Set(extraFields.map((f) => `extra.${f.key}`));
  const inHtml = [...html.matchAll(LETTER_PLACEHOLDER_PATTERN)].map((m) => m[1]!);
  const inText = [...textOnly(html).matchAll(LETTER_PLACEHOLDER_PATTERN)].map((m) => m[1]!);
  const unknown = [...new Set(inHtml.filter((k) => !(k in LETTER_PLACEHOLDERS) && !extras.has(k)))];
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map((k) => `{{${k}}}`).join(", ")}.`, "VALIDATION_ERROR");
  }
  const leftover = html.replace(LETTER_PLACEHOLDER_PATTERN, "");
  if (inText.length !== inHtml.length || leftover.includes("{{") || leftover.includes("}}")) {
    throw new HttpError(400, "A placeholder is broken up by formatting or a stray brace. Re-insert it from the placeholder menu so it's all in one style.", "VALIDATION_ERROR");
  }
}

export function validateExtraFields(fields: LetterExtraField[]): void {
  const seen = new Set<string>();
  for (const f of fields) {
    if (!LETTER_EXTRA_FIELD_KEY_PATTERN.test(f.key)) throw new HttpError(400, `Field key "${f.key}" must be letters and digits, starting with a letter.`, "VALIDATION_ERROR");
    if (seen.has(f.key)) throw new HttpError(400, `Field key "${f.key}" is used twice.`, "VALIDATION_ERROR");
    seen.add(f.key);
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Merge values are plain text: escaped, with line breaks kept (addresses).
export function mergeIntoBody(bodyHtml: string, values: Record<string, string>): string {
  return bodyHtml.replace(LETTER_PLACEHOLDER_PATTERN, (_, key: string) => escapeHtml(values[key] ?? "").replace(/\r?\n/g, "<br>"));
}

export interface Letterhead {
  legalName: string;
  address: string;
  logo: { storageKey: string; sha256: string; mimeType: string } | null;
}

// The complete, self-contained page Chromium renders: embedded font, the
// letterhead (logo as a data: URI) and the merged body. Nothing external.
export function letterDocument(mergedBody: string, letterhead: Letterhead, logoBytes: Buffer | null): string {
  const logo = letterhead.logo && logoBytes ? `<img class="logo" alt="" src="data:${letterhead.logo.mimeType};base64,${logoBytes.toString("base64")}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${embeddedFontCss()}
@page { size: A4; margin: 18mm 20mm 20mm 20mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "Letter Sans"; font-size: 11pt; line-height: 1.5; color: #111; }
.letterhead { display: flex; align-items: center; gap: 14px; border-bottom: 1.5px solid #333; padding-bottom: 8px; margin-bottom: 18px; }
.letterhead .logo { max-height: 56px; max-width: 160px; }
.letterhead .name { font-size: 15pt; font-weight: 700; }
.letterhead .address { font-size: 9pt; color: #444; white-space: pre-line; }
h1 { font-size: 16pt; } h2 { font-size: 13pt; } h3 { font-size: 11.5pt; }
p { margin: 0 0 8pt; } blockquote { margin: 0 0 8pt 16pt; }
</style></head><body>
<div class="letterhead">${logo}<div><div class="name">${escapeHtml(letterhead.legalName)}</div><div class="address">${escapeHtml(letterhead.address)}</div></div></div>
${mergedBody}
</body></html>`;
}
