import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { OVERRIDE_STATUSES, STATUS_CODES } from "@shared/attendance/statusCatalogue";
import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

// A-10 (docs/plans/GREYTHR_PARITY_WORKFORCE.md). The Workforce settings: each a key with an append-only history (a database trigger refuses UPDATE); the latest row
// is in force; no row means Not set. Only a director sets one, with a reason; each save is also audited. Every key and the shape of its value is declared here.

export const WORKFORCE_SETTINGS = {
  /** item 2: the directors' own labels for status codes; a code without one shows our own wording. */
  "attendance.statusLabels": z.partialRecord(z.enum(STATUS_CODES as [string, ...string[]]), z.string().trim().min(1).max(60)),
  /** item 3: the statuses Manual Override may set. Not set = every status the engine supports. */
  "attendance.overrideAllowedStatuses": z.array(z.enum(OVERRIDE_STATUSES)).min(1).max(OVERRIDE_STATUSES.length),
} as const;
export type WorkforceSettingKey = keyof typeof WORKFORCE_SETTINGS;
export const WORKFORCE_SETTING_KEYS = Object.keys(WORKFORCE_SETTINGS) as WorkforceSettingKey[];

export async function getWorkforceSetting<K extends WorkforceSettingKey>(key: K): Promise<z.infer<(typeof WORKFORCE_SETTINGS)[K]> | null> {
  const row = await prisma.workforceSetting.findFirst({ where: { key }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return row ? (row.value as z.infer<(typeof WORKFORCE_SETTINGS)[K]>) : null;
}

export async function settingView(key: WorkforceSettingKey) {
  const row = await prisma.workforceSetting.findFirst({ where: { key }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return { key, value: row?.value ?? null, notSet: !row, setAt: row?.createdAt.toISOString() ?? null, reason: row?.reason ?? null };
}

export async function settingHistory(key: WorkforceSettingKey) {
  const rows = await prisma.workforceSetting.findMany({ where: { key }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  return rows.map((r) => ({ id: r.id, value: r.value, reason: r.reason, setByUserId: r.setByUserId, setAt: r.createdAt.toISOString() }));
}

export async function saveWorkforceSetting(key: WorkforceSettingKey, value: unknown, reason: string, viewer: { userId: string; roleCodes: string[] }, meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null }) {
  if (!viewer.roleCodes.includes("SUPER_ADMIN")) throw new HttpError(403, "Only a director can change this setting.", "DIRECTOR_ONLY");
  const parsed = WORKFORCE_SETTINGS[key].safeParse(value);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "That value is not valid for this setting.", "VALIDATION_ERROR");
  const before = await getWorkforceSetting(key);
  await prisma.workforceSetting.create({ data: { key, value: parsed.data as Prisma.InputJsonValue, reason, setByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "workforce.setting.saved", entityType: "WorkforceSetting", entityId: key, before: { value: before }, after: { value: parsed.data, reason } });
  return settingView(key);
}
