import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// Payroll queues (Phase 6 P6-3, docs/plans/PHASE_6.md §14D). Created on first use, like the attendance queues, so processes that never enqueue (and tests)
// do not open Redis connections for them.
//   payroll-calculate: one run's calculation, in chunks of people, resumable (the run holds a lease and a calculation version)
export const PAYROLL_CALCULATE_QUEUE = "payroll-calculate";

let queue: Queue | null = null;
export function payrollCalculateQueue(): Queue {
  queue ??= new Queue(PAYROLL_CALCULATE_QUEUE, { connection: createBullConnection() });
  return queue;
}

//   payroll-payslips: render, store and announce one run's payslips, a few at a time, idempotent per payslip (P6-5)
export const PAYROLL_PAYSLIPS_QUEUE = "payroll-payslips";
let payslipQueue: Queue | null = null;
export function payrollPayslipsQueue(): Queue {
  payslipQueue ??= new Queue(PAYROLL_PAYSLIPS_QUEUE, { connection: createBullConnection() });
  return payslipQueue;
}
/** The worker runs these one at a time and each payslip is claimed before it is worked on, so a repeat (Prepare again) never does anything twice. */
export async function enqueuePayslipJob(runId: string): Promise<void> {
  await payrollPayslipsQueue().add("deliver", { runId }, { jobId: `payslips-${runId}-${Date.now()}`, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 }); // allow-clock
}

export async function closePayrollQueues(): Promise<void> {
  const q = queue;
  const p = payslipQueue;
  queue = null;
  payslipQueue = null;
  if (q) await q.close();
  if (p) await p.close();
}
