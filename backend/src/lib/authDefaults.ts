import { env } from "../config/env";

// Roles that must set up two-factor authentication before they can use the portal, until someone changes the setting (auth.require2faRoles).
// Development leaves it off so a laptop needs no authenticator app; staging and production start with the three roles that can see salary and
// bank data or change who may do what. A Super Admin can still change the setting (and the change is audited); this is only the starting value.
export function default2faRolesFor(appEnv: string): string[] {
  return appEnv === "development" ? [] : ["SUPER_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN"];
}

export const default2faRoles = (): string[] => default2faRolesFor(env.APP_ENV);

/**
 * Two-step sign-in for a Super Admin is not optional outside development (docs/plans/DIRECTOR_AUTHORITY.md, owner's requirement): a director can move the whole of payroll
 * on their own authority, so a password alone is not enough. Whatever the setting says, SUPER_ADMIN is always in the list there.
 */
export function with2faFloor(configured: string[], appEnv: string): string[] {
  return appEnv === "development" || configured.includes("SUPER_ADMIN") ? configured : [...configured, "SUPER_ADMIN"];
}
