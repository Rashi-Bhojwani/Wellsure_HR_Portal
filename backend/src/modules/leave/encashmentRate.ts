import { Prisma } from "@prisma/client";
import { getSetting } from "../../lib/settings";
import { HttpError } from "../../middleware/errorHandler";

export interface EncashmentRateResult {
  amount: Prisma.Decimal;
  source: "MANUAL_SETTING" | "SALARY_STRUCTURE";
  isFinal: boolean; // false = pending the owners' confirmation — Year End Process's UI must flag this clearly
}

export interface EncashmentRateProvider {
  getDailyRate(employeeId: string, asOfDate: Date): Promise<EncashmentRateResult>;
}

// Extends HttpError (same convention InsufficientLeaveBalanceError/
// InsufficientHoursForCompOffError already follow) so the central error
// handler maps this to a 400 instead of falling through to a 500.
export class EncashmentRateNotConfiguredError extends HttpError {
  constructor() {
    super(400, "Leave encashment daily rate is not configured. Set System Settings -> Leave -> Default Daily Rate before running Year End Process.", "ENCASHMENT_RATE_NOT_CONFIGURED");
    this.name = "EncashmentRateNotConfiguredError";
  }
}

// Phase 4's only implementation: one flat, HR-entered rupee amount for
// every employee (system_settings key "leave.encashment.defaultDailyRate"),
// standing in for spec §5.2's real formula. HR has confirmed "one working
// day's salary per leave day" as the intended rule, but not yet the exact
// formula or its tax treatment (both await the owners' confirmation) — salary
// structures don't exist until Phase 6 regardless, so there is no
// per-employee salary to compute from today.
//
// Fails loudly rather than silently returning 0: a year-end run that
// quietly encashed everyone at ₹0 would be worse than an error, and would
// be very easy to miss in a preview table full of small numbers.
//
// What Phase 6 must supply: a SalaryBasedEncashmentRateProvider
// implementing this same interface off real Basic salary, swapped in
// without touching Year End Process code. YearEndRunItem.rateSource
// snapshots which provider produced each run, so switching providers
// later never retroactively changes already-committed history.
export class SettingsBasedEncashmentRateProvider implements EncashmentRateProvider {
  async getDailyRate(_employeeId: string, _asOfDate: Date): Promise<EncashmentRateResult> {
    const rate = await getSetting<number | null>("leave.encashment.defaultDailyRate", null);
    if (rate === null || rate <= 0) {
      throw new EncashmentRateNotConfiguredError();
    }
    return { amount: new Prisma.Decimal(rate), source: "MANUAL_SETTING", isFinal: false };
  }
}

let encashmentRateProvider: EncashmentRateProvider = new SettingsBasedEncashmentRateProvider();

export function getEncashmentRateProvider(): EncashmentRateProvider {
  return encashmentRateProvider;
}

// Called by Phase 6 once a real salary-based provider exists. Exported
// mainly for tests to install a fake.
export function setEncashmentRateProvider(provider: EncashmentRateProvider): void {
  encashmentRateProvider = provider;
}
