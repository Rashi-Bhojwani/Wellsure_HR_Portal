import { apiClient } from "./client";

// P7-6b (docs/plans/P7_6_SETTLEMENTS.md): off-cycle runs that pay a confirmed settlement or held pay. Directors only.
const base = "/api/offcycle";
export type OffCycleKind = "SETTLEMENT" | "HELD_PAY";
export interface OffCycleCandidate {
  kind: OffCycleKind;
  sourceRef: string;
  employeeCode: string;
  label: string;
  amount: string;
}
export interface OffCycleRun {
  id: string;
  kind: OffCycleKind;
  sourceRef: string;
  employeeId: string;
  name: string;
  paymentDate: string;
  lines: Array<{ label: string; amount: string; source: string }>;
  net: string;
  state: "PREPARED" | "WAITING" | "APPROVED" | "REJECTED" | "FINALISED" | "FILE_WRITTEN";
  approval: { status: string; mine: boolean; checkerIsMe: boolean; authority: string | null } | null;
  bankApproval: { status: string; mine: boolean; checkerIsMe: boolean } | null;
  file: { id: string; fileName: string; sentToBank: boolean } | null;
  fingerprint: string;
  bankFingerprint: string;
  createdAt: string;
}
export const listOffCycle = async () => (await apiClient.get<{ runs: OffCycleRun[] }>(base)).data.runs;
export const listCandidates = async () => (await apiClient.get<{ candidates: OffCycleCandidate[] }>(`${base}/candidates`)).data.candidates;
export const prepareOffCycle = async (body: { kind: OffCycleKind; sourceRef: string; paymentDate: string }) => (await apiClient.post<OffCycleRun>(base, body)).data;
export const askApproval = async (id: string, fingerprint: string) => (await apiClient.post(`${base}/${id}/approval`, { fingerprint })).data;
export const decide = async (id: string, fingerprint: string, decision: "APPROVE" | "REJECT") => (await apiClient.post(`${base}/${id}/decision`, { fingerprint, decision })).data;
export const finalise = async (id: string) => (await apiClient.post<OffCycleRun>(`${base}/${id}/finalise`)).data;
export const askBank = async (id: string, fingerprint: string) => (await apiClient.post(`${base}/${id}/bank/approval`, { fingerprint })).data;
export const decideBank = async (id: string, fingerprint: string, decision: "APPROVE" | "REJECT") => (await apiClient.post(`${base}/${id}/bank/decision`, { fingerprint, decision })).data;
export const writeBankFile = async (id: string) => (await apiClient.post<{ batchId: string; fileName: string }>(`${base}/${id}/bank/file`)).data;
export const downloadBankFile = async (batchId: string) => (await apiClient.get<{ url: string; fileName: string }>(`${base}/bank/${batchId}/download`)).data;
export const markSent = async (batchId: string) => (await apiClient.post(`${base}/bank/${batchId}/sent`, {})).data;
