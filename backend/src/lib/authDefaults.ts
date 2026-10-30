import { env } from "../config/env";

// Roles that must set up two-factor authentication before they can use the portal, until someone changes the setting (auth.require2faRoles).
// Development leaves it off so a laptop needs no authenticator app; staging and production start with the three roles that can see salary and
// bank data or change who may do what. A Super Admin can still change the setting (and the change is audited); this is only the starting value.
export function default2faRolesFor(appEnv: string): string[] {
  // Two-step sign-in for the directors is OPTIONAL (the owners' decision, 2026-10-30): they can enrol any time and sign in normally without it. Whether it is required of them is the
  // setting "auth.requireDirectorTwoFactor" (off by default, changeable only by a director): see lib/directorAuthority.ts. The roles below are the other administrators.
  return appEnv === "development" ? [] : ["HR_ADMIN", "PAYROLL_ADMIN"];
}

export const default2faRoles = (): string[] => default2faRolesFor(env.APP_ENV);

/** The roles that must enrol, given the setting list and whether the owners have turned on "require two-step sign-in for directors". */
export function with2faDirectors(configured: string[], directorsRequired: boolean): string[] {
  return directorsRequired && !configured.includes("SUPER_ADMIN") ? [...configured, "SUPER_ADMIN"] : configured;
}
