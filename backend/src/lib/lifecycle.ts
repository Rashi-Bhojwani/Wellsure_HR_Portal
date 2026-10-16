import { env } from "../config/env";
import { logger } from "./logger";

// Graceful shutdown under ECS. A rolling deploy (or a scale-in) sends SIGTERM to a task that is still in the load balancer's target group;
// ECS force-kills it after the service's stop timeout. So on SIGTERM a task must:
//   1. start failing /ready (and ask clients to reconnect elsewhere) while it still serves everything it already has, for a short drain period,
//      so the load balancer takes it out of rotation before it stops listening;
//   2. stop listening, let requests already in progress finish, close its connections, and exit 0;
//   3. exit anyway if that takes longer than the hard limit, which is under the stop timeout, so the exit is ours and is logged.

let draining = false;
export const isDraining = (): boolean => draining;
export function startDraining(): void {
  draining = true;
}
/** Test-only. */
export function resetDrainingForTests(): void {
  draining = false;
}

export const drainMs = (): number => (env.SHUTDOWN_DRAIN_SECONDS ?? (env.APP_ENV === "development" ? 0 : 10)) * 1000;
export const hardLimitMs = (): number => (env.SHUTDOWN_HARD_LIMIT_SECONDS ?? 25) * 1000;

export type ShutdownOptions = {
  signal: string;
  /** Closes everything, in order. Each step runs only after the previous finished. */
  steps: Array<() => Promise<unknown>>;
  drainMs?: number;
  hardLimitMs?: number;
  exit?: (code: number) => void;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function gracefulShutdown(opts: ShutdownOptions): Promise<void> {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  logger.info({ signal: opts.signal }, "shutting down");
  startDraining();
  const limit = setTimeout(() => {
    logger.error("shutdown took longer than the hard limit; exiting");
    exit(1);
  }, opts.hardLimitMs ?? hardLimitMs());
  limit.unref();
  try {
    const wait = opts.drainMs ?? drainMs();
    if (wait > 0) await sleep(wait);
    for (const step of opts.steps) await step();
    clearTimeout(limit);
    logger.info("shutdown complete");
    exit(0);
  } catch (err) {
    clearTimeout(limit);
    logger.error({ err }, "error during shutdown");
    exit(1);
  }
}
