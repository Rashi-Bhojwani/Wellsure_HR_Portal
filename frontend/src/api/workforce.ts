import { apiClient } from "./client";

// A-10 (docs/plans/GREYTHR_PARITY_WORKFORCE.md): Workforce Management additions.
export interface StatusView {
  code: string;
  meaning: string;
  kind: "day" | "half" | "marker";
  label: string;
  labelSet: boolean;
}
export interface SettingView<T> {
  key: string;
  value: T | null;
  notSet: boolean;
  setAt: string | null;
  reason: string | null;
}
export const listStatuses = async () => (await apiClient.get<{ statuses: StatusView[] }>("/api/workforce/statuses")).data.statuses;
export const getSetting = async <T>(key: string) => (await apiClient.get<SettingView<T>>(`/api/workforce/settings/${key}`)).data;
export const saveSetting = async <T>(key: string, value: T, reason: string) => (await apiClient.put<SettingView<T>>(`/api/workforce/settings/${key}`, { value, reason })).data;
export const settingHistory = async (key: string) => (await apiClient.get<{ history: Array<{ id: string; value: unknown; reason: string; setAt: string }> }>(`/api/workforce/settings/${key}/history`)).data.history;

// G2: the roster month grid.
export type RosterDayKind = "WORK" | "OFF" | "HOLIDAY" | "NOT_EMPLOYED" | "NO_ASSIGNMENT";
export interface RosterMonth {
  cycle: { start: string; end: string; label: string };
  days: string[];
  rows: Array<{ employeeId: string; employeeCode: string; name: string; workDays: number; offDays: number; cells: Array<{ date: string; kind: RosterDayKind; shiftCode: string | null; overridden: boolean }> }>;
  legend: Array<{ code: string; name: string; startTime: string; endTime: string }>;
}
export const rosterMonth = async (q: { cycleStart?: string; locationId?: string; departmentId?: string }) => (await apiClient.get<RosterMonth>("/api/workforce/roster/grid", { params: q })).data;
export const exportRosterMonth = async (q: { cycleStart?: string; locationId?: string; departmentId?: string }) =>
  (await apiClient.get("/api/workforce/roster/grid/export", { params: q, responseType: "blob" })).data as Blob;
