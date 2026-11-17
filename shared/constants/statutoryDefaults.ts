// The Standard statutory defaults pack (docs/plans/STATUTORY_DEFAULTS_PLAN.md, docs/STATUTORY_DEFAULTS.md). Owner decision 2026-11-16: statutory and tax rules ship
// with standard, sourced values already in force, so payroll can run before the directors enter figures. This replaces the Stage 3.2 rule that nothing statutory is
// shipped. Company facts (PAN, TAN, PF and ESI codes, bank layout columns, salary structures, opening balances, company choices such as the pay days basis) stay
// owner-entered.
//
// How it is used:
//   - A value here is used only where no director has CONFIRMED a value of their own; the pack never overwrites, edits or hides a director's value.
//   - Each value is effective-dated: the entry in force on the month's last day applies to the whole month (the same rule as everywhere else in payroll).
//   - Each value carries its source, the date it was checked and whether it was confirmed from an official source. "UNVERIFIED" values are still used (nothing
//     blocks) but are flagged "review needed" on the screens and on Ready for First Run.
//   - Directors change a value the usual way (enter it, a different director confirms it, audited); from then on theirs is used.
//
// Owner decision 2026-11-17 (docs/plans/OWNER_EMPTY_SETTINGS.md): the settings the owners decide themselves ship Not set and are NOT in this pack: gratuity, notice
// pay and leave encashment (their heads and formulas), the company's state, and that state's professional tax, LWF and minimum wages. Their researched values and
// sources are in docs/STATUTORY_DEFAULTS.md under "Reference values, not loaded"; nothing here loads them.
//
// Every figure below was checked on PACK_CHECKED_ON against the source named. Direct fetches of the government sites were refused (HTTP 403/503) from the build
// machine, so the official documents were read through the search index of those official domains; where only a non-government site said it, it is UNVERIFIED.

export const PACK_ID = "STANDARD_DEFAULTS";
/** Bump when any value, source or check date below changes: an acknowledgement and a review name the version they were given for. */
export const PACK_VERSION = 2; // 2 (2026-11-17): the state values and the settlement defaults were taken out (owner decision); runs on version 1 are calculated again
export const PACK_CHECKED_ON = "2026-11-16";
export const STANDARD_DEFAULT_LABEL = "Standard default, change in settings";
export const REVIEW_NEEDED_LABEL = "Review needed";
/** "In force for every month this portal runs": a value with no change found since its source was written. */
export const CONTINUING = "1900-01-01";

export type Verification = "OFFICIAL" | "UNVERIFIED";
export interface PackSource {
  name: string;
  url: string;
}
export interface PackEntry<T = unknown> {
  /** The first day this value applies (CONTINUING = in force throughout). */
  from: string;
  value: T;
  source: PackSource;
  checkedOn: string;
  verification: Verification;
  /** Plain words: what the source says, and why a value is UNVERIFIED. */
  note: string;
}

