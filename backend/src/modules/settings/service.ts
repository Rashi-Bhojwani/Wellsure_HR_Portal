import { getSetting, setSetting } from "../../lib/settings";
import { writeAuditLog } from "../../lib/audit";
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_KEYS, type LeaveSettings, type RateLimitSetting, type SecuritySettings } from "./types";
import type { z } from "zod";
import type { updateLeaveSettingsSchema, updatePeopleDocumentsSettingsSchema, updateSettingsSchema } from "./validators";
import { getPeopleDocumentsSettings, PEOPLE_DOCUMENTS_SETTING_KEYS, type PeopleDocumentsSettings } from "../../lib/peopleDocumentsSettings";

const RATE_LIMIT_SETTING_KEY: Record<(typeof RATE_LIMIT_KEYS)[number], string> = {
  login: "auth.rateLimit.login",
  totpVerify: "auth.rateLimit.totpVerify",
  inviteAccept: "auth.rateLimit.inviteAccept",
  forgotPassword: "auth.rateLimit.forgotPassword",
  resetPassword: "auth.rateLimit.resetPassword",
};

export async function getSettings(): Promise<SecuritySettings> {
  const [lockout, passwordMinLength, invitationTtlHours, require2faRoles, ...rateLimitValues] = await Promise.all([
    getSetting("auth.lockout", { maxAttempts: 5, lockoutMinutes: 15 }),
    getSetting("auth.passwordMinLength", 8),
    getSetting("auth.invitationTtlHours", 48),
    getSetting<string[]>("auth.require2faRoles", []),
    ...RATE_LIMIT_KEYS.map((k) => getSetting<RateLimitSetting>(RATE_LIMIT_SETTING_KEY[k], RATE_LIMIT_DEFAULTS[k])),
  ]);

  const rateLimits = Object.fromEntries(RATE_LIMIT_KEYS.map((k, i) => [k, rateLimitValues[i]!])) as SecuritySettings["rateLimits"];

  return {
    lockoutMaxAttempts: lockout.maxAttempts,
    lockoutMinutes: lockout.lockoutMinutes,
    passwordMinLength,
    invitationTtlHours,
    require2faRoles,
    rateLimits,
  };
}

type UpdateInput = z.infer<typeof updateSettingsSchema>;

// Every field is optional and independently upserted — HR can tighten one
// knob (e.g. just the lockout window) without having to re-submit every
// other setting, and each write gets its own audit log entry so the log
// reads as "who changed the login rate limit," not one opaque blob.
export async function updateSettings(input: UpdateInput, meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null }): Promise<SecuritySettings> {
  const before = await getSettings();

  if (input.lockoutMaxAttempts !== undefined || input.lockoutMinutes !== undefined) {
    const next = {
      maxAttempts: input.lockoutMaxAttempts ?? before.lockoutMaxAttempts,
      lockoutMinutes: input.lockoutMinutes ?? before.lockoutMinutes,
    };
    await setSetting("auth.lockout", next, meta.actorUserId);
  }
  if (input.passwordMinLength !== undefined) {
    await setSetting("auth.passwordMinLength", input.passwordMinLength, meta.actorUserId);
  }
  if (input.invitationTtlHours !== undefined) {
    await setSetting("auth.invitationTtlHours", input.invitationTtlHours, meta.actorUserId);
  }
  if (input.require2faRoles !== undefined) {
    await setSetting("auth.require2faRoles", input.require2faRoles, meta.actorUserId);
  }
  if (input.rateLimits) {
    for (const key of RATE_LIMIT_KEYS) {
      const value = input.rateLimits[key];
      if (value) await setSetting(RATE_LIMIT_SETTING_KEY[key], value, meta.actorUserId);
    }
  }

  const after = await getSettings();
  await writeAuditLog({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "security", before, after });
  return after;
}

export async function getLeaveSettings(): Promise<LeaveSettings> {
  const encashmentDefaultDailyRate = await getSetting<number | null>("leave.encashment.defaultDailyRate", null);
  return { encashmentDefaultDailyRate };
}

type UpdateLeaveInput = z.infer<typeof updateLeaveSettingsSchema>;

export async function updateLeaveSettings(input: UpdateLeaveInput, meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null }): Promise<LeaveSettings> {
  const before = await getLeaveSettings();
  if (input.encashmentDefaultDailyRate !== undefined) {
    await setSetting("leave.encashment.defaultDailyRate", input.encashmentDefaultDailyRate, meta.actorUserId);
  }
  const after = await getLeaveSettings();
  await writeAuditLog({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "leave", before, after });
  return after;
}

// Phase 5 commit C — People & Documents (directory field visibility, upload limits).
export async function getPeopleDocumentsSettingsForAdmin(): Promise<PeopleDocumentsSettings> {
  return getPeopleDocumentsSettings();
}

type UpdatePeopleDocumentsInput = z.infer<typeof updatePeopleDocumentsSettingsSchema>;

export async function updatePeopleDocumentsSettings(
  input: UpdatePeopleDocumentsInput,
  meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<PeopleDocumentsSettings> {
  const before = await getPeopleDocumentsSettings();
  for (const [field, key] of Object.entries(PEOPLE_DOCUMENTS_SETTING_KEYS) as Array<[keyof UpdatePeopleDocumentsInput, string]>) {
    if (input[field] !== undefined) await setSetting(key, input[field], meta.actorUserId);
  }
  const after = await getPeopleDocumentsSettings();
  await writeAuditLog({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "peopleDocuments", before, after });
  return after;
}
