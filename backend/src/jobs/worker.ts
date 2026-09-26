import { Worker } from "bullmq";
import { createBullConnection } from "../lib/redis";
import { logger } from "../lib/logger";
import { processScheduledSeparations } from "../modules/employee/separations";

// Starts every BullMQ worker this service runs. Real workers (attendance
// recompute, leave accrual, etc.) are added here starting Phase 2.
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

  return [pingWorker, separationsWorker];
}
