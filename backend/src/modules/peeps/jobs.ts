import { Queue, Worker } from "bullmq";
import { createBullConnection } from "../../lib/redis";
import { logger } from "../../lib/logger";
import { applyDueChanges } from "./office";

// The one scheduled job Peeps runs: apply Wellsure Office membership changes whose effective time has come (D-30). Registered from modes/scheduler.ts
// and worked from modes/worker.ts (both inside PEEPS blocks).
export const PEEPS_OFFICE_QUEUE = "peeps-office-apply";

let queue: Queue | null = null;
const officeQueue = (): Queue => (queue ??= new Queue(PEEPS_OFFICE_QUEUE, { connection: createBullConnection() }));

export async function registerPeepsScheduledJobs(): Promise<void> {
  await officeQueue().upsertJobScheduler("peeps-office-apply", { pattern: "* * * * *", tz: "Asia/Kolkata" }, { name: "peeps-office-apply" });
  logger.info("Registered repeatable job: peeps-office-apply (every minute)");
}

export function startPeepsWorkers(): Worker[] {
  const worker = new Worker(PEEPS_OFFICE_QUEUE, async () => applyDueChanges(), { connection: createBullConnection() });
  worker.on("failed", (job, err) => logger.error({ event: "peeps.office.apply_failed", jobId: job?.id, err }, "peeps office apply job failed"));
  return [worker];
}

export async function closePeepsQueues(): Promise<void> {
  const q = queue;
  queue = null;
  if (q) await q.close();
}
