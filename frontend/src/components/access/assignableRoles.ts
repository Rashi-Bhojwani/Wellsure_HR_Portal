import type { RoleDefinition } from "../../api/access";

/**
 * The roles the Access tab offers to add: every role the person does not hold, except the payroll roles (Payroll Admin, Payroll Approver). Cleanup C3:
 * those are given to nobody, because the two directors are the payroll team; the API refuses them too (PAYROLL_ROLE_NOT_ASSIGNABLE).
 */
export function assignableRoles<R extends Pick<RoleDefinition, "code" | "directorOnly">>(roles: readonly R[], held: ReadonlyArray<{ code: string }>): R[] {
  return roles.filter((r) => !r.directorOnly && !held.some((h) => h.code === r.code));
}
