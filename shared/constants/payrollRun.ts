// Payroll run vocabulary shared by the backend and the Payroll Run screens. Phase 6, docs/plans/PHASE_6.md §14D.

export const RUN_STATUSES = ["NEW", "CALCULATING", "CALCULATED", "SUBMITTED", "APPROVED", "FAILED", "VOID", "FINALISED"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  NEW: "Not calculated yet",
  CALCULATING: "Calculating",
  CALCULATED: "Calculated (draft)",
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved, not yet final",
  FAILED: "Calculation failed",
  VOID: "Discarded",
  FINALISED: "Finalised",
};

/** The lines the calculator produces from rules, never entered as components. */
export const STATUTORY_LINE_CODES = {
  PF_EMPLOYEE: "PF_EMPLOYEE",
  PF_EPS: "PF_EPS",
  PF_EPF_ER: "PF_EPF_ER",
  PF_EDLI: "PF_EDLI",
  PF_ADMIN: "PF_ADMIN",
  ESI_EMPLOYEE: "ESI_EMPLOYEE",
  ESI_EMPLOYER: "ESI_EMPLOYER",
  PT: "PT",
  LWF_EMPLOYEE: "LWF_EMPLOYEE",
  LWF_EMPLOYER: "LWF_EMPLOYER",
  LEAVE_ENCASHMENT: "LEAVE_ENCASHMENT",
  NET_ROUNDING: "NET_ROUNDING",
} as const;

export const STATUTORY_LINE_LABEL: Record<string, string> = {
  PF_EMPLOYEE: "Provident fund (employee)",
  PF_EPS: "Employer pension (EPS)",
  PF_EPF_ER: "Employer provident fund",
  PF_EDLI: "EDLI (employer)",
  PF_ADMIN: "PF administration charge (employer)",
  ESI_EMPLOYEE: "ESI (employee)",
  ESI_EMPLOYER: "ESI (employer)",
  PT: "Professional tax",
  LWF_EMPLOYEE: "Labour welfare fund (employee)",
  LWF_EMPLOYER: "Labour welfare fund (employer)",
  LEAVE_ENCASHMENT: "Leave encashment",
  ARREARS: "Arrears",
  NET_ROUNDING: "Rounding of net pay",
};

/** Why a calculated person is not payable. */
export const HOLD_REASONS = ["ATTENDANCE_NOT_FINAL", "NO_SALARY", "WORKING_DAYS_PART_MONTH", "FINAL_SETTLEMENT", "NEGATIVE_NET", "ZERO_NET", "NO_BANK_ACCOUNT", "DIRECTOR_HOLD"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];
export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  ATTENDANCE_NOT_FINAL: "Attendance for some of their days is not finalised yet",
  NO_SALARY: "No salary on record for days they were employed",
  WORKING_DAYS_PART_MONTH: "Part month on a working-days basis, which cannot be worked out yet",
  FINAL_SETTLEMENT: "Last month held for final settlement",
  NEGATIVE_NET: "Deductions are more than earnings",
  ZERO_NET: "Net pay is nil",
  NO_BANK_ACCOUNT: "No bank account on the payment date",
  DIRECTOR_HOLD: "Salary held by a director",
};

/** What the person who sees a held name should do about it: shown beside the reason wherever people without a payslip are listed. */
export const HOLD_REASON_ACTION: Record<HoldReason, string> = {
  ATTENDANCE_NOT_FINAL: "Finalise attendance for the period, then calculate the run again.",
  NO_SALARY: "Enter their salary (a salary revision, approved by a checker), then calculate the run again.",
  WORKING_DAYS_PART_MONTH: "Change the pay-days basis in Rules and setup, or pay them through an adjustment.",
  FINAL_SETTLEMENT: "Nothing now: they are paid with their final settlement.",
  NEGATIVE_NET: "Reduce a deduction or add an adjustment, then calculate the run again.",
  ZERO_NET: "Nothing is owed to them this month, so there is nothing to pay.",
  NO_BANK_ACCOUNT: "Enter their bank account in force on the payment date (Employee profile), then calculate the run again.",
  DIRECTOR_HOLD: "A director releases it (Payroll, Held salaries). Until then it is carried forward and not paid.",
};

/** Things a person is calculated with that someone must look at. BLOCKING ones stop the run being submitted (P6-4); WARNING ones are for the reader. */
export const EXCEPTION_CODES = ["NEGATIVE_NET", "STATE_UNMAPPED", "LOP_EXCEEDS_DAYS", "NO_PLACEMENT"] as const;
export type ExceptionCode = (typeof EXCEPTION_CODES)[number];
export type ExceptionSeverity = "BLOCKING" | "WARNING";
