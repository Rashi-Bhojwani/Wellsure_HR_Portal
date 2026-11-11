import { apiClient } from "./client";

// LT-08 (M session): an employee asks for a letter; whoever may prepare the template marks it done or declines it.
export type AskStatus = "ASKED" | "DONE" | "DECLINED" | "WITHDRAWN";
export interface AskOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
}
export interface MyAsk {
  id: string;
  template: string;
  purpose: string;
  status: AskStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export interface PreparerAsk {
  id: string;
  template: { id: string; code: string; name: string };
  employee: { id: string; employeeCode: string; fullName: string };
  purpose: string;
  status: AskStatus;
  note: string | null;
  letterRequestId: string | null;
  candidates: Array<{ id: string; status: string; serial: string | null; preparedAt: string }>;
  createdAt: string;
  decidedAt: string | null;
}
export const askOptions = async () => (await apiClient.get<{ templates: AskOption[] }>("/api/letters/asks/options")).data.templates;
export const myAsks = async () => (await apiClient.get<{ asks: MyAsk[] }>("/api/letters/asks/mine")).data.asks;
export const askForLetter = async (templateCode: string, purpose: string) => (await apiClient.post("/api/letters/asks/mine", { templateCode, purpose })).data;
export const withdrawAsk = async (id: string) => (await apiClient.post(`/api/letters/asks/mine/${id}/withdraw`, {})).data;
export const preparerAsks = async (status: AskStatus) => (await apiClient.get<{ asks: PreparerAsk[] }>("/api/letters/asks", { params: { status } })).data.asks;
export const markAskDone = async (id: string, letterRequestId: string) => (await apiClient.post(`/api/letters/asks/${id}/done`, { letterRequestId })).data;
export const declineAsk = async (id: string, reason: string) => (await apiClient.post(`/api/letters/asks/${id}/decline`, { reason })).data;
