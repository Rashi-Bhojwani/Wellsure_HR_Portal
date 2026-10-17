import type { RunStatus, VarianceTagCode } from "../../../api/payroll";

// The words the Payroll Run screens use (docs/plans/PHASE_6.md §14D).

export const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  NEW: "default",
  CALCULATING: "processing",
  CALCULATED: "blue",
  FAILED: "red",
  VOID: "default",
  FINALISED: "green",
};

export const VARIANCE_TAG_LABEL: Record<VarianceTagCode, string> = {
  JOINED: "Joined this month",
  LEFT: "Left this month",
  SALARY_REVISED: "Salary revised",
  LOP_CHANGED: "Loss of pay changed",
  ADJUSTMENT: "Adjustment",
  ARREARS: "Arrears",
  ENCASHMENT: "Leave encashment",
  STATUTORY_CHANGE: "PF, ESI, PT or LWF changed",
  HELD: "Held",
  NOT_CALCULATED: "Not calculated",
  NOT_IN_THIS_RUN: "Not in this run",
};

export const LINE_KIND_LABEL = { EARNING: "Earning", DEDUCTION: "Deduction", EMPLOYER_CONTRIBUTION: "Employer contribution", ROUNDING: "Rounding" } as const;
