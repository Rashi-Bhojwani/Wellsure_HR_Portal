import { registerPayroll } from "./run/providers";

// Plugs payroll into the seams earlier phases left for it (what was paid, for arrears; the daily rate for leave encashment). Called at process start by the api and
// the worker, beside registerAttendanceEngine.
export function registerPayrollSeams(): void {
  registerPayroll();
}
