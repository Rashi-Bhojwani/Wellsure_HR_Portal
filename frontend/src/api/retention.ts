import { apiClient } from "./client";

// M session block 2, AD-07: data retention for former employees (directors).
export type ErasureCategory = "CONTACT" | "DOCUMENTS";
export interface DueRow { employeeId: string; employeeCode: string; fullName: string; lastWorkingDate: string; category: ErasureCategory; proposal: { id: string; mine: boolean } | null }
export const retentionDue = async () => (await apiClient.get<{ periods: { contactMonths: number | null; documentsMonths: number | null }; due: DueRow[] }>("/api/retention/due")).data;
export const proposeErasure = async (employeeId: string, category: ErasureCategory) => (await apiClient.post("/api/retention/erasures", { employeeId, category })).data;
export const confirmErasure = async (id: string) => (await apiClient.post<{ items: number }>(`/api/retention/erasures/${id}/confirm`)).data;
export const CATEGORY_LABEL: Record<ErasureCategory, string> = { CONTACT: "Contact and personal details", DOCUMENTS: "General documents shared with them" };
