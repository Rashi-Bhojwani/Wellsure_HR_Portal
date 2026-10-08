import { closeAttendanceQueues } from "../jobs/attendanceQueues";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { registerScheduledJobs } from "../jobs/scheduler";

// Exactly one instance of this mode runs at a time (spec §15.2.3) —
// registration must stay idempotent as real repeatable jobs are added.
export async function runScheduler(): Promise<void> {
  await redis.connect();
  await registerScheduledJobs();
  logger.info("scheduler ready");

  // Nothing to poll yet — BullMQ's repeatable-job scheduling runs inside
  // the queue, not this process. Stay alive so the container doesn't
  // exit; replaced by real scheduling heartbeats/metrics in Phase 2+.
  const heartbeat = setInterval(() => logger.debug("scheduler heartbeat"), 60_000);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    clearInterval(heartbeat);
    await closeAttendanceQueues();
    await prisma.$disconnect();
    redis.disconnect();

    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
