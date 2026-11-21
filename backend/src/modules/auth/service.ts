import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { describeMailError } from "../../integrations/mail";
import { writeAuditLog } from "../../lib/audit";
import { default2faRoles, with2faDirectors } from "../../lib/authDefaults";
import { directorTwoFactorRequired } from "../../lib/directorAuthority";
import { getSetting } from "../../lib/settings";
import { resolveAccess, resolveUserRoleCodes } from "../../lib/permissions";
import { signAccessToken, signTotpChallengeToken, verifyTotpChallengeToken } from "../../lib/jwt";
import { HttpError } from "../../middleware/errorHandler";
import { createJoiningPost } from "../engage/autoPosts";
import {
  checkRefreshToken,
  findRefreshTokenByRawToken,
  issueRefreshToken,
  listActiveSessions,
  revokeAllUserRefreshTokens,
  revokeRefreshTokenById,
  rotateRefreshToken,
} from "./tokens";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
  generateTotpEnrollment,
  generateTotpSecret,
  hashBackupCode,
  consumeTotpCode,
  verifyTotpCode,
} from "./totp";
import { sendInvitationEmail, sendPasswordResetEmail, sendWelcomeEmail } from "./emails";
import type { LoginResult, LoginTokens, RequestMetaInput } from "./types";
import { inForceOn } from "../../lib/effectiveDating";
import { behaviourValue } from "../behaviours/service";
import { redis, withTimeout } from "../../lib/redis";
import { createNotification } from "../notifications/service";
import { findEmployeeIdByLoginId, normaliseLoginId } from "./loginId";

