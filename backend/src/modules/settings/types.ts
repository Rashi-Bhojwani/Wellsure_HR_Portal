// Fixed catalog of Phase 1 security-policy settings (spec §7.8) — a
// deliberately closed set of known keys with typed defaults, not a
// generic key-value editor, so the System Settings screen can't write an
// arbitrary/malformed SystemSetting row that some other part of the app
// would then silently misread.

export interface RateLimitSetting {
  maxAttempts: number;
  windowSeconds: number;
}

export const RATE_LIMIT_KEYS = ["login", "totpVerify", "inviteAccept", "forgotPassword", "resetPassword"] as const;
export type RateLimitKey = (typeof RATE_LIMIT_KEYS)[number];

export const RATE_LIMIT_DEFAULTS: Record<RateLimitKey, RateLimitSetting> = {
  login: { maxAttempts: 10, windowSeconds: 900 },
  totpVerify: { maxAttempts: 10, windowSeconds: 900 },
  inviteAccept: { maxAttempts: 10, windowSeconds: 900 },
  forgotPassword: { maxAttempts: 5, windowSeconds: 3600 },
  resetPassword: { maxAttempts: 10, windowSeconds: 900 },
};

export interface SecuritySettings {
  lockoutMaxAttempts: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  invitationTtlHours: number;
  require2faRoles: string[];
  rateLimits: Record<RateLimitKey, RateLimitSetting>;
}
