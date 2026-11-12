import { apiClient } from "./client";

// M session block 2, AT-36: work-from-home requests.
export type WfhStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
export interface MyWfh { active: boolean; eligible: boolean; maxDaysPerRequest: number | null; requests: Array<{ id: string; fromDate: string; toDate: string; reason: string; status: WfhStatus; decisionNote: string | null }> }
export interface WfhRow { id: string; employeeId: string; employeeCode: string; fullName: string; fromDate: string; toDate: string; reason: string; status: WfhStatus; decisionNote: string | null }
export const myWfh = async () => (await apiClient.get<MyWfh>("/api/wfh-requests/mine")).data;
export const askWfh = async (input: { fromDate: string; toDate: string; reason: string }) => (await apiClient.post("/api/wfh-requests/mine", input)).data;
export const withdrawWfh = async (id: string) => (await apiClient.post(`/api/wfh-requests/mine/${id}/withdraw`)).data;
export const listWfh = async (status: "PENDING" | "APPROVED" | "REJECTED") => (await apiClient.get<{ requests: WfhRow[] }>("/api/wfh-requests", { params: { status } })).data.requests;
export const approveWfh = async (id: string) => (await apiClient.post(`/api/wfh-requests/${id}/approve`)).data;
export const rejectWfh = async (id: string, note: string) => (await apiClient.post(`/api/wfh-requests/${id}/reject`, { note })).data;
export const WFH_LABEL: Record<WfhStatus, string> = { PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Not approved", WITHDRAWN: "Withdrawn" };
export const WFH_TONE: Record<WfhStatus, "info" | "success" | "danger" | "neutral"> = { PENDING: "info", APPROVED: "success", REJECTED: "danger", WITHDRAWN: "neutral" };
