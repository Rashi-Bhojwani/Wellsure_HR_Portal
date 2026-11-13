import { apiClient } from "./client";

// P7-6 (docs/plans/P7_6_SETTLEMENTS.md): full and final settlements, directors only.
const base = "/api/settlements";
export interface SettlementLine {
  kind: "HELD_PAY" | "PENDING_ADJUSTMENT" | "LOAN_OWED" | "LEAVE_BALANCE" | "DIRECTOR";
  label: string;
  amount: string | null;
  days?: string;
  source: string;
}
export interface Settlement {
  id: string;
  lines: SettlementLine[];
  total: string;
  payable: boolean;
  recoverOutsidePayroll: string | null;
  state: "PREPARED" | "WAITING" | "CONFIRMED" | "REJECTED" | "REPLACED" | "PAID";
  offCycleRunId: string | null;
  payment: string | null;
  fingerprint: string;
  createdAt: string;
}
export interface SeparationRow {
  separationId: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  lastWorkingDate: string;
  settlement: Settlement | null;
}
export const listSettlements = async () => (await apiClient.get<{ separations: SeparationRow[] }>(base)).data.separations;
export const prepareSettlement = async (body: { separationId: string; directorLines: Array<{ label: string; amount: string; source: string }> }) => (await apiClient.post<Settlement>(base, body)).data;
export const askToConfirm = async (id: string, fingerprint: string) => (await apiClient.post(`${base}/${id}/confirm`, { fingerprint })).data;
export const decideSettlement = async (id: string, fingerprint: string, decision: "APPROVE" | "REJECT") => (await apiClient.post(`${base}/${id}/decision`, { fingerprint, decision })).data;

// PY-27 / PY-28 / PY-29: the settlement guide. Facts only; every rule Not set; no amount proposed.
export interface SettlementGuide {
  separationId: string;
  employeeCode: string;
  dateOfJoining: string;
  lastWorkingDate: string;
  service: { years: number; months: number; days: number; totalDays: number };
  lastDrawn: { cycle: string; gross: string; earnings: Array<{ code: string; label: string; amount: string }> } | null;
  leave: Array<{ label: string; days: string }>;
  rules: Array<{ key: string; label: string; why: string; value: null; state: string }>;
  note: string;
}
export const settlementGuide = async (separationId: string) => (await apiClient.get<SettlementGuide>(`${base}/guide`, { params: { separationId } })).data;