interface MinimalEmployee {
  employeeCode: string;
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function getRequire2faRoles(): Promise<string[]> {
  // The setting wins when it exists; otherwise the environment's starting value (lib/authDefaults.ts). Directors are added only when the owners have required it for them.
  return with2faDirectors(await getSetting<string[]>("auth.require2faRoles", default2faRoles()), await directorTwoFactorRequired());
}

async function getLockoutConfig(): Promise<{ maxAttempts: number; lockoutMinutes: number }> {
  return getSetting("auth.lockout", { maxAttempts: 5, lockoutMinutes: 15 });
}

// The setup link HR sends (an invitation): 7 days unless the setting says otherwise (owner decision 2026-11-17, docs/plans/LOGIN_CHECKLIST.md).
export const DEFAULT_INVITATION_TTL_HOURS = 168;
async function getInvitationTtlHours(): Promise<number> {
  return getSetting("auth.invitationTtlHours", DEFAULT_INVITATION_TTL_HOURS);
}

// A "Forgot password" link: Default behaviours, "Forgot-password link" (two directors; default 60 minutes, shown as "Default in use").
async function getPasswordResetTtlMinutes(): Promise<number> {
  return (await behaviourValue("auth.passwordResetLinkMinutes")).value;
}

// The Zod schema's own .min(8) (validators.ts) is an absolute floor that
// can't be misconfigured away — this is the System Settings screen's own
// knob for HR to require something stricter (e.g. 10+ characters), checked
// wherever a password is actually set.
async function assertPasswordMeetsPolicy(password: string): Promise<void> {
  const minLength = await getSetting("auth.passwordMinLength", 8);
  if (password.length < minLength) {
    throw new HttpError(400, `Password must be at least ${minLength} characters.`, "VALIDATION_ERROR");
  }
}

async function verifyTotpOrBackupCode(user: User, code: string): Promise<boolean> {
  if (user.totpSecretEncrypted) {
    const secret = decryptTotpSecret(user.totpSecretEncrypted);
    if ((await verifyTotpCode(secret, code)) && (await consumeTotpCode(user.id, code))) {
      return true;
    }
  }
  const backupCode = await prisma.totpBackupCode.findFirst({
    where: { userId: user.id, codeHash: hashBackupCode(code), usedAt: null },
  });
  if (backupCode) {
    await prisma.totpBackupCode.update({ where: { id: backupCode.id }, data: { usedAt: new Date() } });
    return true;
  }
  return false;
}

async function completeLogin(
  user: User,
  employee: MinimalEmployee,
  roleCodes: string[],
  meta: RequestMetaInput,
): Promise<LoginTokens> {
  const fresh = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() }, select: { sessionVersion: true } });
  const accessToken = signAccessToken(user.id, fresh.sessionVersion);
  const { token: refreshToken, row: refreshRow } = await issueRefreshToken(user.id, meta);
  await writeAuditLog({
    actorUserId: user.id,
    action: "auth.login.success",
    entityType: "User",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return {
    status: "authenticated",
    accessToken,
    refreshToken,
    refreshExpiresAt: refreshRow.expiresAt,
    user: {
      employeeCode: employee.employeeCode,
      roleCodes,
      privacyNoticeAccepted: user.privacyNoticeAcceptedAt !== null,
    },
  };
}

// A real account's own record of its failed sign-ins, for HR's and directors' screens (Locked out, Unlock) and the audit log. The decision to refuse
// is not taken from here but from the per-number counter (loginFailureCount below), which every typed number has, real or not; this record copies
// that count, so the lock HR sees starts and ends with it.
async function recordFailedLogin(userId: string, meta: RequestMetaInput, failuresForThisNumber: number): Promise<void> {
  const { maxAttempts, lockoutMinutes } = await getLockoutConfig();
  const lockedOut = failuresForThisNumber >= maxAttempts;
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: failuresForThisNumber, ...(lockedOut ? { lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000) } : {}) },
  });
  await writeAuditLog({
    actorUserId: userId,
    action: lockedOut ? "auth.login.lockout" : "auth.login.failed",
    entityType: "User",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// ── Sign-in throttling (follow-up 2, docs/plans/LOGIN_REPORT.md) ─────────
// Failed sign-ins are counted per employee number as typed (normalised as login matches it) whether or not the number exists, and per IP. Once
// either count reaches its limit, every attempt for that number (or from that IP) gets one reply, the same for a real locked account and a number
// nobody holds: 429, LOGIN_TOO_MANY_MESSAGE, padded like every failure. Limits: per number = auth.lockout (default 5 failures, lock for 15
// minutes, counted within that window); per IP = auth.rateLimit.login (default 10 failures in 15 minutes). The lock ends by itself when the counter
// expires, or when HR or a director unlocks the account (adminUnlock clears the counter too).
export const LOGIN_TOO_MANY_MESSAGE = "Too many attempts. Try again later or ask HR to unlock your account.";
export const LOGIN_IP_LIMIT_DEFAULT = { maxAttempts: 100, windowSeconds: 900 }; // FIX-H2: was 10; the value in force is the Default behaviour auth.loginIpFailureLimit

function loginNumberKey(raw: string): string {
  return `ratelimit:auth.loginFail.id:${normaliseLoginId(raw).toLowerCase()}`;
}
function loginIpKey(ip: string | null | undefined): string {
  return `ratelimit:auth.loginFail.ip:${ip ?? "unknown"}`;
}

// FIX-H2 (independent audit 2026-11-20): an office reaches the internet through one address, so ten typos at 9:30 locked the whole branch out. The per-address
// limit is now the two-director Default behaviour "auth.loginIpFailureLimit" (default 100 failures in 15 minutes, far above an office's typos); a director or
// an HR Admin sees and clears a blocked address (Waiting for Confirmation), and unlocking an account clears the addresses it failed from. Over the limit,
// every sign-in from that address waits, correct passwords included: exempting numbers with no failures of their own would let a password spray (one guess
// against each of many numbers) run without any limit (found by trustProxy.test.ts in the final full run, 2026-11-21).
export async function loginIpLimit(): Promise<{ maxAttempts: number; windowSeconds: number }> {
  return (await behaviourValue("auth.loginIpFailureLimit")).value;
}
function loginNumberIpsKey(raw: string): string {
  return `ratelimit:auth.loginFail.ips:${normaliseLoginId(raw).toLowerCase()}`;
}

async function loginOverLimit(raw: string, ip: string | null | undefined): Promise<boolean> {
  const [{ maxAttempts }, ipLimit] = await Promise.all([getLockoutConfig(), loginIpLimit()]);
  const [forNumber, forIp] = await redis.mget(loginNumberKey(raw), loginIpKey(ip));
  const numberFailures = Number(forNumber ?? 0);
  if (numberFailures >= maxAttempts) return true;
  return Number(forIp ?? 0) >= ipLimit.maxAttempts;
}

/** Counts one failed sign-in for the number typed and for the IP; returns the number's count. The same for every number, held or not. */
async function loginFailureCount(raw: string, ip: string | null | undefined): Promise<number> {
  const [{ maxAttempts, lockoutMinutes }, ipLimit] = await Promise.all([getLockoutConfig(), loginIpLimit()]);
  const numberKey = loginNumberKey(raw);
  const forNumber = await redis.incr(numberKey);
  // The window opens with the first failure; the failure that reaches the limit starts the lock period afresh, so the lock lasts lockoutMinutes.
  if (forNumber === 1 || forNumber === maxAttempts) await redis.expire(numberKey, lockoutMinutes * 60);
  const ipKey = loginIpKey(ip);
  if ((await redis.incr(ipKey)) === 1) await redis.expire(ipKey, ipLimit.windowSeconds);
  // FIX-H2: which addresses this number failed from, so unlocking the account clears those address counters too.
  const ipsKey = loginNumberIpsKey(raw);
  await redis.sadd(ipsKey, ip ?? "unknown");
  await redis.expire(ipsKey, Math.max(lockoutMinutes * 60, ipLimit.windowSeconds));
  return forNumber;
}

/** Clears the failed-sign-in counters for an employee number (HR or director unlock): the number's own, and those of the addresses it failed from. */
export async function clearLoginFailures(employeeCode: string): Promise<void> {
  const ips = await redis.smembers(loginNumberIpsKey(employeeCode));
  await redis.del(loginNumberKey(employeeCode), loginNumberIpsKey(employeeCode), ...ips.map((ip) => loginIpKey(ip)));
}

/** FIX-H2: the addresses currently over the limit, for the directors' and HR Admin's screen. */
export async function listLoginIpBlocks(): Promise<Array<{ ip: string; failures: number; secondsLeft: number }>> {
  const { maxAttempts } = await loginIpLimit();
  const out: Array<{ ip: string; failures: number; secondsLeft: number }> = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", "ratelimit:auth.loginFail.ip:*", "COUNT", 200);
    cursor = next;
    for (const key of keys) {
      const [count, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
      if (Number(count ?? 0) >= maxAttempts) out.push({ ip: key.slice("ratelimit:auth.loginFail.ip:".length), failures: Number(count), secondsLeft: Math.max(ttl, 0) });
    }
  } while (cursor !== "0");
  return out.sort((a, b) => b.failures - a.failures);
}

export async function clearLoginIpBlock(ip: string): Promise<boolean> {
  return (await redis.del(loginIpKey(ip))) > 0;
}

// The one reply every failed sign-in gets (owner decision 2026-11-18, docs/plans/LOGIN_REPORT.md): an unknown number, a wrong password and an
// invited account with no password yet (and a suspended or deactivated one) are indistinguishable — same status, same words, same timing. The
// first-time hint lives on the login screen as static text instead. Only the existing lockout keeps its own reply (unchanged rule).
export const LOGIN_FAILED_MESSAGE = "The employee number or password is not correct.";

// Every failed sign-in takes at least this long. Each failure path also does the same expensive step (one argon2 verify, against the real hash or
// a dummy one), so the floor only has to absorb the small database writes a wrong password adds.
export const LOGIN_FAILURE_MIN_DURATION_MS = 400;
// The over-limit reply is padded to the same floor.

let dummyPasswordHash: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyPasswordHash ??= argon2.hash(randomBytes(16).toString("hex"));
  return dummyPasswordHash;
}

// FIX-M3 (independent audit 2026-11-20): when the failed-sign-in store (Redis) is down or slow, sign-in answers within 2 s with a plain 503 and FAILS CLOSED:
// nobody is let in without the attempt being counted. Every store call in the sign-in path goes through this.
export const SIGN_IN_UNAVAILABLE_MESSAGE = "Sign-in is temporarily unavailable. Try again shortly.";
async function rateStore<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(fn(), 1500, "sign-in rate store");
  } catch (err) {
    logger.error({ err }, "sign-in rate store unavailable");
    throw new HttpError(503, SIGN_IN_UNAVAILABLE_MESSAGE, "SIGN_IN_UNAVAILABLE");
  }
}

