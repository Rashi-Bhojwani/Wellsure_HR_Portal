import { SUPER_ADMIN_ROLE_CODE } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { adminIssuePasswordReset, adminResetTotp, adminUnlock } from "../auth/service";
import { AdminCliRefusal } from "./bootstrap";

// Break-glass recovery for a SUPER_ADMIN who has lost their password or 2FA
// device and has no other Super Admin to help them in the app (Phase 5
// commit E1). Run by scripts/admin-recover.ts by someone with shell access to
// the environment — see docs/GETTING_STARTED.md "If a Super Admin loses their
// password or 2FA device" for when to use this rather than the in-app path.
//
// Deliberately narrow: Super Admin targets only (everyone else is recovered
// in the app by a Super Admin or by holders of user.security.manage), and it
// can only reset/unlock/re-issue — never set a password, never grant a role.
// Every action is audit-logged with no actor and the operator's reason.

export interface RecoverInput {
  employeeCode: string;
  resetTwoFactor?: boolean;
  passwordReset?: boolean;
  unlock?: boolean;
  reason: string;
}

export interface RecoverResult {
  employeeCode: string;
  done: string[];
  passwordResetLink: string | null;
  emailedTo: string | null;
}

export async function recoverSuperAdmin(input: RecoverInput): Promise<RecoverResult> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AdminCliRefusal("Give a reason (at least 3 characters) — it goes into the audit log.");
  if (!input.resetTwoFactor && !input.passwordReset && !input.unlock) throw new AdminCliRefusal("Choose at least one of --reset-2fa, --password-reset, --unlock.");

  const employee = await prisma.employee.findUnique({ where: { employeeCode: input.employeeCode.trim() }, include: { user: { include: { roles: { include: { role: true } } } } } });
  const user = employee?.user;
  if (!user || !user.roles.some((r) => r.role.code === SUPER_ADMIN_ROLE_CODE)) {
    throw new AdminCliRefusal(`${input.employeeCode} is not a Super Admin. Other users are recovered in the app (Employee profile → Access).`);
  }
  if (user.status !== "ACTIVE") throw new AdminCliRefusal(`${input.employeeCode}'s account is ${user.status}, not ACTIVE — recovery only applies to an active account.`);

  const meta = { actorUserId: null, userAgent: "admin-recover CLI", reason: `[break-glass CLI] ${reason}` };
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
  return { employeeCode: employee.employeeCode, done, passwordResetLink, emailedTo };
}
