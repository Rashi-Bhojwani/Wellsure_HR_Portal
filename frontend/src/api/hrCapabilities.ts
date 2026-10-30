import type { HrCapabilityId } from "@shared/constants/hrCapabilities";
import { apiClient } from "./client";

// What HR can do (docs/plans/HR_CAPABILITIES.md §1B) — backend/src/modules/hrCapabilities. Directors only.

export type SwitchState = "ON" | "OFF" | "DEFAULT";
export interface Pending {
  state: string;
  effectiveFrom: string;
}
export interface RoleLine {
  roleCode: "HR_ADMIN" | "HR_EXECUTIVE";
  state: SwitchState;
  /** Whether the role's own permission rows give it this with no switch ("as today"). */
  defaultHolds: boolean;
  pending: Pending | null;
}
export interface PersonLine {
  userId: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  roleCodes: string[];
  state: SwitchState;
  pending: Pending | null;
}
export interface CapabilityLine {
  id: HrCapabilityId;
  label: string;
  what: string;
  keys: string[];
  roles: RoleLine[];
  people: PersonLine[];
}
export interface HrPerson {
  userId: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  roleCodes: string[];
}
export interface Overview {
  capabilities: CapabilityLine[];
  people: HrPerson[];
}
export interface HistoryRow {
  id: string;
  capability: string;
  label: string;
  subjectKind: "ROLE" | "USER";
  subject: { roleCode?: string; employeeCode?: string; name?: string };
  state: SwitchState;
  effectiveFrom: string;
  reason: string;
  changedBy: { employeeCode: string; name: string };
  changedAt: string;
}
export interface History {
  total: number;
  page: number;
  pageSize: number;
  rows: HistoryRow[];
}

export async function getOverview(): Promise<Overview> {
  return (await apiClient.get<Overview>("/api/hr-capabilities")).data;
}
export async function getHistory(page: number, capability?: string): Promise<History> {
  return (await apiClient.get<History>("/api/hr-capabilities/history", { params: { page, pageSize: 10, capability } })).data;
}
export interface SetBody {
  capability: HrCapabilityId;
  subject: { kind: "ROLE"; roleCode: "HR_ADMIN" | "HR_EXECUTIVE" } | { kind: "USER"; employeeId: string };
  state: SwitchState;
  reason: string;
  effectiveFrom?: string;
}
export async function setSwitch(body: SetBody): Promise<{ changed: boolean; effectiveFrom: string; overview: Overview }> {
  return (await apiClient.put("/api/hr-capabilities", body)).data;
}