// spec §3: login = employee number + password.
export async function login(employeeCode: string, password: string, meta: RequestMetaInput): Promise<LoginResult> {
  const started = Date.now();
  const pad = async (): Promise<void> => {
    const elapsed = Date.now() - started;
    if (elapsed < LOGIN_FAILURE_MIN_DURATION_MS) await new Promise((resolve) => setTimeout(resolve, LOGIN_FAILURE_MIN_DURATION_MS - elapsed));
  };
  const fail = async (): Promise<never> => {
    await pad();
    throw new HttpError(401, LOGIN_FAILED_MESSAGE, "INVALID_CREDENTIALS");
  };
  const tooMany = async (): Promise<never> => {
    await pad();
    throw new HttpError(429, LOGIN_TOO_MANY_MESSAGE, "TOO_MANY_ATTEMPTS");
  };
  // The same work as checking a real password, for a person who has none to check.
  const burnVerify = async (): Promise<void> => {
    await argon2.verify(await dummyHash(), password).catch(() => false);
  };

  // Over the limit for this number (held or not) or for this IP: decided before anything is looked up, so the reply cannot depend on the number.
  if (await rateStore(() => loginOverLimit(employeeCode, meta.ipAddress))) {
    await burnVerify();
    return tooMany();
  }

  // The employee number, matched exactly after trimming spaces and ignoring case (loginId.ts).
  const employeeId = await findEmployeeIdByLoginId(employeeCode);
  const employee = employeeId ? await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true } }) : null;
  if (!employee?.user) {
    await burnVerify();
    await rateStore(() => loginFailureCount(employeeCode, meta.ipAddress));
    return fail();
  }
  const user = employee.user;

  // Invited (no password yet), suspended or deactivated: exactly the reply an unknown number gets, counted the same way.
  if (user.status !== "ACTIVE") {
    await burnVerify();
    await rateStore(() => loginFailureCount(employeeCode, meta.ipAddress));
    return fail();
  }
  // A lock recorded on the account whose counter has gone (for example Redis was emptied): still refused, with the same over-limit reply.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await burnVerify();
    return tooMany();
  }
  if (!user.passwordHash) {
    await burnVerify();
    await recordFailedLogin(user.id, meta, await rateStore(() => loginFailureCount(employeeCode, meta.ipAddress)));
    return fail();
  }
  if (!(await argon2.verify(user.passwordHash, password))) {
    await recordFailedLogin(user.id, meta, await rateStore(() => loginFailureCount(employeeCode, meta.ipAddress)));
    return fail();
  }
  await rateStore(() => clearLoginFailures(employeeCode));

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });

  const roleCodes = await resolveUserRoleCodes(user.id);
  const require2fa = await getRequire2faRoles();
  const needs2fa = roleCodes.some((code) => require2fa.includes(code));

  if (needs2fa && !user.totpEnabled) {
    const challengeToken = signTotpChallengeToken(user.id, "totp_setup_challenge");
    return { status: "requires_totp_setup", challengeToken };
  }
  // Anyone who has 2FA turned on is asked for the code, whether or not their role requires it: a person who switched it on themselves would otherwise be let in
  // by the password alone, which made their 2FA decorative (found while checking every login path for the 2FA time-step edge, 2026-10-22).
  if (needs2fa || user.totpEnabled) {
    const challengeToken = signTotpChallengeToken(user.id, "totp_challenge");
    return { status: "requires_totp", challengeToken };
  }
  return completeLogin(user, employee, roleCodes, meta);
}

