import { processHistoryRollover } from "../modules/employee/scheduledChanges";
import { Worker } from "bullmq";
import { createBullConnection } from "../lib/redis";
import { logger } from "../lib/logger";
import { businessToday, startOfMonthUTC } from "../lib/businessDate";
import { processScheduledSeparations } from "../modules/employee/separations";
import { runMonthlyPlAccrual } from "../modules/leave/accrual";
import { expireCompOffCredits } from "../modules/leave/compOff";
import { runDailyAutoPosts } from "../modules/engage/autoPosts";
import { autoCloseResolvedTickets } from "../modules/helpdesk/service";
import { processLetterJob } from "../modules/letters/service";
import { LETTERS_QUEUE_NAME } from "./lettersQueue";
import { SECURITY_ALERT_QUEUE_NAME } from "./securityAlertQueue";
import { mailService, type MailMessage } from "../integrations/mail";
import { ATTENDANCE_MANUAL_REMINDER_QUEUE, ATTENDANCE_NIGHTLY_QUEUE, ATTENDANCE_PROCESS_QUEUE, ATTENDANCE_RECOMPUTE_QUEUE } from "./attendanceQueues";
import { runManualReminder } from "../modules/attendance/manual/reminder";
import { processRecomputeJob, runNightly } from "../modules/attendance/jobs";
import { executeProcessRun } from "../modules/attendance/processService";

// Starts every BullMQ worker this service runs. Real workers (attendance
// recompute, etc.) are added here starting Phase 2.
export function startWorkers(): Worker[] {
  const pingWorker = new Worker(
    "system-ping",
    async (job) => {
      logger.debug({ jobId: job.id, data: job.data }, "system-ping processed");
      return { pong: true, at: new Date().toISOString() };
    },
    { connection: createBullConnection() },
  );
  pingWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "system-ping job failed");
  });

  // Attendance (Phase 2 P2-C). Recompute jobs run a few at a time; a
  // Process Attendance run or the nightly is one long job.
  const recomputeWorker = new Worker(
    ATTENDANCE_RECOMPUTE_QUEUE,
    async (job) => processRecomputeJob(job.data as { employeeId?: string; from: string; to: string }),
    { connection: createBullConnection(), concurrency: 4 },
  );
  recomputeWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "attendance-recompute job failed"));
  const nightlyWorker = new Worker(ATTENDANCE_NIGHTLY_QUEUE, async () => runNightly(), { connection: createBullConnection() });
  nightlyWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "attendance-nightly job failed"));
  const processWorker = new Worker(ATTENDANCE_PROCESS_QUEUE, async (job) => executeProcessRun((job.data as { runId: string }).runId), { connection: createBullConnection() });
  processWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "attendance-process job failed"));
  const reminderWorker = new Worker(ATTENDANCE_MANUAL_REMINDER_QUEUE, async () => runManualReminder(), { connection: createBullConnection() });
  reminderWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "attendance-manual-reminder job failed"));

  const rolloverWorker = new Worker(
    "history-rollover",
    async (job) => {
      const result = await processHistoryRollover();
      logger.info({ jobId: job.id, ...result }, "history-rollover processed");
      return result;
    },
    { connection: createBullConnection() },
  );
  rolloverWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "history-rollover job failed");
  });

  const separationsWorker = new Worker(
    "employee-separations",
    async (job) => {
      const result = await processScheduledSeparations();
      logger.info({ jobId: job.id, ...result }, "employee-separations processed");
      return result;
    },
    { connection: createBullConnection() },
  );
  separationsWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "employee-separations job failed");
  });

  const leavePlAccrualWorker = new Worker(
    "leave-pl-accrual",
    async (job) => {
      // Runs exactly on the 1st per the scheduler's cron pattern — the
      // credited month is always "today's" month at run time. A retried
      // or manually re-triggered run recomputes the same month and is a
      // no-op per employee already credited (accrualMonth idempotency).
      const accrualMonth = startOfMonthUTC(businessToday());
      const result = await runMonthlyPlAccrual(accrualMonth);
      logger.info({ jobId: job.id, ...result }, "leave-pl-accrual processed");
      return result;
    },
    { connection: createBullConnection() },
  );
  leavePlAccrualWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "leave-pl-accrual job failed");
  });

  const compOffExpiryWorker = new Worker(
    "comp-off-expiry",
    async (job) => {
      const result = await expireCompOffCredits(businessToday());
      logger.info({ jobId: job.id, ...result }, "comp-off-expiry processed");
      return result;
    },
    { connection: createBullConnection() },
  );
  compOffExpiryWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "comp-off-expiry job failed");
  });

  const engageAutoPostsWorker = new Worker(
    "engage-auto-posts",
    async (job) => {
      const result = await runDailyAutoPosts(businessToday());
      logger.info({ jobId: job.id, ...result }, "engage-auto-posts processed");
      return result;
    },
    { connection: createBullConnection() },
  );
  engageAutoPostsWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "engage-auto-posts job failed");
  });

  const helpdeskAutoCloseWorker = new Worker(
    "helpdesk-auto-close",
    async (job) => {
      const result = await autoCloseResolvedTickets(new Date());
      logger.info({ jobId: job.id, ...result }, "helpdesk-auto-close processed");
      return result;
    },
    { connection: createBullConnection() },
  );
  helpdeskAutoCloseWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "helpdesk-auto-close job failed");
  });

  const lettersWorker = new Worker(
    LETTERS_QUEUE_NAME,
    async (job) => {
      const result = await processLetterJob(job.data.letterId as string);
      logger.info({ jobId: job.id, ...result }, "letters-generate processed");
      return result;
    },
    // One Chromium render at a time per worker keeps memory predictable.
    { connection: createBullConnection(), concurrency: 1 },
  );
  lettersWorker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "letters-generate job failed");
  });

  // E1.1: a break-glass alert email that failed when the CLI ran. Throwing
  // makes BullMQ retry it (SECURITY_ALERT_RETRY).
  const securityAlertWorker = new Worker(
    SECURITY_ALERT_QUEUE_NAME,
    async (job) => {
      await mailService.send(job.data as MailMessage);
      logger.warn({ event: "security.breakglass.alert_delivered_late", to: (job.data as MailMessage).to, attempt: job.attemptsMade + 1 }, "queued break-glass alert email delivered");
    },
    { connection: createBullConnection() },
  );
  securityAlertWorker.on("failed", (job, err) => {
    logger.error({ event: "security.breakglass.alert_undelivered", jobId: job?.id, attempt: job?.attemptsMade, err }, "break-glass alert email still not delivered");
  });

  return [pingWorker, rolloverWorker, separationsWorker, leavePlAccrualWorker, compOffExpiryWorker, engageAutoPostsWorker, helpdeskAutoCloseWorker, lettersWorker, securityAlertWorker, recomputeWorker, nightlyWorker, processWorker, reminderWorker];
}
