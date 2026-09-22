import Redis from "ioredis";
import { env } from "../config/env";

// Plain client for app-level use (cache, pub/sub, readiness checks).
export const redis = new Redis(env.REDIS_URL, { lazyConnect: true });

// BullMQ requires its own connection with maxRetriesPerRequest disabled —
// see https://docs.bullmq.io/guide/going-to-production#maxretriesperrequest
export function createBullConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
}
