import { apiClient } from "./client";

// Attendance Info, Who Is In? and regularization (Phase 2 P2-E began it; Phase 3 commit 1 generalised it).

export type ReasonCode = "FORGOT_TO_PUNCH" | "DEVICE_DOWN" | "ON_DUTY_ELSEWHERE" | "OTHER";
export const REASON_OPTIONS: Array<{ value: ReasonCode; label: string }> = [
  { value: "FORGOT_TO_PUNCH", label: "Forgot to punch" },
  { value: "DEVICE_DOWN", label: "Device was down" },
  { value: "ON_DUTY_ELSEWHERE", label: "On duty elsewhere" },
  { value: "OTHER", label: "Other" },
];
export type TargetStatus = "P" | "A" | "HD_FIRST" | "HD_SECOND";
export const STATUS_OPTIONS: Array<{ value: TargetStatus; label: string }> = [
  { value: "P", label: "Present" },
  { value: "A", label: "Absent" },
  { value: "HD_FIRST", label: "Half day (first half present)" },
  { value: "HD_SECOND", label: "Half day (second half present)" },
];
/** A correction: times (in, out or both) or a status. */
export interface CorrectionBody {
  inTime?: string | null;
  outTime?: string | null;
  status?: TargetStatus | null;
}

export interface MonthDay {
  date: string;
  status: string;
  code: string;
  shiftCode: string | null;
  source: string;
  capture: "DEVICE" | "MANUAL";
  statusOnly: boolean;
  corrected: boolean;
  /** REGULARIZATION | MANUAL_OVERRIDE when the day was corrected by hand. */
  overrideKind?: string | null;
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
  request: { id: string; status: RegularizationStatus; reasonLabel: string; correctionText: string } | null;
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
  employeeName?: string | null;
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
  /** The correction this day was computed with (a regularization, or a manual override), and who and why. */
  override?: { id: string; origin: "REGULARIZATION" | "MANUAL_OVERRIDE"; kind: string; text: string; reasonLabel: string | null; reason: string; by: string | null; at: string; requestId: string | null } | null;
  /** Approved leave HR released because the person worked this day, and the days that went back to their balance (Phase 3 commit 2). */
  leaveReleased?: Array<{ type: string; days: number; reason: string; by: string | null; at: string }>;
  /** The day's shift came from a Shift Override, not the person's assignment. */
  shiftOverride?: { id: string; shiftName: string | null; reason: string; by: string | null; at: string } | null;
  requests?: Array<{ id: string; status: RegularizationStatus; reasonCode: ReasonCode; reasonLabel: string; correctionText: string; reason: string; decisionNote: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string }>;
  canRequest?: Eligibility | null;
}

export type Eligibility =
  | { ok: true; earliest: string; day: { status: string; punchCount: number; firstIn: string | null; lastOut: string | null; shift: string | null } }
  | { ok: false; reason: string; code: string };

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

export async function raiseRegularization(body: CorrectionBody & { date: string; reasonCode: ReasonCode; note?: string }) {
  return (await apiClient.post("/api/attendance/me/regularizations", body)).data;
}
export async function regularizationEligibility(date: string): Promise<Eligibility> {
  return (await apiClient.get<Eligibility>("/api/attendance/me/regularizations/eligibility", { params: { date } })).data;
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
  reasonCode: ReasonCode;
  reasonLabel: string;
  inTime: string | null;
  outTime: string | null;
  targetStatus: TargetStatus | null;
  correctionText: string;
  reason: string;
  status: RegularizationStatus;
  batchId: string | null;
  punches: { count: number; firstIn: string | null; lastOut: string | null } | null;
  dayStatus: string | null;
  shift: string | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
}
export interface QueueFilter {
  status?: RegularizationStatus;
  reasonCode?: ReasonCode;
  from?: string;
  to?: string;
  batchId?: string;
}
export async function regularizationQueue(filter: QueueFilter = {}): Promise<QueueRow[]> {
  return (await apiClient.get<{ requests: QueueRow[] }>("/api/attendance/regularizations", { params: filter })).data.requests;
}

// Bulk correction by HR (Phase 3 commit 1): preview, then confirm the exact set that was previewed.
export interface BulkBody extends CorrectionBody {
  selection: { employeeIds?: string[]; locationId?: string; departmentId?: string };
  from: string;
  to: string;
  reasonCode: ReasonCode;
  note: string;
  action: "RAISE" | "RAISE_AND_APPROVE";
}
export interface BulkPreview {
  count: number;
  employees: number;
  correction: string;
  action: "RAISE" | "RAISE_AND_APPROVE";
  ownLeftOut: number;
  fingerprint: string;
  caps: { maxRangeDays: number; maxEmployeeDays: number };
  rows: Array<{ employeeId: string; employeeCode: string; name: string; date: string; before: string | null; after: string | null }>;
  cannotCorrect: Array<{ code: string; label: string; count: number; examples: Array<{ employeeCode: string; name: string; date: string }> }>;
}
export async function previewBulkCorrection(body: BulkBody): Promise<BulkPreview> {
  return (await apiClient.post<BulkPreview>("/api/attendance/regularizations/bulk/preview", body)).data;
}
export async function confirmBulkCorrection(body: BulkBody, fingerprint: string): Promise<{ batchId: string; requests: number; employees: number; approved: boolean; ownLeftOut: number }> {
  return (await apiClient.post("/api/attendance/regularizations/bulk", { ...body, fingerprint, confirm: true })).data;
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