export async function completeLoginTotp(
  challengeToken: string,
  code: string,
  meta: RequestMetaInput,
): Promise<LoginTokens> {
  let userId: string;
  try {
    userId = verifyTotpChallengeToken(challengeToken, "totp_challenge");
  } catch {
    throw new HttpError(401, "Invalid or expired challenge.", "INVALID_CHALLENGE");
  }

  const employee = await prisma.employee.findFirst({ where: { user: { id: userId } }, include: { user: true } });
  const user = employee?.user;
  if (!employee || !user || user.status !== "ACTIVE" || !user.totpEnabled) {
    throw new HttpError(401, "Invalid or expired challenge.", "INVALID_CHALLENGE");
  }

  if (!(await verifyTotpOrBackupCode(user, code))) {
    await writeAuditLog({
      actorUserId: user.id,
      action: "auth.login.totp_failed",
      entityType: "User",
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw new HttpError(401, "Invalid authentication code.", "INVALID_TOTP");
  }

  const roleCodes = await resolveUserRoleCodes(user.id);
  return completeLogin(user, employee, roleCodes, meta);
}

export async function refresh(
  presentedToken: string,
  meta: RequestMetaInput,
): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date }> {
  const outcome = await checkRefreshToken(presentedToken);

  if (outcome.kind === "reused") {
    await revokeAllUserRefreshTokens(outcome.userId);
    await writeAuditLog({
      actorUserId: outcome.userId,
      action: "auth.refresh.reuse_detected",
      entityType: "User",
      entityId: outcome.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw new HttpError(401, "Session invalid. Please log in again.", "TOKEN_REUSE_DETECTED");
  }
  if (outcome.kind === "not_found" || outcome.kind === "expired") {
    throw new HttpError(401, "Session expired. Please log in again.", "INVALID_REFRESH_TOKEN");
  }

  const user = await prisma.user.findUnique({ where: { id: outcome.row.userId } });
  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "Account is not active.", "UNAUTHENTICATED");
  }

  const rotated = await rotateRefreshToken(outcome.row, meta);
  if (!rotated) {
    // Lost a genuine concurrent-rotation race (see tokens.ts) — a
    // different in-flight request already rotated this exact token
    // first, so it's not reuse (no attack signal, don't revoke the
    // chain), just stale from this call's point of view. The client
    // already has, or is about to receive, a valid session from the
    // request that won; asking it to retry (rather than treating this as
    // a hard logout) matches that.
    throw new HttpError(401, "Session refresh in progress elsewhere. Please retry.", "REFRESH_RACE_LOST");
  }
  const { token: newRefreshToken, row: newRow } = rotated;
  const accessToken = signAccessToken(user.id, user.sessionVersion);
  await writeAuditLog({
    actorUserId: user.id,
    action: "auth.refresh.rotated",
    entityType: "User",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return { accessToken, refreshToken: newRefreshToken, refreshExpiresAt: newRow.expiresAt };
}

export async function logout(presentedToken: string | undefined, userId: string): Promise<void> {
  if (presentedToken) {
    const row = await findRefreshTokenByRawToken(presentedToken);
    if (row && row.userId === userId) {
      await revokeRefreshTokenById(row.id);
    }
  }
  await writeAuditLog({ actorUserId: userId, action: "auth.logout", entityType: "User", entityId: userId });
}

export async function logoutAll(userId: string): Promise<void> {
  await revokeAllUserRefreshTokens(userId);
  await writeAuditLog({ actorUserId: userId, action: "auth.logout_all", entityType: "User", entityId: userId });
}

export async function getSessions(userId: string) {
  return listActiveSessions(userId);
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const row = await prisma.refreshToken.findUnique({ where: { id: sessionId } });
  if (!row || row.userId !== userId) {
    // Same 404 whether the session belongs to someone else or doesn't
    // exist at all — never confirm another user's session ids (IDOR).
    throw new HttpError(404, "Session not found.", "NOT_FOUND");
  }
  await revokeRefreshTokenById(sessionId);
  await writeAuditLog({ actorUserId: userId, action: "auth.session.revoked", entityType: "RefreshToken", entityId: sessionId });
}

// What happened to an invitation, in terms a screen can state without guessing (see invitation_tokens.email_*):
//   SENT       a real mail server accepted the email for delivery (it is "sent", not "read": nothing here can promise an inbox);
//   FILE_ONLY  the system is set to write emails to a file (development, MAIL_DRIVER=console): nothing was sent to anyone;
//   FAILED     sending was attempted and failed; `error` says why, in words;
//   NOT_SENT   no invitation has been issued yet (an imported employee HR has not invited).
export type InvitationDelivery = {
  status: "SENT" | "FILE_ONLY" | "FAILED" | "NOT_SENT";
  to: string;
  driver?: string | undefined;
  error?: string | undefined;
  attemptedAt?: string | undefined;
  sentAt?: string | undefined;
};

type TokenDelivery = { emailTo: string | null; emailDriver: string | null; emailAttemptedAt: Date | null; emailSentAt: Date | null; emailError: string | null };

function deliveryOf(token: TokenDelivery | null, fallbackTo: string): InvitationDelivery {
  if (!token || !token.emailAttemptedAt) return { status: "NOT_SENT", to: token?.emailTo ?? fallbackTo };
  return {
    status: token.emailSentAt ? "SENT" : token.emailError ? "FAILED" : "FILE_ONLY",
    to: token.emailTo ?? fallbackTo,
    driver: token.emailDriver ?? undefined,
    error: token.emailError ?? undefined,
    attemptedAt: token.emailAttemptedAt.toISOString(),
    sentAt: token.emailSentAt?.toISOString(),
  };
}

/** The state of the latest invitation issued to a user, for the profile and the list of people still waiting. */
export async function latestInvitationDelivery(userId: string, email: string): Promise<InvitationDelivery> {
  const token = await prisma.invitationToken.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return deliveryOf(token, email);
}

// Called by the employee module right after creating a new hire's User row
// (status INVITED) — issues the single-use set-password token (TTL from the
// auth.invitationTtlHours System Setting, spec §7.8) and sends the
// invitation email. Every send is audit-logged here, one row per attempt (`auth.invitation.email`: to whom, the outcome, the driver, when, the error if it
// failed, and who triggered it), so there is a record of whether and when each person was sent their link, whichever path sent it.
//
// A failed email never makes this throw (the employee exists either way) and is never hidden: the result says exactly what happened and the same is stored on the token, so
// HR is told "not sent, and why" instead of believing someone was invited.
export async function createInvitation(params: {
  userId: string;
  email: string;
  fullName: string;
  employeeCode: string;
  actorUserId?: string | null;
}): Promise<{ link: string; delivery: InvitationDelivery }> {
  const raw = generateOpaqueToken();
  const ttlHours = await getInvitationTtlHours();
  const token = await prisma.invitationToken.create({
    data: {
      userId: params.userId,
      tokenHash: hashOpaqueToken(raw),
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      createdByUserId: params.actorUserId ?? null,
      emailTo: params.email,
    },
  });
  const attemptedAt = new Date();
  let delivery: InvitationDelivery;
  try {
    const receipt = await sendInvitationEmail(params.email, params.fullName, params.employeeCode, raw);
    const updated = await prisma.invitationToken.update({
      where: { id: token.id },
      data: { emailDriver: receipt.driver, emailAttemptedAt: attemptedAt, emailSentAt: receipt.delivered ? attemptedAt : null },
    });
    delivery = deliveryOf(updated, params.email);
  } catch (err: unknown) {
    logger.error({ err, to: params.email }, "failed to send invitation email");
    const updated = await prisma.invitationToken.update({
      where: { id: token.id },
      data: { emailDriver: env.MAIL_DRIVER, emailAttemptedAt: attemptedAt, emailError: describeMailError(err) },
    });
    delivery = deliveryOf(updated, params.email);
  }
  try {
    await writeAuditLog({
      actorUserId: params.actorUserId ?? null,
      action: "auth.invitation.email",
      entityType: "InvitationToken",
      entityId: token.id,
      after: {
        userId: params.userId,
        employeeCode: params.employeeCode,
        to: delivery.to,
        outcome: delivery.status,
        driver: delivery.driver ?? null,
        attemptedAt: delivery.attemptedAt ?? attemptedAt.toISOString(),
        sentAt: delivery.sentAt ?? null,
        error: delivery.error ?? null,
      },
    });
  } catch (err: unknown) {
    // The invitation exists and the email has been dealt with either way; a record that could not be written is logged, never allowed to undo them.
    logger.error({ err }, "failed to record the invitation email in the audit log");
  }
  // `link` is returned only for the SUPER_ADMIN bootstrap CLI's --print-link
  // (modules/access/bootstrap.ts); every other caller ignores it.
  return { link: `${env.WEB_BASE_URL}/set-password/${raw}`, delivery };
}

// Resend: invalidates any still-outstanding invitation tokens for this user
// (a stale link should stop working once a fresher one is issued) and
// issues a new one. HR-triggered — see employee module's resend-invite
// endpoint, which is what actually audit-logs this action.
export async function resendInvitation(userId: string, email: string, fullName: string, employeeCode: string, actorUserId?: string | null): Promise<{ link: string; delivery: InvitationDelivery }> {
  await prisma.invitationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  return createInvitation({ userId, email, fullName, employeeCode, actorUserId: actorUserId ?? null });
}

export async function getInvitationDetails(token: string): Promise<{ employeeCode: string; fullName: string }> {
  const row = await prisma.invitationToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new HttpError(400, "This invitation link is invalid or has expired.", "INVALID_INVITATION");
  }
  const employee = await prisma.employee.findFirst({
    where: { user: { id: row.userId } },
    include: { nameHistory: { where: inForceOn() } },
  });
  if (!employee) {
    throw new HttpError(400, "This invitation link is invalid or has expired.", "INVALID_INVITATION");
  }
  return { employeeCode: employee.employeeCode, fullName: employee.nameHistory[0]?.fullName ?? employee.employeeCode };
}

export async function acceptInvitation(
  token: string,
  password: string,
  meta: RequestMetaInput,
): Promise<LoginResult> {
  const row = await prisma.invitationToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new HttpError(400, "This invitation link is invalid or has expired.", "INVALID_INVITATION");
  }
  await assertPasswordMeetsPolicy(password);

  const passwordHash = await argon2.hash(password);
  // Single use, atomically (as resetPassword): only the request that claims the unused token sets the password.
  const user = await prisma.$transaction(async (tx) => {
    const claim = await tx.invitationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count === 0) return null;
    return tx.user.update({ where: { id: row.userId }, data: { passwordHash, status: "ACTIVE" } });
  });
  if (!user) {
    throw new HttpError(400, "This invitation link is invalid or has expired.", "INVALID_INVITATION");
  }
  // FIX-C1 (independent audit 2026-11-20): using a setup link ends every other session of the account (none should exist; if one does, it is not this person's).
  await revokeAllUserRefreshTokens(user.id);

  const employee = await prisma.employee.findFirst({
    where: { user: { id: user.id } },
    include: { personal: true, nameHistory: { where: inForceOn() } },
  });
  if (!employee) {
    throw new HttpError(500, "Employee record not found for this account.", "INTERNAL_ERROR");
  }
  const fullName = employee.nameHistory[0]?.fullName ?? employee.employeeCode;

  await writeAuditLog({
    actorUserId: user.id,
    action: "auth.invitation.accepted",
    entityType: "User",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  // The real joining event (spec §8) — fires here, not on the daily
  // Engage cron, which only ever scans for birthdays/anniversaries. Never
  // throws (createAutoPost's own try/catch swallows and logs), so a
  // transient failure here can't block the account activation this
  // function exists to complete.
  await createJoiningPost(employee.id);

  if (employee.personal?.personalEmail) {
    sendWelcomeEmail(employee.personal.personalEmail, fullName).catch((err: unknown) =>
      logger.error({ err }, "failed to send welcome email"),
    );
  }

  const roleCodes = await resolveUserRoleCodes(user.id);
  const require2fa = await getRequire2faRoles();
  if (roleCodes.some((code) => require2fa.includes(code))) {
    const challengeToken = signTotpChallengeToken(user.id, "totp_setup_challenge");
    return { status: "requires_totp_setup", challengeToken };
  }
  return completeLogin(user, employee, roleCodes, meta);
}

// Every "Forgot password" request, whatever happens inside, takes at least this long and gets the same reply (controller.ts), so neither the words
// nor the time tell anyone whether an employee number exists. The real work is a few small queries (mail goes out in the background), well
// under the floor.
export const FORGOT_PASSWORD_MIN_DURATION_MS = 400;

// Per employee number, on top of the per-IP limit in routes.ts: stops one person's inbox being flooded from many addresses. Counted for every
// number typed, held or not, so hitting it says nothing about whether the number exists.
export const FORGOT_PASSWORD_PER_LOGIN_DEFAULT = { maxAttempts: 3, windowSeconds: 3600 };

async function assertForgotPasswordPerLoginLimit(loginId: string): Promise<void> {
  const config = await getSetting("auth.rateLimit.forgotPasswordPerLogin", FORGOT_PASSWORD_PER_LOGIN_DEFAULT);
  const key = `ratelimit:auth.forgotPasswordPerLogin:${normaliseLoginId(loginId).toLowerCase()}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, config.windowSeconds);
  if (count > config.maxAttempts) {
    throw new HttpError(429, "Too many requests for this employee number. Please wait an hour and try again, or ask HR.", "RATE_LIMITED");
  }
}

const HR_ROLE_CODES = ["HR_ADMIN", "HR_EXECUTIVE"];

/**
 * A link was asked for (by the person, or by HR sending a setup link) but there is no email on record, so nothing was sent. HR is told, by number
 * only: the notice row behind the employee screen and the pending-invitations list, and an in-app notification to each active HR user.
 */
export async function recordNoEmailOnRecord(employee: { id: string; employeeCode: string }, actorUserId: string | null, meta: RequestMetaInput = {}): Promise<void> {
  await prisma.loginEmailMissingNotice.upsert({
    where: { employeeId: employee.id },
    create: { employeeId: employee.id },
    update: { requestCount: { increment: 1 }, lastRequestedAt: new Date() },
  });
  await writeAuditLog({
    actorUserId,
    action: "auth.link.no_email_on_record",
    entityType: "Employee",
    entityId: employee.id,
    after: { employeeCode: employee.employeeCode, sent: false },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  const hrUsers = await prisma.user.findMany({
    where: { status: "ACTIVE", roles: { some: { role: { code: { in: HR_ROLE_CODES } } } } },
    select: { id: true },
  });
  for (const hr of hrUsers) {
    await createNotification({
      userId: hr.id,
      type: "auth.no_email_on_record",
      title: `No email on record for employee ${employee.employeeCode}`,
      body: `A password link was asked for, but employee ${employee.employeeCode} has no email on record, so nothing was sent. Add their email, then send a setup link.`,
      link: `/admin/employee/profile/${employee.id}`,
      payload: { employeeId: employee.id, employeeCode: employee.employeeCode },
    });
  }
}

/** The email on record for an employee, or null when there is none (an empty or blank value counts as none). */
export function emailOnRecord(personal: { personalEmail: string | null } | null | undefined): string | null {
  const email = personal?.personalEmail?.trim();
  return email ? email : null;
}

// Identical reply and (padded) identical timing whether or not the number exists — see controller.ts, which always responds with the same
// sentence. INVITED accounts get a link too: that is how a new person sets their first password (owner decision 2026-11-17). The link goes only
// to the email on record; nothing in the request can choose the address.
export async function forgotPassword(employeeCode: string, meta: RequestMetaInput): Promise<void> {
  const start = Date.now();
  try {
    await assertForgotPasswordPerLoginLimit(employeeCode);

    const employeeId = await findEmployeeIdByLoginId(employeeCode);
    const employee = employeeId
      ? await prisma.employee.findUnique({ where: { id: employeeId }, include: { user: true, personal: true, nameHistory: { where: inForceOn() } } })
      : null;
    const user = employee?.user;

    if (employee && user && (user.status === "ACTIVE" || user.status === "INVITED")) {
      const email = emailOnRecord(employee.personal);
      if (!email) {
        await recordNoEmailOnRecord(employee, null, meta);
      } else {
        const raw = generateOpaqueToken();
        const ttlMinutes = await getPasswordResetTtlMinutes();
        const token = await prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashOpaqueToken(raw), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
        });
        const fullName = employee.nameHistory[0]?.fullName ?? employee.employeeCode;
        sendPasswordResetEmail(email, fullName, raw).catch((err: unknown) => logger.error({ err }, "failed to send password reset email"));
        // Who and what, never the token.
        await writeAuditLog({
          actorUserId: user.id,
          action: "auth.forgot_password.requested",
          entityType: "User",
          entityId: user.id,
          after: { tokenId: token.id, accountStatus: user.status, expiresInMinutes: ttlMinutes },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
      }
    }
  } finally {
    const elapsed = Date.now() - start;
    if (elapsed < FORGOT_PASSWORD_MIN_DURATION_MS) {
      await new Promise((resolve) => setTimeout(resolve, FORGOT_PASSWORD_MIN_DURATION_MS - elapsed));
    }
  }
}

// FIX-M1 (independent audit 2026-11-20): an authenticated change of one's own password. The current password is checked (argon2), the new one meets the
// policy, every session ends (refresh tokens revoked, session version raised: every access token already issued stops at once), and this device gets a new pair.
export async function changePassword(userId: string, currentPassword: string, newPassword: string, meta: RequestMetaInput): Promise<{ accessToken: string; refreshToken: string; refreshExpiresAt: Date }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) throw new HttpError(401, "Not signed in.", "UNAUTHENTICATED");
  if (!(await argon2.verify(user.passwordHash, currentPassword))) {
    await writeAuditLog({ actorUserId: userId, action: "auth.password.change_failed", entityType: "User", entityId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
    throw new HttpError(400, "Your current password is not correct.", "WRONG_PASSWORD");
  }
  await assertPasswordMeetsPolicy(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(newPassword) } });
  await prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  await revokeAllUserRefreshTokens(userId);
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } });
  const { token: refreshToken, row } = await issueRefreshToken(userId, meta);
  await writeAuditLog({ actorUserId: userId, action: "auth.password.changed", entityType: "User", entityId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
  return { accessToken: signAccessToken(userId, fresh.sessionVersion), refreshToken, refreshExpiresAt: row.expiresAt };
}

export async function resetPassword(token: string, password: string, meta: RequestMetaInput): Promise<void> {
  const invalid = () => new HttpError(400, "This reset link is invalid or has expired.", "INVALID_RESET_TOKEN");
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw invalid();
  // A suspended or deactivated account cannot get back in through an old link.
  if (row.user.status !== "ACTIVE" && row.user.status !== "INVITED") throw invalid();
  await assertPasswordMeetsPolicy(password);

  const activating = row.user.status === "INVITED";
  const passwordHash = await argon2.hash(password);
  const now = new Date();
  // Single use, atomically: the claim only succeeds while the token is still unused, so two concurrent submissions cannot both set a password.
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    if (claim.count === 0) return false;
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, ...(activating ? { status: "ACTIVE" as const } : {}) } });
    // A fresh password makes every other outstanding link for this person pointless: use them all up.
    await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
    if (activating) await tx.invitationToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
    return true;
  });
  if (!claimed) throw invalid();

  await revokeAllUserRefreshTokens(row.userId); // force re-login on every device after a reset
  await writeAuditLog({
    actorUserId: row.userId,
    action: activating ? "auth.account.activated_by_reset" : "auth.password.reset",
    entityType: "User",
    entityId: row.userId,
    after: { tokenId: row.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  // The same joining post accepting an invitation makes: this is the person's first sign-in either way. Never throws.
  if (activating) await createJoiningPost(row.user.employeeId);
}

export async function acceptPrivacyNotice(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { privacyNoticeAcceptedAt: new Date() } });
  await writeAuditLog({ actorUserId: userId, action: "auth.privacy_notice.accepted", entityType: "User", entityId: userId });
}

export async function getMe(userId: string) {
  const employee = await prisma.employee.findFirst({
    where: { user: { id: userId } },
    include: { user: true, nameHistory: { where: inForceOn() } },
  });
  if (!employee?.user) {
    throw new HttpError(404, "Not found", "NOT_FOUND");
  }
  // The same resolver every request uses (lib/permissions.ts), so what the
  // UI shows is exactly what the server enforces.
  const { roleCodes, permissions, dataScope } = await resolveAccess(userId);
  return {
    employeeCode: employee.employeeCode,
    employeeId: employee.id,
    fullName: employee.nameHistory[0]?.fullName ?? employee.employeeCode,
    roleCodes,
    permissions: Array.from(permissions),
    dataScope,
    totpEnabled: employee.user.totpEnabled,
    privacyNoticeAccepted: employee.user.privacyNoticeAcceptedAt !== null,
    // True only in the development database that holds the made-up demo company: every screen then says so (docs/plans/PHASE_6.md §14J).
    demoCompany: (await getSetting<boolean>("demo.company", false)) === true,
  };
}

// ── TOTP setup/verify/disable ───────────────────────────────────────────

export async function setupTotp(userId: string): Promise<{ qrCodeDataUrl: string; secret: string }> {
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpSecretEncrypted: encryptTotpSecret(secret) } });
  const employee = await prisma.employee.findFirst({ where: { user: { id: userId } } });
  await writeAuditLog({ actorUserId: userId, action: "auth.2fa.setup_started", entityType: "User", entityId: userId });
  return generateTotpEnrollment(employee?.employeeCode ?? userId, secret);
}

export async function verifyTotpSetup(userId: string, code: string): Promise<{ backupCodes: string[] }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpSecretEncrypted) {
    throw new HttpError(400, "No 2FA setup in progress.", "NO_TOTP_SETUP");
  }
  const secret = decryptTotpSecret(user.totpSecretEncrypted);
  if (!(await verifyTotpCode(secret, code)) || !(await consumeTotpCode(userId, code))) {
    throw new HttpError(401, "Invalid authentication code.", "INVALID_TOTP");
  }

  const backupCodes = generateBackupCodes();
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { totpEnabled: true, totpVerifiedAt: new Date() } }),
    prisma.totpBackupCode.deleteMany({ where: { userId } }),
    prisma.totpBackupCode.createMany({ data: backupCodes.map((code_) => ({ userId, codeHash: hashBackupCode(code_) })) }),
  ]);
  await writeAuditLog({ actorUserId: userId, action: "auth.2fa.enabled", entityType: "User", entityId: userId });
  return { backupCodes };
}

export async function completeLoginAfterTotpSetup(userId: string, meta: RequestMetaInput): Promise<LoginTokens> {
  const employee = await prisma.employee.findFirst({ where: { user: { id: userId } }, include: { user: true } });
  if (!employee?.user) {
    throw new HttpError(401, "Invalid session.", "UNAUTHENTICATED");
  }
  const roleCodes = await resolveUserRoleCodes(userId);
  return completeLogin(employee.user, employee, roleCodes, meta);
}

export async function disableTotp(userId: string, password: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
    throw new HttpError(401, "Incorrect password.", "INVALID_CREDENTIALS");
  }

  const roleCodes = await resolveUserRoleCodes(userId);
  const require2fa = await getRequire2faRoles();
  if (roleCodes.some((roleCode) => require2fa.includes(roleCode))) {
    throw new HttpError(
      403,
      "Your role requires 2FA to stay enabled. Ask a Super Admin to reset it if you need to re-enroll.",
      "TOTP_REQUIRED_BY_ROLE",
    );
  }
  if (!user.totpSecretEncrypted || !(await verifyTotpOrBackupCode(user, code))) {
    throw new HttpError(401, "Invalid authentication code.", "INVALID_TOTP");
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecretEncrypted: null, totpVerifiedAt: null } }),
    prisma.totpBackupCode.deleteMany({ where: { userId } }),
  ]);
  await writeAuditLog({ actorUserId: userId, action: "auth.2fa.disabled", entityType: "User", entityId: userId });
}

export async function regenerateBackupCodes(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpEnabled) {
    throw new HttpError(400, "2FA is not enabled.", "TOTP_NOT_ENABLED");
  }
  const backupCodes = generateBackupCodes();
  await prisma.$transaction([
    prisma.totpBackupCode.deleteMany({ where: { userId } }),
    prisma.totpBackupCode.createMany({ data: backupCodes.map((code) => ({ userId, codeHash: hashBackupCode(code) })) }),
  ]);
  await writeAuditLog({ actorUserId: userId, action: "auth.2fa.backup_codes_regenerated", entityType: "User", entityId: userId });
  return backupCodes;
}

// ── Admin security actions (Phase 5 commit E1) ──────────────────────────
// Used by the employee profile's Access tab (access module) and by the
// break-glass recovery CLI (scripts/admin-recover.ts). Callers decide who
// may act on whom; these only perform and audit the action.

// What every admin security action records (E1.1): who, why, and — for the
// break-glass CLI — the operator, their written justification and the
// security event that announced it.
export interface AdminSecurityMeta {
  actorUserId: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string;
  operator?: string;
  justification?: string;
  securityEventId?: string;
}

function securityAuditFields(meta: AdminSecurityMeta) {
  return {
    actorUserId: meta.actorUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    after: {
      reason: meta.reason ?? null,
      ...(meta.operator && { operator: meta.operator }),
      ...(meta.justification && { justification: meta.justification }),
      ...(meta.securityEventId && { securityEventId: meta.securityEventId }),
    },
  };
}

// Wipes 2FA (secret + backup codes) and ends every session.
export async function adminResetTotp(userId: string, meta: AdminSecurityMeta): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecretEncrypted: null, totpVerifiedAt: null } }),
    prisma.totpBackupCode.deleteMany({ where: { userId } }),
  ]);
  await revokeAllUserRefreshTokens(userId);
  await writeAuditLog({ ...securityAuditFields(meta), action: "auth.2fa.reset_by_admin", entityType: "User", entityId: userId });
}

// Clears a failed-login lockout. The reason is recorded too (E1.1 — E1
// dropped it on this one path).
export async function adminUnlock(userId: string, meta: AdminSecurityMeta): Promise<void> {
  const user = await prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null }, include: { employee: { select: { employeeCode: true } } } });
  await clearLoginFailures(user.employee.employeeCode);
  await writeAuditLog({ ...securityAuditFields(meta), action: "auth.unlocked_by_admin", entityType: "User", entityId: userId });
}

// Issues a password-reset link (Default behaviours auth.passwordResetLinkMinutes, default 1 hour; single use) and emails it to the
// personal email on file. Returns the link only for the break-glass CLI,
// whose operator may need to hand it over when email itself is the problem.
export async function adminIssuePasswordReset(userId: string, meta: AdminSecurityMeta): Promise<{ link: string; emailedTo: string | null }> {
  const employee = await prisma.employee.findFirst({ where: { user: { id: userId } }, include: { personal: true, nameHistory: { where: inForceOn() } } });
  if (!employee) throw new HttpError(404, "User not found.", "NOT_FOUND");
  const raw = generateOpaqueToken();
  await prisma.passwordResetToken.create({ data: { userId, tokenHash: hashOpaqueToken(raw), expiresAt: new Date(Date.now() + (await getPasswordResetTtlMinutes()) * 60_000) } });
  const email = emailOnRecord(employee.personal);
  if (email) {
    await sendPasswordResetEmail(email, employee.nameHistory[0]?.fullName ?? employee.employeeCode, raw).catch((err: unknown) =>
      logger.error({ err }, "failed to send password reset email"),
    );
  }
  const audit = securityAuditFields(meta);
  await writeAuditLog({ ...audit, action: "auth.password_reset_issued_by_admin", entityType: "User", entityId: userId, after: { ...audit.after, emailed: Boolean(email) } });
  return { link: `${env.WEB_BASE_URL}/reset-password/${raw}`, emailedTo: email };
}
