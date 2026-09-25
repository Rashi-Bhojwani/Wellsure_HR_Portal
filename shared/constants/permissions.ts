// Phase 1 permission keys (spec §2). Single source of truth for backend
// (RBAC middleware, seed data) and frontend (menu-config permission
// gating) — never hardcode a permission string anywhere else.
export const PERMISSION_KEYS = [
  "employee.view",
  "employee.create",
  "employee.edit",
  "employee.export",
  "employee.manage",
  "employee.statutory.view",
  "employee.statutory.edit",
  "employee.bank.view",
  "employee.bank.edit",
  "employee.separate",
  "employee.separate.view",
  "profile.changerequest.approve",
  "org.manage",
  "role.view",
  "role.manage",
  "user.security.manage",
  "import.manage",
  "audit.view",
  "settings.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
