import { buildXlsx, safeSheetName, type XlsxSheet } from "../../lib/xlsx";
import type { Watermark } from "./rules/context";

// The watermark on everything that leaves the screen (docs/plans/PHASE_6.md §1): a run that used a Placeholder rule is a TEST, and its workbooks and payslip
// previews say so in the file itself, where a forwarded attachment cannot lose it.

/** Every sheet gets a red banner naming the rules, and its tab name starts with TEST. A confirmed run's sheets are returned untouched. */
export function withWatermark(sheets: XlsxSheet[], watermark: Watermark): XlsxSheet[] {
  if (!watermark.test) return sheets;
  const banner = [watermark.text, `Do not pay from this. Still a Placeholder: ${watermark.rules.map((r) => r.label).join("; ")}.`];
  return sheets.map((s) => ({ ...s, name: safeSheetName(`TEST ${s.name}`), banner, footer: [...(s.footer ?? []), watermark.text] }));
}

export async function buildPayrollXlsx(sheets: XlsxSheet[], watermark: Watermark): Promise<Buffer> {
  return buildXlsx(withWatermark(sheets, watermark));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A diagonal mark across every page and a line at the top, for a payslip preview PDF. Empty for a confirmed run. */
export function watermarkHtml(watermark: Watermark): string {
  if (!watermark.test) return "";
  return `<style>
.wm-top{position:fixed;top:0;left:0;right:0;text-align:center;background:#c00000;color:#fff;font:bold 12px sans-serif;padding:4px}
.wm-diag{position:fixed;top:40%;left:0;right:0;text-align:center;font:bold 64px sans-serif;color:rgba(192,0,0,.18);transform:rotate(-30deg);pointer-events:none;z-index:9999}
</style>
<div class="wm-top">${escapeHtml(watermark.text)}: ${escapeHtml(watermark.rules.map((r) => r.label).join("; "))}</div>
<div class="wm-diag">${escapeHtml(watermark.text)}</div>`;
}

export function applyWatermarkToHtml(html: string, watermark: Watermark): string {
  const mark = watermarkHtml(watermark);
  if (!mark) return html;
  return html.includes("</body>") ? html.replace("</body>", `${mark}</body>`) : html + mark;
}
