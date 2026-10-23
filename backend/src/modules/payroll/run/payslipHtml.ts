import { escapeHtml } from "../../../lib/htmlEscape";
import { embeddedFontCss } from "../../../lib/pdf/renderer";
import type { PayslipContent, PayslipLine } from "./payslip";

// The page Chromium turns into a payslip PDF: one A4 page, the embedded font, no script and no external file. Every value is escaped text. A draft preview carries a
// diagonal TEST watermark and a banner; a published payslip never does (it cannot exist on Placeholder rules).

const esc = escapeHtml;
const rupees = (v: string) => `₹ ${v}`;

function lineRows(lines: PayslipLine[]): string {
  return lines.length === 0 ? `<tr><td class="none" colspan="2">None</td></tr>` : lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="amt">${rupees(l.amount)}</td></tr>`).join("");
}

export function payslipHtml(c: PayslipContent, opts: { watermark?: string | null } = {}): string {
  const wm = opts.watermark ? `<div class="wm">${esc(opts.watermark)}</div><div class="banner">${esc(opts.watermark)}</div>` : "";
  const s = c.statutory;
  const ids = [s.panLast4 ? `PAN ending ${esc(s.panLast4)}` : "", s.uanLast4 ? `UAN ending ${esc(s.uanLast4)}` : "", s.esiLast4 ? `ESI ending ${esc(s.esiLast4)}` : ""].filter(Boolean).join(" · ");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${embeddedFontCss()}
@page { size: A4; margin: 14mm 14mm 14mm 14mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "Letter Sans"; font-size: 10pt; color: #111; line-height: 1.4; }
.head { border-bottom: 1.5px solid #333; padding-bottom: 6px; margin-bottom: 10px; }
.head .co { font-size: 14pt; font-weight: 700; }
.head .addr { font-size: 8.5pt; color: #444; white-space: pre-line; }
h1 { font-size: 12pt; margin: 8px 0; }
table { width: 100%; border-collapse: collapse; }
.kv td { padding: 2px 6px 2px 0; vertical-align: top; }
.kv td.k { color: #555; width: 24%; }
.cols { display: flex; gap: 14px; margin-top: 10px; }
.cols > div { flex: 1; }
.cols h2 { font-size: 10pt; margin: 0 0 4px; padding-bottom: 3px; border-bottom: 1px solid #999; }
.cols td { padding: 3px 0; border-bottom: 1px solid #eee; }
.amt { text-align: right; white-space: nowrap; }
.none { color: #888; }
.tot td { font-weight: 700; border-top: 1px solid #333; border-bottom: none; padding-top: 5px; }
.net { margin-top: 12px; border: 1.5px solid #333; padding: 8px 10px; }
.net .n { font-size: 14pt; font-weight: 700; }
.net .w { color: #333; margin-top: 2px; }
.info { margin-top: 10px; color: #555; font-size: 8.5pt; }
.foot { margin-top: 14px; color: #777; font-size: 8pt; }
.wm { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 46pt; font-weight: 700; color: rgba(192,0,0,0.14); transform: rotate(-24deg); }
.banner { position: fixed; top: 0; left: 0; right: 0; text-align: center; color: #c00000; font-weight: 700; font-size: 9pt; }
</style></head><body>${wm}
<div class="head"><div class="co">${esc(c.company.legalName || "Company")}</div><div class="addr">${esc(c.company.address)}</div></div>
<h1>Payslip for ${esc(c.period.label)}</h1>
<table class="kv">
<tr><td class="k">Employee</td><td>${esc(c.employee.name)} (${esc(c.employee.code)})</td><td class="k">Period</td><td>${esc(c.period.start)} to ${esc(c.period.end)}</td></tr>
<tr><td class="k">Designation</td><td>${esc(c.employee.designation)}</td><td class="k">Department</td><td>${esc(c.employee.department)}</td></tr>
<tr><td class="k">Location</td><td>${esc(c.employee.location)}</td><td class="k">Date of joining</td><td>${esc(c.employee.dateOfJoining)}</td></tr>
<tr><td class="k">Days paid</td><td>${esc(c.days.paid)}</td><td class="k">Loss of pay days</td><td>${esc(c.days.lop)}</td></tr>
<tr><td class="k">Bank</td><td>${c.bank ? `${esc(c.bank.bankName)}, account ending ${esc(c.bank.accountLast4)}` : "—"}</td><td class="k">Identifiers</td><td>${ids || "—"}</td></tr>
</table>
<div class="cols">
<div><h2>Earnings</h2><table>${lineRows(c.earnings)}<tr class="tot"><td>Gross</td><td class="amt">${rupees(c.totals.gross)}</td></tr></table></div>
<div><h2>Deductions</h2><table>${lineRows(c.deductions)}${c.rounding ? `<tr><td>Rounding</td><td class="amt">${rupees(c.rounding)}</td></tr>` : ""}<tr class="tot"><td>Total deductions</td><td class="amt">${rupees(c.totals.deductions)}</td></tr></table></div>
</div>
<div class="net"><div class="n">Net pay ${rupees(c.totals.net)}</div><div class="w">${esc(c.netInWords)}</div></div>
${c.employerContributions.length ? `<div class="info"><b>Employer contributions (for information, not part of your pay):</b> ${c.employerContributions.map((l) => `${esc(l.label)} ${rupees(l.amount)}`).join(" · ")}</div>` : ""}
<div class="foot">This is a computer-generated payslip. Year-to-date figures will be added in a later release.</div>
</body></html>`;
}
