import type { DirectoryToggleableField, DocumentMimeType } from "@shared/constants/peopleDocuments";
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
