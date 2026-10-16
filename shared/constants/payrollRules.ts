// The payroll rules catalog (Phase 6, docs/plans/PHASE_6.md §3.1). Single source of truth for the backend (validation, placeholders, the gates) and the
// Rules and setup screen (labels, grouping, who confirms, the shape of the value). A rule that is not in this list does not exist; a payroll
// calculation can read a rule only through the backend's RuleContext, which looks it up here.
//
// What ships:
//   origin "STATUTORY"  a figure set by law or by a statutory body (a rate, a ceiling, a prescribed rounding, a state's slabs). Where it is a single figure
//                       I can recall, it ships as a PLACEHOLDER labelled "From memory, unverified". Confirming one requires typing the value again.
//   origin "COMPANY"    a choice only the company can make (pay-days basis, payment date, company identifiers...). It ships EMPTY ("Not set"): an
//                       administrator enters a value, which is a Placeholder until a different person confirms it.
// Nothing here is a claim that a number is correct; the claim is made by a Confirmation, by a named person, on a date.

export const PLACEHOLDER_SOURCE_LABEL = "From memory, unverified";
export const TEST_WATERMARK_TEXT = "TEST — placeholder rules";

export const RULE_GROUPS = [
  "Period and days",
  "Rounding",
  "Provident Fund",
  "Employees' State Insurance",
  "Who is covered",
  "Professional Tax",
  "Labour Welfare Fund",
  "Tax",
  "Leave encashment",
  "Arrears",
  "Variance",
  "Payslip",
  "Company identifiers",
] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];

/** How a value is entered, validated and compared. `rounding`, `paymentDate` and `json` are structured; the rest are single values. */
export type RuleShape =
  | { kind: "percent" } // a percentage as written: "12" means 12%
  | { kind: "money" } // rupees, an exact decimal string
  | { kind: "integer"; min: number; max: number }
  | { kind: "choice"; choices: readonly string[] }
  | { kind: "boolean" }
  | { kind: "text" }
  | { kind: "formula" } // an expression in the payroll formula language (backend/src/modules/payroll/formula.ts)
  | { kind: "rounding" } // { mode, scale }
  | { kind: "paymentDate" } // { monthOffset: 0 | 1, day: 1..28 | "LAST" }
  | { kind: "employmentTypes" } // a list of employment types
  | { kind: "json"; example: string }; // a structured table; entered and retyped as JSON

export interface RuleDef {
  key: string;
  group: RuleGroup;
  label: string;
  /** What it is, in a sentence a payroll administrator can check against a document. */
  description: string;
  /** What changes in a payslip or a statutory file when it changes. */
  affects: string;
  shape: RuleShape;
  origin: "STATUTORY" | "COMPANY";
  /** Who should vouch for it. */
  whoConfirms: string;
  /** Shipped placeholder value (STATUTORY single figures only). Absent means the rule ships empty. */
  placeholder?: unknown;
  /** Offered on the screen as a suggestion, never shipped as a value. */
  suggestion?: string;
}

const ROUNDING_NOTE = "A mode (half up, half even, up, down, ceiling, floor) and a number of decimal places.";
const STAT = "CA / statutory notification";

