import { apiClient } from "./client";

// ST-30: compliance due dates, directors only. None is preset; each is entered with its source.
const base = "/api/payroll-compliance";
export interface DueDateView { id: string; statute: string; item: string; dueDay: number; remindDaysBefore: number; source: string; dueThisMonth: string; state: "DONE" | "OVERDUE" | "DUE_SOON" | "UPCOMING"; doneMonths: string[] }
export const listDueDates = async () => (await apiClient.get<{ month: string; dates: DueDateView[]; note: string }>(base)).data;
export const addDueDate = async (body: { statute: string; item: string; dueDay: number; remindDaysBefore: number; source: string }) => (await apiClient.post<{ id: string }>(base, body)).data;
export const retireDueDate = async (id: string, reason: string) => (await apiClient.post(`${base}/${id}/retire`, { reason })).data;
export const markDueDateDone = async (id: string, month: string, note?: string) => (await apiClient.post(`${base}/${id}/done`, { month, ...(note ? { note } : {}) })).data;
