import { apiClient } from "./client";

// Part 3 B2a: each company's payroll registrations and bank details, directors only. Not set until entered and confirmed by a different director.
const base = "/api/payroll-company-settings";
type View = { id: string; registrations: Record<string, string | undefined>; debitAccount: string | null; reason: string; enteredByMe: boolean; at: string };
export interface CompanySettings { companies: Array<{ key: string; name: string; inForce: View | null; waiting: View | null }>; note: string }
export const companySettings = async () => (await apiClient.get<CompanySettings>(base)).data;
export const enterCompanySettings = async (body: { companyKey: string; registrations: Record<string, string | undefined>; debitAccount?: string; reason: string }) => (await apiClient.post<{ id: string }>(base, body)).data;
export const confirmCompanySettings = async (id: string) => (await apiClient.post(`${base}/${id}/confirm`)).data;
