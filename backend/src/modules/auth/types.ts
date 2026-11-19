export interface LoginTokens {
  status: "authenticated";
  accessToken: string;
  refreshToken: string;
  /** The refresh token row's own expiry; the browser cookie is given exactly this, so the two never disagree. */
  refreshExpiresAt: Date;
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
