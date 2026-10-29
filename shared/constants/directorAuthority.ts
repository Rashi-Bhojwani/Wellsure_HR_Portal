// Director authority (docs/plans/DIRECTOR_AUTHORITY.md). A director (a Super Admin) acts on their own authority: what two people used to do, one does, at once, and the
// other director is told. For each step an owner can switch a second-director check back on. The switches live in SystemSetting `payroll.secondDirector`; a missing
// step means "off" (the director acts alone).

export const DIRECTOR_STEPS = [
  "RULE_CONFIRM",
  "RUN_APPROVAL",
  "PERIOD_FINALISE",
  "PERIOD_UNLOCK",
  "SALARY_REVISION",
  "PAYSLIP_PUBLISH",
  "BANK_FILE",
  "SETUP_SIGNOFF",
  "IDENTITY_DIRECTOR_ENTRY",
  "SETTINGS",
] as const;
export type DirectorStep = (typeof DIRECTOR_STEPS)[number];

export interface DirectorStepInfo {
  label: string;
  /** In words an owner understands: what switching the second-director check on for this step changes. */
  covers: string;
}

export const DIRECTOR_STEP_INFO: Record<DirectorStep, DirectorStepInfo> = {
  RULE_CONFIRM: { label: "Payroll rules", covers: "Confirming a rule, a salary component or structure, a file layout, and the company's registration numbers, bank layout and debit account." },
  RUN_APPROVAL: { label: "Approving a payroll run", covers: "Approving a calculated run." },
  PERIOD_FINALISE: { label: "Closing a payroll period", covers: "Closing (finalising) a period after its run is approved." },
  PERIOD_UNLOCK: { label: "Unlocking a closed period", covers: "Unlocking a closed period. Never possible once payslips are published or a bank file exists." },
  SALARY_REVISION: { label: "Salary revisions", covers: "Making, cancelling and applying a salary revision. A director's own pay is always set by the other director, whatever this says." },
  PAYSLIP_PUBLISH: { label: "Publishing payslips", covers: "Publishing payslips to employees." },
  BANK_FILE: { label: "The bank file", covers: "Generating the bank transfer file. The system never moves money." },
  SETUP_SIGNOFF: { label: "Sign-off of people's pay details", covers: "Signing off salaries, bank accounts and PF numbers before the first real run." },
  IDENTITY_DIRECTOR_ENTRY: { label: "A director's own entry of bank / statutory details", covers: "Bank and statutory details a director enters for someone. What HR enters always waits for a director, and a director's own details always wait for the other director." },
  SETTINGS: { label: "System settings", covers: "Changes to System Settings." },
};

export const DIRECTOR_AUTHORITY_SETTING_KEY = "payroll.secondDirector";
/** Days a notice may stay unacknowledged before a red banner is raised (SystemSetting; the owner's answer was 3). */
export const DIRECTOR_ESCALATION_DAYS_KEY = "payroll.directorNoticeEscalationDays";
export const DEFAULT_DIRECTOR_ESCALATION_DAYS = 3;

export const DIRECTOR_NOTICE_KINDS = ["ACTION", "SWITCH_CHANGED", "SETTING_CHANGED"] as const;
export type DirectorNoticeKind = (typeof DIRECTOR_NOTICE_KINDS)[number];

/** The roles only a director may hold: they are markers, a Super Admin already holds every permission. */
export const DIRECTOR_ONLY_ROLE_CODES = ["PAYROLL_ADMIN", "PAYROLL_APPROVER"] as const;

/** SecurityEvent kinds raised for directors; the banner and the acknowledgement route recognise them by this prefix. */
export const DIRECTOR_SECURITY_EVENT_PREFIX = "director.";

export interface DirectorNoticeView {
  id: string;
  kind: DirectorNoticeKind;
  step: DirectorStep | string;
  stepLabel: string;
  subjectLabel: string;
  itemCount: number | null;
  authority: "SECOND_DIRECTOR" | "DIRECTOR_AUTHORITY" | null;
  createdAt: string;
  /** Who acted; the viewer never sees a notice of their own act, so this is always another director. */
  actorName: string;
  seenAt: string | null;
  acknowledgedAt: string | null;
  escalated: boolean;
}

export interface DirectorSwitchView {
  step: DirectorStep;
  label: string;
  covers: string;
  /** true = a second director must decide; false (the default) = a director acts alone and the other is told. */
  requireSecondDirector: boolean;
}
