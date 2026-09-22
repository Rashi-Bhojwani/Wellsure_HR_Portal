import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { startWorkers } from "../jobs/worker";

export async function runWorker(): Promise<void> {
  await redis.connect();
  const workers = startWorkers();
  logger.info({ count: workers.length }, "worker started");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    redis.disconnect();

    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
