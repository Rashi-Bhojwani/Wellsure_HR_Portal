import { Prisma } from "@prisma/client";
import { DEFAULT_OFFICE_NAME, PEEPS_SETTING_DEFAULTS, PEEPS_SETTING_KEYS, PEEPS_SETTINGS, type PeepsSettingKey } from "@shared/constants/peeps";
import { writeAuditLogs } from "../../lib/audit";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { PEEPS_SETTING_SCHEMAS } from "./settingSchemas";
import type { ActorMeta, PeepsActor } from "./types";

// Peeps settings (D-29: every module's audience and working values are director-controlled settings). Append-only versions; the one in force is the
// newest version a director confirmed, and that director must not be the person who entered it (service + database trigger). A key with no confirmed
// version falls back to its shipped default when it has one (PEEPS_SETTING_DEFAULTS, Stage 3: "Default, change in settings"); otherwise it is Not set,
// and the module that needs it refuses to activate.

type Client = Prisma.TransactionClient | typeof prisma;

export async function getSetting<T>(key: PeepsSettingKey, client: Client = prisma): Promise<T | null> {
  const row = await client.peepsSettingVersion.findFirst({ where: { key, confirmation: { isNot: null } }, orderBy: { version: "desc" }, select: { value: true } });
  if (row) return row.value as T;
  return key in PEEPS_SETTING_DEFAULTS ? (PEEPS_SETTING_DEFAULTS[key] as T) : null;
}

export async function getSettings<K extends PeepsSettingKey>(keys: readonly K[], client: Client = prisma): Promise<Partial<Record<K, unknown>>> {
  const rows = await client.peepsSettingVersion.findMany({ where: { key: { in: [...keys] }, confirmation: { isNot: null } }, orderBy: { version: "desc" }, select: { key: true, value: true } });
  const out: Partial<Record<K, unknown>> = {};
  for (const r of rows) if (!((r.key as K) in out)) out[r.key as K] = r.value;
  for (const k of keys) if (!(k in out) && k in PEEPS_SETTING_DEFAULTS) out[k] = PEEPS_SETTING_DEFAULTS[k];
  return out;
}

/** Which of these keys are Not set (no confirmed version and no shipped default). */
export async function missingSettings(keys: readonly PeepsSettingKey[], client: Client = prisma): Promise<PeepsSettingKey[]> {
  const set = await getSettings(keys, client);
  return keys.filter((k) => !(k in set));
}

export const NOT_SET_UP = "PEEPS_NOT_SET_UP";
export async function assertSettings(keys: readonly PeepsSettingKey[], what: string): Promise<void> {
  const missing = await missingSettings(keys);
  if (missing.length > 0) {
    throw new HttpError(409, `${what} is not set up yet. Not set: ${missing.map((k) => PEEPS_SETTINGS[k].label.toLowerCase()).join(", ")}.`, NOT_SET_UP);
  }
}

/** What employees see in place of the named person who hosts or gives. The owners named the workspace "Wellsure Office"; a director may rename it. */
export async function officeName(): Promise<string> {
  return (await getSetting<string>("office.name")) ?? DEFAULT_OFFICE_NAME;
}

async function names(userIds: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } },
  });
  return new Map(users.map((u) => [u.id, u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode]));
}

export interface SettingView {
  key: PeepsSettingKey;
  module: string;
  label: string;
  what: string;
  enteredBy: "DIRECTOR" | "OFFICE";
  /** CONFIRMED: a director-confirmed version is in force. DEFAULT: the shipped default is in force ("Default, change in settings"). NOT_SET: neither. */
  state: "CONFIRMED" | "DEFAULT" | "NOT_SET";
  defaultValue: unknown;
  inForce: { version: number; value: unknown; enteredByName: string | null; confirmedByName: string | null; confirmedAt: string } | null;
  pending: { version: number; value: unknown; note: string; enteredByName: string | null; enteredByMe: boolean; enteredAt: string } | null;
}

export async function listSettings(actor: PeepsActor): Promise<SettingView[]> {
  const rows = await prisma.peepsSettingVersion.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }], include: { confirmation: true, withdrawal: true } });
  const who = await names(rows.flatMap((r) => [r.enteredByUserId, ...(r.confirmation ? [r.confirmation.confirmedByUserId] : [])]));
  return PEEPS_SETTING_KEYS.map((key) => {
    const ofKey = rows.filter((r) => r.key === key);
    const confirmed = ofKey.find((r) => r.confirmation);
    const latest = ofKey[0];
    const hasDefault = key in PEEPS_SETTING_DEFAULTS;
    return {
      key,
      ...PEEPS_SETTINGS[key],
      state: confirmed ? "CONFIRMED" : hasDefault ? "DEFAULT" : "NOT_SET",
      defaultValue: hasDefault ? PEEPS_SETTING_DEFAULTS[key] : null,
      inForce: confirmed
        ? { version: confirmed.version, value: confirmed.value, enteredByName: who.get(confirmed.enteredByUserId) ?? null, confirmedByName: who.get(confirmed.confirmation!.confirmedByUserId) ?? null, confirmedAt: confirmed.confirmation!.confirmedAt.toISOString() }
        : null,
      pending:
        latest && !latest.confirmation && !latest.withdrawal
          ? { version: latest.version, value: latest.value, note: latest.note, enteredByName: who.get(latest.enteredByUserId) ?? null, enteredByMe: latest.enteredByUserId === actor.userId, enteredAt: latest.enteredAt.toISOString() }
          : null,
    };
  });
}

