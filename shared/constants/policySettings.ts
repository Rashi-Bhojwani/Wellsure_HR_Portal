// M session, block 2 (docs/plans/M_CHECKLIST.md "Policy settings"). The director settings of the decision rows, described once so the screen renders
// each one without per-key code and the server validates it from the same description.
//
// Kinds:
//   plain       — in force from the start with a conventional default, shown "Default, change in settings".
//   activation  — anything that changes pay or leave: no effect until a director turns it on and a different director confirms. The suggested
//                 values are only offered on the form; they are never in force by themselves.
//   notSet      — a value only the owners can choose (retention periods, a provider account): Not set until a director chooses it.
// Every change: a director proposes, a different director confirms, both audited (the D-37 store).

export type PolicyField =
  | { name: string; label: string; type: "boolean" }
  | { name: string; label: string; type: "int"; min: number; max: number; unit?: string; optional?: boolean }
  | { name: string; label: string; type: "choice"; options: ReadonlyArray<{ value: string; label: string }> }
  | { name: string; label: string; type: "codes"; help?: string; max: number }
  | { name: string; label: string; type: "lines"; help?: string; max: number };

export type PolicyKind = "plain" | "activation" | "notSet";
export type PolicyArea = "People" | "Attendance" | "Leave" | "Data" | "Messages" | "Company";

export interface PolicySettingDef {
  key: string;
  area: PolicyArea;
  row: string;
  title: string;
  what: string;
  kind: PolicyKind;
  fields: readonly PolicyField[];
  /** plain: the value in force until changed. activation: the suggestion offered on the form. notSet: null. */
  defaultValue: Record<string, unknown> | null;
  /** Why this default (for the owners' review). */
  why: string;
}

export const DEFAULT_LABEL = "Default, change in settings";
export const INACTIVE_LABEL = "Off until a director turns it on and another confirms";
export const NOT_SET_LABEL = "Not set";

export const ONBOARDING_OWNERS = ["HR", "MANAGER", "EMPLOYEE"] as const;

