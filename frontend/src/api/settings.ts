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
  require2faRoles: string[];
  rateLimits: {
    login: RateLimitSetting;
    totpVerify: RateLimitSetting;
    inviteAccept: RateLimitSetting;
    forgotPassword: RateLimitSetting;
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

export interface LeaveSettings {
  encashmentDefaultDailyRate: number | null;
}

export async function getLeaveSettings(): Promise<LeaveSettings> {
  const { data } = await apiClient.get<LeaveSettings>("/api/settings/leave");
  return data;
}

export async function updateLeaveSettings(input: Partial<LeaveSettings>): Promise<LeaveSettings> {
  const { data } = await apiClient.put<LeaveSettings>("/api/settings/leave", input);
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
