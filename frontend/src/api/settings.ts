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
