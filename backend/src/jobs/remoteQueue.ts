import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// Remote attendance reminders (docs/plans/STAGE_5A_PLAN.md): hourly, tells the directors about records waiting longer than the threshold a director set. With the
// threshold Not set the job runs and does nothing.
export const REMOTE_REMINDER_QUEUE = "remote-attendance-reminders";

let queue: Queue | null = null;
export function remoteReminderQueue(): Queue {
  queue ??= new Queue(REMOTE_REMINDER_QUEUE, { connection: createBullConnection() });
  return queue;
}
