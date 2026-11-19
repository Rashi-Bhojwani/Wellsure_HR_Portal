import { Prisma } from "@prisma/client";
import { HttpError } from "../../middleware/errorHandler";

export interface EncashmentRateResult {
  amount: Prisma.Decimal;
  source: string; // "SALARY_STRUCTURE" in the application; tests install their own
  isFinal: boolean;
}

/** Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 4): one leave-day value for year-end, mid-year and exit encashment. */
export interface EncashmentRateProvider {
  /** The value of one leave day (for a per-day column or a report). */
  getDailyRate(employeeId: string, asOfDate: Date): Promise<EncashmentRateResult>;
  /** The value of `days` leave days, rounded once at the end, exactly as mid-year and exit encashment work it out. */
  amountFor?(employeeId: string, asOfDate: Date, days: Prisma.Decimal): Promise<EncashmentRateResult>;
}

/** The value of `days` leave days through the provider (a provider without amountFor: its daily rate times the days). */
export async function encashedAmountFor(provider: EncashmentRateProvider, employeeId: string, asOfDate: Date, days: Prisma.Decimal): Promise<{ amount: Prisma.Decimal; dailyRate: Prisma.Decimal; source: string; isFinal: boolean }> {
  const rate = await provider.getDailyRate(employeeId, asOfDate);
  if (!provider.amountFor) return { amount: days.times(rate.amount), dailyRate: rate.amount, source: rate.source, isFinal: rate.isFinal };
  const total = await provider.amountFor(employeeId, asOfDate, days);
  return { amount: total.amount, dailyRate: rate.amount, source: total.source, isFinal: total.isFinal };
}

// Extends HttpError so the central error handler maps it to a plain refusal, never a 500.
export class EncashmentRateNotConfiguredError extends HttpError {
  constructor() {
    super(409, "Leave encashment amount is not set. Choose it in settings (Default behaviours, Leave encashment amount): the per-day basis heads and divisor.", "SETTING_NOT_SET", { settings: ["payroll.leaveEncashment"] });
    this.name = "EncashmentRateNotConfiguredError";
  }
}

// The one leave-day value is the Default behaviours setting "Leave encashment amount" (payroll.leaveEncashment), which payroll reads; payroll plugs its provider in
// at process start (payroll/run/providers.ts registerPayroll). Until then, and whenever that setting is Not set, every caller is refused: there is no flat-rupee
// fallback and no other formula (before: setting leave.encashment.defaultDailyRate and the rule ENCASH_DAILY_RATE_FORMULA).
export class NotConfiguredEncashmentRateProvider implements EncashmentRateProvider {
  async getDailyRate(): Promise<EncashmentRateResult> {
    throw new EncashmentRateNotConfiguredError();
  }
  async amountFor(): Promise<EncashmentRateResult> {
    throw new EncashmentRateNotConfiguredError();
  }
}

let encashmentRateProvider: EncashmentRateProvider = new NotConfiguredEncashmentRateProvider();

export function getEncashmentRateProvider(): EncashmentRateProvider {
  return encashmentRateProvider;
}

/** Called by payroll at process start (and by tests to install a fake). */
export function setEncashmentRateProvider(provider: EncashmentRateProvider): void {
  encashmentRateProvider = provider;
}
