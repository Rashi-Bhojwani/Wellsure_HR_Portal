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

export async function closePayrollQueues(): Promise<void> {
  const q = queue;
  queue = null;
  if (q) await q.close();
}
