import { createServer } from "node:http";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { closePdfRenderer } from "../lib/pdf/renderer";
import { closeLettersQueue } from "../jobs/lettersQueue";
import { redis } from "../lib/redis";
import { createApp } from "../app";
import { assertLeastPrivilegedDatabaseRole } from "../lib/dbRoles";
import { initFieldEncryption } from "../lib/fieldKeys";
import { gracefulShutdown } from "../lib/lifecycle";
import { createSocketServer } from "../realtime/socket";
import { registerAttendanceEngine } from "../modules/attendance/wiring";
import { registerPayrollSeams } from "../modules/payroll/wiring";
import { closeAttendanceQueues } from "../jobs/attendanceQueues";
import { closePayrollQueues } from "../jobs/payrollQueues";

export async function runApi(): Promise<void> {
  await assertLeastPrivilegedDatabaseRole(prisma, env.APP_ENV); // outside development: not as a role that could rewrite the audit trail
  await initFieldEncryption(); // unwraps the data keys once; refuses to start without them
  await redis.connect();
  registerAttendanceEngine();
  registerPayrollSeams();

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
    await gracefulShutdown({
      signal,
      steps: [
        // Disconnect the websocket clients and stop listening (socket.io's close() closes the HTTP server too); requests already in progress run to
        // completion, and idle keep-alive connections are closed so the server can finish closing.
        () =>
          new Promise<void>((resolve) => {
            io.close(() => resolve());
            httpServer.closeIdleConnections();
          }),
        closePdfRenderer, // letters/preview may have Chromium open
        closeLettersQueue,
        closeAttendanceQueues,
        closePayrollQueues,
        () => prisma.$disconnect(),
        async () => redis.disconnect(),
      ],
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
