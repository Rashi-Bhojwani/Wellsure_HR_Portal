import { Worker } from "bullmq";
import { createBullConnection } from "../lib/redis";
import { logger } from "../lib/logger";

// Starts every BullMQ worker this service runs. Only `system-ping` exists
// today — real workers (attendance recompute, leave accrual, etc.) are
// added here starting Phase 2.
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

  return [pingWorker];
}
