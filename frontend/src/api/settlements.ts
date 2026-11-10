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
  state: "PREPARED" | "WAITING" | "CONFIRMED" | "REJECTED" | "REPLACED";
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
