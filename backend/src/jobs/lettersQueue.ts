import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// On demand: renders an issued letter to PDF and files it in the employee's
// documents (modules/letters/service.ts). Created on first use, so the API
// process (and every test that imports the app) doesn't open a Redis
// connection for it until a letter is actually issued.
export const LETTERS_QUEUE_NAME = "letters-generate";
let queue: Queue | null = null;

export function lettersGenerateQueue(): Queue {
  queue ??= new Queue(LETTERS_QUEUE_NAME, { connection: createBullConnection() });
  return queue;
}

export async function closeLettersQueue(): Promise<void> {
  const q = queue;
  queue = null;
  if (q) await q.close();
}