export const POLICY_SETTINGS: readonly PolicySettingDef[] = [
  {
    key: "policy.probation",
    area: "People",
    row: "ER-26",
    title: "Probation",
    what: "How long probation lasts from the joining date, and how many days before its end HR and the manager are reminded. Confirming or extending is done on Employee → Probation.",
    kind: "plain",
    fields: [
      { name: "months", label: "Probation length", type: "int", min: 1, max: 12, unit: "months" },
      { name: "reminderDays", label: "Remind this many days before the end", type: "int", min: 1, max: 60, unit: "days" },
    ],
    defaultValue: { months: 3, reminderDays: 15 },
    why: "Three months is the most common probation in Indian offer letters for companies of this size; a fortnight's notice leaves time for the manager's review.",
  },
  {
    key: "policy.onboarding",
    area: "People",
    row: "OE-04",
    title: "Onboarding checklist",
    what: "The steps every new joiner's onboarding goes through. One per line: who does it (HR, MANAGER or EMPLOYEE), a vertical bar, the days after joining it is due, a vertical bar, the step.",
    kind: "plain",
    fields: [{ name: "items", label: "Steps (OWNER | days | step)", type: "lines", max: 30, help: "For example: HR | 0 | Collect signed offer letter" }],
    defaultValue: {
      items: [
        "HR | 0 | Collect the signed offer letter and joining documents",
        "HR | 1 | Send the portal invitation and check the employee signed in",
        "MANAGER | 1 | Introduce the new joiner to the team",
        "EMPLOYEE | 3 | Complete My Info (contact, emergency contact, family)",
        "EMPLOYEE | 7 | Read and acknowledge the company policies",
        "MANAGER | 30 | First month check-in",
      ],
    },
    why: "The usual first-month steps of an Indian office onboarding, with no asset or payroll step (assets are built on another branch; payroll set-up is the directors').",
  },
  {
    key: "policy.feedback",
    area: "People",
    row: "SS-13",
    title: "Employee feedback",
    what: "Whether an employee may send feedback without their name. When they do, no author is stored at all, so nobody can reply to them.",
    kind: "plain",
    fields: [{ name: "anonymousAllowed", label: "Feedback without a name is allowed", type: "boolean" }],
    defaultValue: { anonymousAllowed: true },
    why: "A suggestion box is normally anonymous; named feedback stays available for people who want an answer.",
  },
  {
    key: "policy.importRules",
    area: "People",
    row: "IE-07 / IE-08",
    title: "HR's update import",
    what: "Which existing-employee details HR may change from an Excel file. Bank and statutory numbers are never changed through this import. Job changes (department, designation, location, manager) need a director when on.",
    kind: "plain",
    fields: [
      { name: "contactAndPersonal", label: "HR may update contact and personal details", type: "boolean" },
      { name: "jobNeedsDirector", label: "Job changes from a file need a director", type: "boolean" },
      { name: "maxRows", label: "Most rows in one file", type: "int", min: 1, max: 2000 },
    ],
    defaultValue: { contactAndPersonal: true, jobNeedsDirector: true, maxRows: 500 },
    why: "HR keeps contact and personal records; moving people between teams changes who approves what, so a director applies those.",
  },
  {
    key: "policy.regularizationLimits",
    area: "Attendance",
    row: "AT-22",
    title: "Attendance correction limits",
    what: "At most this many correction requests a person may raise in one calendar month. A request over the limit is refused with the reason.",
    kind: "activation",
    fields: [{ name: "perMonth", label: "Most requests a month", type: "int", min: 1, max: 31 }],
    defaultValue: { perMonth: 3 },
    why: "Three a month is the usual limit in Indian attendance policies. It changes attendance (and so loss of pay), so it is off until the directors turn it on.",
  },
  {
    key: "policy.overtime",
    area: "Attendance",
    row: "AT-19",
    title: "Overtime",
    what: "Overtime is time worked beyond the shift on a finalised day, at least the minimum, rounded down to the step. The employee claims it and the manager (with the approval key) or a director approves. Paying it is payroll's.",
    kind: "activation",
    fields: [
      { name: "minimumMinutes", label: "Least overtime that counts", type: "int", min: 15, max: 240, unit: "minutes" },
      { name: "roundToMinutes", label: "Round down to", type: "int", min: 1, max: 60, unit: "minutes" },
      { name: "approver", label: "Who approves", type: "choice", options: [{ value: "MANAGER_OR_DIRECTOR", label: "The manager (with the approval key) or a director" }, { value: "DIRECTOR", label: "A director only" }] },
    ],
    defaultValue: { minimumMinutes: 60, roundToMinutes: 30, approver: "MANAGER_OR_DIRECTOR" },
    why: "Overtime is off in most offices of this size; when used, an hour's minimum in half-hour steps with the manager's approval is common. It changes pay, so it is off until the directors turn it on.",
  },
  {
    key: "policy.wfh",
    area: "Attendance",
    row: "AT-36",
    title: "Work from home requests",
    what: "Whether employees may ask for work-from-home days, which departments may (by code; empty = everyone), and how far ahead. A director approves; the approved days become remote days, as a director's remote mark does today.",
    kind: "activation",
    fields: [
      { name: "departments", label: "Departments that may ask (codes; empty = all)", type: "codes", max: 50 },
      { name: "maxDaysPerRequest", label: "Most days in one request", type: "int", min: 1, max: 31, unit: "days" },
    ],
    defaultValue: { departments: [], maxDaysPerRequest: 5 },
    why: "A director already decides remote work; requests keep that. It changes attendance (and so pay), so it is off until the directors turn it on.",
  },
  {
    key: "policy.leaveLimits",
    area: "Leave",
    row: "LV-19",
    title: "Leave request limits",
    what: "Per leave type: the most days in one request and the least notice (days between asking and the first day). One line per type: CODE | most days | notice days (0 = none).",
    kind: "activation",
    fields: [{ name: "rules", label: "Rules (CODE | most days | notice days)", type: "lines", max: 20, help: "For example: PL | 15 | 7" }],
    defaultValue: { rules: ["PL | 15 | 7"] },
    why: "A fortnight at most and a week's notice for planned leave are common; sick and casual leave usually have no notice. It changes leave, so it is off until the directors turn it on.",
  },
  {
    key: "policy.sandwich",
    area: "Leave",
    row: "LV-20",
    title: "Sandwich rule",
    what: "For the listed leave types, week-offs and holidays between two leave days of the same request are counted as leave.",
    kind: "activation",
    fields: [{ name: "leaveTypes", label: "Leave types (codes)", type: "codes", max: 20 }],
    defaultValue: { leaveTypes: [] },
    why: "Many Indian companies do not apply a sandwich rule; where they do it is for earned leave. It changes leave, so it is off until the directors turn it on and name the types.",
  },
  {
    key: "policy.encashmentRequests",
    area: "Leave",
    row: "LV-23",
    title: "Encashment requests during the year",
    what: "Whether employees may ask to encash leave of the listed types, keeping at least the minimum balance. A director approves; payroll pays the approved days and records them in the leave ledger.",
    kind: "activation",
    fields: [
      { name: "leaveTypes", label: "Leave types (codes)", type: "codes", max: 10 },
      { name: "keepAtLeast", label: "Balance that must remain", type: "int", min: 0, max: 60, unit: "days" },
      { name: "maxDaysPerYear", label: "Most days a year", type: "int", min: 1, max: 60, unit: "days" },
    ],
    defaultValue: { leaveTypes: ["PL"], keepAtLeast: 15, maxDaysPerYear: 10 },
    why: "Year-end encashment is the company's rule; mid-year encashment, when allowed, keeps a reserve. It changes pay and leave, so it is off until the directors turn it on.",
  },
  {
    key: "policy.retention",
    area: "Data",
    row: "AD-07",
    title: "Data retention for former employees",
    what: "How long after the leaving date each kind of record is kept. Not set means kept. Payroll and tax records, and pay or statutory documents, are not erased here (their periods follow the law and are the directors' with payroll). Erasing needs one director to propose it and another to confirm.",
    kind: "notSet",
    fields: [
      { name: "contactMonths", label: "Contact and personal details", type: "int", min: 1, max: 240, unit: "months after leaving", optional: true },
      { name: "documentsMonths", label: "Documents shared with the person", type: "int", min: 1, max: 240, unit: "months after leaving", optional: true },
      { name: "helpdeskMonths", label: "Helpdesk tickets they raised", type: "int", min: 1, max: 240, unit: "months after leaving", optional: true },
    ],
    defaultValue: null,
    why: "Retention periods are the owners' (DPDP and labour law); nothing is erased until they choose.",
  },
  {
    key: "policy.textMessages",
    area: "Messages",
    row: "NT-11",
    title: "SMS and WhatsApp",
    what: "Whether some notices also go by SMS or WhatsApp, and which provider sends them. The provider needs an account and a key kept as a secret in the environment.",
    kind: "notSet",
    fields: [
      { name: "provider", label: "Provider", type: "choice", options: [{ value: "NONE", label: "None" }, { value: "SMS", label: "An SMS provider (configured at deployment)" }, { value: "WHATSAPP", label: "A WhatsApp provider (configured at deployment)" }] },
      { name: "categories", label: "Notices sent this way (LEAVE_DECISION, REQUEST_DECISION, DOCUMENT_ADDED)", type: "codes", max: 10 },
    ],
    defaultValue: null,
    why: "Choosing a provider needs an account and a secret key: the owners' choice at deployment.",
  },
] as const;

export const POLICY_KEYS = POLICY_SETTINGS.map((s) => s.key);
export const policyDef = (key: string) => POLICY_SETTINGS.find((s) => s.key === key);

/** Text-message categories a director may choose for NT-11 (the server refuses others), and the notification types each covers. */
export const TEXT_MESSAGE_CATEGORIES = [
  { code: "LEAVE_DECISION", label: "A decision on my leave", types: ["leave.decided"] },
  { code: "REQUEST_DECISION", label: "A decision on my overtime, work-from-home or encashment request", types: ["overtime.approved", "overtime.rejected", "wfh.rejected", "encashment.approved", "encashment.rejected"] },
  { code: "DOCUMENT_ADDED", label: "A letter or document issued to me", types: ["document.added"] },
] as const;
