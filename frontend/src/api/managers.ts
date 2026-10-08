import { apiClient } from "./client";

// Manager Management (Phase 5 commit E2) — backend/src/modules/managers.

export interface PersonPlacement {
  employeeId: string;
  employeeCode: string;
  name: string;
  status: string;
  department: string | null;
  designation: string | null;
  branch: string | null;
  reportingManagerId: string | null;
  placedSince: string | null;
}
export interface ManagerRow extends PersonPlacement {
  teamSize: number;
  permissions: string[]; // what they can actually do — empty unless Admin granted it (2026-10-03)
  leaveApproval: boolean;
}
export interface UnassignedRow extends PersonPlacement {
  why: string;
}
export interface ManagerOption {
  employeeId: string;
  employeeCode: string;
  name: string;
  teamSize: number;
}

export async function listManagers(): Promise<ManagerRow[]> {
  const { data } = await apiClient.get<{ managers: ManagerRow[] }>("/api/managers");
  return data.managers;
}
export async function managerOptions(): Promise<ManagerOption[]> {
  const { data } = await apiClient.get<{ managers: ManagerOption[] }>("/api/managers/options");
  return data.managers;
}
export async function listUnassigned(): Promise<UnassignedRow[]> {
  const { data } = await apiClient.get<{ employees: UnassignedRow[] }>("/api/managers/unassigned");
  return data.employees;
}
export type ScheduledMove = PersonPlacement & { from: string; jobHistoryId: string; toManager?: string | null };
export async function getTeam(managerId: string): Promise<{ manager: PersonPlacement; members: PersonPlacement[]; joining: ScheduledMove[]; leaving: ScheduledMove[] }> {
  const { data } = await apiClient.get(`/api/managers/${managerId}/team`);
  return data;
}
export async function appointManager(employeeId: string, effectiveFrom?: string, grantLeaveApproval = false): Promise<void> {
  await apiClient.post("/api/managers", { employeeId, effectiveFrom, grantLeaveApproval });
}
export async function setLeaveApproval(employeeId: string, grant: boolean): Promise<ManagerRow> {
  const { data } = await apiClient.post<ManagerRow>(`/api/managers/${employeeId}/leave-approval`, { grant });
  return data;
}
export async function removeManager(employeeId: string, body: { newManagerId: string | null; effectiveFrom?: string }): Promise<void> {
  await apiClient.delete(`/api/managers/${employeeId}`, { data: body });
}
export async function assignTeam(managerId: string, employeeIds: string[], effectiveFrom?: string): Promise<{ assigned: number; alreadyInTeam: number }> {
  const { data } = await apiClient.post(`/api/managers/${managerId}/team`, { employeeIds, effectiveFrom });
  return data;
}
export async function removeTeamMember(managerId: string, memberId: string, effectiveFrom?: string): Promise<void> {
  await apiClient.delete(`/api/managers/${managerId}/team/${memberId}`, { data: { effectiveFrom } });
}
