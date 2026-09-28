import { getSetting, setSetting } from "../../lib/settings";
import { writeAuditLog } from "../../lib/audit";
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_KEYS, type RateLimitSetting, type SecuritySettings } from "./types";
import type { z } from "zod";
import type { updateSettingsSchema } from "./validators";

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
