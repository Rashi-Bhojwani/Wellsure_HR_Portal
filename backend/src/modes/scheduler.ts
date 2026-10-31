import { env } from "../config/env";
import { closeAttendanceQueues } from "../jobs/attendanceQueues";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { assertLeastPrivilegedDatabaseRole } from "../lib/dbRoles";
import { assertNoDemoCompany } from "../lib/demoGuard";
import { initFieldEncryption } from "../lib/fieldKeys";
import { gracefulShutdown } from "../lib/lifecycle";
import { redis } from "../lib/redis";
import { registerScheduledJobs } from "../jobs/scheduler";

// Exactly one instance of this mode runs at a time (spec §15.2.3) —
// registration must stay idempotent as real repeatable jobs are added.
export async function runScheduler(): Promise<void> {
  await assertLeastPrivilegedDatabaseRole(prisma, env.APP_ENV); // outside development: not as a role that could rewrite the audit trail
  await assertNoDemoCompany(prisma, env.APP_ENV); // outside development: never with the made-up demo company in the database
  await initFieldEncryption();
  await redis.connect();
  await registerScheduledJobs();
  // PEEPS-BEGIN office-unmute
  await (await import("../modules/peeps/jobs")).registerPeepsScheduledJobs();
  // PEEPS-END
  logger.info("scheduler ready");

  // Nothing to poll yet — BullMQ's repeatable-job scheduling runs inside
  // the queue, not this process. Stay alive so the container doesn't
  // exit; replaced by real scheduling heartbeats/metrics in Phase 2+.
  const heartbeat = setInterval(() => logger.debug("scheduler heartbeat"), 60_000);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await gracefulShutdown({
      signal,
      drainMs: 0,
      steps: [async () => clearInterval(heartbeat), closeAttendanceQueues, () => prisma.$disconnect(), async () => redis.disconnect()],
    });
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