const EPFO_RATES: PackSource = { name: "EPFO, Present rates of contribution", url: "https://www.epfindia.gov.in/site_docs/PDFs/MiscPDFs/ContributionRate.pdf" };
const EPFO_FAQ_2020: PackSource = { name: "EPFO, FAQ on the rate of contribution (2020): no change in admin charges (0.5%) and EDLI (0.5%)", url: "https://www.epfindia.gov.in/site_docs/PDFs/Updates/FAQ_Reduced_rate_of_contribution_20052020.pdf" };
const SO_5109: PackSource = { name: "Ministry of Labour and Employment, S.O. 5109(E) dated 17-09-2026 (Gazette of India, Extraordinary), wage ceiling under section 2(89) of the Code on Social Security, 2020", url: "https://www.labour.gov.in/static/uploads/2026/09/2b0f1dbbd3769fc388416186ec145328.pdf" };
const PIB_CEILING: PackSource = { name: "PIB, EPFO raises wage ceiling from Rs. 15,000 to Rs. 25,000 (first revision since September 2014)", url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2313829" };
const ESIC_CONTRIB: PackSource = { name: "ESIC, Contribution (rates from 01.07.2019; daily wage up to Rs 176 exempt from the employee share)", url: "https://esic.gov.in/contribution" };
const ESIC_NOTE_2025: PackSource = { name: "ESIC, Standard note on the ESI Scheme as on 01.01.2025 (wage ceiling Rs 21,000 from 01.01.2017)", url: "https://esic.gov.in/attachments/publicationfile/Standard_Note_on_Employees_State_Insurance_Scheme_as_on_01_01_2025_English_1757940841.pdf" };
const ESI_RULES: PackSource = { name: "ESI (Central) Rules, 1950, rules 51 and 51B (as on 26.04.2024)", url: "https://esic.gov.in/attachments/actfile/35df0691b900c1d011c6ceb7913eb1d6.pdf" };
const IT_SALARIED_AY2627: PackSource = { name: "Income Tax Department, Salaried Individuals for AY 2026-27 (slabs, rebate, cess, surcharge)", url: "https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1" };
const IT_MEMO_2026: PackSource = { name: "Memorandum explaining the Finance Bill, 2026: no change proposed in the tax rates (sections or First Schedule) for tax year 2026-27 under the Income-tax Act, 2025", url: "https://www.indiabudget.gov.in/doc/memo.pdf" };
const IT_SD: PackSource = { name: "Income Tax Department, threshold limits / benefits allowable: standard deduction 75,000 (new regime) and 50,000 (old regime), AY 2026-27", url: "https://www.incometaxindia.gov.in/w/individual-and-huf-benefits-allowable" };
const IT_REBATE: PackSource = { name: "Income Tax Department, Rebate under section 87A: up to 60,000 for total income up to 12,00,000 (new regime) from AY 2026-27 onwards, with marginal relief", url: "https://wm.incometaxindia.gov.in/w/what-is-rebate-under-section-87a-for-f.y-2025-26-and-who-can-claim-it-" };
const IT_SURCHARGE: PackSource = { name: "Income Tax Department, Tax rates, surcharge and cess (AY 2026-27)", url: "https://www.incometaxindia.gov.in/w/tax-rates%E2%80%8B" };
const IT_ITR_RULES: PackSource = { name: "CBDT e-Filing ITR-1 validation rules AY 2026-27 (80C/80CCC/80CCD(1) 1,50,000; 80CCD(1B) 50,000; 80D; 24(b) 2,00,000; nil in the new regime)", url: "https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-05/CBDT_e-Filing_ITR%201_Validation%20Rules_AY%202026-27.pdf" };

const ON = PACK_CHECKED_ON;
const official = <T>(from: string, value: T, source: PackSource, note: string): PackEntry<T> => ({ from, value, source, checkedOn: ON, verification: "OFFICIAL", note });
const unverified = <T>(from: string, value: T, source: PackSource, note: string): PackEntry<T> => ({ from, value, source, checkedOn: ON, verification: "UNVERIFIED", note });

/** Payroll rules (shared/constants/payrollRules.ts) the pack fills, each a dated series. Only STATUTORY-origin rules; company choices stay owner-entered. */
export const PACK_RULES: Readonly<Record<string, readonly PackEntry[]>> = {
  PF_EMPLOYEE_RATE: [official(CONTINUING, "12", EPFO_RATES, "Employee 12% of basic wages, dearness allowance and retaining allowance. Rates unchanged by S.O. 5109(E) (only the wage base moved).")],
  PF_EPS_RATE: [official(CONTINUING, "8.33", EPFO_RATES, "Of the employer's 12%, 8.33% goes to the pension scheme (on wages up to the ceiling).")],
  PF_EPF_ER_RATE: [official(CONTINUING, "3.67", EPFO_RATES, "The rest of the employer's 12% (3.67%) goes to the provident fund.")],
  PF_EDLI_RATE: [official(CONTINUING, "0.5", EPFO_FAQ_2020, "EDLI contribution 0.5% of wages, payable by the employer. EDLI administrative charges are not levied since April 2017.")],
  PF_ADMIN_RATE: [official("2018-06-01", "0.5", EPFO_RATES, "EPF administrative charges 0.50% of EPF wages from 01.06.2018, rounded to the nearest rupee, minimum Rs 500 a month per establishment (Rs 75 with no contributory member). The monthly minimum is per establishment and is not modelled per person.")],
  PF_WAGE_CEILING: [
    official("2014-09-01", "15000", PIB_CEILING, "Rs 15,000 a month from September 2014 (the revision S.O. 5109(E) replaces; PIB: the first revision since September 2014)."),
    official("2026-09-17", "25000", SO_5109, "Rs 25,000 a month from the date of publication, 17 September 2026 (S.O. 5109(E), superseding S.O. 2702(E) of 29 May 2026). The month that contains the date (September 2026) uses the value in force on its last day, Rs 25,000, as every payroll rule does; a secondary site says EPFO splits that month by days: review needed for September 2026 only."),
  ],
  PF_ROUNDING: [unverified(CONTINUING, { mode: "HALF_UP", scale: 0 }, EPFO_RATES, "Whole rupees, half up. The ECR takes whole rupees and EPFO rounds administrative charges to the nearest rupee; no official text found for the contribution lines themselves.")],
  ESI_EMPLOYEE_RATE: [official("2019-07-01", "0.75", ESIC_CONTRIB, "Employee 0.75% of wages from 01.07.2019. Employees whose average daily wage is up to Rs 176 pay no employee share (the employer still pays); that exemption is not modelled.")],
  ESI_EMPLOYER_RATE: [official("2019-07-01", "3.25", ESIC_CONTRIB, "Employer 3.25% of wages from 01.07.2019.")],
  ESI_WAGE_CEILING: [official("2017-01-01", "21000", ESIC_NOTE_2025, "Covered when monthly wages are up to Rs 21,000 (Rs 25,000 for persons with disability; not modelled) from 01.01.2017; unchanged by the PF ceiling notification.")],
  ESI_ROUNDING: [unverified(CONTINUING, { mode: "UP", scale: 0 }, ESI_RULES, "Up to the next whole rupee. The published rules are not consistent (rule 51: \"next higher rupee multiple of five paise\"; rule 51B: \"next higher rupee\"): review needed.")],
};

/** The rules the pack covers: with no confirmed director value, the pack's entry is used and is treated as in force (not a Placeholder). */
export const PACK_RULE_KEYS: readonly string[] = Object.keys(PACK_RULES);
/** Rules where only a CONFIRMED director value replaces the standard default: the dated rules above. PT_SLABS and LWF_TABLE are not in the pack (owner decision
 *  2026-11-17): they are the directors' own tables, Not set until entered. */
export const PACK_COVERED_RULE_KEYS: readonly string[] = [...PACK_RULE_KEYS];
export const isPackCovered = (key: string): boolean => PACK_COVERED_RULE_KEYS.includes(key);

// ── The company's state (setting statutory.state): Not set by default, chosen by a director. No state's PT, LWF or minimum wages are loaded. ──

/** States and union territories a director may choose for professional tax, LWF and minimum wages (the keys used in the PT_SLABS and LWF_TABLE tables). */
export const COMPANY_STATES: Readonly<Record<string, string>> = {
  ANDAMAN_AND_NICOBAR_ISLANDS: "Andaman and Nicobar Islands", ANDHRA_PRADESH: "Andhra Pradesh", ARUNACHAL_PRADESH: "Arunachal Pradesh", ASSAM: "Assam", BIHAR: "Bihar",
  CHANDIGARH: "Chandigarh", CHHATTISGARH: "Chhattisgarh", DADRA_NAGAR_HAVELI_AND_DAMAN_DIU: "Dadra and Nagar Haveli and Daman and Diu", DELHI: "Delhi", GOA: "Goa",
  GUJARAT: "Gujarat", HARYANA: "Haryana", HIMACHAL_PRADESH: "Himachal Pradesh", JAMMU_AND_KASHMIR: "Jammu and Kashmir", JHARKHAND: "Jharkhand", KARNATAKA: "Karnataka",
  KERALA: "Kerala", LADAKH: "Ladakh", LAKSHADWEEP: "Lakshadweep", MADHYA_PRADESH: "Madhya Pradesh", MAHARASHTRA: "Maharashtra", MANIPUR: "Manipur", MEGHALAYA: "Meghalaya",
  MIZORAM: "Mizoram", NAGALAND: "Nagaland", ODISHA: "Odisha", PUDUCHERRY: "Puducherry", PUNJAB: "Punjab", RAJASTHAN: "Rajasthan", SIKKIM: "Sikkim",
  TAMIL_NADU: "Tamil Nadu", TELANGANA: "Telangana", TRIPURA: "Tripura", UTTAR_PRADESH: "Uttar Pradesh", UTTARAKHAND: "Uttarakhand", WEST_BENGAL: "West Bengal",
};
export const stateLabel = (key: string | null | undefined): string => (key ? (COMPANY_STATES[key] ?? key) : "Not set");

// ── Income tax: tax year 2026-27 (1 April 2026 to 31 March 2027) under the Income-tax Act, 2025 ──

const taxNote = (s: PackSource) => `${s.name} (checked ${ON})`;
const e = <T>(value: T, s: PackSource, from = "2026-04-01") => ({ value, sourceNote: taxNote(s), effectiveFrom: from });

/** A complete tax year in the shape of backend/src/modules/payroll/tax/schema.ts. Used only for a year no director has confirmed a value for. */
export const PACK_TAX_YEARS: Readonly<Record<string, { value: unknown; verification: Verification; unverifiedParts: string[] }>> = {
  "2026-27": {
    verification: "UNVERIFIED",
    unverifiedParts: [
      "Standard deduction for tax year 2026-27 under the 2025 Act: confirmed only for AY 2026-27 (the 1961 Act); the Finance Bill 2026 memorandum says rates are unchanged but does not name it.",
      "Surcharge: one table for both regimes (new regime, top rate 25%); the old regime's 37% above Rs 5 crore and marginal relief at surcharge thresholds are not modelled.",
      "Rounding of TDS (whole rupees, half up), minimum monthly TDS (0) and how one-off pay is taxed (the month it is paid) are policy defaults, not statute.",
      "The section catalogue lists only the common old-regime deductions with their caps; section numbers follow the 1961 Act as the e-filing rules still do.",
    ],
    value: {
      NEW: {
        slabs: e([
          { from: "0", to: "400000", ratePercent: "0" },
          { from: "400000", to: "800000", ratePercent: "5" },
          { from: "800000", to: "1200000", ratePercent: "10" },
          { from: "1200000", to: "1600000", ratePercent: "15" },
          { from: "1600000", to: "2000000", ratePercent: "20" },
          { from: "2000000", to: "2400000", ratePercent: "25" },
          { from: "2400000", to: null, ratePercent: "30" },
        ], IT_MEMO_2026),
        standardDeduction: e("75000", IT_SD),
        rebate: e({ thresholdIncome: "1200000", maximum: "60000" }, IT_REBATE),
      },
      OLD: {
        slabs: e([
          { from: "0", to: "250000", ratePercent: "0" },
          { from: "250000", to: "500000", ratePercent: "5" },
          { from: "500000", to: "1000000", ratePercent: "20" },
          { from: "1000000", to: null, ratePercent: "30" },
        ], IT_SALARIED_AY2627),
        standardDeduction: e("50000", IT_SD),
        rebate: e({ thresholdIncome: "500000", maximum: "12500" }, IT_SALARIED_AY2627),
      },
      // Surcharge applies when income EXCEEDS 50 lakh, 1 crore, 2 crore: a band starts one paisa above each threshold (the engine reads from <= income < to).
      surcharge: e([
        { from: "0", to: "5000000.01", ratePercent: "0" },
        { from: "5000000.01", to: "10000000.01", ratePercent: "10" },
        { from: "10000000.01", to: "20000000.01", ratePercent: "15" },
        { from: "20000000.01", to: null, ratePercent: "25" },
      ], IT_SURCHARGE),
      cessPercent: e("4", IT_SURCHARGE),
      defaultRegime: e("NEW", IT_SALARIED_AY2627),
      rounding: e({ mode: "HALF_UP", scale: 0 }, IT_SALARIED_AY2627),
      minimumMonthlyTds: e("0", IT_SALARIED_AY2627),
      oneOffs: e("MONTH_PAID", IT_SALARIED_AY2627),
      marginalReliefOnRebate: e(true, IT_REBATE),
      sections: e([
        { code: "S80C", label: "80C / 80CCC / 80CCD(1): PF, life insurance, tuition fees, home loan principal", appliesTo: "OLD", cap: null, groupCap: { group: "C80", cap: "150000" }, proofRequired: true },
        { code: "S80CCD1B", label: "80CCD(1B): additional NPS contribution", appliesTo: "OLD", cap: "50000", groupCap: null, proofRequired: true },
        { code: "S80D_SELF", label: "80D: health insurance, self and family (below 60)", appliesTo: "OLD", cap: "25000", groupCap: null, proofRequired: true },
        { code: "S80D_PARENTS", label: "80D: health insurance, parents (below 60)", appliesTo: "OLD", cap: "25000", groupCap: null, proofRequired: true },
        { code: "S24B", label: "24(b): interest on a home loan, self-occupied house", appliesTo: "OLD", cap: "200000", groupCap: null, proofRequired: true },
      ], IT_ITR_RULES),
    },
  },
};

// ── Settlements: gratuity, notice pay and leave encashment are Not set (owner decision 2026-11-17); see docs/STATUTORY_DEFAULTS.md, "Reference values, not loaded". ──

// ── Returns ──

/**
 * EPFO's ECR 2.0 upload file, as EPFO publishes it: a text file, one line per member, fields separated by #~#, no header row, whole rupees, in this order: UAN, member
 * name, gross wages, EPF wages, EPS wages, EDLI wages, EE share remitted, EPS contribution remitted, ER share (EPF-EPS difference) remitted, NCP days, refund of advances.
 * Used for the PF file when no director-confirmed layout exists, labelled "check against the portal before uploading". The ESI monthly contribution upload is not publicly
 * documented (only the portal's own template), so nothing is built for it.
 */
export const PACK_ECR_LAYOUT = {
  source: { name: "EPFO, Introduction to Electronic Challan cum Return Version II (ECR 2.0): fields and #~# separator", url: "https://www.epfindia.gov.in/site_docs/PDFs/EPFOUnifiedPortal/Introduction_ECR2.0.pdf" },
  checkedOn: PACK_CHECKED_ON,
  verification: "OFFICIAL" as Verification,
  note: "Check against the portal before uploading: EPFO's own help file on the employer portal is the final word on the current layout.",
  value: {
    format: "DELIMITED",
    delimiter: "#~#",
    quote: false,
    lineEnding: "LF",
    extension: "txt",
    amountDecimals: 0,
    columnHeaders: false,
    header: [],
    trailer: [],
    columns: ["UAN", "NAME", "GROSS_WAGES", "EPF_WAGES", "EPS_WAGES", "EDLI_WAGES", "EPF_CONTRIBUTION", "EPS_CONTRIBUTION", "EPF_EPS_DIFF", "NCP_DAYS", "REFUND"].map((f) => ({ source: "FIELD", value: f })),
  },
};

// ── Review ──

export const DEFAULT_REVIEW_INTERVAL_MONTHS = 6;

/** The entry of a dated series in force on a day (YYYY-MM-DD): the latest `from` on or before it. Pure. */
export function entryOn<T>(series: readonly PackEntry<T>[] | undefined, day: string): PackEntry<T> | null {
  if (!series) return null;
  let best: PackEntry<T> | null = null;
  for (const entry of series) if (entry.from <= day && (!best || entry.from >= best.from)) best = entry;
  return best;
}

/** Every dated change the pack knows of, for the reminder ("a value's effective date has passed without review"). */
export function packChangeDates(): Array<{ key: string; from: string }> {
  const out: Array<{ key: string; from: string }> = [];
  for (const [key, series] of Object.entries(PACK_RULES)) for (const entry of series) if (entry.from !== CONTINUING) out.push({ key, from: entry.from });
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** Every value flagged "review needed", in words, for Ready for First Run and docs/STATUTORY_DEFAULTS.md. */
export function packReviewNeeded(): Array<{ key: string; label: string; note: string }> {
  const out: Array<{ key: string; label: string; note: string }> = [];
  for (const [key, series] of Object.entries(PACK_RULES)) for (const entry of series) if (entry.verification === "UNVERIFIED") out.push({ key, label: key, note: entry.note });
  for (const [year, t] of Object.entries(PACK_TAX_YEARS)) for (const part of t.unverifiedParts) out.push({ key: `TAX_YEAR:${year}`, label: `Income tax ${year}`, note: part });
  return out;
}
