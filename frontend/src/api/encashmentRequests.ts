import { apiClient } from "./client";

// M session block 2, LV-23: leave encashment requests during the year (days only; payroll pays them).
export type EncStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
export interface MyEncashment { active: boolean; keepAtLeast?: number; maxDaysPerYear?: number; types: Array<{ code: string; name: string; balance: number; askedThisYear: number; mayAsk: number }>; requests: Array<{ id: string; leaveTypeCode: string; days: number; status: EncStatus; decisionNote: string | null; createdAt: string }> }
export interface EncRow { id: string; employeeId: string; employeeCode: string; fullName: string; leaveTypeCode: string; leaveYear: number; days: number; reason: string; status: EncStatus; decisionNote: string | null }
export const myEncashment = async () => (await apiClient.get<MyEncashment>("/api/encashment-requests/mine")).data;
export const askEncashment = async (input: { leaveTypeCode: string; days: number; reason: string }) => (await apiClient.post("/api/encashment-requests/mine", input)).data;
export const withdrawEncashment = async (id: string) => (await apiClient.post(`/api/encashment-requests/mine/${id}/withdraw`)).data;
export const listEncashment = async (status: "PENDING" | "APPROVED" | "REJECTED") => (await apiClient.get<{ requests: EncRow[] }>("/api/encashment-requests", { params: { status } })).data.requests;
export const approveEncashment = async (id: string) => (await apiClient.post(`/api/encashment-requests/${id}/approve`, {})).data;
export const rejectEncashment = async (id: string, note: string) => (await apiClient.post(`/api/encashment-requests/${id}/reject`, { note })).data;
export const ENC_LABEL: Record<EncStatus, string> = { PENDING: "Waiting", APPROVED: "Approved: paid with payroll", REJECTED: "Not approved", WITHDRAWN: "Withdrawn" };
export const ENC_TONE: Record<EncStatus, "info" | "success" | "danger" | "neutral"> = { PENDING: "info", APPROVED: "success", REJECTED: "danger", WITHDRAWN: "neutral" };
