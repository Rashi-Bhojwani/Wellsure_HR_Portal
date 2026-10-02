import { SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { AlertNotDelivered, raiseBreakGlassAlert } from "../../lib/securityAlerts";
import { adminIssuePasswordReset, adminResetTotp, adminUnlock } from "../auth/service";
import { AdminCliRefusal } from "./bootstrap";

// Break-glass recovery for a SUPER_ADMIN who has lost their password or 2FA
// device and has no other Super Admin to help them in the app (Phase 5
// commit E1; made loud in E1.1). Run by scripts/admin-recover.ts by someone
// with shell access to the environment — see docs/GETTING_STARTED.md "If a
// Super Admin loses their password or 2FA device".
//
// Deliberately narrow: Super Admin targets only (everyone else is recovered
// in the app by a Super Admin or by holders of user.security.manage), and it
// can only reset/unlock/re-issue — never set a password, never grant a role.
//
// Deliberately loud (E1.1): before anything changes, every active Super
// Admin (the target included) and SECURITY_ALERT_EMAIL are emailed, a log
// line goes outside the database, and a security event raises a banner that
// only a Super Admin other than the target can clear (lib/securityAlerts.ts).
// "Only when the in-app routes are unavailable" can't be verified by a
// program, so the operator must say why in writing; that text goes into the
// alert, the event and every audit row.

export const MIN_REASON_LENGTH = 10;

export interface RecoverInput {
  employeeCode: string;
  resetTwoFactor?: boolean;
  passwordReset?: boolean;
  unlock?: boolean;
  reason: string;
  operator: string;
  justification: string;
  mailIsDown?: boolean;
}

export interface RecoverResult {
  employeeCode: string;
  done: string[];
  passwordResetLink: string | null;
  emailedTo: string | null;
  alert: { eventId: string; emailed: string[]; queued: string[] };
}

export async function recoverSuperAdmin(input: RecoverInput): Promise<RecoverResult> {
  const reason = input.reason.trim();
  const operator = input.operator.trim();
  const justification = input.justification.trim();
  if (reason.length < MIN_REASON_LENGTH) throw new AdminCliRefusal(`Give a reason of at least ${MIN_REASON_LENGTH} characters (--reason) — it goes into the alert and every audit entry.`);
  if (operator.length < 2) throw new AdminCliRefusal("Say who is running this (--operator \"<your name>\") — it goes into the alert and every audit entry.");
  if (justification.length < MIN_REASON_LENGTH) {
    throw new AdminCliRefusal(`Say why the in-app route (another Super Admin, or Forgot password) can't be used (--confirm-no-other-admin "<why>", at least ${MIN_REASON_LENGTH} characters).`);
  }
  if (!input.resetTwoFactor && !input.passwordReset && !input.unlock) throw new AdminCliRefusal("Choose at least one of --reset-2fa, --password-reset, --unlock.");

  const employee = await prisma.employee.findUnique({
    where: { employeeCode: input.employeeCode.trim() },
    include: { user: { include: { roles: { include: { role: true } } } }, nameHistory: { where: { effectiveTo: null } } },
  });
  const user = employee?.user;
  if (!employee || !user || !user.roles.some((r) => r.role.code === SUPER_ADMIN_ROLE_CODE)) {
    throw new AdminCliRefusal(`${input.employeeCode} is not a Super Admin. Other users are recovered in the app (Employee profile → Access).`);
  }
  if (user.status !== "ACTIVE") throw new AdminCliRefusal(`${input.employeeCode}'s account is ${user.status}, not ACTIVE — recovery only applies to an active account.`);

  const planned = [input.unlock && "unlock", input.resetTwoFactor && "reset 2FA (signs them out everywhere)", input.passwordReset && "issue a password-reset link"].filter((x): x is string => Boolean(x));
  // Loud first: nothing below runs unless the alert went out (or the
  // operator explicitly declared mail down and it was queued).
  let alert;
  try {
    alert = await raiseBreakGlassAlert(
      { kind: "break_glass.recover", targetUserId: user.id, target: `${employee.employeeCode} · ${employee.nameHistory[0]?.fullName ?? ""}`.trim(), actions: planned, reason, justification, operator },
      { mailIsDown: input.mailIsDown },
    );
  } catch (err) {
    if (err instanceof AlertNotDelivered) throw new AdminCliRefusal(err.message);
    throw err;
  }

  const meta = { actorUserId: null, userAgent: "admin-recover CLI", reason: `[break-glass CLI] ${reason}`, operator, justification, securityEventId: alert.eventId };
  const done: string[] = [];
  if (input.unlock) {
    await adminUnlock(user.id, meta);
    done.push("unlocked");
  }
  if (input.resetTwoFactor) {
    await adminResetTotp(user.id, meta);
    done.push("2FA reset (signed out everywhere)");
  }
  let passwordResetLink: string | null = null;
  let emailedTo: string | null = null;
  if (input.passwordReset) {
    ({ link: passwordResetLink, emailedTo } = await adminIssuePasswordReset(user.id, meta));
    done.push("password reset link issued (valid 1 hour)");
  }
  return { employeeCode: employee.employeeCode, done, passwordResetLink, emailedTo, alert };
}
