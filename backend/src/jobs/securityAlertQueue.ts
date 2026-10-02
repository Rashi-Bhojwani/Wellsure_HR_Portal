import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// Break-glass alert emails that couldn't be sent at the time (E1.1: the CLI
// was run with --mail-is-down). Retried every 5 minutes for 24 hours. Created
// lazily, like lettersQueue, so nothing opens a Redis connection until used.
export const SECURITY_ALERT_QUEUE_NAME = "security-alert-email";
export const SECURITY_ALERT_RETRY = { attempts: 288, backoff: { type: "fixed" as const, delay: 5 * 60 * 1000 } };
let queue: Queue | null = null;

export function securityAlertQueue(): Queue {
  queue ??= new Queue(SECURITY_ALERT_QUEUE_NAME, { connection: createBullConnection() });
  return queue;
}

export async function closeSecurityAlertQueue(): Promise<void> {
  const q = queue;
  queue = null;
  if (q) await q.close();
}
