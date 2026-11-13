import { apiClient } from "./client";

// M session block 2, AT-19: overtime claims.
export type ClaimStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
export interface MyOvertimeDay { date: string; excessMinutes: number; eligibleMinutes: number; claim: { id: string; status: ClaimStatus; minutes: number; decisionNote: string | null } | null }
export interface MyOvertime { active: boolean; policy?: { minimumMinutes: number; roundToMinutes: number }; days: MyOvertimeDay[] }
export interface OvertimeClaim { id: string; employeeId: string; employeeCode: string; fullName: string; date: string; minutes: number; approvedMinutes: number | null; note: string; status: ClaimStatus; decisionNote: string | null }
export const myOvertime = async (month: string) => (await apiClient.get<MyOvertime>("/api/overtime/mine", { params: { month } })).data;
export const claimOvertime = async (date: string, note: string) => (await apiClient.post("/api/overtime/mine", { date, note })).data;
export const withdrawOvertime = async (id: string) => (await apiClient.post(`/api/overtime/mine/${id}/withdraw`)).data;
export const listOvertime = async (status: "PENDING" | "APPROVED" | "REJECTED") => (await apiClient.get<{ active: boolean; claims: OvertimeClaim[] }>("/api/overtime", { params: { status } })).data;
export const approveOvertime = async (id: string) => (await apiClient.post(`/api/overtime/${id}/approve`, {})).data;
export const rejectOvertime = async (id: string, note: string) => (await apiClient.post(`/api/overtime/${id}/reject`, { note })).data;
export const overtimeTotals = async (month: string) => (await apiClient.get<{ people: Array<{ employeeId: string; employeeCode: string; fullName: string; days: number; minutes: number }> }>("/api/overtime/totals", { params: { month } })).data.people;
export const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
