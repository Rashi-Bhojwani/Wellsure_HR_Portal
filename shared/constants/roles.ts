// The 7 spec roles (spec §2). Single source of truth for backend (seed
// data, RBAC checks) and frontend (role-aware UI).
export const ROLE_CODES = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "HR_EXECUTIVE",
  "PAYROLL_ADMIN",
  "MANAGER",
  "APPROVER",
  "EMPLOYEE",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export type DataScope = "SELF" | "TEAM" | "ALL";
