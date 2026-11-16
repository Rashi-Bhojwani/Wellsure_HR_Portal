import { apiClient } from "./client";

// Part 3 A2/A3: paying approved overtime and in-year leave encashment, directors only. Nothing is paid while a setting is Not set.
const base = "/api/payroll-pay-policies";
export interface OvertimePreview { month: string; notSet: string[]; payHead: string | null; people: Array<{ employeeId: string; employeeCode: string; name: string; minutes: number; amount: string | null; posted: boolean; noSalary: boolean }> }
export interface EncashmentList { notSet: string[]; payHead: string | null; requests: Array<{ id: string; employeeCode: string; name: string; leaveType: string; leaveYear: number; days: string; amount: string | null; paid: boolean; noSalary: boolean }> }
export const overtimePreview = async (month: string) => (await apiClient.get<OvertimePreview>(`${base}/overtime`, { params: { month } })).data;
export const postOvertime = async (month: string) => (await apiClient.post<{ month: string; created: number }>(`${base}/overtime/post`, { month })).data;
export const encashmentList = async () => (await apiClient.get<EncashmentList>(`${base}/encashment`)).data;
export const payEncashment = async (requestId: string) => (await apiClient.post(`${base}/encashment/pay`, { requestId })).data;
