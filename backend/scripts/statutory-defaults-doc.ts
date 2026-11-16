import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  CONTINUING,
  PACK_CHECKED_ON,
  PACK_ECR_LAYOUT,
  PACK_ENCASHMENT,
  PACK_GRATUITY,
  PACK_NOTICE,
  PACK_RULES,
  PACK_STATE_LABEL,
  PACK_STATE_RULES,
  PACK_TAX_YEARS,
  PACK_VERSION,
  type PackEntry,
} from "@shared/constants/statutoryDefaults";
import { RULE_BY_KEY } from "@shared/constants/payrollRules";

// `npm run docs:statutory-defaults`: writes docs/STATUTORY_DEFAULTS.md from shared/constants/statutoryDefaults.ts (the single source the code reads), so the document can
// never drift from what payroll uses. statutoryDefaults.test.ts fails if the document is out of date.
const v = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));
const from = (e: PackEntry) => (e.from === CONTINUING ? "in force (no change found)" : e.from);
const flag = (e: PackEntry | { verification: string }) => (e.verification === "UNVERIFIED" ? "**UNVERIFIED, review needed**" : "Official");
const link = (s: { name: string; url: string }) => (s.url ? `[${s.name}](${s.url})` : s.name);
const esc = (t: string) => t.replace(/\|/g, "\\|");
const lines: string[] = [];
lines.push("# Standard statutory defaults", "");
lines.push(`Generated from \`shared/constants/statutoryDefaults.ts\` by \`npm run docs:statutory-defaults\` (pack version ${PACK_VERSION}, values checked on ${PACK_CHECKED_ON}). Do not edit by hand.`, "");
lines.push("Owner decision 2026-11-16: statutory and tax rules ship with standard, sourced values already in force (plan: `docs/plans/STATUTORY_DEFAULTS_PLAN.md`). A value is used only where no director has **confirmed** a value of their own; the pack never overwrites one. State: Rajasthan. Direct fetches of the government sites were refused (HTTP 403/503) from the build machine, so official documents were read through the search index of the official domains; a value only a non-government site states is marked UNVERIFIED and is still used, flagged \"review needed\" on the screens and on Ready for First Run.", "");
lines.push("## Payroll rules", "", "| Rule | Value | Effective from | Source | Checked | Status | Notes |", "|---|---|---|---|---|---|---|");
for (const [key, series] of Object.entries(PACK_RULES)) for (const e of series) lines.push(`| ${RULE_BY_KEY[key]?.label ?? key} (\`${key}\`) | ${esc(v(e.value))} | ${from(e)} | ${esc(link(e.source))} | ${e.checkedOn} | ${flag(e)} | ${esc(e.note)} |`);
for (const [state, p] of Object.entries(PACK_STATE_RULES)) {
  const name = PACK_STATE_LABEL[state] ?? state;
  lines.push("", `## ${name}: professional tax, labour welfare fund, minimum wages`, "", "| Item | Value | Effective from | Source | Checked | Status | Notes |", "|---|---|---|---|---|---|---|");
  lines.push(`| Professional tax | Not levied in ${name} | ${from(p.professionalTax)} | ${esc(link(p.professionalTax.source))} | ${p.professionalTax.checkedOn} | ${flag(p.professionalTax)} | ${esc(p.professionalTax.note)} |`);
  lines.push(`| Labour welfare fund | Not levied in ${name} | ${from(p.labourWelfareFund)} | ${esc(link(p.labourWelfareFund.source))} | ${p.labourWelfareFund.checkedOn} | ${flag(p.labourWelfareFund)} | ${esc(p.labourWelfareFund.note)} |`);
  lines.push(`| Minimum wages (shops and commercial establishments) | ${p.minimumWages.value.map((r) => `${r.category}: Rs ${r.dailyAmount}/day, Rs ${r.monthlyAmount}/month`).join("; ")} | ${from(p.minimumWages)} | ${esc(link(p.minimumWages.source))} | ${p.minimumWages.checkedOn} | ${flag(p.minimumWages)} | ${esc(p.minimumWages.note)} |`);
  lines.push("", "Any other state: professional tax and LWF are refused (\"Values for this state have not been loaded\") until a director enters that state's tables.");
}
for (const [year, t] of Object.entries(PACK_TAX_YEARS)) {
  const val = t.value as Record<string, unknown>;
  lines.push("", `## Income tax ${year} (Income-tax Act, 2025)`, "", `Status: ${t.verification === "UNVERIFIED" ? "**partly UNVERIFIED, review needed**" : "Official"}.`, "", "| Item | Value | Source |", "|---|---|---|");
  const row = (label: string, x: { value: unknown; sourceNote: string; effectiveFrom: string } | undefined) => x && lines.push(`| ${label} | ${esc(v(x.value))} | ${esc(x.sourceNote)} (from ${x.effectiveFrom}) |`);
  for (const r of ["NEW", "OLD"] as const) {
    const reg = val[r] as Record<string, { value: unknown; sourceNote: string; effectiveFrom: string }>;
    row(`${r === "NEW" ? "New" : "Old"} regime slabs`, reg.slabs);
    row(`${r === "NEW" ? "New" : "Old"} regime standard deduction`, reg.standardDeduction);
    row(`${r === "NEW" ? "New" : "Old"} regime rebate`, reg.rebate);
  }
  for (const k of ["surcharge", "cessPercent", "defaultRegime", "marginalReliefOnRebate", "rounding", "minimumMonthlyTds", "oneOffs", "sections"]) row(k, val[k] as never);
  lines.push("", "Review needed:", ...t.unverifiedParts.map((p) => `- ${p}`));
}
lines.push("", "## Settlements", "", "| Item | Value | Effective from | Source | Status | Notes |", "|---|---|---|---|---|---|");
for (const [label, e] of [["Gratuity", PACK_GRATUITY], ["Notice recovery (policy default, not statute)", PACK_NOTICE], ["Leave encashment (policy default, not statute)", PACK_ENCASHMENT]] as const) lines.push(`| ${label} | ${esc(v(e.value))} | ${from(e as PackEntry)} | ${esc(link(e.source))} | ${flag(e as PackEntry)} | ${esc(e.note)} |`);
lines.push("", "## Returns", "", `- **PF ECR**: ${link(PACK_ECR_LAYOUT.source)}. Fields in order: UAN, member name, gross wages, EPF wages, EPS wages, EDLI wages, EE share, EPS contribution, ER share (EPF-EPS difference), NCP days, refund of advances; separator \`#~#\`; whole rupees; no header. ${PACK_ECR_LAYOUT.note}`);
lines.push("- **ESI monthly contribution upload**: not publicly documented (only the portal's own template). Nothing is built; **an item for the owners to try on the real ESIC portal**.");
lines.push("", "## Not modelled (named, not guessed)", "", "- ESI: the daily-wage exemption (Rs 176) and the Rs 25,000 ceiling for persons with disability.", "- PF: the Rs 500 monthly minimum administrative charge (per establishment); September 2026 uses the ceiling in force on its last day (Rs 25,000).", "- Gratuity: one year for fixed-term employees (pro rata); a part year of exactly six months (no days over) counts as a year here, while the Code says \"in excess of six months\".", "- Income tax: the old regime's 37% surcharge above Rs 5 crore and marginal relief at surcharge thresholds.");
export const STATUTORY_DOC = `${lines.join("\n")}\n`;
if (process.argv[1]?.endsWith("statutory-defaults-doc.ts")) writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "docs", "STATUTORY_DEFAULTS.md"), STATUTORY_DOC);
if (process.argv[1]?.endsWith("statutory-defaults-doc.ts")) console.log("docs/STATUTORY_DEFAULTS.md written");
