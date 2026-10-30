import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// HR capability switches with a future start (docs/plans/HR_CAPABILITIES.md §1B). Access itself is always right (it is resolved from the rows on every request); this job only moves
// the person's live sockets into or out of the permission rooms and tells their browser to refetch its menu at the moment the switch takes effect.
export const HR_CAPABILITY_QUEUE = "hr-capability-activate";

let queue: Queue | null = null;
export function hrCapabilityQueue(): Queue {
  queue ??= new Queue(HR_CAPABILITY_QUEUE, { connection: createBullConnection() });
  return queue;
}

export async function closeHrCapabilityQueue(): Promise<void> {
  const q = queue;
  queue = null;
  if (q) await q.close();
}
