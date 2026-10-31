// The four new leave types (Peeps, Q-15 decided) and the choices their owner-entered rules are made of. Every rule value is Not set until HR (or a
// director) prepares a version and a different director approves it; a type cannot be applied for before that. Stable codes: the display name is a
// label edited in Leave Types & Policies, and balances, requests and the ledger key on the type, never on its name.

export const PEEPS_LEAVE_TYPE_CODES = ["MENSTRUAL", "MEDICAL", "WEDDING", "BEREAVEMENT"] as const;
export type PeepsLeaveTypeCode = (typeof PEEPS_LEAVE_TYPE_CODES)[number];
export const isPeepsLeaveTypeCode = (code: string): code is PeepsLeaveTypeCode => (PEEPS_LEAVE_TYPE_CODES as readonly string[]).includes(code);

export const LEAVE_CAP_PERIODS = ["PER_REQUEST", "PER_CALENDAR_YEAR", "PER_EMPLOYMENT"] as const;
export const LEAVE_UNITS = ["FULL_DAY", "HALF_DAY"] as const;
export const LEAVE_COUNTING = ["WORKING_DAYS", "CALENDAR_DAYS"] as const;
export const LEAVE_ROUTES = ["MANAGER_OR_HR", "HR_ONLY"] as const;
export const LEAVE_YEAR_END_BALANCE = ["LAPSE", "CARRY_FORWARD"] as const;
export const LEAVE_ENCASHMENT = ["NONE", "ENCASH_UNUSED"] as const;
export const LEAVE_EMPLOYMENT_TYPES = ["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"] as const;

export const LEAVE_RULE_LABELS = {
  PER_REQUEST: "At most this many days in one request",
  PER_CALENDAR_YEAR: "At most this many days in a calendar year",
  PER_EMPLOYMENT: "At most this many days in the whole employment",
  GRANTED_BALANCE: "A balance HR credits through the Leave Granter (no automatic credit)",
  FULL_DAY: "Full days only",
  HALF_DAY: "Half days allowed",
  WORKING_DAYS: "Working days only (holidays and week-offs inside the range are not counted)",
  CALENDAR_DAYS: "Calendar days (holidays and week-offs inside the range are counted)",
  MANAGER_OR_HR: "The reporting manager or HR",
  HR_ONLY: "HR only",
  LAPSE: "Unused balance lapses at year end",
  CARRY_FORWARD: "Unused balance carries forward",
  NONE: "Not encashed",
  ENCASH_UNUSED: "Unused balance is encashed (computed by payroll)",
} as const;

/** The rules that must all be set before a type can be applied for (the year-end part is separate and keeps the type out of year end). */
export const LEAVE_REQUIRED_RULES = ["paid", "entitlement", "eligibility", "units", "counting", "document", "approvalRoute"] as const;
