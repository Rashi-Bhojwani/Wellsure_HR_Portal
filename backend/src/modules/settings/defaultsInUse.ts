import { prisma } from "../../lib/prisma";

// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 5; audit §3 rows marked "values shown; not marked as defaults"): the settings on System Settings that apply a
// value until somebody saves one. None of them changes pay or leave, so they keep working on their default, and the screen now says "Default in use" for each that
// nobody has saved yet (the value shown in the form is that default).
export const DEFAULTED_SETTING_KEYS = [
  "auth.lockout",
  "auth.passwordMinLength",
  "auth.invitationTtlHours",
  "auth.rateLimit.login",
  "auth.rateLimit.totpVerify",
  "auth.rateLimit.inviteAccept",
  "auth.rateLimit.forgotPassword",
  "auth.rateLimit.resetPassword",
  "attendance.deviceAlerts",
  "attendance.deviceHealth",
  "attendance.regularization",
  "attendance.excessHours",
  "helpdesk.autoCloseDays",
  "helpdesk.reopenWindowDays",
  "people.directory.visibleFields",
  "people.photo.maxUploadMb",
  "documents.maxUploadMb",
  "documents.allowedMimeTypes",
] as const;

export async function defaultsInUse(): Promise<{ keys: string[] }> {
  const stored = new Set((await prisma.systemSetting.findMany({ where: { key: { in: [...DEFAULTED_SETTING_KEYS] } }, select: { key: true } })).map((r) => r.key));
  return { keys: DEFAULTED_SETTING_KEYS.filter((k) => !stored.has(k)) };
}
