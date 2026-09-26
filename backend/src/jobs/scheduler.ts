import { logger } from "../lib/logger";
import { employeeSeparationsQueue } from "./queues";

// Registers BullMQ repeatable jobs. Idempotent registration matters here —
// see docs/PROJECT_SPEC.md §15.2.3 (the scheduler service always runs
// exactly one task) — BullMQ itself de-dupes a repeatable job by its
// {jobId, pattern} pair, so calling this on every scheduler boot is safe.
// Monthly PL accrual, the nightly attendance cron, daily Engage auto-posts
// and comp-off expiry are registered here starting Phase 2/4/5.
export async function registerScheduledJobs(): Promise<void> {
  await employeeSeparationsQueue.upsertJobScheduler(
    "employee-separations-daily",
    { pattern: "0 1 * * *", tz: "Asia/Kolkata" }, // 01:00 IST daily
    { name: "process-due-separations" },
  );
  logger.info("Registered repeatable job: employee-separations (01:00 IST daily)");
}