export const RULE_CATALOG: readonly RuleDef[] = [
  // ── Period and days ──
  { key: "PAY_DAYS_BASIS", group: "Period and days", label: "Pay days basis", description: "How a month's pay is divided into days: calendar days, a fixed number, or working days.", affects: "Every earning that is pro-rated (joiners, leavers, loss of pay).", shape: { kind: "choice", choices: ["CALENDAR_DAYS", "FIXED_DAYS", "WORKING_DAYS"] }, origin: "COMPANY", whoConfirms: "HR + CA" },
  { key: "FIXED_DAYS_VALUE", group: "Period and days", label: "Fixed days in a month", description: "The number of days a month counts as, if the basis is a fixed number.", affects: "Used only when the pay days basis is FIXED_DAYS.", shape: { kind: "integer", min: 1, max: 31 }, origin: "COMPANY", whoConfirms: "HR + CA" },
  { key: "LOP_DIVISOR", group: "Period and days", label: "Loss-of-pay divisor", description: "What a month's salary is divided by to get the deduction for one day of loss of pay.", affects: "The loss-of-pay deduction for everyone with LOP days.", shape: { kind: "choice", choices: ["SAME_AS_PAY_DAYS_BASIS", "CALENDAR_DAYS", "FIXED_DAYS", "WORKING_DAYS"] }, origin: "COMPANY", whoConfirms: "HR + CA" },
  { key: "PAYMENT_DATE_RULE", group: "Period and days", label: "Payment date", description: "When salary is paid: this month or next, and on which day (1 to 28, or the last day).", affects: "Which bank account is used (the one in force on the payment date).", shape: { kind: "paymentDate" }, origin: "COMPANY", whoConfirms: "HR" },
  { key: "LEAVER_PAYMENT_TIMING", group: "Period and days", label: "Leavers' last month", description: "Whether a leaver's last month is paid with the run or held for final settlement.", affects: "Who is in the bank file in a leaver's last month.", shape: { kind: "choice", choices: ["PAY_WITH_RUN", "HOLD_FOR_FNF"] }, origin: "COMPANY", whoConfirms: "HR" },
  { key: "NEGATIVE_NET_POLICY", group: "Period and days", label: "Negative net pay", description: "What happens when deductions exceed earnings.", affects: "Whether the run can be submitted with such a person in it.", shape: { kind: "choice", choices: ["BLOCK", "HOLD_PAYMENT"] }, origin: "COMPANY", whoConfirms: "HR" },
  // ── Rounding ──
  { key: "LINE_ROUNDING", group: "Rounding", label: "Rounding of salary lines", description: `How each earning and deduction line is rounded. ${ROUNDING_NOTE}`, affects: "Every salary component line.", shape: { kind: "rounding" }, origin: "COMPANY", whoConfirms: "HR + CA" },
  { key: "PF_ROUNDING", group: "Rounding", label: "Rounding of PF contributions", description: `How PF contributions are rounded. ${ROUNDING_NOTE}`, affects: "Employee and employer PF lines and the ECR file.", shape: { kind: "rounding" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: { mode: "HALF_UP", scale: 0 } },
  { key: "ESI_ROUNDING", group: "Rounding", label: "Rounding of ESI contributions", description: `How ESI contributions are rounded. ${ROUNDING_NOTE}`, affects: "Employee and employer ESI lines and the ESI return.", shape: { kind: "rounding" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: { mode: "UP", scale: 0 } },
  { key: "NET_PAY_ROUNDING", group: "Rounding", label: "Rounding of net pay", description: `Whether net pay is rounded after all lines are added. ${ROUNDING_NOTE} Choose NONE to pay the exact sum of the rounded lines.`, affects: "Net pay and the bank file.", shape: { kind: "rounding" }, origin: "COMPANY", whoConfirms: "HR" },
  // ── Provident Fund ──
  { key: "PF_EMPLOYEE_RATE", group: "Provident Fund", label: "PF: employee rate", description: "Employee's provident fund contribution, as a percentage of PF wages.", affects: "PF deducted from every covered employee.", shape: { kind: "percent" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "12" },
  { key: "PF_EPS_RATE", group: "Provident Fund", label: "PF: employer pension (EPS) rate", description: "The part of the employer's contribution that goes to the pension scheme, as a percentage of PF wages.", affects: "Employer cost and the ECR file.", shape: { kind: "percent" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "8.33" },
  { key: "PF_EPF_ER_RATE", group: "Provident Fund", label: "PF: employer share to the provident fund", description: "The rest of the employer's contribution, as a percentage of PF wages.", affects: "Employer cost and the ECR file.", shape: { kind: "percent" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "3.67" },
  { key: "PF_EDLI_RATE", group: "Provident Fund", label: "PF: EDLI rate", description: "Employer's deposit-linked insurance charge, as a percentage of PF wages.", affects: "Employer cost.", shape: { kind: "percent" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "0.5" },
  { key: "PF_ADMIN_RATE", group: "Provident Fund", label: "PF: administration charge rate", description: "Employer's PF administration charge, as a percentage of PF wages.", affects: "Employer cost.", shape: { kind: "percent" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "0.5" },
  { key: "PF_WAGE_CEILING", group: "Provident Fund", label: "PF: monthly wage ceiling", description: "The monthly wage above which PF is not computed on the excess (if the ceiling mode caps it).", affects: "PF wages for everyone earning near or above it.", shape: { kind: "money" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "15000" },
  { key: "PF_CEILING_MODE", group: "Provident Fund", label: "PF: ceiling mode", description: "Whether PF is computed on wages capped at the ceiling, or on actual wages.", affects: "PF wages for everyone above the ceiling.", shape: { kind: "choice", choices: ["CAP_AT_CEILING", "ACTUAL_WAGE"] }, origin: "COMPANY", whoConfirms: "HR + CA" },
  // ── ESI ──
  { key: "ESI_EMPLOYEE_RATE", group: "Employees' State Insurance", label: "ESI: employee rate", description: "Employee's ESI contribution, as a percentage of gross wages.", affects: "ESI deducted from every covered employee.", shape: { kind: "percent" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "0.75" },
  { key: "ESI_EMPLOYER_RATE", group: "Employees' State Insurance", label: "ESI: employer rate", description: "Employer's ESI contribution, as a percentage of gross wages.", affects: "Employer cost and the ESI return.", shape: { kind: "percent" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "3.25" },
  { key: "ESI_WAGE_CEILING", group: "Employees' State Insurance", label: "ESI: monthly wage ceiling", description: "ESI applies only if monthly gross wages are within this amount.", affects: "Who is covered by ESI at all.", shape: { kind: "money" }, origin: "STATUTORY", whoConfirms: STAT, placeholder: "21000" },
  { key: "ESI_PERIOD_RULE", group: "Employees' State Insurance", label: "ESI: coverage period rule", description: "Whether eligibility is tested every month, or fixed for the half-year contribution period once it starts.", affects: "Whether someone who crosses the ceiling mid-period stays covered.", shape: { kind: "choice", choices: ["MONTHLY", "STICKY_HALF_YEAR"] }, origin: "COMPANY", whoConfirms: "CA" },
  // ── Who is covered ──
  { key: "PF_ELIGIBLE_TYPES", group: "Who is covered", label: "PF: employment types covered", description: "Which employment types have PF deducted.", affects: "Who has PF at all.", shape: { kind: "employmentTypes" }, origin: "COMPANY", whoConfirms: "CA + HR" },
  { key: "ESI_ELIGIBLE_TYPES", group: "Who is covered", label: "ESI: employment types covered", description: "Which employment types have ESI deducted.", affects: "Who has ESI at all.", shape: { kind: "employmentTypes" }, origin: "COMPANY", whoConfirms: "CA + HR" },
  // ── Professional Tax ──
  { key: "PT_STATE_OF_PLACEMENT", group: "Professional Tax", label: "PT: which placement decides the state", description: "Professional tax is by state: whether the state is taken from the branch the person was placed in on the first or the last day of the period.", affects: "Which state's slab applies to someone transferred mid-month.", shape: { kind: "choice", choices: ["LAST_DAY_OF_PERIOD", "FIRST_DAY_OF_PERIOD"] }, origin: "COMPANY", whoConfirms: "CA" },
  { key: "PT_SLABS", group: "Professional Tax", label: "PT: slabs by state", description: "For each state: the gross-pay slabs and the monthly tax for each, and any month that differs (February).", affects: "Professional tax deducted. With nothing set, professional tax is ₹0 and the run says so.", shape: { kind: "json", example: '{"states":{"EXAMPLE_STATE":{"slabs":[{"fromGross":"0","toGross":"15000","monthlyAmount":"0"},{"fromGross":"15000","toGross":null,"monthlyAmount":"200"}],"monthOverrides":{"2":"300"}}}}' }, origin: "STATUTORY", whoConfirms: STAT },
  { key: "STATE_NAME_MAP", group: "Professional Tax", label: "State names", description: "Maps the free-text state on each branch (for example \"Tamilnadu\") to the state key used in the PT and LWF tables.", affects: "Which branches are in which state for PT and LWF.", shape: { kind: "json", example: '{"Tamil Nadu":"TAMIL_NADU","Tamilnadu":"TAMIL_NADU"}' }, origin: "COMPANY", whoConfirms: "HR" },
  // ── LWF ──
  { key: "LWF_TABLE", group: "Labour Welfare Fund", label: "LWF: amounts by state", description: "For each state: the employee and employer amounts, how often, and in which months.", affects: "Labour welfare fund deducted. With nothing set, LWF is ₹0.", shape: { kind: "json", example: '{"states":{"EXAMPLE_STATE":{"employee":"10","employer":"20","frequency":"HALF_YEARLY","months":[6,12]}}}' }, origin: "STATUTORY", whoConfirms: STAT },
  // ── Tax ──
  { key: "TDS_MODE", group: "Tax", label: "Income tax (TDS)", description: "How income tax is deducted. Until Phase 7 builds the projection, only NONE exists and the TDS line shows ₹0 with a notice.", affects: "The TDS line on every payslip.", shape: { kind: "choice", choices: ["NONE"] }, origin: "COMPANY", whoConfirms: "CA" },
  // ── Leave encashment ──
  { key: "ENCASH_DAILY_RATE_FORMULA", group: "Leave encashment", label: "Encashment: daily rate formula", description: "How one day of encashed leave is valued, from the person's salary components, for example BASIC / 30.", affects: "Year-end leave encashment amounts and the leave liability report.", shape: { kind: "formula" }, origin: "COMPANY", whoConfirms: "CA", suggestion: "BASIC / 30 (the default named in the specification, §5.2)" },
  { key: "ENCASH_TAXABLE", group: "Leave encashment", label: "Encashment: taxable", description: "Whether leave encashment is treated as taxable income.", affects: "TDS projection (Phase 7).", shape: { kind: "boolean" }, origin: "COMPANY", whoConfirms: "CA" },
  { key: "ENCASH_PF_APPLICABLE", group: "Leave encashment", label: "Encashment: PF applies", description: "Whether PF is computed on leave encashment.", affects: "PF wages in the payout month.", shape: { kind: "boolean" }, origin: "COMPANY", whoConfirms: "CA" },
  { key: "ENCASH_PAYOUT_RULE", group: "Leave encashment", label: "Encashment: when it is paid", description: "Which run pays a committed year-end encashment.", affects: "The month encashment appears on payslips.", shape: { kind: "choice", choices: ["FIRST_RUN_AFTER_COMMIT", "SAME_MONTH_AS_COMMIT"] }, origin: "COMPANY", whoConfirms: "HR" },
  // ── Arrears ──
  { key: "ARREARS_PAYOUT", group: "Arrears", label: "Arrears: how they are paid", description: "How the difference for months already closed is paid after a back-dated revision.", affects: "Where arrears appear on a payslip.", shape: { kind: "choice", choices: ["SEPARATE_LINE_IN_NEXT_RUN"] }, origin: "COMPANY", whoConfirms: "HR + CA" },
  { key: "ARREARS_PF_ESI", group: "Arrears", label: "Arrears: PF and ESI", description: "Whether PF and ESI are computed on arrears.", affects: "PF and ESI in the month arrears are paid.", shape: { kind: "choice", choices: ["FOLLOW_COMPONENT_FLAGS", "EXCLUDE"] }, origin: "COMPANY", whoConfirms: "CA" },
  // ── Variance ──
  { key: "VARIANCE_FLAG_PERCENT", group: "Variance", label: "Variance: flag above (percent)", description: "A person's net pay that moves by more than this percentage from last month is highlighted in previews.", affects: "Only what the preview highlights.", shape: { kind: "percent" }, origin: "COMPANY", whoConfirms: "HR" },
  { key: "VARIANCE_FLAG_MIN_AMOUNT", group: "Variance", label: "Variance: ignore below (rupees)", description: "Changes smaller than this amount are not highlighted however large the percentage.", affects: "Only what the preview highlights.", shape: { kind: "money" }, origin: "COMPANY", whoConfirms: "HR" },
  // ── Payslip ──
  { key: "PAYSLIP_LAYOUT", group: "Payslip", label: "Payslip layout", description: "Which blocks a payslip shows.", affects: "Every payslip.", shape: { kind: "json", example: '{"showEmployerContributions":false,"showYearToDate":false}' }, origin: "COMPANY", whoConfirms: "HR" },
  // ── Company identifiers ──
  { key: "PF_ESTABLISHMENT_CODE", group: "Company identifiers", label: "PF establishment code", description: "The company's provident fund establishment code, printed on the ECR file.", affects: "The PF ECR file.", shape: { kind: "text" }, origin: "COMPANY", whoConfirms: "HR" },
  { key: "ESI_EMPLOYER_CODE", group: "Company identifiers", label: "ESI employer code", description: "The company's ESI employer code, printed on the ESI return.", affects: "The ESI return.", shape: { kind: "text" }, origin: "COMPANY", whoConfirms: "HR" },
  { key: "PT_REGISTRATION", group: "Company identifiers", label: "PT registration number", description: "The company's professional tax registration number.", affects: "The PT statement.", shape: { kind: "text" }, origin: "COMPANY", whoConfirms: "HR" },
  { key: "LWF_REGISTRATION", group: "Company identifiers", label: "LWF registration number", description: "The company's labour welfare fund registration number.", affects: "The LWF statement.", shape: { kind: "text" }, origin: "COMPANY", whoConfirms: "HR" },
];

export const RULE_KEYS = RULE_CATALOG.map((r) => r.key);
export const RULE_BY_KEY: Record<string, RuleDef> = Object.fromEntries(RULE_CATALOG.map((r) => [r.key, r]));
export const SHIPPED_PLACEHOLDER_KEYS = RULE_CATALOG.filter((r) => r.placeholder !== undefined).map((r) => r.key);
