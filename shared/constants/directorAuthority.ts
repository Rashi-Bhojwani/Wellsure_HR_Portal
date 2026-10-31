// Director authority (docs/plans/DIRECTOR_AUTHORITY.md). A director (a Super Admin) acts on their own authority: what two people used to do, one does, at once, and the
// other director is told. For each payroll step that can move or commit money or change pay rules the two directors MUST choose, with no default, between "a different director
// must decide" and "the acting director decides alone, the other is told". One director proposes the choice and the other confirms it; until both have, the choice is Not set and
// payroll refuses to run that step. The choices live in SystemSetting `payroll.secondDirector`. Both modes tell the other director.

export const DIRECTOR_STEPS = [
  "RULE_CONFIRM",
  "RUN_APPROVAL",
  "PERIOD_FINALISE",
  "PERIOD_UNLOCK",
  "SALARY_REVISION",
  "MONTHLY_INPUTS",
  "PAYSLIP_PUBLISH",
  "BANK_FILE",
  "SETUP_SIGNOFF",
  "IDENTITY_DIRECTOR_ENTRY",
  "SETTINGS",
] as const;
export type DirectorStep = (typeof DIRECTOR_STEPS)[number];

/** The steps whose choice is required (no default). Settings and a director's own identity entry stay "act alone, other is told" and may optionally be chosen too. */
export const DIRECTOR_CHOICE_REQUIRED_STEPS = ["RULE_CONFIRM", "RUN_APPROVAL", "PERIOD_FINALISE", "PERIOD_UNLOCK", "SALARY_REVISION", "MONTHLY_INPUTS", "PAYSLIP_PUBLISH", "BANK_FILE", "SETUP_SIGNOFF"] as const satisfies readonly DirectorStep[];
export const isChoiceRequired = (step: string): boolean => (DIRECTOR_CHOICE_REQUIRED_STEPS as readonly string[]).includes(step);
/** The recommendation shown on the screen: switch the second-director check ON for these. */
export const DIRECTOR_RECOMMENDED_SECOND_STEPS = ["RUN_APPROVAL", "BANK_FILE", "SALARY_REVISION", "RULE_CONFIRM"] as const satisfies readonly DirectorStep[];

export const DIRECTOR_CHOICE_MODES = ["SECOND_DIRECTOR", "DIRECTOR_AUTHORITY"] as const;
export type DirectorChoiceMode = (typeof DIRECTOR_CHOICE_MODES)[number];
export const DIRECTOR_CHOICE_STATUSES = ["NOT_SET", "PENDING_CONFIRMATION", "CONFIRMED"] as const;
export type DirectorChoiceStatus = (typeof DIRECTOR_CHOICE_STATUSES)[number];

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
  SALARY_REVISION: { label: "Salary revisions", covers: "Making, cancelling and applying a salary revision. A director may set their own pay; it is audited and the other director is told." },
  MONTHLY_INPUTS: { label: "Confirming a month's Monthly Inputs", covers: "Confirming the figures entered for a month (one-off earnings and deductions such as incentives or advances) before payroll may use them. Any later change voids the confirmation." },
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
  /** Payroll will not run this step until the choice is Confirmed. */
  required: boolean;
  /** The screen recommends "a different director must decide" for this step. */
  recommendedSecond: boolean;
  status: DirectorChoiceStatus;
  /** The mode in force: only when Confirmed. A change waiting for confirmation does not take effect. */
  mode: DirectorChoiceMode | null;
  /** A made-up choice in the DEMO company, labelled as such. */
  demo: boolean;
  confirmed: { byName: string; at: string } | null;
  proposed: { mode: DirectorChoiceMode; byName: string; at: string; byMe: boolean } | null;
}
