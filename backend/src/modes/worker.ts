import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { closePdfRenderer } from "../lib/pdf/renderer";
import { assertLeastPrivilegedDatabaseRole } from "../lib/dbRoles";
import { initFieldEncryption } from "../lib/fieldKeys";
import { gracefulShutdown } from "../lib/lifecycle";
import { redis } from "../lib/redis";
import { startSocketEmitter, stopSocketEmitter } from "../realtime/emitter";
import { startWorkers } from "../jobs/worker";
import { registerAttendanceEngine } from "../modules/attendance/wiring";
import { closeAttendanceQueues } from "../jobs/attendanceQueues";
import { metricsService } from "../integrations/metrics";
import { bullCountsFn, startQueueMetrics } from "../jobs/queueMetrics";

export async function runWorker(): Promise<void> {
  await assertLeastPrivilegedDatabaseRole(prisma, env.APP_ENV); // outside development: not as a role that could rewrite the audit trail
  await initFieldEncryption();
  await redis.connect();
  await startSocketEmitter(); // live events from jobs reach the api's clients
  registerAttendanceEngine(); // jobs that change data (e.g. separations) ask for recompute too
  const workers = startWorkers();
  logger.info({ count: workers.length }, "worker started");
  // Backlog, failed-job counts and a heartbeat for the alarms (nothing is published locally).
  const queueCounts = bullCountsFn();
  const stopMetrics = startQueueMetrics(workers.map((w) => w.name), queueCounts.counts, metricsService);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await gracefulShutdown({
      signal,
      drainMs: 0, // nothing routes requests to a worker
      steps: [
        async () => stopMetrics(),
        () => Promise.all(workers.map((w) => w.close())), // waits for the jobs running now to finish
        () => queueCounts.close(),
        closeAttendanceQueues,
        closePdfRenderer, // letters/preview may have Chromium open
        stopSocketEmitter,
        () => prisma.$disconnect(),
        async () => redis.disconnect(),
      ],
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
