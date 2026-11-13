import { escapeHtml } from "../../../lib/htmlEscape";
import { embeddedFontCss } from "../../../lib/pdf/renderer";
import type { EngineResult } from "./engine";

// ST-24 / SS-05 (docs/plans/A_PARITY_ROWS.md): the page Chromium turns into a Form 16 Part B PDF. Our own layout of the figures the system already holds (no
// official template, no tax worked out here). Every value is escaped text; no script, no external file. A draft carries a diagonal watermark and a banner on every
// page. Part A is never made: the page says where it comes from.

export interface Form16PdfContent {
  company: { legalName: string; address: string };
  employee: { name: string; code: string; panLast4: string | null };
  year: string;
  regime: string | null;
  taxablePay: string;
  tdsDeducted: string;
  computation: EngineResult | null;
  missing: string[];
  watermark: string | null;
  partA: string;
}

const esc = escapeHtml;
const rupees = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? "—" : `₹ ${esc(v)}`);
const row = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td class="amt">${v}</td></tr>`;

export function form16Html(c: Form16PdfContent): string {
  const wm = c.watermark ? `<div class="wm">DRAFT</div><div class="banner">${esc(c.watermark)}</div>` : "";
  const r = c.computation;
  const sections = r && r.sections.length ? r.sections.map((s) => `<tr><td>${esc(s.label)} (${esc(s.code)})</td><td class="amt">${rupees(s.requested)}</td><td class="amt">${rupees(s.counted)}</td></tr>`).join("") : `<tr><td class="none" colspan="3">None</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${embeddedFontCss()}
@page { size: A4; margin: 14mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "Letter Sans"; font-size: 10pt; color: #111; line-height: 1.4; }
.head { border-bottom: 1.5px solid #333; padding-bottom: 6px; margin-bottom: 10px; }
.head .co { font-size: 14pt; font-weight: 700; }
.head .addr { font-size: 8.5pt; color: #444; white-space: pre-line; }
h1 { font-size: 12pt; margin: 8px 0 2px; }
h2 { font-size: 10pt; margin: 12px 0 4px; padding-bottom: 3px; border-bottom: 1px solid #999; }
table { width: 100%; border-collapse: collapse; }
td { padding: 3px 0; border-bottom: 1px solid #eee; vertical-align: top; }
td.k { color: #333; }
.amt { text-align: right; white-space: nowrap; }
.none { color: #888; }
.tot td { font-weight: 700; border-top: 1px solid #333; border-bottom: none; }
.note { margin-top: 10px; color: #555; font-size: 8.5pt; }
.wm { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 70pt; font-weight: 700; color: rgba(192,0,0,0.14); transform: rotate(-24deg); }
.banner { position: fixed; top: 0; left: 0; right: 0; text-align: center; color: #c00000; font-weight: 700; font-size: 9pt; }
</style></head><body>${wm}
<div class="head"><div class="co">${esc(c.company.legalName || "Company")}</div><div class="addr">${esc(c.company.address)}</div></div>
<h1>Form 16, Part B: ${esc(c.year)}</h1>
<table>
${row("Employee", `${esc(c.employee.name)} (${esc(c.employee.code)})`)}
${row("PAN", c.employee.panLast4 ? `ending ${esc(c.employee.panLast4)}` : "Not on record")}
${row("Regime", esc(c.regime ?? "Not chosen"))}
</table>
<h2>Salary and tax</h2>
<table>
${row("Taxable pay paid in the year", rupees(c.taxablePay))}
${r ? row("Standard deduction", rupees(r.standardDeduction)) : ""}
</table>
<h2>Deductions counted</h2>
<table><tr><td class="k"><b>Section</b></td><td class="amt"><b>Declared</b></td><td class="amt"><b>Counted</b></td></tr>${sections}</table>
<h2>Tax on the year</h2>
<table>
${r ? [row("Taxable income", rupees(r.taxableIncome)), row("Tax on the slabs", rupees(r.slabTax)), row("Rebate", rupees(r.rebate)), row(`Surcharge (${esc(r.surchargeRate)}%)`, rupees(r.surcharge)), row(`Health and education cess (${esc(r.cessPercent)}%)`, rupees(r.cess))].join("") : row("Tax computation", "Not available")}
<tr class="tot"><td>Tax for the year</td><td class="amt">${rupees(r?.annualTax)}</td></tr>
<tr class="tot"><td>TDS deducted</td><td class="amt">${rupees(c.tdsDeducted)}</td></tr>
</table>
${c.missing.length ? `<div class="note">Not yet available: ${c.missing.map(esc).join("; ")}</div>` : ""}
${r && r.notModelled.length ? `<div class="note">Not counted: ${r.notModelled.map(esc).join("; ")}</div>` : ""}
<div class="note">${esc(c.partA)}</div>
<div class="note">Our own layout of the figures in this system's finalised payroll runs; not the official form template.</div>
</body></html>`;
}
