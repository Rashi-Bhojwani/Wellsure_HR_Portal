// Stage 6 payroll reports (docs/plans/STAGE_6_PAYROLL_REPORTS.md): the catalog shared by the backend (modules/payroll/reports) and the Payroll Reports screen.
// Directors only. Each report declares its filters and its columns; `on: true` marks the conventional starting layout ("Default, change in settings").

export type PayrollReportFilter = "month" | "compareMonth" | "fromMonth" | "toMonth" | "fromDate" | "toDate" | "asOf" | "department" | "location" | "company";
export type PayrollReportColumnType = "text" | "number" | "money" | "percent" | "date";

export interface PayrollReportColumnDef {
  key: string;
  header: string;
  type: PayrollReportColumnType;
  /** In the conventional starting layout. */
  on: boolean;
}

export interface PayrollReportDef {
  key: PayrollReportKey;
  title: string;
  description: string;
  filters: readonly PayrollReportFilter[];
  columns: readonly PayrollReportColumnDef[];
}

export const PAYROLL_REPORT_KEYS = ["payroll-summary", "department-cost", "head-wise", "bank-transfer", "loans", "claims", "statutory-summary", "statutory-by-person", "variance", "ctc", "register-wages", "register-deductions", "register-overtime"] as const; // registers: part 3 B3
export type PayrollReportKey = (typeof PAYROLL_REPORT_KEYS)[number];

const c = (key: string, header: string, type: PayrollReportColumnType, on = true): PayrollReportColumnDef => ({ key, header, type, on });
const ORG = ["department", "location", "company"] as const; // company: part 3 B1 (no company row = the main company, "MAIN")
const PERSON = [c("employeeCode", "Employee code", "text"), c("name", "Name", "text"), c("department", "Department", "text"), c("location", "Branch", "text", false)];

