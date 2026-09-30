import type { AutoPostKind } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { getSetting, setSetting } from "../../lib/settings";
import type { ActorMeta } from "./types";

// Closed catalog of exactly 3 rows (spec §7.7's "configure auto-posts
// (joining, birthday, anniversary templates and time)") — same one-row-
// per-fixed-kind shape as LeavePolicy. Defensive defaults here too (never
// hard-depend on seed data — lib/settings.ts's own stated rule): a row
// missing from the DB just means "never customised," not broken.
const DEFAULT_TEMPLATES: Record<AutoPostKind, string> = {
  BIRTHDAY: "Wishing {name} a fantastic birthday, filled with joy and celebration!",
  JOINING: "{name} has joined us in the company on {date}. Please join us in welcoming our newest team member.",
  ANNIVERSARY: "Our congratulations to {name} on completing {years} successful year(s).",
};

const AUTO_POST_KINDS: AutoPostKind[] = ["BIRTHDAY", "JOINING", "ANNIVERSARY"];

function formatRow(kind: AutoPostKind, row: { enabled: boolean; template: string; updatedAt: Date } | null) {
  return {
    kind,
    enabled: row?.enabled ?? true,
    template: row?.template ?? DEFAULT_TEMPLATES[kind],
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export async function listAutoPostSettings() {
  const rows = await prisma.engageAutoPostSetting.findMany();
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return AUTO_POST_KINDS.map((kind) => formatRow(kind, byKind.get(kind) ?? null));
}

export async function getAutoPostSetting(kind: AutoPostKind): Promise<{ enabled: boolean; template: string }> {
  const row = await prisma.engageAutoPostSetting.findUnique({ where: { kind } });
  return { enabled: row?.enabled ?? true, template: row?.template ?? DEFAULT_TEMPLATES[kind] };
}

export async function updateAutoPostSetting(kind: AutoPostKind, input: { enabled?: boolean; template?: string }, meta: ActorMeta) {
  const current = await getAutoPostSetting(kind);
  const row = await prisma.engageAutoPostSetting.upsert({
    where: { kind },
    create: { kind, enabled: input.enabled ?? current.enabled, template: input.template ?? current.template },
    update: {
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.template !== undefined && { template: input.template }),
    },
  });
  await writeAuditLog({ ...meta, action: "engage.autopost.settings.update", entityType: "EngageAutoPostSetting", entityId: kind, before: current, after: { enabled: row.enabled, template: row.template } });
  return formatRow(kind, row);
}

const DAILY_RUN_HOUR_KEY = "engage.autopost.dailyRunHour";
const DEFAULT_DAILY_RUN_HOUR = 8; // spec §8's "daily 08:00 cron"

// Read at scheduler-registration time only (jobs/scheduler.ts) — BullMQ's
// repeatable-job schedule isn't live-reloaded within a running process, so
// a change here takes effect on the scheduler's next restart. Documented
// in the admin screen's own help text, not silently swallowed.
export async function getDailyRunHour(): Promise<number> {
  return getSetting(DAILY_RUN_HOUR_KEY, DEFAULT_DAILY_RUN_HOUR);
}

export async function setDailyRunHour(hour: number, meta: ActorMeta): Promise<number> {
  await setSetting(DAILY_RUN_HOUR_KEY, hour, meta.actorUserId);
  await writeAuditLog({ ...meta, action: "engage.autopost.dailyRunHour.update", entityType: "SystemSetting", entityId: DAILY_RUN_HOUR_KEY, after: { hour } });
  return hour;
}
