import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { User } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { writeAuditLog } from "../../lib/audit";
import { getSetting } from "../../lib/settings";
import { resolveUserPermissions, resolveUserRoleCodes } from "../../lib/permissions";
import { signAccessToken, signTotpChallengeToken, verifyTotpChallengeToken } from "../../lib/jwt";
import { HttpError } from "../../middleware/errorHandler";
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
  verifyTotpCode,
} from "./totp";
import { sendInvitationEmail, sendPasswordResetEmail, sendWelcomeEmail } from "./emails";
import type { LoginResult, LoginTokens, RequestMetaInput } from "./types";

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
  // Disabled by default for now (temporary — re-enable by setting this
  // SystemSetting, e.g. back to ["SUPER_ADMIN", "HR_ADMIN", "HR_EXECUTIVE",
  // "PAYROLL_ADMIN"], once 2FA is ready to be required again). The setup/
  // verify/disable/backup-code flows and their tests are untouched.
  return getSetting<string[]>("auth.require2faRoles", []);
}

async function getLockoutConfig(): Promise<{ maxAttempts: number; lockoutMinutes: number }> {
  return getSetting("auth.lockout", { maxAttempts: 5, lockoutMinutes: 15 });
}

async function verifyTotpOrBackupCode(user: User, code: string): Promise<boolean> {
  if (user.totpSecretEncrypted) {
    const secret = decryptTotpSecret(user.totpSecretEncrypted);
    if (await verifyTotpCode(secret, code)) {
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
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const accessToken = signAccessToken(user.id);
  const { token: refreshToken } = await issueRefreshToken(user.id, meta);
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
    user: {
      employeeCode: employee.employeeCode,
      roleCodes,
      privacyNoticeAccepted: user.privacyNoticeAcceptedAt !== null,
    },
  };
}

async function recordFailedLogin(userId: string, meta: RequestMetaInput): Promise<void> {
  const { maxAttempts, lockoutMinutes } = await getLockoutConfig();
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
  });
  let lockedOut = false;
  if (updated.failedLoginAttempts >= maxAttempts) {
    lockedOut = true;
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(Date.now() + lockoutMinutes * 60_000) },
    });
  }
  await writeAuditLog({
    actorUserId: userId,
    action: lockedOut ? "auth.login.lockout" : "auth.login.failed",
    entityType: "User",
    entityId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// spec §3: login = Employee Code + password. Every failure path (unknown
// code, wrong password) returns the same generic message — only lockout
// and not-yet-activated get a distinct message, since neither reveals
// anything an attacker couldn't already infer from Employee Codes being
// openly known internal identifiers, not secrets.
export async function login(employeeCode: string, password: string, meta: RequestMetaInput): Promise<LoginResult> {
  const genericError = () => new HttpError(401, "Invalid Employee Code or password.", "INVALID_CREDENTIALS");

  const employee = await prisma.employee.findUnique({ where: { employeeCode }, include: { user: true } });
  if (!employee?.user) {
    await argon2.hash(password).catch(() => undefined); // keep timing roughly consistent with the real-user path
    throw genericError();
  }
  const user = employee.user;

  if (user.status === "INVITED") {
    throw new HttpError(
      403,
      "Your account hasn't been activated yet. Check your email for the set-password link.",
      "NOT_ACTIVATED",
    );
  }
  if (user.status !== "ACTIVE") {
    throw genericError();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new HttpError(423, `Account is locked. Try again in ${minutes} minute(s).`, "LOCKED");
  }
  if (!user.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
    await recordFailedLogin(user.id, meta);
    throw genericError();
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });

  const roleCodes = await resolveUserRoleCodes(user.id);
  const require2fa = await getRequire2faRoles();
  const needs2fa = roleCodes.some((code) => require2fa.includes(code));

  if (needs2fa && !user.totpEnabled) {
    const challengeToken = signTotpChallengeToken(user.id, "totp_setup_challenge");
    return { status: "requires_totp_setup", challengeToken };
  }
  if (needs2fa) {
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
): Promise<{ accessToken: string; refreshToken: string }> {
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
  const { token: newRefreshToken } = rotated;
  const accessToken = signAccessToken(user.id);
  await writeAuditLog({
    actorUserId: user.id,
    action: "auth.refresh.rotated",
    entityType: "User",
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return { accessToken, refreshToken: newRefreshToken };
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

// Called by the employee module right after creating a new hire's User row
// (status INVITED) — issues the 48h single-use set-password token and
// sends the invitation email. Not itself audit-logged: the caller's own
// "employee.created" entry covers this as part of the same action.
export async function createInvitation(params: {
  userId: string;
  email: string;
  fullName: string;
  employeeCode: string;
}): Promise<void> {
  const raw = generateOpaqueToken();
  await prisma.invitationToken.create({
    data: {
      userId: params.userId,
      tokenHash: hashOpaqueToken(raw),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });
  await sendInvitationEmail(params.email, params.fullName, params.employeeCode, raw).catch((err: unknown) =>
    logger.error({ err }, "failed to send invitation email"),
  );
}

// Resend: invalidates any still-outstanding invitation tokens for this user
// (a stale link should stop working once a fresher one is issued) and
// issues a new one. HR-triggered — see employee module's resend-invite
// endpoint, which is what actually audit-logs this action.
export async function resendInvitation(userId: string, email: string, fullName: string, employeeCode: string): Promise<void> {
  await prisma.invitationToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  await createInvitation({ userId, email, fullName, employeeCode });
}

export async function getInvitationDetails(token: string): Promise<{ employeeCode: string; fullName: string }> {
  const row = await prisma.invitationToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new HttpError(400, "This invitation link is invalid or has expired.", "INVALID_INVITATION");
  }
  const employee = await prisma.employee.findFirst({
    where: { user: { id: row.userId } },
    include: { nameHistory: { where: { effectiveTo: null } } },
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

  const passwordHash = await argon2.hash(password);
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash, status: "ACTIVE" } }),
    prisma.invitationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);

  const employee = await prisma.employee.findFirst({
    where: { user: { id: user.id } },
    include: { personal: true, nameHistory: { where: { effectiveTo: null } } },
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

const FORGOT_PASSWORD_MIN_DURATION_MS = 200;

// Identical response and (approximately) identical timing whether or not
// employeeCode exists — see routes.ts, which always responds the same
// way regardless of what this function does internally.
export async function forgotPassword(employeeCode: string, meta: RequestMetaInput): Promise<void> {
  const start = Date.now();

  const employee = await prisma.employee.findUnique({
    where: { employeeCode },
    include: { user: true, personal: true, nameHistory: { where: { effectiveTo: null } } },
  });

  if (employee?.user && employee.user.status === "ACTIVE" && employee.personal?.personalEmail) {
    const raw = generateOpaqueToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: employee.user.id,
        tokenHash: hashOpaqueToken(raw),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const fullName = employee.nameHistory[0]?.fullName ?? employee.employeeCode;
    sendPasswordResetEmail(employee.personal.personalEmail, fullName, raw).catch((err: unknown) =>
      logger.error({ err }, "failed to send password reset email"),
    );
    await writeAuditLog({
      actorUserId: employee.user.id,
      action: "auth.forgot_password.requested",
      entityType: "User",
      entityId: employee.user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  const elapsed = Date.now() - start;
  if (elapsed < FORGOT_PASSWORD_MIN_DURATION_MS) {
    await new Promise((resolve) => setTimeout(resolve, FORGOT_PASSWORD_MIN_DURATION_MS - elapsed));
  }
}

export async function resetPassword(token: string, password: string, meta: RequestMetaInput): Promise<void> {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new HttpError(400, "This reset link is invalid or has expired.", "INVALID_RESET_TOKEN");
  }

  const passwordHash = await argon2.hash(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllUserRefreshTokens(row.userId); // force re-login on every device after a reset
  await writeAuditLog({
    actorUserId: row.userId,
    action: "auth.password.reset",
    entityType: "User",
    entityId: row.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function acceptPrivacyNotice(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { privacyNoticeAcceptedAt: new Date() } });
  await writeAuditLog({ actorUserId: userId, action: "auth.privacy_notice.accepted", entityType: "User", entityId: userId });
}

export async function getMe(userId: string) {
  const employee = await prisma.employee.findFirst({
    where: { user: { id: userId } },
    include: { user: true, nameHistory: { where: { effectiveTo: null } } },
  });
  if (!employee?.user) {
    throw new HttpError(404, "Not found", "NOT_FOUND");
  }
  const [roleCodes, permissions] = await Promise.all([resolveUserRoleCodes(userId), resolveUserPermissions(userId)]);
  return {
    employeeCode: employee.employeeCode,
    fullName: employee.nameHistory[0]?.fullName ?? employee.employeeCode,
    roleCodes,
    permissions: Array.from(permissions),
    totpEnabled: employee.user.totpEnabled,
    privacyNoticeAccepted: employee.user.privacyNoticeAcceptedAt !== null,
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
  if (!(await verifyTotpCode(secret, code))) {
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