export async function enterSetting(key: PeepsSettingKey, input: { value: unknown; note?: string }, actor: PeepsActor, meta: ActorMeta): Promise<SettingView> {
  if (PEEPS_SETTINGS[key].enteredBy === "DIRECTOR" && !actor.isDirector) throw new HttpError(403, "Only a director enters this setting.", "DIRECTORS_ONLY");
  const parsed = PEEPS_SETTING_SCHEMAS[key].safeParse(input.value);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  await (await import("./settingChecks")).checkSettingChange(key, parsed.data);
  await prisma.$transaction(
    async (tx) => {
      const last = await tx.peepsSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" }, select: { version: true } });
      const row = await tx.peepsSettingVersion.create({ data: { key, version: (last?.version ?? 0) + 1, value: parsed.data as Prisma.InputJsonValue, note: input.note ?? "", enteredByUserId: actor.userId } });
      await writeAuditLogs([{ ...meta, action: "peeps.setting.entered", entityType: "PeepsSettingVersion", entityId: row.id, after: { key, version: row.version, value: parsed.data } }], tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return (await listSettings(actor)).find((s) => s.key === key)!;
}

const previousValue = new Map<PeepsSettingKey, unknown>();

export async function confirmSetting(key: PeepsSettingKey, input: { version: number }, actor: PeepsActor, meta: ActorMeta): Promise<SettingView> {
  if (!actor.isDirector) throw new HttpError(403, "Only a director confirms a Peeps setting.", "DIRECTORS_ONLY");
  previousValue.set(key, await getSetting(key));
  await prisma.$transaction(async (tx) => {
    const row = await tx.peepsSettingVersion.findUnique({ where: { key_version: { key, version: input.version } }, include: { confirmation: true, withdrawal: true } });
    if (!row) throw new HttpError(404, "That version does not exist.", "NOT_FOUND");
    if (row.confirmation) throw new HttpError(409, "That version is already confirmed.", "ALREADY_CONFIRMED");
    if (row.withdrawal) throw new HttpError(409, "That version was withdrawn.", "WITHDRAWN");
    const latest = await tx.peepsSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" }, select: { version: true } });
    if (latest && latest.version !== row.version) throw new HttpError(409, "A newer version has been entered since; confirm that one instead.", "STALE_VERSION");
    if (row.enteredByUserId === actor.userId) throw new HttpError(403, "The person who entered a setting cannot confirm it. Another director confirms it.", "SAME_PERSON");
    const c = await tx.peepsSettingConfirmation.create({ data: { versionId: row.id, confirmedByUserId: actor.userId } });
    await writeAuditLogs([{ ...meta, action: "peeps.setting.confirmed", entityType: "PeepsSettingVersion", entityId: row.id, after: { key, version: row.version, confirmationId: c.id } }], tx);
  });
  const prev = previousValue.get(key);
  previousValue.delete(key);
  await (await import("./settingChecks")).auditCatalogueRetirements(key, prev, actor, meta);
  // The asset audience decides whether members' "Manage the asset register" grants exist (office.ts, grantKeysFor): re-apply them at once.
  if (key === "audience.assets") await (await import("./office")).resyncOfficeGrants(actor.userId);
  return (await listSettings(actor)).find((s) => s.key === key)!;
}

/** Stage 3: withdraw a pending (unconfirmed) version, by the person who entered it or a director, with a reason (audited). A confirmed version cannot
 *  be withdrawn (service + trigger); withdrawing twice changes nothing. */
export async function withdrawSetting(key: PeepsSettingKey, input: { version: number; reason: string }, actor: PeepsActor, meta: ActorMeta): Promise<SettingView> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.peepsSettingVersion.findUnique({ where: { key_version: { key, version: input.version } }, include: { confirmation: true, withdrawal: true } });
    if (!row) throw new HttpError(404, "That version does not exist.", "NOT_FOUND");
    if (row.enteredByUserId !== actor.userId && !actor.isDirector) throw new HttpError(403, "Only the person who entered it, or a director, withdraws it.", "FORBIDDEN");
    if (row.confirmation) throw new HttpError(409, "That version is already confirmed and cannot be withdrawn.", "ALREADY_DECIDED");
    if (row.withdrawal) return;
    const w = await tx.peepsSettingWithdrawal.create({ data: { versionId: row.id, withdrawnByUserId: actor.userId, reason: input.reason } });
    await writeAuditLogs([{ ...meta, action: "peeps.setting.withdrawn", entityType: "PeepsSettingVersion", entityId: row.id, after: { key, version: row.version, withdrawalId: w.id, reason: input.reason } }], tx);
  });
  return (await listSettings(actor)).find((s) => s.key === key)!;
}
