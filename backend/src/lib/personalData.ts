import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 7): another person's personal contact details (personal email, mobile, current and permanent address,
// emergency contact) are shown only to someone holding employee.personal.view, which the Developer role never holds (shared/constants/sensitiveData.ts,
// EMPLOYEE_PERSONAL_CONTACT; the ceiling in lib/permissions.ts). Everyone always sees their own. The Developer keeps what support needs: employee number, name,
// role and status.
export const PERSONAL_VIEW_KEY = "employee.personal.view";
export const PERSONAL_CONTACT_FIELDS = ["personalEmail", "mobile", "currentAddress", "permanentAddress", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation", "dateOfBirth", "gender", "bloodGroup"] as const;
// dateOfBirth, gender and bloodGroup (health data) are personal too: support needs none of them, so they are withheld the same way.

export function canSeePersonal(viewer: { permissions: Set<string>; employeeId?: string | null }, subjectEmployeeId?: string | null): boolean {
  return viewer.permissions.has(PERSONAL_VIEW_KEY) || (!!subjectEmployeeId && !!viewer.employeeId && subjectEmployeeId === viewer.employeeId);
}

/** The same object with every personal contact field set to null (the key is kept so the screen can say "Hidden"). */
export function withoutPersonalContact<T extends Record<string, unknown>>(personal: T): T {
  const out: Record<string, unknown> = { ...personal };
  for (const f of PERSONAL_CONTACT_FIELDS) if (f in out) out[f] = null;
  return out as T;
}

/** The colleague directory is governed by its own company toggle (People & Documents); there only the Developer role is kept from personal contact (as the audit log
 *  hides values from it), so an ordinary colleague's view is unchanged. */
export const developerViewer = (user: { roleCodes: string[] }): boolean => user.roleCodes.includes(DEVELOPER_ROLE_CODE) && !user.roleCodes.includes("SUPER_ADMIN");

/**
 * Decided 2026-11-18 (owner): the four profile fields feat/employee-number-login adds stay visible to the Developer. None carries personal contact data, and
 * support needs the machine ID to diagnose punches. When that branch merges, they must NOT be added to PERSONAL_CONTACT_FIELDS.
 */
export const DEVELOPER_KEEPS_PROFILE_FIELDS = ["deviceUserId", "loginIdMatchesMachine", "noEmailOnRecord", "emailMissingRequestedAt"] as const;
