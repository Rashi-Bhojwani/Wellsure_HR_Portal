import { META_PERMISSION_KEYS, type PermissionKey } from "./permissions";

// The registry of sensitive data (docs/plans/PHASE_6.md §14J). The owners enter their own salaries, bank accounts, debit account, PF/ESI/PT/LWF/TAN identifiers and bank file layout, and the
// developer must be able to build and run the system without holding any permission that reveals or changes them. This file is the single place that says what is sensitive and which
// permissions open it. Three things read it:
//   - lib/permissions.ts, which removes every key listed here from anyone who holds the DEVELOPER role, whatever else they are given (the ceiling);
//   - the "Who can see and change this" table on the Setup Checklist and docs/SENSITIVE_DATA.md;
//   - a test that fails if any permission in the catalogue is neither listed here nor in REVIEWED_NOT_SENSITIVE, so a new permission cannot be added without somebody deciding which it is.

export type SensitiveClassId =
  | "SALARY_AND_PAYROLL"
  | "PAYROLL_RULES"
  | "EMPLOYEE_BANK"
  | "EMPLOYEE_STATUTORY"
  | "COMPANY_IDENTIFIERS"
  | "BANK_LAYOUT_AND_DEBIT_ACCOUNT"
  | "PERSONAL_DOCUMENTS"
  | "SENSITIVE_TICKETS"
  | "ACCESS_CONTROL";

export interface SensitiveClass {
  id: SensitiveClassId;
  label: string;
  /** In words an owner understands: what this is, and who it is for. */
  what: string;
  /** Permissions that let a person see the values themselves. */
  view: readonly PermissionKey[];
  /** Permissions that let a person enter or change them, or act on them. */
  edit: readonly PermissionKey[];
  /** Permissions that let a second person vouch for them. */
  confirm: readonly PermissionKey[];
}

export const SENSITIVE_CLASSES: readonly SensitiveClass[] = [
  {
    id: "SALARY_AND_PAYROLL",
    label: "Salaries and payroll figures",
    what: "What each person earns, payroll runs, payslips, the bank transfer batches and the salary and statutory reports.",
    view: ["payroll.salary.view", "payroll.payslip.view", "payroll.bank.view", "reports.salary.view", "reports.liability.view", "documents.pay.view"],
    edit: ["payroll.salary.edit", "payroll.adjust", "payroll.run", "payroll.unlock", "leave.yearend.manage"],
    confirm: ["payroll.approve"],
  },
  {
    id: "PAYROLL_RULES",
    label: "Payroll rules, components and structures",
    what: "The rates, ceilings and choices that decide how pay is worked out. Not secret, but whoever changes or confirms them decides what people are paid.",
    view: [],
    edit: ["payroll.rules.manage"],
    confirm: ["payroll.rules.confirm"],
  },
  {
    id: "EMPLOYEE_BANK",
    label: "Employees' bank accounts",
    what: "The account each person is paid into.",
    view: ["employee.bank.view"],
    edit: ["employee.bank.edit"], // approving a bank change request needs this same key (changeRequests.ts), so profile.changerequest.approve alone edits nothing here
    confirm: [],
  },
  {
    id: "EMPLOYEE_STATUTORY",
    label: "Employees' PAN, Aadhaar, UAN and ESI numbers",
    what: "The government identifiers of each person.",
    view: ["employee.statutory.view"],
    edit: ["employee.statutory.edit"], // likewise for a statutory change request
    confirm: [],
  },
  {
    id: "COMPANY_IDENTIFIERS",
    label: "The company's PF, ESI, PT, LWF, PAN and TAN identifiers",
    what: "The company's own registration numbers, printed on statutory files.",
    view: ["payroll.identifiers.manage"],
    edit: ["payroll.identifiers.manage"],
    confirm: ["payroll.identifiers.confirm"],
  },
  {
    id: "BANK_LAYOUT_AND_DEBIT_ACCOUNT",
    label: "The bank file layout and the company's debit account",
    what: "How the bank wants its transfer file laid out, and the company account the salaries are paid from.",
    view: ["payroll.banklayout.manage", "payroll.banklayout.confirm"],
    edit: ["payroll.banklayout.manage"],
    confirm: ["payroll.banklayout.confirm"],
  },
  {
    id: "PERSONAL_DOCUMENTS",
    label: "Employees' HR-held documents",
    what: "ID proofs, certificates and letters kept on file for each person.",
    view: ["employee.documents.view"],
    edit: ["employee.documents.manage"],
    confirm: [],
  },
  {
    id: "SENSITIVE_TICKETS",
    label: "Sensitive helpdesk tickets",
    what: "Tickets in categories such as Payroll and Salary or Grievance, where people write private things.",
    view: ["helpdesk.sensitive.view"],
    edit: [],
    confirm: [],
  },
  {
    id: "ACCESS_CONTROL",
    label: "Power over other people's access",
    what: "Security policy, other people's sign-in and 2FA, individual permission exceptions, and unlocking attendance. Whoever holds these can weaken the protection of everything above.",
    view: [],
    edit: [...META_PERMISSION_KEYS],
    confirm: [],
  },
];

