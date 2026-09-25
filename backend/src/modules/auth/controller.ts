import type { Request, Response } from "express";
import { env } from "../../config/env";
import { verifyTotpChallengeToken } from "../../lib/jwt";
import { HttpError } from "../../middleware/errorHandler";
import * as authService from "./service";
import type { LoginResult, RequestMetaInput } from "./types";

const REFRESH_COOKIE = "refreshToken";

function requestMeta(req: Request): RequestMetaInput {
  return { userAgent: req.headers["user-agent"] ?? null, ipAddress: req.ip ?? null };
}

// httpOnly + sameSite=strict so the cookie is never readable by JS and is
// never sent on a cross-site navigation; secure in every environment
// except local dev (which isn't served over HTTPS) — spec §9's CSRF note.
function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env.APP_ENV !== "development",
    expires: expiresAt,
    path: "/api/auth",
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}

function sendLoginResult(res: Response, result: LoginResult): void {
  if (result.status === "authenticated") {
    // 30d matches JWT_REFRESH_TTL's default; the cookie's actual expiry
    // is driven by the token row itself, this is just the browser-facing copy.
    setRefreshCookie(res, result.refreshToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    res.status(200).json({ accessToken: result.accessToken, user: result.user });
    return;
  }
  res.status(200).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const { employeeCode, password } = req.body as { employeeCode: string; password: string };
  const result = await authService.login(employeeCode, password, requestMeta(req));
  sendLoginResult(res, result);
}

export async function loginTotp(req: Request, res: Response): Promise<void> {
  const { challengeToken, code } = req.body as { challengeToken: string; code: string };
  const result = await authService.completeLoginTotp(challengeToken, code, requestMeta(req));
  sendLoginResult(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const presented = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
  if (!presented) {
    throw new HttpError(401, "No session found.", "INVALID_REFRESH_TOKEN");
  }
  const { accessToken, refreshToken } = await authService.refresh(presented, requestMeta(req));
  setRefreshCookie(res, refreshToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  res.status(200).json({ accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const presented = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
  await authService.logout(presented, req.user!.userId);
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  await authService.logoutAll(req.user!.userId);
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function getSessions(req: Request, res: Response): Promise<void> {
  const sessions = await authService.getSessions(req.user!.userId);
  res.status(200).json({ sessions });
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
  await authService.revokeSession(req.user!.userId, req.params.id as string);
  res.status(204).send();
}

export async function getInvitation(req: Request, res: Response): Promise<void> {
  const details = await authService.getInvitationDetails(req.params.token as string);
  res.status(200).json(details);
}

export async function acceptInvitation(req: Request, res: Response): Promise<void> {
  const { password } = req.body as { password: string };
  const result = await authService.acceptInvitation(req.params.token as string, password, requestMeta(req));
  sendLoginResult(res, result);
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { employeeCode } = req.body as { employeeCode: string };
  await authService.forgotPassword(employeeCode, requestMeta(req));
  // Identical response regardless of whether employeeCode exists.
  res.status(200).json({ message: "If that Employee Code exists, a reset link has been sent to the email on file." });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { password } = req.body as { password: string };
  await authService.resetPassword(req.params.token as string, password, requestMeta(req));
  res.status(200).json({ message: "Password reset. Please log in with your new password." });
}

export async function me(req: Request, res: Response): Promise<void> {
  const profile = await authService.getMe(req.user!.userId);
  res.status(200).json(profile);
}

export async function acceptPrivacyNotice(req: Request, res: Response): Promise<void> {
  await authService.acceptPrivacyNotice(req.user!.userId);
  res.status(204).send();
}

// 2FA setup/verify can be reached two ways: mid-login (a totp_setup_challenge
// token, no session yet) or self-service from an already-authenticated
// session (Account & Security). Resolve whichever was presented.
function resolveTotpSetupUserId(req: Request): string {
  if (req.user) {
    return req.user.userId;
  }
  const { challengeToken } = req.body as { challengeToken?: string };
  if (!challengeToken) {
    throw new HttpError(401, "Authentication required", "UNAUTHENTICATED");
  }
  try {
    return verifyTotpChallengeToken(challengeToken, "totp_setup_challenge");
  } catch {
    throw new HttpError(401, "Invalid or expired challenge.", "INVALID_CHALLENGE");
  }
}

export async function setupTotp(req: Request, res: Response): Promise<void> {
  const userId = resolveTotpSetupUserId(req);
  const enrollment = await authService.setupTotp(userId);
  res.status(200).json(enrollment);
}

export async function verifyTotp(req: Request, res: Response): Promise<void> {
  const userId = resolveTotpSetupUserId(req);
  const { code } = req.body as { code: string };
  const { backupCodes } = await authService.verifyTotpSetup(userId, code);

  if (!req.user) {
    // This was the login-time setup challenge — finish logging in now.
    const result = await authService.completeLoginAfterTotpSetup(userId, requestMeta(req));
    if (result.status === "authenticated") {
      setRefreshCookie(res, result.refreshToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
      res.status(200).json({ accessToken: result.accessToken, user: result.user, backupCodes });
      return;
    }
  }
  res.status(200).json({ backupCodes });
}

export async function disableTotp(req: Request, res: Response): Promise<void> {
  const { password, code } = req.body as { password: string; code: string };
  await authService.disableTotp(req.user!.userId, password, code);
  res.status(204).send();
}

export async function regenerateBackupCodes(req: Request, res: Response): Promise<void> {
  const backupCodes = await authService.regenerateBackupCodes(req.user!.userId);
  res.status(200).json({ backupCodes });
}
