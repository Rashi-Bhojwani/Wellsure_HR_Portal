// Permission keys (spec §2), Phase 1 + Phase 4. Single source of truth for
// backend (RBAC middleware, seed data) and frontend (menu-config
// permission gating) — never hardcode a permission string anywhere else.
export const PERMISSION_KEYS = [
  // Phase 1
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
  // Phase 4 — Leave
  "leave.apply.onBehalf", // apply for leave as someone else
  "leave.view", // see other employees' leave requests/ledger/balances (TEAM/ALL, via resolveDataScope)
  "leave.approve", // approve/reject/bulk-approve/cancel-on-behalf
  "leave.grant", // Leave Granter — manual grant/debit + manual comp-off credit
  "leave.policy.manage", // leave types, policies, holidays, restricted holidays
  "leave.recalculate", // Leave Recalculator
  "leave.yearend.manage", // Year End Process
  // Phase 5 — Homepage, Dashboards, Notifications
  "announcements.manage", // create/edit/deactivate the Home page HR banner
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
