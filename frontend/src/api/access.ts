import type { DataScope } from "@shared/constants/roles";
import { apiClient } from "./client";

// Roles & permissions (Phase 5 commit E1) — backend/src/modules/access.

export interface RoleDefinition {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  locked: boolean; // SUPER_ADMIN: every permission, can't be changed
  managerLocked?: boolean; // MANAGER: always empty — granted per manager (2026-10-03)
  dataScope: DataScope;
  permissions: string[];
  holderCount: number;
}

export interface EmployeePermission {
  key: string;
  effective: boolean;
  inheritedFrom: string[];
  override: { effect: "GRANT" | "REVOKE"; reason: string; createdByUserId: string; createdAt: string } | null;
}

export interface EmployeeAccess {
  employeeId: string;
  userId: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  totpEnabled: boolean;
  locked: boolean;
  isSuperAdmin: boolean;
  isManager: boolean; // E2: only manager-grantable keys can be granted
  dataScope: DataScope;
  roles: Array<{ code: string; name: string; assignedAt: string }>;
  permissions: EmployeePermission[];
  can: { editRoles: boolean; editOverrides: boolean; securityActions: boolean };
}

export async function listRoles(): Promise<RoleDefinition[]> {
  const { data } = await apiClient.get<{ roles: RoleDefinition[] }>("/api/access/roles");
  return data.roles;
}

export async function updateRole(code: string, body: { permissions?: string[]; dataScope?: DataScope }): Promise<RoleDefinition> {
  const { data } = await apiClient.put<{ role: RoleDefinition }>(`/api/access/roles/${encodeURIComponent(code)}`, body);
  return data.role;
}

export async function getEmployeeAccess(employeeId: string): Promise<EmployeeAccess> {
  const { data } = await apiClient.get<EmployeeAccess>(`/api/access/employees/${employeeId}`);
  return data;
}

export async function assignRole(employeeId: string, code: string): Promise<EmployeeAccess> {
  const { data } = await apiClient.post<EmployeeAccess>(`/api/access/employees/${employeeId}/roles`, { code });
  return data;
}

export async function removeRole(employeeId: string, code: string): Promise<EmployeeAccess> {
  const { data } = await apiClient.delete<EmployeeAccess>(`/api/access/employees/${employeeId}/roles/${encodeURIComponent(code)}`);
  return data;
}

export async function setOverride(employeeId: string, key: string, body: { effect: "GRANT" | "REVOKE"; reason: string }): Promise<EmployeeAccess> {
  const { data } = await apiClient.put<EmployeeAccess>(`/api/access/employees/${employeeId}/overrides/${encodeURIComponent(key)}`, body);
  return data;
}

export async function clearOverride(employeeId: string, key: string, reason: string): Promise<EmployeeAccess> {
  const { data } = await apiClient.delete<EmployeeAccess>(`/api/access/employees/${employeeId}/overrides/${encodeURIComponent(key)}`, { data: { reason } });
  return data;
}

export async function resetTwoFactor(employeeId: string, reason: string): Promise<EmployeeAccess> {
  const { data } = await apiClient.post<EmployeeAccess>(`/api/access/employees/${employeeId}/reset-2fa`, { reason });
  return data;
}

export async function unlockAccount(employeeId: string, reason: string): Promise<EmployeeAccess> {
  const { data } = await apiClient.post<EmployeeAccess>(`/api/access/employees/${employeeId}/unlock`, { reason });
  return data;
}

export async function sendPasswordReset(employeeId: string, reason: string): Promise<void> {
  await apiClient.post(`/api/access/employees/${employeeId}/password-reset`, { reason });
}

// Security events (E1.1) — Super Admins only.
export interface SecurityEvent {
  id: string;
  kind: "break_glass.recover" | "break_glass.bootstrap" | "director.switch_changed" | "director.unacknowledged";
  summary: string;
  details: { noticeId?: string; reason?: string; justification?: string | null; operator?: string; origin?: { hostname?: string; appEnv?: string }; emailed?: string[]; queued?: string[] };
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  acknowledgementNote: string | null;
  youAreTarget: boolean;
}

export async function listSecurityEvents(status: "open" | "all" = "open"): Promise<SecurityEvent[]> {
  const { data } = await apiClient.get<{ events: SecurityEvent[] }>("/api/access/security-events", { params: { status } });
  return data.events;
}

export async function acknowledgeSecurityEvent(id: string, note: string): Promise<void> {
  await apiClient.post(`/api/access/security-events/${id}/acknowledge`, { note });
}
