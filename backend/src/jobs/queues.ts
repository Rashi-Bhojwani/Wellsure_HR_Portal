import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// BullMQ skeleton. `system-ping` is a trivial job that only proves the
// queue/worker/Redis wiring works end to end — the real queues
// (attendance.recompute, leave accrual, etc.) start in Phase 2+.
export const systemPingQueue = new Queue("system-ping", { connection: createBullConnection() });

// Daily: completes any INITIATED separation whose last working date has
// passed (spec §3.8) — see modules/employee/separations.ts.
export const employeeSeparationsQueue = new Queue("employee-separations", { connection: createBullConnection() });

// 1st of every month: monthly PL accrual, idempotent per employee-month
// (spec §5.5) — see modules/leave/accrual.ts.
export const leavePlAccrualQueue = new Queue("leave-pl-accrual", { connection: createBullConnection() });

// Daily: expires comp-off credits past their configured expiry window
// (spec §5.5) — see modules/leave/compOff.ts.
export const compOffExpiryQueue = new Queue("comp-off-expiry", { connection: createBullConnection() });

// Daily (spec §8's "engage.birthday/.joining/.anniversary | org (daily
// 08:00 cron + on joining)"): scans for today's birthdays and work
// anniversaries — see modules/engage/autoPosts.ts. Joining posts fire on
// the actual joining event (auth/service.ts's acceptInvitation), never on
// this cron.
export const engageAutoPostsQueue = new Queue("engage-auto-posts", { connection: createBullConnection() });

// Hourly: closes Resolved helpdesk tickets whose auto-close time (shown to
// the employee on the ticket) has passed — see modules/helpdesk/service.ts.
// Hourly rather than daily so a ticket closes within the hour of the time
// the employee was shown, not up to a day later.
export const helpdeskAutoCloseQueue = new Queue("helpdesk-auto-close", { connection: createBullConnection() });