export const SENSITIVE_PERMISSION_KEYS: readonly PermissionKey[] = [...new Set(SENSITIVE_CLASSES.flatMap((c) => [...c.view, ...c.edit, ...c.confirm]))];
const SENSITIVE_SET = new Set<string>(SENSITIVE_PERMISSION_KEYS);
export const isSensitivePermission = (key: string): boolean => SENSITIVE_SET.has(key);

/**
 * Every permission that is deliberately not sensitive, as a person decided. A test fails if a permission is in neither this list nor a class above, so adding a permission
 * means saying here which it is.
 */
export const REVIEWED_NOT_SENSITIVE: readonly PermissionKey[] = [
  "profile.changerequest.approve", // decides personal-details requests; a bank or statutory request also needs employee.bank.edit / employee.statutory.edit (checked in approveChangeRequest)
  "employee.view",
  "employee.create",
  "employee.edit",
  "employee.export",
  "employee.manage",
  "employee.separate",
  "employee.separate.view",
  "org.manage",
  "role.view",
  "import.manage",
  "audit.view",
  "leave.apply.onBehalf",
  "leave.view",
  "leave.approve",
  "leave.grant",
  "leave.policy.manage",
  "leave.recalculate",
  "announcements.manage",
  "engage.moderate",
  "engage.groups.manage",
  "engage.autopost.manage",
  "documents.manage",
  "helpdesk.manage",
  "letters.template.manage",
  "letters.generate",
  "manager.appoint",
  "manager.team.assign",
  "delegation.manage",
  "reports.view",
  "attendance.view",
  "attendance.config.manage",
  "attendance.manual.enter",
  "attendance.process",
  "attendance.devices.manage",
  "attendance.regularization.view",
  "attendance.regularization.approve",
  "attendance.regularization.bulk",
  "attendance.override.manage",
  "attendance.swipes.view",
  "attendance.finalise",
  "payroll.rules.view",
];

/** The keys nobody can hold together with the DEVELOPER role. */
export const DEVELOPER_ROLE_CODE = "DEVELOPER";
export const DEVELOPER_FORBIDDEN_KEYS: readonly PermissionKey[] = SENSITIVE_PERMISSION_KEYS;

/** What the DEVELOPER role is given: what is needed to build and run the system, and nothing in SENSITIVE_PERMISSION_KEYS (a test pins that). */
export const DEVELOPER_ROLE_PERMISSIONS: readonly PermissionKey[] = [
  "employee.view",
  "org.manage",
  "import.manage",
  "role.view",
  "audit.view",
  "attendance.view",
  "attendance.config.manage",
  "attendance.process",
  "attendance.devices.manage",
  "attendance.swipes.view",
  "attendance.regularization.view",
  "leave.view",
  "leave.policy.manage",
  "reports.view",
  "helpdesk.manage",
  "payroll.rules.view",
];

/** A guard for tests and the matrix: which class(es) a permission opens, and how. */
export function classesOf(key: string): Array<{ class: SensitiveClass; as: "view" | "edit" | "confirm" }> {
  const out: Array<{ class: SensitiveClass; as: "view" | "edit" | "confirm" }> = [];
  for (const c of SENSITIVE_CLASSES) for (const as of ["view", "edit", "confirm"] as const) if ((c[as] as readonly string[]).includes(key)) out.push({ class: c, as });
  return out;
}
