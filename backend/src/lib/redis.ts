import Redis from "ioredis";
import { env } from "../config/env";

// Plain client for app-level use (cache, pub/sub, readiness checks).
// FIX-M3 (independent audit 2026-11-20): with Redis down, ioredis's defaults (20 retries per command, no timeout) made /ready and every sign-in hang for over 10 s.
// A command now fails after 1.5 s and is retried at most once; reconnection keeps trying in the background.
export const REDIS_COMMAND_TIMEOUT_MS = 1500;
export const redis = new Redis(env.REDIS_URL, { lazyConnect: true, commandTimeout: REDIS_COMMAND_TIMEOUT_MS, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: (times) => Math.min(times * 200, 2000) });

/** FIX-M3: a promise that rejects after `ms` (for checks that must answer quickly whatever the dependency does). */
export function withTimeout<T>(p: Promise<T>, ms: number, what = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

// BullMQ requires its own connection with maxRetriesPerRequest disabled —
// see https://docs.bullmq.io/guide/going-to-production#maxretriesperrequest
export function createBullConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
}
