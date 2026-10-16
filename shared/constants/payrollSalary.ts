// Salary vocabulary shared by the backend (validation) and the Salary screens (labels). Phase 6, docs/plans/PHASE_6.md §4 and §14B.

export const COMPONENT_TYPES = ["EARNING", "DEDUCTION", "EMPLOYER_CONTRIBUTION"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
export const COMPONENT_TYPE_LABEL: Record<ComponentType, string> = {
  EARNING: "Earning",
  DEDUCTION: "Deduction",
  EMPLOYER_CONTRIBUTION: "Employer contribution",
};

/** A component or structure code: capitals, digits and underscores, starting with a letter. Also usable as a name in a structure formula. */
export const ITEM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,24}$/;

/** Produced by the calculator from rules, never entered as components, so a component can never be mistaken for them. */
export const RESERVED_COMPONENT_CODES = ["CTC", "ANNUAL_CTC", "PF_EMPLOYEE", "PF_EMPLOYER", "ESI_EMPLOYEE", "ESI_EMPLOYER", "PT", "LWF", "TDS", "ARREARS"] as const;

export const LINE_CALC_METHODS = ["PERCENT", "FIXED_AMOUNT", "PER_PERSON", "FORMULA", "BALANCE"] as const;
export type LineCalcMethod = (typeof LINE_CALC_METHODS)[number];
export const LINE_CALC_LABEL: Record<LineCalcMethod, string> = {
  PERCENT: "Percentage of CTC or of an earlier line",
  FIXED_AMOUNT: "Same fixed amount for everyone",
  PER_PERSON: "Typed in for each person",
  FORMULA: "Formula",
  BALANCE: "Whatever is left of CTC",
};

export const SALARY_CHANGE_REASONS = ["JOINING", "REVISION", "CORRECTION"] as const;
export type SalaryChangeReason = (typeof SALARY_CHANGE_REASONS)[number];

export const REVISION_SELECTION_KINDS = ["EMPLOYEES", "BRANCH", "GRADE", "STRUCTURE", "ALL"] as const;
export type RevisionSelectionKind = (typeof REVISION_SELECTION_KINDS)[number];

/** The reserved component code arrears are paid under. */
export const ARREARS_CODE = "ARREARS";
