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

// G3: attendance activity locks (directors).
export interface AttendanceLockView {
  id: string;
  effectiveFrom: string;
  fromDate: string;
  toDate: string;
  categories: string[];
  people: number;
  everyone: boolean;
  segmentName: string | null;
  reason: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
  state: "IN_FORCE" | "SCHEDULED" | "VOID";
}
export const listLocks = async () => (await apiClient.get<{ locks: AttendanceLockView[]; categories: Array<{ code: string; label: string }> }>("/api/workforce/locks")).data;
export const createLock = async (body: { effectiveFrom: string; fromDate: string; toDate: string; categories: string[]; segmentId: string | null; reason: string }) =>
  (await apiClient.post<AttendanceLockView>("/api/workforce/locks", body)).data;
export const voidLock = async (id: string, reason: string) => (await apiClient.post<AttendanceLockView>(`/api/workforce/locks/${id}/void`, { reason })).data;

// G4: holiday locations, weekend overrides, leave type reviewers.
export const holidayLocations = async () => (await apiClient.get<{ locations: Record<string, string[]> }>("/api/workforce/holidays/locations")).data.locations;
export const setHolidayLocations = async (id: string, locationIds: string[], reason: string) => (await apiClient.put(`/api/workforce/holidays/${id}/locations`, { locationIds, reason })).data;
export interface WeekendOverrideView {
  id: string;
  fromDate: string;
  toDate: string;
  pattern: string;
  people: number;
  segmentName: string | null;
  reason: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
export const listWeekendOverrides = async () => (await apiClient.get<{ overrides: WeekendOverrideView[] }>("/api/workforce/weekend-overrides")).data.overrides;
export const createWeekendOverride = async (body: { fromDate: string; toDate: string; weekOffPatternId: string; employeeIds?: string[]; segmentId?: string | null; reason: string }) =>
  (await apiClient.post<WeekendOverrideView>("/api/workforce/weekend-overrides", body)).data;
export const voidWeekendOverride = async (id: string, reason: string) => (await apiClient.post(`/api/workforce/weekend-overrides/${id}/void`, { reason })).data;
export interface ReviewerView {
  id: string;
  leaveType: string;
  reviewerCode: string;
  reviewerEmployeeId: string;
  location: string | null;
  department: string | null;
  reason: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
export const listReviewers = async () => (await apiClient.get<{ reviewers: ReviewerView[] }>("/api/workforce/leave-reviewers")).data.reviewers;
export const createReviewer = async (body: { leaveTypeId: string; reviewerEmployeeId: string; locationId?: string | null; departmentId?: string | null; reason: string }) =>
  (await apiClient.post("/api/workforce/leave-reviewers", body)).data;
export const voidReviewer = async (id: string, reason: string) => (await apiClient.post(`/api/workforce/leave-reviewers/${id}/void`, { reason })).data;

// G5: swipe decisions and device sync requests.
export const decideSwipes = async (body: { punchIds: string[]; action: "REJECT" | "REINSTATE"; reason: string }) => (await apiClient.post<{ decided: number }>("/api/workforce/swipes/decide", body)).data;
export interface SyncRequestView {
  id: string;
  device: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: "PENDING" | "DONE" | "CANCELLED";
  requestedAt: string;
  finishedAt: string | null;
}
export const listSyncRequests = async () => (await apiClient.get<{ requests: SyncRequestView[] }>("/api/workforce/sync-requests")).data.requests;
export const requestSync = async (body: { deviceId: string; fromDate: string; toDate: string; reason: string }) => (await apiClient.post<SyncRequestView>("/api/workforce/sync-requests", body)).data;
export const cancelSync = async (id: string) => (await apiClient.post<SyncRequestView>(`/api/workforce/sync-requests/${id}/cancel`)).data;

// G6: leavers.
export interface LeaverRow {
  separationId: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  lastWorkingDate: string;
  separationStatus: string;
  status: "PENDING" | "DONE";
  doneAt: string | null;
  actions: number | null;
}
export interface RecalcAction {
  type: "CREDIT" | "REVERSE";
  accrualMonth: string;
  leaveTypeCode: string;
  days: number;
}
export const listLeavers = async (q: { status?: "PENDING" | "DONE" }) => (await apiClient.get<{ from: string; to: string; leavers: LeaverRow[] }>("/api/workforce/leavers", { params: q })).data;
export const previewLeaver = async (id: string) => (await apiClient.get<{ lastWorkingDate: string; actions: RecalcAction[] }>(`/api/workforce/leavers/${id}/preview`)).data;
export const applyLeaver = async (id: string) => (await apiClient.post<{ lastWorkingDate: string; actions: RecalcAction[] }>(`/api/workforce/leavers/${id}/apply`)).data;

// G7: workflow.
export type WorkflowType = "LEAVE" | "REGULARIZATION";
export interface WorkflowItem {
  id: string;
  type: WorkflowType;
  employeeId: string;
  employeeCode: string;
  name: string;
  what: string;
  when: string;
  reason: string | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  waitingOn?: string | null;
}
export const workflowReview = async (q: { type: WorkflowType; state: "PENDING" | "COMPLETED"; search?: string }) => (await apiClient.get<{ items: WorkflowItem[] }>("/api/workforce/workflow/review", { params: q })).data.items;
export const workflowMonitor = async (q: { type: WorkflowType; search?: string }) => (await apiClient.get<{ items: WorkflowItem[] }>("/api/workforce/workflow/monitor", { params: q })).data.items;
export const workflowDecide = async (body: { type: WorkflowType; ids: string[]; approve: boolean; note?: string | null }) =>
  (await apiClient.post<{ decided: number; failed: number; results: Array<{ id: string; ok: boolean; error?: string }> }>("/api/workforce/workflow/decide", body)).data;
