import { logger } from "../lib/logger";

// Registers BullMQ repeatable jobs. Idempotent registration matters here —
// see docs/PROJECT_SPEC.md §15.2.3 (the scheduler service always runs
// exactly one task). No repeatable jobs exist yet: monthly PL accrual,
// the nightly attendance cron, daily Engage auto-posts and comp-off
// expiry are registered here starting Phase 2/4/5.
export async function registerScheduledJobs(): Promise<void> {
  logger.info("No repeatable jobs registered yet (added starting Phase 2)");
}
