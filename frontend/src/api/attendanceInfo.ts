import { apiClient } from "./client";

// Attendance Info, Who Is In? and the forgot-to-punch request (Phase 2 P2-E).

export interface MonthDay {
  date: string;
  status: string;
  code: string;
  shiftCode: string | null;
  source: string;
  capture: "DEVICE" | "MANUAL";
  statusOnly: boolean;
  corrected: boolean;
  missingPunch: boolean;
  flags: string[];
  lopDays: number;
  firstIn: string | null;
  lastOut: string | null;
  totalMinutes: number | null;
  actualMinutes: number | null;
  lateInMinutes: number | null;
  provisional: boolean;
  locked: boolean;
  workedOnOffDay: boolean;
  request: { id: string; status: RegularizationStatus; missing: "IN" | "OUT"; time: string } | null;
}

export interface MonthView {
  employee: { id: string; employeeCode: string; name: string; dateOfJoining: string };
  month: string;
  today: string;
  days: MonthDay[];
  stats: { avgWorkMinutes: number | null; avgActualMinutes: number | null; lateDays: number; lopDays: number; exceptionDays: number; exceptionKinds: Record<string, number> };
}

export type RegularizationStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface DayDetail {
  date: string;
  employed: boolean;
  status?: string;
  code?: string;
  firstHalfStatus?: string | null;
  secondHalfStatus?: string | null;
  source?: string;
  capture?: "DEVICE" | "MANUAL";
  lopDays?: number;
  flags?: string[];
  provisional?: boolean;
  locked?: boolean;
  holidayName?: string | null;
  leaveTypeCode?: string | null;
  workedOnOffDay?: boolean;
  processedAt?: string;
  shift?: { code: string; name: string; startTime: string; endTime: string; sessions: Array<{ kind: string; label: string; startTime: string; endTime: string }> } | null;
  policy?: { code: string; name: string } | null;
  times?: Record<"firstIn" | "lastOut", string | null> & Record<"lateInMinutes" | "earlyOutMinutes" | "totalMinutes" | "breakMinutes" | "actualMinutes" | "inShiftMinutes" | "shortfallMinutes" | "excessMinutes", number | null>;
  manualEntry?: { kind: string; text: string; via: string; remark: string | null; enteredBy: string | null; enteredAt: string } | null;
  punches?: Array<{ id: string; time: string; date: string; device: string; route: string; role: "FIRST_IN" | "LAST_OUT" | "ONLY" | "BETWEEN" | "DUPLICATE" | "FLAGGED" | "DISCARDED" | "NOT_USED" }>;
  correction?: { id: string; missing: "IN" | "OUT"; time: string; decidedBy: string | null; decidedAt: string | null } | null;
  requests?: Array<{ id: string; status: RegularizationStatus; missing: "IN" | "OUT"; time: string; reason: string; decisionNote: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string }>;
  canRequest?: { ok: true; punchTime: string } | { ok: false; reason: string } | null;
}

export async function myMonth(month: string): Promise<MonthView> {
  return (await apiClient.get<MonthView>("/api/attendance/me/month", { params: { month } })).data;
}
export async function myDay(date: string): Promise<DayDetail> {
  return (await apiClient.get<DayDetail>(`/api/attendance/me/day/${date}`)).data;
}
export async function employeeMonth(employeeId: string, month: string): Promise<MonthView> {
  return (await apiClient.get<MonthView>(`/api/attendance/employees/${employeeId}/month`, { params: { month } })).data;
}
export async function employeeDay(employeeId: string, date: string): Promise<DayDetail> {
  return (await apiClient.get<DayDetail>(`/api/attendance/employees/${employeeId}/day/${date}`)).data;
}

export async function raiseRegularization(body: { date: string; missing: "IN" | "OUT"; time: string; reason: string }) {
  return (await apiClient.post("/api/attendance/me/regularizations", body)).data;
}
export async function cancelRegularization(id: string) {
  return (await apiClient.post(`/api/attendance/me/regularizations/${id}/cancel`)).data;
}

export interface QueueRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  date: string;
  missing: "IN" | "OUT";
  time: string;
  reason: string;
  status: RegularizationStatus;
  punch: string | null;
  dayStatus: string | null;
  shift: string | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
}
export async function regularizationQueue(status?: RegularizationStatus): Promise<QueueRow[]> {
  return (await apiClient.get<{ requests: QueueRow[] }>("/api/attendance/regularizations", { params: { status } })).data.requests;
}
export async function approveRegularization(id: string, note?: string) {
  return (await apiClient.post(`/api/attendance/regularizations/${id}/approve`, { note: note || null })).data;
}
export async function rejectRegularization(id: string, note?: string) {
  return (await apiClient.post(`/api/attendance/regularizations/${id}/reject`, { note: note || null })).data;
}

export interface WhoPerson {
  employeeId: string;
  employeeCode: string;
  name: string;
  branch: string | null;
  department: string | null;
}
export interface WhoIsIn {
  date: string;
  asOf: string;
  filters: { locations: Array<{ id: string; name: string }>; departments: Array<{ id: string; name: string }> };
  counts: { total: number; arrived: number; notArrived: number; away: number; manual: number; late: number };
  arrived: Array<WhoPerson & { time: string | null; lateInMinutes: number | null; halfDayLeave: string | null }>;
  notArrived: Array<WhoPerson & { shiftStart: string | null }>;
  away: Array<WhoPerson & { why: string; workedToday: boolean }>;
  manual: Array<WhoPerson & { state: "NOT_MARKED" | "STATUS_ONLY" | "TIMED"; time: string | null; status: string }>;
}
export async function whoIsIn(q: { locationId?: string; departmentId?: string }): Promise<WhoIsIn> {
  return (await apiClient.get<WhoIsIn>("/api/attendance/who-is-in", { params: q })).data;
}
