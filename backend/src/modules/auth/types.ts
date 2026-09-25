export interface LoginTokens {
  status: "authenticated";
  accessToken: string;
  refreshToken: string;
  user: { employeeCode: string; roleCodes: string[]; privacyNoticeAccepted: boolean };
}

export interface LoginRequiresTotp {
  status: "requires_totp";
  challengeToken: string;
}

export interface LoginRequiresTotpSetup {
  status: "requires_totp_setup";
  challengeToken: string;
}

export type LoginResult = LoginTokens | LoginRequiresTotp | LoginRequiresTotpSetup;

export interface RequestMetaInput {
  userAgent?: string | null;
  ipAddress?: string | null;
}
