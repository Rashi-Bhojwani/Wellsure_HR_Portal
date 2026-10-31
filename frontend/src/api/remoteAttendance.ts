import { apiClient } from "./client";

// Remote attendance (Stage 5a) — backend/src/modules/attendance/remote. Times are HH:MM only; nothing here carries a place.

export type RemoteStatus = "OPEN" | "PENDING" | "APPROVED_FULL" | "APPROVED_HALF" | "REJECTED";
export interface RemoteRecord {
  id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: RemoteStatus;
  half: "FIRST" | "SECOND" | null;
  decidedAt: string | null;
  decisionReason: string | null;
  rejectOutcome: "ABSENT" | "LOSS_OF_PAY" | null;
  reopenCount: number;
  openRequests: number;
  hours: string | null;
  reviewUsed: boolean;
}
export type DayState = "NOT_STARTED" | "CHECKED_IN" | "CHECKED_OUT" | "PENDING_APPROVAL" | "APPROVED" | "HALF_DAY" | "REJECTED";
export interface RemoteToday {
  remote: boolean;
  today: string;
  serverTime: string;
  state: DayState;
  record: RemoteRecord | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
}
export interface DirectorRecord extends RemoteRecord {
  employeeId: string;
  employeeCode: string;
  name: string;
  yours: boolean;
  departmentName: string | null;
  correctionNote: string | null;
  decidedByName: string | null;
}
export interface RemotePerson {
  employeeId: string;
  employeeCode: string;
  name: string;
  remoteToday: boolean;
  since: string | null;
  lastReason: string | null;
}
export interface RemoteRequestRow {
  id: string;
  recordId: string;
  kind: "CORRECTION" | "REVIEW";
  note: string;
  name: string;
  date: string;
  proposedCheckIn: string | null;
  proposedCheckOut: string | null;
  createdAt: string;
}
export type Decision = { kind: "FULL"; note?: string } | { kind: "HALF"; half: "FIRST" | "SECOND"; reason: string } | { kind: "REJECT"; reason: string; outcome: "ABSENT" | "LOSS_OF_PAY" };
export interface RemoteReport {
  from: string;
  to: string;
  total: { days: number; full: number; half: number; absent: number; lossOfPay: number; pending: number };
  pendingNow: number;
  people: Array<{ name: string; days: number; full: number; half: number; absent: number; lossOfPay: number; pending: number; hours: string }>;
  perMonth: Array<{ name: string; month: string; days: number; full: number; half: number; rejected: number; pending: number }>;
  rejected: Array<{ name: string; date: string; outcome: string; reason: string }>;
  halfDays: Array<{ name: string; date: string; half: string; reason: string }>;
}
export interface RemoteSettings {
  reminderAfterHours: number | null;
  suggestedRejectOutcome: "ABSENT" | "LOSS_OF_PAY" | null;
}

const base = "/api/attendance";
const get = async <T>(path: string, params?: object) => (await apiClient.get<T>(`${base}${path}`, { params })).data;
const post = async <T>(path: string, body?: object) => (await apiClient.post<T>(`${base}${path}`, body ?? {})).data;

export const myRemoteToday = () => get<RemoteToday>("/me/remote/today");
export const myRemoteRecords = async (q: { from?: string; to?: string } = {}) => (await get<{ records: RemoteRecord[] }>("/me/remote/records", q)).records;
export const askMissedDay = (body: { date: string; note: string; checkIn: string; checkOut: string }) => post<{ id: string }>("/me/remote/missed-day", body);
export const remoteCheckIn = () => post<RemoteRecord>("/me/remote/check-in");
export const remoteCheckOut = () => post<RemoteRecord>("/me/remote/check-out");
export const askRemoteChange = (recordId: string, body: { kind: "CORRECTION" | "REVIEW"; note: string; checkIn?: string; checkOut?: string }) => post<{ id: string }>(`/me/remote/records/${recordId}/requests`, body);

export const remotePeople = async () => (await get<{ people: RemotePerson[] }>("/remote/marks")).people;
export const markRemote = (body: { employeeId: string; effectiveFrom: string; remote: boolean; reason: string }) => post<{ id: string }>("/remote/marks", body);
export const remoteRecords = (q: { status?: RemoteStatus; from?: string; to?: string; employeeId?: string; departmentId?: string; page: number; pageSize: number }) => get<{ rows: DirectorRecord[]; total: number }>("/remote/records", q);
export const decideRemote = (id: string, d: Decision) => post<RemoteRecord>(`/remote/records/${id}/decision`, d);
export const reopenRemote = (id: string, reason: string) => post<RemoteRecord>(`/remote/records/${id}/reopen`, { reason });
export const bulkApproveRemote = (ids: string[], note?: string) => post<{ done: number; skipped: Array<{ id: string; why: string }> }>("/remote/bulk-approve", { ids, ...(note ? { note } : {}) });
export const bulkRejectRemote = (ids: string[], reason: string, outcome: "ABSENT" | "LOSS_OF_PAY") => post<{ done: number; skipped: Array<{ id: string; why: string }> }>("/remote/bulk-reject", { ids, reason, outcome });
export const remoteRequests = async () => (await get<{ requests: RemoteRequestRow[] }>("/remote/requests")).requests;
export const resolveRemoteRequest = (id: string, body: { accept: boolean; note: string }) => post<{ status: string }>(`/remote/requests/${id}/resolve`, body);
export const remoteReport = (from: string, to: string) => get<RemoteReport>("/remote/report", { from, to });
export const remoteSettings = () => get<RemoteSettings>("/remote/settings");
export const saveRemoteSettings = async (body: RemoteSettings) => (await apiClient.put<RemoteSettings>(`${base}/remote/settings`, body)).data;
