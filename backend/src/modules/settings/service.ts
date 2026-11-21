import { default2faRoles } from "../../lib/authDefaults";
import { getSetting, setSetting } from "../../lib/settings";
import { writeAuditLog } from "../../lib/audit";
import { directorTwoFactorRequired, isDirector } from "../../lib/directorAuthority";
import { recordDirectorNotice, scheduleDelivery } from "../../lib/directorNotices";
import { prisma } from "../../lib/prisma";
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_KEYS, type RateLimitSetting, type SecuritySettings } from "./types";
import type { z } from "zod";
import type { updateDeviceAlertSettingsSchema, updateRegularizationSettingsSchema, updateExcessHoursSettingsSchema, updateDeviceHealthSettingsSchema, updateHelpdeskSettingsSchema, updatePeopleDocumentsSettingsSchema, updateSettingsSchema } from "./validators";
import type { DeviceHealthThresholds } from "@shared/attendance/agentProtocol";
import { DEVICE_ALERT_SETTING_KEY, getDeviceAlertSettings, type DeviceAlertSettings } from "../../lib/deviceAlertSettings";
import { getRegularizationSettings, REGULARIZATION_SETTING_KEY, type RegularizationSettings } from "../../lib/regularizationSettings";
import { EXCESS_HOURS_SETTING_KEY, getExcessHoursSettings, type ExcessHoursSettings } from "../../lib/excessHoursSettings";
import { DEVICE_HEALTH_SETTING_KEY, getDeviceHealthThresholds } from "../../lib/deviceHealthSettings";
import { HttpError } from "../../middleware/errorHandler";
import { getPeopleDocumentsSettings, PEOPLE_DOCUMENTS_SETTING_KEYS, type PeopleDocumentsSettings } from "../../lib/peopleDocumentsSettings";
import { getHelpdeskSettings, HELPDESK_SETTING_KEYS, type HelpdeskSettings } from "../../lib/helpdeskSettings";

type SettingsAudit = Parameters<typeof writeAuditLog>[0];

/** Every System Settings change is audited; one made by a director also tells the other director (docs/plans/DIRECTOR_AUTHORITY.md Q-DA-10). The notice names the area, never a value. */
async function auditSettingsChange(entry: SettingsAudit): Promise<void> {
  await writeAuditLog(entry);
  if (!entry.actorUserId || !(await isDirector(entry.actorUserId))) return;
  const area = String(entry.entityId ?? "settings");
  const { noticeId } = await prisma.$transaction((tx) =>
    recordDirectorNotice({ kind: "ACTION", step: "SETTINGS", subjectType: "SYSTEM_SETTING", subjectId: area, subjectLabel: `the ${area} settings`, actorUserId: entry.actorUserId!, approvalId: null, authority: "DIRECTOR_AUTHORITY" }, tx),
  );
  await scheduleDelivery(noticeId);
}

const RATE_LIMIT_SETTING_KEY: Record<(typeof RATE_LIMIT_KEYS)[number], string> = {
  login: "auth.rateLimit.login",
  totpVerify: "auth.rateLimit.totpVerify",
  inviteAccept: "auth.rateLimit.inviteAccept",
  forgotPassword: "auth.rateLimit.forgotPassword",
  forgotPasswordPerLogin: "auth.rateLimit.forgotPasswordPerLogin",
  resetPassword: "auth.rateLimit.resetPassword",
};

export async function getSettings(): Promise<SecuritySettings> {
  const [lockout, passwordMinLength, invitationTtlHours, require2faRoles, requireDirectorTwoFactor, ...rateLimitValues] = await Promise.all([
    getSetting("auth.lockout", { maxAttempts: 5, lockoutMinutes: 15 }),
    getSetting("auth.passwordMinLength", 8),
    getSetting("auth.invitationTtlHours", 168), // 7 days: the setup link HR sends (auth/service.ts DEFAULT_INVITATION_TTL_HOURS)
    getSetting<string[]>("auth.require2faRoles", default2faRoles()),
    directorTwoFactorRequired(),
    ...RATE_LIMIT_KEYS.map((k) => getSetting<RateLimitSetting>(RATE_LIMIT_SETTING_KEY[k], RATE_LIMIT_DEFAULTS[k])),
  ]);

  const rateLimits = Object.fromEntries(RATE_LIMIT_KEYS.map((k, i) => [k, rateLimitValues[i]!])) as SecuritySettings["rateLimits"];
  // FIX-H2 (independent audit 2026-11-20): the per-address sign-in limit is the two-director Default behaviour "auth.loginIpFailureLimit" (default 100 in 15 minutes).
  const { behaviourValue } = await import("../behaviours/service");
  rateLimits.login = (await behaviourValue("auth.loginIpFailureLimit")).value;

  return {
    lockoutMaxAttempts: lockout.maxAttempts,
    lockoutMinutes: lockout.lockoutMinutes,
    passwordMinLength,
    invitationTtlHours,
    require2faRoles,
    requireDirectorTwoFactor,
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
  // FIX-C1/H2 (independent audit 2026-11-20): these two moved to Default behaviours (one director proposes, the other confirms). Checked before anything is
  // written, and refused only when the value actually changes: the System Settings form sends every field, and resending the current value is not a change
  // (2026-11-21: refusing any payload that carried the sign-in limit made the whole Security section unsavable, and a refused save was half-applied).
  if (input.requireDirectorTwoFactor !== undefined && input.requireDirectorTwoFactor !== before.requireDirectorTwoFactor) {
    // FIX-C1 (independent audit 2026-11-20): compulsory by default, and changed only by one director proposing and the other confirming (Default behaviours,
    // "Two-step sign-in is compulsory for the directors"). This one-director path no longer changes it.
    if (!(await isDirector(meta.actorUserId))) throw new HttpError(403, "Only a director can change whether two-step sign-in is required of directors.", "DIRECTOR_ONLY");
    throw new HttpError(409, "Two-step sign-in for directors is changed in Default behaviours: one director proposes, the other confirms.", "USE_DEFAULT_BEHAVIOURS");
  }
  const loginLimit = input.rateLimits?.login;
  if (loginLimit && (loginLimit.maxAttempts !== before.rateLimits.login.maxAttempts || loginLimit.windowSeconds !== before.rateLimits.login.windowSeconds)) {
    throw new HttpError(409, "The sign-in limit per address is changed in Default behaviours: one director proposes, the other confirms.", "USE_DEFAULT_BEHAVIOURS");
  }

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
      if (key === "login") continue; // the Default behaviour auth.loginIpFailureLimit (checked above), never the old setting
      const value = input.rateLimits[key];
      if (value) await setSetting(RATE_LIMIT_SETTING_KEY[key], value, meta.actorUserId);
    }
  }

  const after = await getSettings();
  await auditSettingsChange({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "security", before, after });
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
  await auditSettingsChange({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "peopleDocuments", before, after });
  return after;
}

