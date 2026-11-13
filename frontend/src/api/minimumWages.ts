import { apiClient } from "./client";

// ST-29: minimum wages, directors only. Every rate, category and compared head is entered by a director; none is preset.
const base = "/api/payroll-minimum-wages";
export interface MinimumWageSetup {
  rates: Array<{ id: string; state: string; category: string; monthlyAmount: string; effectiveFrom: string; source: string }>;
  basis: { headCodes: string[]; source: string; setAt: string } | null;
  branchStates: string[];
  note: string;
}
export interface MinimumWageCheck { run: string; basis?: string[]; notSet: string[]; checked: number; below: Array<{ employeeCode: string; name: string; state: string; category: string; compared: string; minimum: string; shortfall: string }>; note?: string }
export const minimumWageSetup = async () => (await apiClient.get<MinimumWageSetup>(base)).data;
export const addMinimumWage = async (body: { state: string; category: string; monthlyAmount: string; effectiveFrom: string; source: string }) => (await apiClient.post(`${base}/rates`, body)).data;
export const setMinimumWageCategory = async (employeeId: string, category: string) => (await apiClient.post(`${base}/categories`, { employeeId, category })).data;
export const setMinimumWageBasis = async (headCodes: string[], source: string) => (await apiClient.post(`${base}/basis`, { headCodes, source })).data;
export const minimumWageCheck = async (runId: string) => (await apiClient.get<MinimumWageCheck>(`${base}/check`, { params: { runId } })).data;
