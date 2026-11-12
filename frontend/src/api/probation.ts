import { apiClient } from "./client";

// M session block 2, ER-26: probation.
export interface ProbationRow { employeeId: string; employeeCode: string; fullName: string; department: string | null; manager: string | null; dateOfJoining: string; lastDay: string; extended: boolean; confirmedAt: string | null; overdue: boolean }
export const listProbation = async (show: "due" | "all") => (await apiClient.get<{ policy: { months: number; reminderDays: number }; people: ProbationRow[] }>("/api/probation", { params: { show } })).data;
export const confirmProbation = async (employeeId: string, reason: string) => (await apiClient.post(`/api/probation/${employeeId}/confirm`, { reason })).data;
export const extendProbation = async (employeeId: string, until: string, reason: string) => (await apiClient.post(`/api/probation/${employeeId}/extend`, { until, reason })).data;
export const myProbation = async () => (await apiClient.get<{ lastDay: string; confirmedAt: string | null; extended: boolean }>("/api/probation/mine")).data;
