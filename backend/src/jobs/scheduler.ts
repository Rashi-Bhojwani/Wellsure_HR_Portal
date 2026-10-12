import { logger } from "../lib/logger";
import { getDailyRunHour } from "../modules/engage/autoPostSettings";
import { getSetting } from "../lib/settings";
import { MANUAL_REMINDER_HOUR_KEY } from "../modules/attendance/manual/reminder";
import { attendanceDeviceHealthQueue, attendanceManualReminderQueue, attendanceNightlyQueue } from "./attendanceQueues";
import { compOffExpiryQueue, employeeSeparationsQueue, historyRolloverQueue, engageAutoPostsQueue, helpdeskAutoCloseQueue, leavePlAccrualQueue } from "./queues";

// Registers BullMQ repeatable jobs. Idempotent registration matters here —
// see docs/PROJECT_SPEC.md §15.2.3 (the scheduler service always runs
// exactly one task) — BullMQ itself de-dupes a repeatable job by its
// {jobId, pattern} pair, so calling this on every scheduler boot is safe.
// The nightly attendance cron and daily Engage auto-posts are registered
// here starting Phase 2/5.
export async function registerScheduledJobs(): Promise<void> {
  // Attendance nightly (Phase 2 P2-C): finalises yesterday (and catches up any
  // missed nights) once every GEN shift window has closed (01:00).
  await attendanceNightlyQueue().upsertJobScheduler("attendance-nightly", { pattern: "0 2 * * *", tz: "Asia/Kolkata" }, { name: "attendance-nightly" });
  logger.info("Registered repeatable job: attendance-nightly (02:00 IST daily)");
  // "Still not marked" to whoever marks a manual branch (P2-D). The hour is
  // the System Setting attendance.manualReminderHour (default 18), read at
  // registration like the Engage hour below: a change applies on restart.
  const stored = Number(await getSetting<number | string>(MANUAL_REMINDER_HOUR_KEY, 18));
  const reminderHour = Number.isInteger(stored) && stored >= 0 && stored <= 23 ? stored : 18;
  await attendanceManualReminderQueue().upsertJobScheduler("attendance-manual-reminder", { pattern: `0 ${reminderHour} * * *`, tz: "Asia/Kolkata" }, { name: "attendance-manual-reminder" });
  logger.info(`Registered repeatable job: attendance-manual-reminder (${String(reminderHour).padStart(2, "0")}:00 IST daily)`);

  // Device and agent health (P2-H): cheap queries on timestamps, every minute. The thresholds are read each run, so a change in System Settings applies at once.
  await attendanceDeviceHealthQueue().upsertJobScheduler("attendance-device-health", { pattern: "* * * * *", tz: "Asia/Kolkata" }, { name: "attendance-device-health" });
  logger.info("Registered repeatable job: attendance-device-health (every minute)");

  await historyRolloverQueue.upsertJobScheduler(
    "history-rollover-daily",
    { pattern: "5 0 * * *", tz: "Asia/Kolkata" }, // 00:05 IST daily (EF3)
    { name: "process-history-rollover" },
  );
  logger.info("Registered repeatable job: history-rollover (00:05 IST daily)");

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

  await helpdeskAutoCloseQueue.upsertJobScheduler(
    "helpdesk-auto-close-hourly",
    { pattern: "5 * * * *", tz: "Asia/Kolkata" }, // :05 past every hour
    { name: "auto-close-resolved-tickets" },
  );
  logger.info("Registered repeatable job: helpdesk-auto-close (hourly at :05)");

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
