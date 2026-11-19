import type { DirectoryToggleableField, DocumentMimeType } from "@shared/constants/peopleDocuments";
import type { DeviceHealthThresholds as Thresholds } from "@shared/attendance/agentProtocol";
import { apiClient } from "./client";

export interface RateLimitSetting {
  maxAttempts: number;
  windowSeconds: number;
}

export interface SecuritySettings {
  lockoutMaxAttempts: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  invitationTtlHours: number;
  /** How long a "Forgot password" link stays valid. */
  require2faRoles: string[];
  /** Optional by default: only a director can change it. */
  requireDirectorTwoFactor: boolean;
  rateLimits: {
    login: RateLimitSetting;
    totpVerify: RateLimitSetting;
    inviteAccept: RateLimitSetting;
    forgotPassword: RateLimitSetting;
    forgotPasswordPerLogin: RateLimitSetting;
    resetPassword: RateLimitSetting;
  };
}

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const { data } = await apiClient.get<SecuritySettings>("/api/settings/security");
  return data;
}

export async function updateSecuritySettings(input: Partial<SecuritySettings>): Promise<SecuritySettings> {
  const { data } = await apiClient.put<SecuritySettings>("/api/settings/security", input);
  return data;
}


// Phase 5 commit C — People & Documents.
export interface PeopleDocumentsSettings {
  directoryVisibleFields: DirectoryToggleableField[];
  photoMaxUploadMb: number;
  documentMaxUploadMb: number;
  documentAllowedMimeTypes: DocumentMimeType[];
}

export async function getPeopleDocumentsSettings(): Promise<PeopleDocumentsSettings> {
  const { data } = await apiClient.get<PeopleDocumentsSettings>("/api/settings/people-documents");
  return data;
}

export async function updatePeopleDocumentsSettings(input: Partial<PeopleDocumentsSettings>): Promise<PeopleDocumentsSettings> {
  const { data } = await apiClient.put<PeopleDocumentsSettings>("/api/settings/people-documents", input);
  return data;
}

// Phase 5 commit D — Helpdesk.
export interface HelpdeskSettings {
  autoCloseDays: number;
  reopenWindowDays: number;
}

export async function getHelpdeskSettings(): Promise<HelpdeskSettings> {
  const { data } = await apiClient.get<HelpdeskSettings>("/api/settings/helpdesk");
  return data;
}

export async function updateHelpdeskSettings(input: Partial<HelpdeskSettings>): Promise<HelpdeskSettings> {
  const { data } = await apiClient.put<HelpdeskSettings>("/api/settings/helpdesk", input);
  return data;
}

// Phase 2 P2-F — Attendance → Device health: sent to every sync agent, and
// used for the warnings on the Devices screen and Admin Home.
export type { DeviceHealthThresholds } from "@shared/attendance/agentProtocol";

export async function getDeviceHealthSettings(): Promise<Thresholds> {
  const { data } = await apiClient.get<Thresholds>("/api/settings/device-health");
  return data;
}

export async function updateDeviceHealthSettings(input: Partial<Thresholds>): Promise<Thresholds> {
  const { data } = await apiClient.put<Thresholds>("/api/settings/device-health", input);
  return data;
}

// Phase 2 P2-H — Attendance → Device alerts.
export interface DeviceAlertSettings {
  deviceSilentMinutes: number;
  agentSilentMinutes: number;
  agentWindowMarginMinutes: number;
  morningCheckTime: string;
  alertEmails: string[];
  alertSuperAdmins: boolean;
  recoverySettleSeconds: number;
}
export async function getDeviceAlertSettings(): Promise<DeviceAlertSettings> {
  return (await apiClient.get<DeviceAlertSettings>("/api/settings/device-alerts")).data;
}
export async function updateDeviceAlertSettings(input: Partial<DeviceAlertSettings>): Promise<DeviceAlertSettings> {
  return (await apiClient.put<DeviceAlertSettings>("/api/settings/device-alerts", input)).data;
}

// Phase 3 commit 1 — Attendance → Regularization: how far back a correction reaches and the bulk caps.
export interface RegularizationSettings {
  backdateCycles: number;
  bulkMaxRangeDays: number;
  bulkMaxEmployeeDays: number;
}
export async function getRegularizationSettings(): Promise<RegularizationSettings> {
  return (await apiClient.get<RegularizationSettings>("/api/settings/regularization")).data;
}
export async function updateRegularizationSettings(input: Partial<RegularizationSettings>): Promise<RegularizationSettings> {
  return (await apiClient.put<RegularizationSettings>("/api/settings/regularization", input)).data;
}

// Phase 3 commit 4 — Attendance → Excess hours: the smallest excess (in minutes) the report lists.
export interface ExcessHoursSettings {
  minMinutes: number;
}
export async function getExcessHoursSettings(): Promise<ExcessHoursSettings> {
  return (await apiClient.get<ExcessHoursSettings>("/api/settings/excess-hours")).data;
}
export async function updateExcessHoursSettings(input: Partial<ExcessHoursSettings>): Promise<ExcessHoursSettings> {
  return (await apiClient.put<ExcessHoursSettings>("/api/settings/excess-hours", input)).data;
}

// NT-08 (M session): the wording of the sign-in emails (directors).
export type EmailTemplateKey = "INVITATION" | "PASSWORD_RESET" | "WELCOME";
export interface EmailText {
  subject: string;
  heading: string;
  body: string;
}
export interface EmailTemplate {
  key: EmailTemplateKey;
  label: string;
  placeholders: string[];
  text: EmailText;
  isDefault: boolean;
  defaultText: EmailText;
}
export const listEmailTemplates = async () => (await apiClient.get<{ templates: EmailTemplate[] }>("/api/settings/email-templates")).data.templates;
export const updateEmailTemplate = async (key: EmailTemplateKey, text: EmailText | null) =>
  (await apiClient.put<{ templates: EmailTemplate[] }>("/api/settings/email-templates", { key, text })).data.templates;

// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md items 5 and 6): times and limits that had no screen; which settings are still on their built-in default.
export interface ScheduleLimitSetting {
  key: string;
  label: string;
  help: string;
  kind: "hour" | "time" | "int";
  min: number | null;
  max: number | null;
  value: number | string;
  defaultValue: number | string;
  defaultInUse: boolean;
}
export async function getSchedulesLimits(): Promise<ScheduleLimitSetting[]> {
  return (await apiClient.get<{ settings: ScheduleLimitSetting[] }>("/api/settings/schedules-limits")).data.settings;
}
export async function setScheduleLimit(key: string, value: number | string): Promise<ScheduleLimitSetting[]> {
  return (await apiClient.put<{ settings: ScheduleLimitSetting[] }>(`/api/settings/schedules-limits/${encodeURIComponent(key)}`, { value })).data.settings;
}
export async function getDefaultsInUse(): Promise<string[]> {
  return (await apiClient.get<{ keys: string[] }>("/api/settings/defaults-in-use")).data.keys;
}
