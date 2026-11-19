import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { SCHEDULE_LIMIT_SETTINGS, dailyPattern, scheduleLimitValid, scheduleLimitValue } from "../../lib/schedulesAndLimits";
import { setSetting } from "../../lib/settings";
import { HttpError } from "../../middleware/errorHandler";
import { attendanceManualReminderQueue, attendanceNightlyQueue } from "../../jobs/attendanceQueues";
import { peopleDailyQueue, reportSubscriptionsQueue } from "../../jobs/queues";

// System Settings, "Schedules and limits" (audit fix 2026-11-18, docs/plans/AUDIT_FIXES.md items 5 and 6). settings.manage (the directors; never HR or the
// Developer). A saved time reschedules its job at once (BullMQ job schedulers live in Redis, so the API can move them; the scheduler re-applies them on start).

type Meta = { actorUserId: string; ipAddress?: string | null; userAgent?: string | null };

/** The timed jobs and the setting each follows. Exported so the scheduler registers them the same way. */
export const TIMED_JOBS: ReadonlyArray<{ key: string; id: string; name: string; queue: () => { upsertJobScheduler: (id: string, repeat: { pattern: string; tz: string }, tmpl: { name: string }) => Promise<unknown> } }> = [
  { key: "attendance.nightlyHour", id: "attendance-nightly", name: "attendance-nightly", queue: attendanceNightlyQueue },
  { key: "attendance.manualReminderHour", id: "attendance-manual-reminder", name: "attendance-manual-reminder", queue: attendanceManualReminderQueue },
  { key: "reports.subscriptionsTime", id: "report-subscriptions-daily", name: "send-due-reports", queue: () => reportSubscriptionsQueue },
  { key: "people.dailyJobTime", id: "m-people-daily", name: "people-daily", queue: () => peopleDailyQueue },
];

export async function scheduleTimedJob(key: string): Promise<string> {
  const job = TIMED_JOBS.find((j) => j.key === key);
  if (!job) return "";
  const pattern = dailyPattern(await scheduleLimitValue<number | string>(key));
  await job.queue().upsertJobScheduler(job.id, { pattern, tz: "Asia/Kolkata" }, { name: job.name });
  return pattern;
}

export async function listSchedulesLimits() {
  const stored = new Set((await prisma.systemSetting.findMany({ where: { key: { in: SCHEDULE_LIMIT_SETTINGS.map((d) => d.key) } }, select: { key: true } })).map((r) => r.key));
  return {
    settings: await Promise.all(
      SCHEDULE_LIMIT_SETTINGS.map(async (d) => ({ key: d.key, label: d.label, help: d.help, kind: d.kind, min: d.min ?? null, max: d.max ?? null, value: await scheduleLimitValue(d.key), defaultValue: d.defaultValue, defaultInUse: !stored.has(d.key) })),
    ),
  };
}

export async function setScheduleLimit(key: string, value: unknown, meta: Meta) {
  const def = SCHEDULE_LIMIT_SETTINGS.find((d) => d.key === key);
  if (!def) throw new HttpError(404, "There is no such setting.", "NOT_FOUND");
  if (!scheduleLimitValid(def, value)) throw new HttpError(400, def.kind === "time" ? "A time as HH:MM (00:00 to 23:59)." : `A whole number from ${def.min} to ${def.max}.`, "VALIDATION_ERROR");
  const before = await scheduleLimitValue(key);
  await setSetting(key, value, meta.actorUserId);
  const pattern = await scheduleTimedJob(key);
  await writeAuditLog({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: key, before: { value: before }, after: { value, ...(pattern ? { schedule: pattern } : {}) } });
  return listSchedulesLimits();
}
