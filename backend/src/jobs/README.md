# jobs

BullMQ queues, workers and repeatable-job (scheduler) definitions:
attendance recompute (debounced per employee/date), the nightly attendance
cron, monthly PL accrual, comp-off expiry, daily Engage auto-posts, and
scheduled report emails. See spec §4.3, §5.5, §8 — Phase 2 onward.

`payroll-calculate` (Phase 6, P6-3): one payroll run's calculation. The job takes a lease on the run, works it out in memory, writes the people in chunks of 50 (each chunk in one transaction, stamped with the run's calculation version) and can be run again after a crash: it writes only the people not yet written, and starts over if the rules or inputs moved. `payrollQueues.ts` creates the queue on first use; the worker is in `worker.ts`.
