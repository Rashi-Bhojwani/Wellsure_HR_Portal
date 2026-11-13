import { apiClient } from "./client";

// M session block 2, OE-04: onboarding checklist.
export interface OnboardingTask { id: string; position: number; owner: "HR" | "MANAGER" | "EMPLOYEE"; step: string; dueDate: string; doneAt: string | null }
export interface Joiner { employeeId: string; employeeCode: string; fullName: string; dateOfJoining: string; started: boolean; total: number; done: number; overdue: number }
export const listJoiners = async (show: "open" | "all") => (await apiClient.get<{ people: Joiner[] }>("/api/onboarding", { params: { show } })).data.people;
export const startOnboarding = async (employeeId: string) => (await apiClient.post(`/api/onboarding/${employeeId}/start`)).data;
export const stepsOf = async (employeeId: string) => (await apiClient.get<{ tasks: OnboardingTask[] }>(`/api/onboarding/${employeeId}/steps`)).data.tasks;
export const myOnboarding = async () => (await apiClient.get<{ own: OnboardingTask[]; team: Array<{ employeeId: string; fullName: string; tasks: OnboardingTask[] }> }>("/api/onboarding/mine")).data;
export const setStepDone = async (taskId: string, done: boolean) => (await apiClient.put<OnboardingTask>(`/api/onboarding/tasks/${taskId}/done`, { done })).data;
export const OWNER_LABEL: Record<OnboardingTask["owner"], string> = { HR: "HR", MANAGER: "Manager", EMPLOYEE: "Employee" };
