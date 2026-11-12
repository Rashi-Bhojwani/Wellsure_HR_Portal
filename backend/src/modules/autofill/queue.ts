import { Queue } from "bullmq";
import { createBullConnection } from "../../lib/redis";

// Autofill extraction queue. The job data is the extraction id ONLY (never a file, a value or a name); the job id is the same id,
// so a duplicate enqueue while a job is waiting is dropped by BullMQ. Created on first use (no Redis connection at import).
export const AUTOFILL_QUEUE_NAME = "autofill-extract";
let queue: Queue | null = null;
export function autofillQueue(): Queue {
  queue ??= new Queue(AUTOFILL_QUEUE_NAME, { connection: createBullConnection(), defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: 100 } });
  return queue;
}
export async function enqueueExtraction(extractionId: string): Promise<void> {
  await autofillQueue().add("extract", { extractionId }, { jobId: `autofill-${extractionId}-${Date.now()}` });
}
export async function closeAutofillQueue(): Promise<void> {
  const q = queue;
  queue = null;
  if (q) await q.close();
}
