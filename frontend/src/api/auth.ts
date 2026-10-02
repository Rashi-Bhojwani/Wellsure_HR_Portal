import { apiClient } from "./client";

export interface LoginTokensResponse {
  accessToken: string;
  user: { employeeCode: string; roleCodes: string[]; privacyNoticeAccepted: boolean };
}

export interface LoginChallengeResponse {
  status: "requires_totp" | "requires_totp_setup";
  challengeToken: string;
}

export type LoginResponse = LoginTokensResponse | LoginChallengeResponse;

export function isLoginChallenge(res: LoginResponse): res is LoginChallengeResponse {
  return "status" in res;
}

export async function login(employeeCode: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>("/api/auth/login", { employeeCode, password });
  return data;
}

export async function loginTotp(challengeToken: string, code: string): Promise<LoginTokensResponse> {
  const { data } = await apiClient.post<LoginTokensResponse>("/api/auth/login/totp", { challengeToken, code });
  return data;
}

export async function refresh(): Promise<{ accessToken: string }> {
  const { data } = await apiClient.post<{ accessToken: string }>("/api/auth/refresh");
  return data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/api/auth/logout");
}

export async function logoutAll(): Promise<void> {
  await apiClient.post("/api/auth/logout-all");
}

export interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export async function getSessions(): Promise<Session[]> {
  const { data } = await apiClient.get<{ sessions: Session[] }>("/api/auth/sessions");
  return data.sessions;
}

export async function revokeSession(id: string): Promise<void> {
  await apiClient.delete(`/api/auth/sessions/${id}`);
}

export async function getInvitation(token: string): Promise<{ employeeCode: string; fullName: string }> {
  const { data } = await apiClient.get(`/api/auth/invitations/${token}`);
  return data;
}

export async function acceptInvitation(token: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>(`/api/auth/invitations/${token}/accept`, { password });
  return data;
}

export async function forgotPassword(employeeCode: string): Promise<void> {
  await apiClient.post("/api/auth/forgot-password", { employeeCode });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiClient.post(`/api/auth/reset-password/${token}`, { password });
}

export interface MeResponse {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  roleCodes: string[];
  permissions: string[];
  dataScope: "SELF" | "TEAM" | "ALL";
  totpEnabled: boolean;
  privacyNoticeAccepted: boolean;
}

export async function me(): Promise<MeResponse> {
  const { data } = await apiClient.get<MeResponse>("/api/auth/me");
  return data;
}

export async function acceptPrivacyNotice(): Promise<void> {
  await apiClient.post("/api/auth/privacy-notice/accept");
}

export interface TotpEnrollment {
  qrCodeDataUrl: string;
  secret: string;
}

export async function setupTotp(challengeToken?: string): Promise<TotpEnrollment> {
  const { data } = await apiClient.post<TotpEnrollment>("/api/auth/2fa/setup", challengeToken ? { challengeToken } : {});
  return data;
}

export interface TotpVerifyResponse extends Partial<LoginTokensResponse> {
  backupCodes: string[];
}

export async function verifyTotp(code: string, challengeToken?: string): Promise<TotpVerifyResponse> {
  const { data } = await apiClient.post<TotpVerifyResponse>(
    "/api/auth/2fa/verify",
    challengeToken ? { challengeToken, code } : { code },
  );
  return data;
}

export async function disableTotp(password: string, code: string): Promise<void> {
  await apiClient.post("/api/auth/2fa/disable", { password, code });
}

export async function regenerateBackupCodes(): Promise<string[]> {
  const { data } = await apiClient.post<{ backupCodes: string[] }>("/api/auth/2fa/backup-codes/regenerate");
  return data.backupCodes;
}
