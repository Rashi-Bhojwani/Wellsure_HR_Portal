import { apiClient } from "./client";

// P7-4 (docs/plans/P7_4_LOANS.md): loans and advances.
const base = "/api/loans";
export interface LoanView {
  /** Where recovery stands (NOT_SANCTIONED, NOT_PAID_OUT, RECOVERING, STOPPED, FULLY_RECOVERED, RECOVERED_AT_EXIT). */
  recovery?: "NOT_SANCTIONED" | "NOT_PAID_OUT" | "RECOVERING" | "STOPPED" | "FULLY_RECOVERED" | "RECOVERED_AT_EXIT";
  id: string;
  employeeId: string;
  name?: string;
  typeKey: string;
  principal: string;
  ratePercent: string;
  instalments: number;
  firstMonth: string;
  purpose: string;
  status: "DRAFT" | "WAITING" | "SANCTIONED" | "REJECTED";
  disbursed: boolean;
  balance: string;
  recovered: string;
  interestPaid: string;
  prepaid: string;
  waived: string;
  schedule: Array<{ n: number; month: string; principal: string; interest: string; balanceAfter: string; state: string }>;
  changes: Array<{ id: string; kind: string; amount: string | null; reference: string; effective: boolean; createdAt: string }>;
  waiting: { mine: boolean } | null;
  fingerprint: string;
  createdAt: string;
}
export interface LoanType {
  typeKey: string;
  version: number;
  name: string;
  maxAmount: string | null;
  maxInstalments: number | null;
  ratePercent: string | null;
  employeesMayRequest: boolean | null;
  disbursementHead: string | null;
  principalHead: string | null;
  interestHead: string | null;
  retired: boolean;
  gaps: string[];
}
export const myLoans = async () => (await apiClient.get<{ loans: LoanView[]; requestable: Array<{ typeKey: string; name: string; maxAmount: string; maxInstalments: number; ratePercent: string }> }>(`${base}/mine`)).data;
export const askForLoan = async (body: { typeKey: string; principal: string; instalments: number; firstMonth: string; purpose: string }) => (await apiClient.post<{ id: string }>(`${base}/mine`, body)).data;
export const allLoans = async () => (await apiClient.get<{ loans: LoanView[] }>(base)).data.loans;
export const loanTypes = async () => (await apiClient.get<{ types: LoanType[] }>(`${base}/types`)).data.types;
export const saveLoanType = async (body: Omit<LoanType, "version" | "gaps"> & { reason: string }) => (await apiClient.put(`${base}/types`, body)).data;
export const enterLoan = async (body: { employeeId: string; typeKey: string; principal: string; instalments: number; firstMonth: string; purpose: string }) => (await apiClient.post<{ id: string }>(base, body)).data;
export const requestSanction = async (id: string, fingerprint: string) => (await apiClient.post(`${base}/${id}/sanction`, { fingerprint })).data;
export const decideSanction = async (id: string, fingerprint: string, decision: "APPROVE" | "REJECT") => (await apiClient.post(`${base}/${id}/sanction/decision`, { fingerprint, decision })).data;
