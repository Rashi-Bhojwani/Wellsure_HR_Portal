import { Worker } from "bullmq";
import { createBullConnection } from "../lib/redis";
import { logger } from "../lib/logger";
import { businessToday, startOfMonthUTC } from "../lib/businessDate";
import { processScheduledSeparations } from "../modules/employee/separations";
import { runMonthlyPlAccrual } from "../modules/leave/accrual";
import { expireCompOffCredits } from "../modules/leave/compOff";
import { runDailyAutoPosts } from "../modules/engage/autoPosts";
import { autoCloseResolvedTickets } from "../modules/helpdesk/service";

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

  return [pingWorker, separationsWorker, leavePlAccrualWorker, compOffExpiryWorker, engageAutoPostsWorker, helpdeskAutoCloseWorker];
}
