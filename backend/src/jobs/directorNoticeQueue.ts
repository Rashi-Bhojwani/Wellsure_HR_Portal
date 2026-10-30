import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// Director-action notices (docs/plans/DIRECTOR_AUTHORITY.md §6). Written with the act; delivered afterwards, here, so a mail outage can never undo or block an act.
//   "deliver": one notice, to each other director: the bell, the realtime nudge and an e-mail. Retried.
//   "sweep":   hourly: delivers what was never delivered, and raises the red banner for a notice left unacknowledged past the escalation days.
export const DIRECTOR_NOTICE_QUEUE = "director-notices";
export const DIRECTOR_NOTICE_RETRY = { attempts: 12, backoff: { type: "exponential" as const, delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 1000 };

let queue: Queue | null = null;
export function directorNoticeQueue(): Queue {
  queue ??= new Queue(DIRECTOR_NOTICE_QUEUE, { connection: createBullConnection() });
  return queue;
}

export async function closeDirectorNoticeQueue(): Promise<void> {
  const q = queue;
  queue = null;
  if (q) await q.close();
}
