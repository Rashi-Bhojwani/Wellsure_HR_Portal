import { apiClient } from "./client";

// FIX (independent audit 2026-11-20): the two-director confirmations the audit fixes add, in one place. Values are never sent: only which fields would change,
// who it is about (employee number) and what kind of change it is.
export interface LeaveChangeRow { id: string; kind: "GRANT" | "COMP_OFF_GRANT" | "IMPORT"; status: "PENDING" | "CONFIRMED" | "REJECTED"; summary: string; proposedAt: string; mine: boolean; aboutMe: boolean; canConfirm: boolean; canReject: boolean }
export interface DirectorChangeRow { id: string; action: "GRANT_SUPER_ADMIN" | "REVOKE_SUPER_ADMIN" | "ASSIGN_ROLE" | "REMOVE_ROLE" | "SUSPEND" | "RESET_2FA" | "UNLOCK"; status: "PENDING" | "APPLIED" | "REJECTED"; target: string; roleCode: string | null; reason: string; proposedAt: string; mine: boolean; confirmations: number; canConfirm: boolean; canReject: boolean }
export interface ContactChangeRow { id: string; kind: "LOGIN_EMAIL" | "DIRECTOR_RECORD"; status: "PENDING" | "APPLIED" | "REJECTED"; employeeCode: string; fields: string[]; source: string; proposedAt: string; mine: boolean; aboutMe: boolean; canConfirm: boolean; canReject: boolean }
export interface LoginBlock { ip: string; failures: number; secondsLeft: number }

export const listLeaveChanges = async () => (await apiClient.get<{ requests: LeaveChangeRow[] }>("/api/leave/change-requests", { params: { status: "PENDING" } })).data.requests;
export const confirmLeaveChange = async (id: string) => (await apiClient.post(`/api/leave/change-requests/${id}/confirm`, {})).data;
export const rejectLeaveChange = async (id: string, note: string) => (await apiClient.post(`/api/leave/change-requests/${id}/reject`, { note })).data;

export const listDirectorChanges = async () => (await apiClient.get<{ changes: DirectorChangeRow[] }>("/api/access/director-changes")).data.changes;
export const confirmDirectorChange = async (id: string) => (await apiClient.post<{ applied: boolean }>(`/api/access/director-changes/${id}/confirm`, {})).data;
export const rejectDirectorChange = async (id: string, note: string) => (await apiClient.post(`/api/access/director-changes/${id}/reject`, { note })).data;

export const listContactChanges = async () => (await apiClient.get<{ changes: ContactChangeRow[] }>("/api/employees/contact-changes")).data.changes;
export const confirmContactChange = async (id: string) => (await apiClient.post(`/api/employees/contact-changes/${id}/confirm`, {})).data;
export const rejectContactChange = async (id: string, note: string) => (await apiClient.post(`/api/employees/contact-changes/${id}/reject`, { note })).data;

export const listLoginBlocks = async () => (await apiClient.get<{ blocks: LoginBlock[]; limit: { maxAttempts: number; windowSeconds: number } }>("/api/access/login-blocks")).data;
export const clearLoginBlock = async (ip: string, reason: string) => (await apiClient.delete(`/api/access/login-blocks/${encodeURIComponent(ip)}`, { data: { reason } })).data;

export const DIRECTOR_ACTION_LABEL: Record<DirectorChangeRow["action"], string> = {
  GRANT_SUPER_ADMIN: "Make a director",
  REVOKE_SUPER_ADMIN: "Remove director status",
  ASSIGN_ROLE: "Give a director a role",
  REMOVE_ROLE: "Take a role from a director",
  SUSPEND: "Turn off a director's portal access",
  RESET_2FA: "Reset a director's two-step sign-in",
  UNLOCK: "Unlock a director's sign-in",
};
export const LEAVE_KIND_LABEL: Record<LeaveChangeRow["kind"], string> = { GRANT: "Grant or debit", COMP_OFF_GRANT: "Comp-off credit", IMPORT: "Leave import" };
export const CONTACT_KIND_LABEL: Record<ContactChangeRow["kind"], string> = { LOGIN_EMAIL: "Sign-in email", DIRECTOR_RECORD: "Director's own details" };
