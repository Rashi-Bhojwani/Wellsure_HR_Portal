import { createServer } from "node:http";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { closePdfRenderer } from "../lib/pdf/renderer";
import { closeLettersQueue } from "../jobs/lettersQueue";
import { redis } from "../lib/redis";
import { createApp } from "../app";
import { createSocketServer } from "../realtime/socket";
import { registerAttendanceEngine } from "../modules/attendance/wiring";
import { closeAttendanceQueues } from "../jobs/attendanceQueues";

export async function runApi(): Promise<void> {
  await redis.connect();
  registerAttendanceEngine();

  const app = createApp();
  const httpServer = createServer(app);
  const io = await createSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`api listening on :${env.PORT} (${env.APP_ENV})`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    await new Promise<void>((resolve) => io.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closePdfRenderer(); // letters/preview may have Chromium open
    await closeLettersQueue();
    await closeAttendanceQueues();
    await prisma.$disconnect();
    redis.disconnect();

    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
