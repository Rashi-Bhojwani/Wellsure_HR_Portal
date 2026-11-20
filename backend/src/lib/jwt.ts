import jwt from "jsonwebtoken";
import { env } from "../config/env";

// Access tokens are short-lived, stateless JWTs (spec §9). Refresh tokens
// are opaque random strings tracked in refresh_tokens (see
// modules/auth/tokens.ts) — never JWTs, so there's nothing to verify here
// beyond a database lookup.

const ACCESS_TTL = env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"];

// FIX-M1 (independent audit 2026-11-20): every access token carries the account's session version (users.session_version). A password reset or change, a
// setup-link use, a two-step reset, signing out everywhere and a suspension raise it (modules/auth/tokens.ts, revokeAllUserRefreshTokens), and
// middleware/authenticate.ts refuses a token whose version is older, so every other session ends at once instead of when its token expires.
export function signAccessToken(userId: string, sessionVersion = 0): string {
  return jwt.sign({ typ: "access", sub: userId, sv: sessionVersion }, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function verifyAccessTokenClaims(token: string): { userId: string; sessionVersion: number } {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  if (payload.typ !== "access" || typeof payload.sub !== "string") {
    throw new Error("Invalid access token payload");
  }
  return { userId: payload.sub, sessionVersion: typeof payload.sv === "number" ? payload.sv : 0 };
}

export function verifyAccessToken(token: string): string {
  return verifyAccessTokenClaims(token).userId;
}

// Short-lived (5m) tokens proving "this user just presented a correct
// Employee Code + password" without yet granting a full session — used
// for the two-step login-time TOTP challenge (spec §3.7: HR/Admin/Payroll
// roles must enable 2FA). Distinct `typ` per purpose so a setup challenge
// can't be replayed as a verify challenge or vice versa.
export type TotpChallengePurpose = "totp_challenge" | "totp_setup_challenge";

export function signTotpChallengeToken(userId: string, purpose: TotpChallengePurpose): string {
  return jwt.sign({ typ: purpose, sub: userId }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
}

export function verifyTotpChallengeToken(token: string, purpose: TotpChallengePurpose): string {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  if (payload.typ !== purpose || typeof payload.sub !== "string") {
    throw new Error("Invalid or wrong-purpose challenge token");
  }
  return payload.sub;
}
