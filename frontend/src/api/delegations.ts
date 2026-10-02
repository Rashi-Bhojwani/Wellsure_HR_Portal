import { apiClient } from "./client";

// Workflow Delegates (Phase 5 commit E3) — backend/src/modules/delegations.

export type DelegationStatus = "SCHEDULED" | "ACTIVE" | "ENDED" | "REVOKED";

export interface DelegationPerson {
  userId: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  designation: string | null;
  department: string | null;
}
export interface DelegateOption extends DelegationPerson {
  roles: string[];
}
export interface DelegationRow {
  id: string;
  delegator: DelegationPerson;
  delegate: DelegationPerson;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: DelegationStatus;
  delegateCanApprove: boolean;
  actionsOnBehalf: number;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}
export interface MyDelegations {
  canDelegate: boolean;
  notAllowedReason: string | null;
  given: DelegationRow[];
  covering: DelegationRow[];
}
export interface NewDelegation {
  delegateUserId: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
}

export async function mine(): Promise<MyDelegations> {
  return (await apiClient.get<MyDelegations>("/api/delegations/mine")).data;
}
export async function myDelegateOptions(): Promise<DelegateOption[]> {
  return (await apiClient.get<{ options: DelegateOption[] }>("/api/delegations/delegate-options")).data.options;
}
export async function createMine(body: NewDelegation): Promise<DelegationRow> {
  return (await apiClient.post<DelegationRow>("/api/delegations/mine", body)).data;
}
export async function revokeMine(id: string, reason?: string): Promise<DelegationRow> {
  return (await apiClient.post<DelegationRow>(`/api/delegations/mine/${id}/revoke`, { reason: reason || null })).data;
}

export async function listAll(status?: DelegationStatus): Promise<DelegationRow[]> {
  return (await apiClient.get<{ delegations: DelegationRow[] }>("/api/delegations", { params: status ? { status } : {} })).data.delegations;
}
export async function managerOptions(): Promise<DelegationPerson[]> {
  return (await apiClient.get<{ options: DelegationPerson[] }>("/api/delegations/managers")).data.options;
}
export async function delegateOptionsFor(delegatorUserId: string): Promise<DelegateOption[]> {
  return (await apiClient.get<{ options: DelegateOption[] }>(`/api/delegations/delegate-options/${delegatorUserId}`)).data.options;
}
export async function create(body: NewDelegation & { delegatorUserId: string }): Promise<DelegationRow> {
  return (await apiClient.post<DelegationRow>("/api/delegations", body)).data;
}
export async function revoke(id: string, reason?: string): Promise<DelegationRow> {
  return (await apiClient.post<DelegationRow>(`/api/delegations/${id}/revoke`, { reason: reason || null })).data;
}
