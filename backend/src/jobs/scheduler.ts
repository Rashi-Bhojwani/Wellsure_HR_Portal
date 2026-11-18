import { logger } from "../lib/logger";
import { getDailyRunHour } from "../modules/engage/autoPostSettings";
import { scheduleTimedJob } from "../modules/settings/schedulesLimits";
import { directorNoticeQueue } from "./directorNoticeQueue";
import { remoteReminderQueue } from "./remoteQueue";
import { attendanceDeviceHealthQueue } from "./attendanceQueues";
import { compOffExpiryQueue, employeeSeparationsQueue, historyRolloverQueue, engageAutoPostsQueue, helpdeskAutoCloseQueue, leavePlAccrualQueue } from "./queues";

// Registers BullMQ repeatable jobs. Idempotent registration matters here —
// see docs/PROJECT_SPEC.md §15.2.3 (the scheduler service always runs
// exactly one task) — BullMQ itself de-dupes a repeatable job by its
// {jobId, pattern} pair, so calling this on every scheduler boot is safe.
// The nightly attendance cron and daily Engage auto-posts are registered
// here starting Phase 2/5.
export async function registerScheduledJobs(): Promise<void> {
  // Attendance nightly (Phase 2 P2-C) and the "still not marked" reminder (P2-D): their hours are System Settings, Schedules and limits (audit fix 2026-11-18,
  // #14 and A-17; defaults 02:00 and 18:00). Registered from the setting here; a director's change reschedules the job at once (modules/settings/schedulesLimits.ts).
  for (const key of ["attendance.nightlyHour", "attendance.manualReminderHour"]) logger.info(`Registered repeatable job for ${key}: ${await scheduleTimedJob(key)} (IST)`);

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

  // RP-13 (M session): scheduled reports (WEEKLY ones go on Mondays, MONTHLY on the 1st), and the daily people job. Their times are settings (audit A-21;
  // defaults 07:41 and 08:13), rescheduled at once when changed.
  for (const key of ["reports.subscriptionsTime", "people.dailyJobTime"]) logger.info(`Registered repeatable job for ${key}: ${await scheduleTimedJob(key)} (IST)`);

  // Remote attendance reminders: hourly; a no-op while the threshold is Not set.
  await remoteReminderQueue().upsertJobScheduler("remote-attendance-reminder-hourly", { pattern: "40 * * * *", tz: "Asia/Kolkata" }, { name: "remind" });
  logger.info("Registered repeatable job: remote attendance reminders (hourly at :40)");

  // Director-action notices (D1): hourly, retry what was not delivered and escalate what nobody acknowledged (default after 3 days, SystemSetting).
  await directorNoticeQueue().upsertJobScheduler("director-notice-sweep-hourly", { pattern: "20 * * * *", tz: "Asia/Kolkata" }, { name: "sweep" });
  logger.info("Registered repeatable job: director-notices sweep (hourly at :20)");

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
