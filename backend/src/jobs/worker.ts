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
import { DIRECTOR_NOTICE_QUEUE } from "./directorNoticeQueue";
import { REMOTE_REMINDER_QUEUE } from "./remoteQueue";
import { sendDueReminders } from "../modules/attendance/remote/service";
import { HR_CAPABILITY_QUEUE } from "./hrCapabilityQueue";
import { notifySubjectAccessChanged } from "../modules/hrCapabilities/service";
import { deliverDirectorNotice, sweepDirectorNotices } from "../lib/directorNotices";
import { mailService, type MailMessage } from "../integrations/mail";
import { ATTENDANCE_DEVICE_HEALTH_QUEUE, ATTENDANCE_MANUAL_REMINDER_QUEUE, ATTENDANCE_NIGHTLY_QUEUE, ATTENDANCE_PROCESS_QUEUE, ATTENDANCE_RECOMPUTE_QUEUE } from "./attendanceQueues";
import { runManualReminder } from "../modules/attendance/manual/reminder";
import { processRecomputeJob, runNightly } from "../modules/attendance/jobs";
import { executeProcessRun } from "../modules/attendance/processService";
import { runDeviceHealthChecks } from "../modules/biometric/health/runner";
import { PAYROLL_CALCULATE_QUEUE, PAYROLL_PAYSLIPS_QUEUE } from "./payrollQueues";
import { deliverPayslips } from "../modules/payroll/run/payslipDelivery";
import { executeCalculation } from "../modules/payroll/run/engine";

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
  // Device and agent health (P2-H): one check at a time, never two overlapping.
  const deviceHealthWorker = new Worker(
    ATTENDANCE_DEVICE_HEALTH_QUEUE,
    async () => {
      const r = await runDeviceHealthChecks();
      if (r.opened.length || r.resolved.length || r.notified.opened || r.notified.escalated || r.notified.recovered) logger.info({ ...r }, "device health check changed something");
      return r;
    },
    { connection: createBullConnection(), concurrency: 1 },
  );
  deviceHealthWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "attendance-device-health job failed"));

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

  const remoteReminderWorker = new Worker(
    REMOTE_REMINDER_QUEUE,
    async (job) => {
      const sent = await sendDueReminders();
      logger.info({ jobId: job.id, sent }, "remote attendance reminders processed");
      return { sent };
    },
    { connection: createBullConnection() },
  );
  remoteReminderWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "remote attendance reminder job failed"));

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

  // D1 (docs/plans/DIRECTOR_AUTHORITY.md §6): what a director's act tells the other director, delivered after the act has committed, and the hourly sweep that
  // retries undelivered notices and raises the red banner for one left unacknowledged past the escalation days.
  const directorNoticeWorker = new Worker(
    DIRECTOR_NOTICE_QUEUE,
    async (job) => {
      if (job.name === "sweep") return sweepDirectorNotices();
      return deliverDirectorNotice((job.data as { noticeId: string }).noticeId);
    },
    { connection: createBullConnection() },
  );
  directorNoticeWorker.on("failed", (job, err) => logger.error({ event: "director.notice.job_failed", jobId: job?.id, err }, "director notice job failed"));

  // Stage 1: an HR capability switch with a future start takes effect for sockets and menus at its own moment (access is resolved from the rows on every request regardless).
  const hrCapabilityWorker = new Worker(
    HR_CAPABILITY_QUEUE,
    async (job) => notifySubjectAccessChanged((job.data as { subjectKind: string; subjectKey: string }).subjectKind, (job.data as { subjectKind: string; subjectKey: string }).subjectKey),
    { connection: createBullConnection() },
  );
  hrCapabilityWorker.on("failed", (job, err) => logger.error({ event: "hr.capability.activate_failed", jobId: job?.id, err }, "hr capability activation job failed"));

  // Payroll (Phase 6 P6-3): one calculation at a time per worker. The job id is the lease owner, so BullMQ handing a stalled job to this worker again
  // takes the run over at once instead of waiting for the lease to run out.
  const payrollCalculateWorker = new Worker(PAYROLL_CALCULATE_QUEUE, async (job) => executeCalculation((job.data as { runId: string }).runId, `job-${job.id}`), { connection: createBullConnection(), concurrency: 1 });
  payrollCalculateWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "payroll-calculate job failed"));
  const payrollPayslipsWorker = new Worker(PAYROLL_PAYSLIPS_QUEUE, async (job) => deliverPayslips((job.data as { runId: string }).runId), { connection: createBullConnection(), concurrency: 1 });
  payrollPayslipsWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "payroll-payslips job failed"));

  return [pingWorker, rolloverWorker, separationsWorker, leavePlAccrualWorker, compOffExpiryWorker, engageAutoPostsWorker, helpdeskAutoCloseWorker, lettersWorker, securityAlertWorker, recomputeWorker, nightlyWorker, processWorker, reminderWorker, deviceHealthWorker, payrollCalculateWorker, payrollPayslipsWorker, directorNoticeWorker, hrCapabilityWorker, remoteReminderWorker];
}
