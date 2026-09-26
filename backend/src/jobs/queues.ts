import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// BullMQ skeleton. `system-ping` is a trivial job that only proves the
// queue/worker/Redis wiring works end to end — the real queues
// (attendance.recompute, leave accrual, etc.) start in Phase 2+.
export const systemPingQueue = new Queue("system-ping", { connection: createBullConnection() });

// Daily: completes any INITIATED separation whose last working date has
// passed (spec §3.8) — see modules/employee/separations.ts.
export const employeeSeparationsQueue = new Queue("employee-separations", { connection: createBullConnection() });
