import { logger } from "../lib/logger";
import { getDailyRunHour } from "../modules/engage/autoPostSettings";
import { compOffExpiryQueue, employeeSeparationsQueue, engageAutoPostsQueue, leavePlAccrualQueue } from "./queues";

// Registers BullMQ repeatable jobs. Idempotent registration matters here —
// see docs/PROJECT_SPEC.md §15.2.3 (the scheduler service always runs
// exactly one task) — BullMQ itself de-dupes a repeatable job by its
// {jobId, pattern} pair, so calling this on every scheduler boot is safe.
// The nightly attendance cron and daily Engage auto-posts are registered
// here starting Phase 2/5.
export async function registerScheduledJobs(): Promise<void> {
  await employeeSeparationsQueue.upsertJobScheduler(
    "employee-separations-daily",
    { pattern: "0 1 * * *", tz: "Asia/Kolkata" }, // 01:00 IST daily
    { name: "process-due-separations" },
  );
  logger.info("Registered repeatable job: employee-separations (01:00 IST daily)");

  await leavePlAccrualQueue.upsertJobScheduler(
    "leave-pl-accrual-monthly",
    { pattern: "30 0 1 * *", tz: "Asia/Kolkata" }, // 00:30 IST, 1st of every month (spec §5.5)
    { name: "run-monthly-pl-accrual" },
  );
  logger.info("Registered repeatable job: leave-pl-accrual (00:30 IST, 1st of month)");

  await compOffExpiryQueue.upsertJobScheduler(
    "comp-off-expiry-daily",
    { pattern: "30 1 * * *", tz: "Asia/Kolkata" }, // 01:30 IST daily (spec §5.5)
    { name: "expire-comp-off-credits" },
  );
  logger.info("Registered repeatable job: comp-off-expiry (01:30 IST daily)");

  // The hour is admin-configurable (Engage Admin > Auto-Post Settings,
  // engage.autopost.manage) via SystemSetting "engage.autopost.dailyRunHour"
  // (default 8, spec §8's "daily 08:00 cron") — read once here at
  // registration time. BullMQ's repeatable-job schedule isn't live-
  // reloaded within a running process, so a changed hour takes effect on
  // the scheduler's next restart, not immediately; documented in the
  // admin screen itself.
  const dailyRunHour = await getDailyRunHour();
  await engageAutoPostsQueue.upsertJobScheduler(
    "engage-auto-posts-daily",
    { pattern: `0 ${dailyRunHour} * * *`, tz: "Asia/Kolkata" },
    { name: "run-daily-engage-auto-posts" },
  );
  logger.info(`Registered repeatable job: engage-auto-posts (${String(dailyRunHour).padStart(2, "0")}:00 IST daily)`);
}
