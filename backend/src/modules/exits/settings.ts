import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { requireExitDirector, type ExitMeta } from "./access";

const code = z.string().trim().min(1).max(60).regex(/^[A-Z0-9_]+$/);
export const ownerSchema = z.object({ ownerTeam: z.enum(["IT", "ADMIN", "MANAGER", "HR"]), ownerEmployeeIds: z.array(z.string().min(1)) }).refine((v) => v.ownerTeam === "MANAGER" || v.ownerEmployeeIds.length > 0, "Choose the named owners.");
export const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(ownerSchema.and(z.object({ code, label: z.string().trim().min(1).max(240), required: z.boolean() }))).refine((a) => new Set(a.map((i) => i.code)).size === a.length, "Item codes must be unique."),
  assetOwner: ownerSchema,
  reason: z.string().trim().min(1).max(2000),
});
export const SETTING_SCHEMAS = {
  officeAudience: z.object({ officeManages: z.boolean() }),
  noticeRules: z.array(z.object({ employmentType: z.enum(["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"]), gradeId: z.string().min(1).nullable(), days: z.number().int().min(0).max(2147483647), basis: z.literal("CALENDAR_DAYS"), countFrom: z.enum(["SUBMISSION_DAY", "NEXT_DAY"]), sourceNote: z.string().trim().min(1).max(2000) })).refine((a) => new Set(a.map((r) => `${r.employmentType}/${r.gradeId}`)).size === a.length, "A notice rule is listed twice."),
  rejectAllowed: z.object({ allowed: z.boolean() }),
  interviewQuestions: z.array(z.object({ id: code, label: z.string().trim().min(1).max(500), required: z.boolean() })).min(1).refine((a) => new Set(a.map((q) => q.id)).size === a.length, "A question is listed twice."),
  overdueThresholds: z.object({ clearanceDays: z.number().int().min(0).max(2147483647) }),
  interviewRetention: z.object({ days: z.number().int().min(0).max(2147483647) }),
  reasonCategories: z.array(z.object({ code, label: z.string().trim().min(1).max(120) })).min(1).refine((a) => new Set(a.map((c) => c.code)).size === a.length, "A category is listed twice."),
} as const;
export type ExitSettingKey = keyof typeof SETTING_SCHEMAS;
export const settingKeySchema = z.enum(Object.keys(SETTING_SCHEMAS) as [ExitSettingKey, ...ExitSettingKey[]]);
export const settingInputSchema = z.object({ value: z.unknown(), reason: z.string().trim().min(1).max(2000), version: z.number().int().min(0) });
export async function settingVersion(key: ExitSettingKey) {
  return prisma.exitSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" } });
}
export async function getExitSetting<K extends ExitSettingKey>(key: K): Promise<z.infer<(typeof SETTING_SCHEMAS)[K]> | null> {
  const row = await settingVersion(key);
  return row?.value == null ? null : SETTING_SCHEMAS[key].parse(row.value) as z.infer<(typeof SETTING_SCHEMAS)[K]>;
}
export async function requiredSetting<K extends ExitSettingKey>(key: K) {
  const value = await getExitSetting(key);
  if (value === null) throw new HttpError(409, `Exits: ${key} is Not set. A director must set it up first.`, "EXITS_NOT_SET");
  return value;
}
export async function settingsView(userId: string) {
  await requireExitDirector(userId);
  return Promise.all(Object.keys(SETTING_SCHEMAS).map(async (key) => {
    const row = await settingVersion(key as ExitSettingKey);
    return { key, state: !row || row.value === null ? "NOT_SET" : "CONFIRMED", version: row?.version ?? 0, value: row?.value ?? null, reason: row?.reason ?? null, changedByUserId: row?.changedByUserId ?? null, changedAt: row?.changedAt.toISOString() ?? null };
  }));
}
export async function setExitSetting(key: ExitSettingKey, input: z.infer<typeof settingInputSchema>, meta: ExitMeta) {
  await requireExitDirector(meta.actorUserId);
  const value = input.value === null ? null : SETTING_SCHEMAS[key].parse(input.value);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.exits.setting'),hashtext(${key}))::text`;
    const previous = await tx.exitSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" } });
    if ((previous?.version ?? 0) !== input.version) throw new HttpError(409, "This setting changed. Reload it before saving.", "CONFLICT");
    const row = await tx.exitSettingVersion.create({ data: { key, version: input.version + 1, value: value === null ? Prisma.JsonNull : value, reason: input.reason, changedByUserId: meta.actorUserId } });
    await writeAuditLogs([{ ...meta, action: "exits.setting.confirmed", entityType: "ExitSettingVersion", entityId: row.id, after: { key, version: row.version, reason: input.reason } }], tx);
  });
  return settingsView(meta.actorUserId);
}
export async function createTemplate(input: z.infer<typeof templateSchema>, meta: ExitMeta) {
  await requireExitDirector(meta.actorUserId);
  const parsed = templateSchema.parse(input);
  const ids = [...new Set([...parsed.items.flatMap((i) => i.ownerEmployeeIds), ...parsed.assetOwner.ownerEmployeeIds])];
  if (await prisma.employee.count({ where: { id: { in: ids }, status: "ACTIVE", user: { status: "ACTIVE", roles: { none: { role: { code: "DEVELOPER" } } } } } }) !== ids.length) throw new HttpError(400, "Choose active item owners who can use exits.", "VALIDATION_ERROR");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.exits.template'))::text`;
    const previous = await tx.exitChecklistTemplate.findFirst({ orderBy: { version: "desc" } });
    const row = await tx.exitChecklistTemplate.create({ data: { ...parsed, version: (previous?.version ?? 0) + 1, changedByUserId: meta.actorUserId } });
    await writeAuditLogs([{ ...meta, action: "exits.template.confirmed", entityType: "ExitChecklistTemplate", entityId: row.id, after: { version: row.version, name: row.name } }], tx);
    return row;
  });
}
export async function latestTemplate() {
  return prisma.exitChecklistTemplate.findFirst({ orderBy: { version: "desc" } });
}