// Phase 5 commit D — Helpdesk (auto-close and reopen windows).
export async function getHelpdeskSettingsForAdmin(): Promise<HelpdeskSettings> {
  return getHelpdeskSettings();
}

type UpdateHelpdeskInput = z.infer<typeof updateHelpdeskSettingsSchema>;

export async function updateHelpdeskSettings(
  input: UpdateHelpdeskInput,
  meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<HelpdeskSettings> {
  const before = await getHelpdeskSettings();
  for (const [field, key] of Object.entries(HELPDESK_SETTING_KEYS) as Array<[keyof UpdateHelpdeskInput, string]>) {
    if (input[field] !== undefined) await setSetting(key, input[field], meta.actorUserId);
  }
  const after = await getHelpdeskSettings();
  await auditSettingsChange({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "helpdesk", before, after });
  return after;
}

// Phase 2 P2-F — Attendance → Device health: the retention warning/alarm,
// the nearly-full log and the clock-drift thresholds every sync agent and the
// Devices screen use. One stored object (attendance.deviceHealth).
export async function getDeviceHealthSettings(): Promise<DeviceHealthThresholds> {
  return getDeviceHealthThresholds();
}

type UpdateDeviceHealthInput = z.infer<typeof updateDeviceHealthSettingsSchema>;

export async function updateDeviceHealthSettings(
  input: UpdateDeviceHealthInput,
  meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<DeviceHealthThresholds> {
  const before = await getDeviceHealthThresholds();
  const after: DeviceHealthThresholds = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  if (after.retentionWarningPercent >= after.retentionAlarmPercent) {
    throw new HttpError(400, "The retention warning must come before the alarm (a lower percentage).", "VALIDATION_ERROR");
  }
  await setSetting(DEVICE_HEALTH_SETTING_KEY, after, meta.actorUserId);
  await auditSettingsChange({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "deviceHealth", before, after });
  return after;
}

// Phase 2 P2-H — Attendance → Device alerts: how long before silence is an
// incident, the morning check, and who is told. One stored object.
export async function getDeviceAlertSettingsForAdmin(): Promise<DeviceAlertSettings> {
  return getDeviceAlertSettings();
}

type UpdateDeviceAlertInput = z.infer<typeof updateDeviceAlertSettingsSchema>;

export async function updateDeviceAlertSettings(
  input: UpdateDeviceAlertInput,
  meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<DeviceAlertSettings> {
  const before = await getDeviceAlertSettings();
  const after: DeviceAlertSettings = { ...before, ...(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<DeviceAlertSettings>) };
  after.alertEmails = [...new Set(after.alertEmails)];
  await setSetting(DEVICE_ALERT_SETTING_KEY, after, meta.actorUserId);
  await auditSettingsChange({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "deviceAlerts", before, after });
  return after;
}

// Phase 3 commit 1 — Attendance → Regularization: backdating and the bulk caps.
export async function getRegularizationSettingsForAdmin(): Promise<RegularizationSettings> {
  return getRegularizationSettings();
}

type UpdateRegularizationInput = z.infer<typeof updateRegularizationSettingsSchema>;

export async function updateRegularizationSettings(
  input: UpdateRegularizationInput,
  meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<RegularizationSettings> {
  const before = await getRegularizationSettings();
  const after: RegularizationSettings = { ...before, ...(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<RegularizationSettings>) };
  await setSetting(REGULARIZATION_SETTING_KEY, after, meta.actorUserId);
  await auditSettingsChange({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "regularization", before, after });
  return after;
}

// Phase 3 commit 4 — Attendance → Excess hours: the smallest excess the report lists.
export async function getExcessHoursSettingsForAdmin(): Promise<ExcessHoursSettings> {
  return getExcessHoursSettings();
}

export async function updateExcessHoursSettings(
  input: z.infer<typeof updateExcessHoursSettingsSchema>,
  meta: { actorUserId: string; ipAddress?: string | null; userAgent?: string | null },
): Promise<ExcessHoursSettings> {
  const before = await getExcessHoursSettings();
  const after: ExcessHoursSettings = { ...before, ...(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<ExcessHoursSettings>) };
  await setSetting(EXCESS_HOURS_SETTING_KEY, after, meta.actorUserId);
  await auditSettingsChange({ ...meta, action: "settings.updated", entityType: "SystemSetting", entityId: "excessHours", before, after });
  return after;
}
