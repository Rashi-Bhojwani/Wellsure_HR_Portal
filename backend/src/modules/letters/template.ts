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

// ── Proof that a letter contains no pay figure ───────────────────────────────────────────────
// HR may issue a letter without the pay-letters key only when the template version PROVES it cannot carry a pay figure: (1) the closed placeholder catalog has no pay placeholder, so
// the body can only print those; (2) no extra field is a number or currency, nor named or labelled like pay; (3) the fixed text of the body has no pay word, currency sign or
// amount. Anything else is refused, in words, with the reasons. The values HR types at issue are checked the same way (payFreeValueProblem). It is a conservative test: a false
// refusal sends the letter to a director; a false pass would be a leak, so the word list errs wide.
const PAY_VOCABULARY = /\b(ctc|cost to company|salary|salaries|wage|wages|stipend|remuneration|compensation|emolument|gross|net pay|take[- ]home|basic pay|basic salary|allowance|allowances|bonus|incentive|variable pay|pay ?(?:scale|band|grade|package|slip|structure)|per annum|p\.a\.|per month|lpa|lakh|lakhs|crore|gratuity|provident fund|pf contribution|esi|increment|hike|rupee|rupees|inr|rs\.?)\b|₹/i;
const GROUPED_AMOUNT = /\b\d{1,3}(,\d{2,3})+(\.\d+)?\b/;

export interface PayFreeProof {
  ok: boolean;
  reasons: string[];
}

export function payFreeProof(bodyHtml: string, extraFields: LetterExtraField[]): PayFreeProof {
  const reasons: string[] = [];
  for (const f of extraFields) {
    if (f.type === "number" || f.type === "currency") reasons.push(`The field "${f.label}" is a ${f.type} field, which could carry a pay figure.`);
    else if (PAY_VOCABULARY.test(`${f.key} ${f.label}`)) reasons.push(`The field "${f.label}" is named like pay.`);
  }
  const text = textOnly(bodyHtml.replace(LETTER_PLACEHOLDER_PATTERN, " ")).replace(/\s+/g, " ");
  const word = text.match(PAY_VOCABULARY);
  if (word) reasons.push(`The letter's own text mentions pay ("${word[0].trim()}").`);
  if (GROUPED_AMOUNT.test(text)) reasons.push("The letter's own text contains an amount.");
  const used = [...bodyHtml.matchAll(LETTER_PLACEHOLDER_PATTERN)].map((m) => m[1]!);
  const unknown = used.filter((k) => !(k in LETTER_PLACEHOLDERS) && !k.startsWith("extra."));
  if (unknown.length > 0) reasons.push(`It uses a placeholder that is not in the closed list (${[...new Set(unknown)].join(", ")}).`);
  return { ok: reasons.length === 0, reasons };
}

/** What HR typed into a field of a pay-free letter: refused if it looks like pay, so a text field cannot be used to carry a figure. */
export function payFreeValueProblem(label: string, value: string): string | null {
  if (PAY_VOCABULARY.test(value) || GROUPED_AMOUNT.test(value)) return `"${label}" looks like a pay figure, so this letter needs a director.`;
  return null;
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
