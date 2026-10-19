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
export const HOLD_REASONS = ["ATTENDANCE_NOT_FINAL", "NO_SALARY", "WORKING_DAYS_PART_MONTH", "FINAL_SETTLEMENT", "NEGATIVE_NET", "ZERO_NET", "NO_BANK_ACCOUNT"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];
export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  ATTENDANCE_NOT_FINAL: "Attendance for some of their days is not finalised yet",
  NO_SALARY: "No salary on record for days they were employed",
  WORKING_DAYS_PART_MONTH: "Part month on a working-days basis, which cannot be worked out yet",
  FINAL_SETTLEMENT: "Last month held for final settlement",
  NEGATIVE_NET: "Deductions are more than earnings",
  ZERO_NET: "Net pay is nil",
  NO_BANK_ACCOUNT: "No bank account on the payment date",
};

/** Things a person is calculated with that someone must look at. BLOCKING ones stop the run being submitted (P6-4); WARNING ones are for the reader. */
export const EXCEPTION_CODES = ["NEGATIVE_NET", "STATE_UNMAPPED", "LOP_EXCEEDS_DAYS", "NO_PLACEMENT"] as const;
export type ExceptionCode = (typeof EXCEPTION_CODES)[number];
export type ExceptionSeverity = "BLOCKING" | "WARNING";
