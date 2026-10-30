import type { EmploymentType } from "@prisma/client";
import type { ComponentType } from "@shared/constants/payrollSalary";
import type { ExceptionCode, ExceptionSeverity, HoldReason } from "@shared/constants/payrollRun";
import type { PayrollPlacement } from "../../../lib/effectiveDating";
import type { Money } from "../money";
import type { RulePin } from "../rules/context";
import type { ComponentValue } from "../salary/schemas";
import type { RunRules } from "./rules";

// The shapes the calculation passes around (docs/plans/PHASE_6.md §14D). `PersonInput` is everything one person's pay depends on, gathered through the readers
// and nothing else; `calculatePerson` is a pure function of it and the run's rules, so a figure can always be reproduced from what is stored.

export interface CycleSpan {
  start: Date;
  end: Date;
  label: string;
}

export interface SegmentInput {
  /** The days this salary row covers inside the person's employed span. */
  from: Date;
  to: Date;
  salaryId: string;
  structureKey: string;
  structureVersion: number;
  structureHash: string;
  roundingPin: RulePin | null;
  lines: Array<{ component: string; version: number; type: ComponentType; amount: Money; order: number }>;
}

export interface AdjustmentIn {
  /** Null for a year-end encashment that has not yet been turned into an adjustment row (a preview). */
  id: string | null;
  source: "MANUAL" | "SALARY_ARREARS" | "YEAR_END_ENCASHMENT" | "IMPORT" | "LOP_REVERSAL";
  sourceRef: string | null;
  componentCode: string;
  direction: "EARNING" | "DEDUCTION";
  amount: Money;
  reason: string;
  /** Arrears: the closed cycle they belong to, and the breakdown by component (signed). */
  periodLabel?: string | undefined;
  breakdown?: Array<{ component: string; amount: Money }> | undefined;
}

export interface DayIn {
  date: Date;
  status: string;
  lopDays: Money;
}

export interface PersonInput {
  employeeId: string;
  employeeCode: string;
  employmentType: EmploymentType;
  dateOfJoining: Date;
  lastWorkingDate: Date | null;
  /** The part of the cycle they were employed. */
  span: { from: Date; to: Date };
  /** The locked days inside the span. */
  days: DayIn[];
  /** Employed days attendance has not locked (ISO). Any means the person cannot be calculated. */
  missingDays: string[];
  segments: SegmentInput[];
  /** Employed days no salary row covers (ISO). Any means the person cannot be calculated. */
  salaryGapDays: string[];
  /** Placement on the day that decides the PT / LWF state. */
  placement: PayrollPlacement | null;
  placementDay: Date;
  hasBankAccount: boolean;
  adjustments: AdjustmentIn[];
  /** Under a half-year ESI rule: the full-month ESI-applicable entitlement at the start of the contribution period (or at joining, if later). Null otherwise. */
  esiPeriodStartEntitlement: Money | null;
}

export interface ComponentLookup {
  byVersion: ReadonlyMap<string, ComponentValue>; // "CODE@version"
  /** The newest version of each component, for adjustments. */
  current: ReadonlyMap<string, { version: number; value: ComponentValue }>;
}

export interface CalcContext {
  cycle: CycleSpan;
  /** The month the cycle pays: the month of its end date (1 to 12). */
  payrollMonth: number;
  rules: RunRules;
  components: ComponentLookup;
}

export interface LineOut {
  code: string;
  label: string;
  kind: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION" | "ROUNDING";
  source: "COMPONENT" | "ADJUSTMENT" | "LOP_REVERSAL" | "ARREARS" | "ENCASHMENT" | "PF" | "ESI" | "PT" | "LWF" | "NET_ROUNDING";
  sourceRef: string | null;
  amount: Money;
  basis: Record<string, unknown>;
}

export interface ExceptionOut {
  code: ExceptionCode;
  severity: ExceptionSeverity;
  message: string;
}

export interface ItemOut {
  employeeId: string;
  status: "PAYABLE" | "HELD" | "EXCLUDED";
  holdReason: HoldReason | null;
  holdDetail: string | null;
  employedFrom: Date | null;
  employedTo: Date | null;
  basisDays: Money;
  lopDivisorDays: Money;
  lopDays: Money;
  paidDays: Money;
  gross: Money;
  deductions: Money;
  employerContributions: Money;
  netBeforeRounding: Money;
  roundingAdjustment: Money;
  netPay: Money;
  employmentType: EmploymentType;
  placement: Record<string, unknown>;
  structureKey: string | null;
  structureVersion: number | null;
  lines: LineOut[];
  inputs: Record<string, unknown>;
  notices: string[];
  exceptions: ExceptionOut[];
  itemHash: string;
}