export const PAYROLL_REPORTS: Record<PayrollReportKey, PayrollReportDef> = {
  "payroll-summary": {
    key: "payroll-summary",
    title: "Payroll summary",
    description: "Each finalised run: people paid and held, gross, deductions, employer contributions, net and cost to company.",
    filters: ["fromMonth", "toMonth"],
    columns: [c("cycle", "Month", "text"), c("paid", "People paid", "number"), c("held", "People held", "number"), c("gross", "Gross", "money"), c("deductions", "Deductions", "money"), c("employer", "Employer contributions", "money"), c("netPaid", "Net paid", "money"), c("netHeld", "Net held", "money", false), c("cost", "Cost to company", "money")],
  },
  "department-cost": {
    key: "department-cost",
    title: "Department-wise cost",
    description: "For one finalised month, per department: people, gross, employer contributions, cost to company and net.",
    filters: ["month", ...ORG],
    columns: [c("department", "Department", "text"), c("people", "People", "number"), c("gross", "Gross", "money"), c("employer", "Employer contributions", "money"), c("cost", "Cost to company", "money"), c("deductions", "Deductions", "money", false), c("net", "Net", "money")],
  },
  "head-wise": {
    key: "head-wise",
    title: "Head-wise summary",
    description: "For one finalised month, each pay head: how many people it touched and the total.",
    filters: ["month", ...ORG],
    columns: [c("code", "Head", "text"), c("label", "Shown as", "text"), c("kind", "Kind", "text"), c("people", "People", "number"), c("total", "Total", "money")],
  },
  "bank-transfer": {
    key: "bank-transfer",
    title: "Bank-transfer summary",
    description: "Every bank file written (monthly runs, repayments, off-cycle runs): rows, total, whether it was marked sent, and rows the bank rejected. No account number.",
    filters: ["fromDate", "toDate"],
    columns: [c("kind", "File", "text"), c("forWhat", "For", "text"), c("paymentDate", "Payment date", "date"), c("rows", "Rows", "number"), c("total", "Total", "money"), c("fileName", "File name", "text", false), c("sent", "Marked sent", "text"), c("rejected", "Rejected rows", "number")],
  },
  loans: {
    key: "loans",
    title: "Loan summary",
    description: "Every sanctioned loan: principal, rate, instalments, recovered, balance and where recovery stands.",
    filters: ["asOf", ...ORG],
    columns: [...PERSON, c("type", "Loan type", "text"), c("principal", "Principal", "money"), c("rate", "Rate % a year", "percent", false), c("instalments", "Instalments", "number", false), c("recovered", "Recovered through payroll", "money"), c("balance", "Balance", "money"), c("recovery", "Recovery", "text")],
  },
  claims: {
    key: "claims",
    title: "Claim summary",
    description: "Claims by type and state for money spent in a date range: how many, how much claimed and how much approved.",
    filters: ["fromDate", "toDate"],
    columns: [c("type", "Claim type", "text"), c("state", "State", "text"), c("claims", "Claims", "number"), c("claimed", "Claimed", "money"), c("approved", "Approved", "money")],
  },
  "statutory-summary": {
    key: "statutory-summary",
    title: "Statutory summary",
    description: "For one finalised month, each statutory line the run worked out (PF, ESI, PT, LWF, TDS): people, employee share and employer share.",
    filters: ["month"],
    columns: [c("statute", "Statute", "text"), c("line", "Line", "text"), c("people", "People", "number"), c("employee", "Employee share", "money"), c("employer", "Employer share", "money")],
  },
  "statutory-by-person": {
    key: "statutory-by-person",
    title: "PF, ESI, PT, LWF and TDS by person",
    description: "For one finalised month, each person's statutory lines as the run worked them out.",
    filters: ["month", ...ORG],
    columns: [...PERSON, c("pfEmployee", "PF (employee)", "money"), c("pfEmployer", "PF (employer, all parts)", "money"), c("esiEmployee", "ESI (employee)", "money"), c("esiEmployer", "ESI (employer)", "money"), c("pt", "PT", "money"), c("lwfEmployee", "LWF (employee)", "money"), c("lwfEmployer", "LWF (employer)", "money", false), c("tds", "TDS", "money")],
  },
  variance: {
    key: "variance",
    title: "Variance between months",
    description: "Each person's gross and net in one finalised month against another, with the change.",
    filters: ["month", "compareMonth", ...ORG],
    columns: [...PERSON, c("grossBefore", "Gross (compared month)", "money", false), c("grossNow", "Gross (month)", "money", false), c("netBefore", "Net (compared month)", "money"), c("netNow", "Net (month)", "money"), c("change", "Change in net", "money"), c("changePercent", "Change %", "percent")],
  },
  ctc: {
    key: "ctc",
    title: "CTC",
    description: "Everyone with a salary in force on a date: annual and monthly CTC, the structure, and since when.",
    filters: ["asOf", ...ORG],
    columns: [...PERSON, c("annualCtc", "Annual CTC", "money"), c("monthlyCtc", "Monthly CTC", "money"), c("structure", "Structure", "text", false), c("from", "Since", "date")],
  },
  // Part 3 B3: statutory registers from finalised runs, in conventional layouts ("Default, change in settings"); no official form is claimed, no figure is worked out here.
  "register-wages": {
    key: "register-wages",
    title: "Register of wages",
    description: "For one finalised month, each person paid or held: days, every earning and deduction head the run worked out (one column each), gross, deductions and net.",
    filters: ["month", ...ORG],
    columns: [...PERSON, c("paidDays", "Days paid", "number"), c("lopDays", "Loss of pay days", "number"), c("gross", "Gross", "money"), c("deductions", "Deductions", "money"), c("net", "Net", "money")],
  },
  "register-deductions": {
    key: "register-deductions",
    title: "Register of deductions",
    description: "For one finalised month, every deduction the run made from each person, one row per deduction.",
    filters: ["month", ...ORG],
    columns: [...PERSON, c("head", "Deduction", "text"), c("headCode", "Head code", "text", false), c("source", "Worked out by", "text", false), c("amount", "Amount", "money")],
  },
  "register-overtime": {
    key: "register-overtime",
    title: "Register of overtime",
    description: "Approved overtime in a month, one row per day: minutes claimed and approved, who decided, and what payroll has been asked to pay for the month.",
    filters: ["month", ...ORG],
    columns: [...PERSON, c("date", "Day", "date"), c("minutes", "Minutes claimed", "number"), c("approvedMinutes", "Minutes approved", "number"), c("decidedOn", "Decided on", "date", false), c("paidForMonth", "Paid for the month", "money")],
  },
};

export interface PayrollReportResult {
  key: PayrollReportKey;
  title: string;
  generatedAt: string;
  filtersApplied: string[];
  columns: PayrollReportColumnDef[];
  rows: Array<Record<string, string | number | null>>;
  /** Totals of the money and number columns, worked out exactly. */
  totals: Record<string, string | number>;
  notes: string[];
}
