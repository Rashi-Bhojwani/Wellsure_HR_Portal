import { Queue } from "bullmq";
import { createBullConnection } from "../lib/redis";

// Attendance queues (Phase 2 P2-C, docs/plans/PHASE_2.md §4.1). Created on
// first use, like letters-generate, so processes that never enqueue (and
// tests) don't open Redis connections for them.
//   attendance-recompute: one employee's date range, debounced 1 s per range
//   attendance-nightly:   02:00 IST — yesterday (and any missed nights) for everyone
//   attendance-process:   a Process Attendance run, in the background with progress
//   attendance-manual-reminder: daily, "still not marked" to branch markers (P2-D)
//   attendance-device-health: every minute, opens/closes device and agent incidents and tells HR (P2-H)
export const ATTENDANCE_RECOMPUTE_QUEUE = "attendance-recompute";
export const ATTENDANCE_NIGHTLY_QUEUE = "attendance-nightly";
export const ATTENDANCE_PROCESS_QUEUE = "attendance-process";
export const ATTENDANCE_MANUAL_REMINDER_QUEUE = "attendance-manual-reminder";
export const ATTENDANCE_DEVICE_HEALTH_QUEUE = "attendance-device-health";

const queues = new Map<string, Queue>();
function lazy(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: createBullConnection() });
    queues.set(name, q);
  }
  return q;
}

export const attendanceRecomputeQueue = () => lazy(ATTENDANCE_RECOMPUTE_QUEUE);
export const attendanceNightlyQueue = () => lazy(ATTENDANCE_NIGHTLY_QUEUE);
export const attendanceProcessQueue = () => lazy(ATTENDANCE_PROCESS_QUEUE);
export const attendanceManualReminderQueue = () => lazy(ATTENDANCE_MANUAL_REMINDER_QUEUE);
export const attendanceDeviceHealthQueue = () => lazy(ATTENDANCE_DEVICE_HEALTH_QUEUE);

export async function closeAttendanceQueues(): Promise<void> {
  const all = [...queues.values()];
  queues.clear();
  await Promise.all(all.map((q) => q.close()));
}
