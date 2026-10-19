import { setPayrollConsumptionCheck, setPayrollInputsListener, setPayrollLockCheck } from "../../lib/effectiveDating";
import { reverifyOpenRuns } from "./run/closing";
import { payrollConsumption, payrollLockOn } from "./run/lock";
import { registerPayroll } from "./run/providers";

// Plugs payroll into the seams earlier phases left for it: what was paid (for arrears), the daily rate for leave encashment, and, from P6-4, the real payroll
// lock (any history change dated inside a finalised period is refused), what attendance asks before it unlocks a period payroll has used, and the nudge that
// re-checks a run waiting for a decision when something it reads has moved. Called at process start by the api and the worker, beside registerAttendanceEngine.
export function registerPayrollSeams(): void {
  registerPayroll();
  setPayrollLockCheck(payrollLockOn);
  setPayrollConsumptionCheck(payrollConsumption);
  setPayrollInputsListener(reverifyOpenRuns);
}
