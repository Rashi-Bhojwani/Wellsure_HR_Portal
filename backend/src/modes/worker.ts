import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { closePdfRenderer } from "../lib/pdf/renderer";
import { redis } from "../lib/redis";
import { startSocketEmitter, stopSocketEmitter } from "../realtime/emitter";
import { startWorkers } from "../jobs/worker";
import { registerAttendanceEngine } from "../modules/attendance/wiring";
import { closeAttendanceQueues } from "../jobs/attendanceQueues";

export async function runWorker(): Promise<void> {
  await redis.connect();
  await startSocketEmitter(); // live events from jobs reach the api's clients
  registerAttendanceEngine(); // jobs that change data (e.g. separations) ask for recompute too
  const workers = startWorkers();
  logger.info({ count: workers.length }, "worker started");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    await Promise.all(workers.map((w) => w.close()));
    await closeAttendanceQueues();
    await closePdfRenderer(); // letters/preview may have Chromium open
    await stopSocketEmitter();
    await prisma.$disconnect();
    redis.disconnect();

    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
