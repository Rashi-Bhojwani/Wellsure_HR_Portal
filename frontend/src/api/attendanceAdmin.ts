import { apiClient } from "./client";
import type { ReasonCode } from "./attendanceInfo";

// Attendance administration (Phase 3 commit 2): Manual Override, Shift Override, Shift Roster and Employee Swipes —
// backend/src/modules/attendance/{override,roster,swipes}. Every change is previewed first and confirmed against the
// exact set that was previewed.

export interface Selection {
  employeeIds?: string[];
  locationId?: string;
  departmentId?: string;
}

// ── Manual Override ──
export type OverrideStatus = "P" | "A" | "HD_FIRST" | "HD_SECOND" | "WORKED";
export const OVERRIDE_STATUS_OPTIONS: Array<{ value: OverrideStatus; label: string }> = [
  { value: "P", label: "Present" },
  { value: "A", label: "Absent" },
  { value: "HD_FIRST", label: "Half day (first half present)" },
  { value: "HD_SECOND", label: "Half day (second half present)" },
  { value: "WORKED", label: "Worked (on a holiday or week-off)" },
];
export interface OverrideBody {
  selection: Selection;
  from: string;
  to: string;
  reasonCode: ReasonCode;
  note: string;
  releaseLeave: boolean;
  /** With the release: the day follows the device's own punches (no status or times are set). */
  followDevice?: boolean;
  inTime?: string | null;
  outTime?: string | null;
  status?: OverrideStatus | null;
}
export interface OverridePreview {
  count: number;
  employees: number;
  correction: string;
  ownLeftOut: number;
  fingerprint: string;
  caps: { maxRangeDays: number; maxEmployeeDays: number };
  /** Days of approved leave this would release, and so return to balances. */
  leaveDaysReleased: number;
  rows: Array<{ employeeId: string; employeeCode: string; name: string; date: string; before: string | null; after: string | null; replaces: string | null; leave: Array<{ type: string; days: number }> }>;
  cannotOverride: Array<{ code: string; label: string; count: number; examples: Array<{ employeeCode: string; name: string; date: string }> }>;
}
export async function previewOverride(body: OverrideBody): Promise<OverridePreview> {
  return (await apiClient.post<OverridePreview>("/api/attendance/overrides/preview", body)).data;
}
export async function confirmOverride(body: OverrideBody, fingerprint: string): Promise<{ days: number; employees: number; ownLeftOut: number; leaveDaysReleased: number }> {
  return (await apiClient.post("/api/attendance/overrides", { ...body, fingerprint, confirm: true })).data;
}
export async function clearOverride(body: { employeeId: string; date: string; note: string }): Promise<{ id: string }> {
  return (await apiClient.post("/api/attendance/overrides/clear", body)).data;
}
export interface OverrideEntry {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  origin: "REGULARIZATION" | "MANUAL_OVERRIDE";
  kind: string;
  what: string;
  reasonCode: string | null;
  reason: string;
  by: string;
  at: string;
  inForce: boolean;
  leaveReleased: Array<{ type: string; days: number }>;
}
export async function listOverrides(q: { employeeId?: string; from?: string; to?: string; page?: number; pageSize?: number }): Promise<{ total: number; entries: OverrideEntry[] }> {
  return (await apiClient.get("/api/attendance/overrides", { params: q })).data;
}

// ── Shift Override ──
export interface ShiftOverrideBody {
  selection: Selection;
  from: string;
  to: string;
  shiftId: string;
  note: string;
}
export interface ShiftOverridePreview {
  count: number;
  employees: number;
  shift: string;
  ownLeftOut: number;
  fingerprint: string;
  caps: { maxRangeDays: number; maxEmployeeDays: number };
  rows: Array<{ employeeId: string; employeeCode: string; name: string; date: string; shiftBefore: string | null; statusBefore: string | null; statusAfter: string | null }>;
  cannotOverride: Array<{ code: string; label: string; count: number; examples: Array<{ employeeCode: string; name: string; date: string }> }>;
}
export async function previewShiftOverride(body: ShiftOverrideBody): Promise<ShiftOverridePreview> {
  return (await apiClient.post<ShiftOverridePreview>("/api/attendance/shift-overrides/preview", body)).data;
}
export async function confirmShiftOverride(body: ShiftOverrideBody, fingerprint: string): Promise<{ days: number; employees: number; ownLeftOut: number }> {
  return (await apiClient.post("/api/attendance/shift-overrides", { ...body, fingerprint, confirm: true })).data;
}
export async function clearShiftOverride(body: { employeeId: string; date: string; note: string }): Promise<{ id: string }> {
  return (await apiClient.post("/api/attendance/shift-overrides/clear", body)).data;
}
export interface ShiftOverrideEntry {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  shift: string;
  cleared: boolean;
  reason: string;
  by: string;
  at: string;
  inForce: boolean;
}
export async function listShiftOverrides(q: { employeeId?: string; from?: string; to?: string; page?: number; pageSize?: number }): Promise<{ total: number; entries: ShiftOverrideEntry[] }> {
  return (await apiClient.get("/api/attendance/shift-overrides", { params: q })).data;
}

// ── Shift Roster ──
export interface RosterBody {
  selection: Selection;
  start: string;
  steps: Array<{ shiftId: string; days: number }>;
  repeat: boolean;
  until?: string | null;
  then: "RETURN" | "STAY";
  note: string;
}
export interface RosterPreview {
  people: number;
  changes: number;
  replacedScheduled: number;
  start: string;
  until: string | null;
  then: "RETURN" | "STAY" | null;
  horizon: string;
  fingerprint: string;
  rows: Array<{ employeeId: string; employeeCode: string; name: string; currentShift: string | null; segments: Array<{ from: string; shift: string }>; replaces: Array<{ from: string; shift: string }> }>;
  cannotRoster: Array<{ code: string; label: string; count: number; examples: Array<{ employeeCode: string; name: string }> }>;
}
export async function previewRoster(body: RosterBody): Promise<RosterPreview> {
  return (await apiClient.post<RosterPreview>("/api/attendance/roster/preview", body)).data;
}
export async function confirmRoster(body: RosterBody, fingerprint: string): Promise<{ people: number; changes: number; replacedScheduled: number }> {
  return (await apiClient.post("/api/attendance/roster", { ...body, fingerprint, confirm: true })).data;
}

// ── Employee Swipes ──
export interface SwipeQuery {
  from?: string;
  to?: string;
  deviceId?: string;
  locationId?: string;
  employeeId?: string;
  route?: "AGENT" | "PUSH" | "IMPORT";
  used?: "yes" | "no";
  flagged?: "any" | "pending" | "accepted" | "discarded" | "none";
  unmapped?: boolean;
  page?: number;
  pageSize?: number;
}
export interface Swipe {
  id: string;
  punchedAt: string;
  deviceTime: string;
  time: string;
  businessDate: string;
  device: string;
  deviceSerial: string | null;
  branch: string | null;
  deviceUserId: string;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  route: "AGENT" | "PUSH" | "IMPORT";
  batchId: string;
  receivedAt: string;
  flag: "FUTURE" | "TOO_OLD" | null;
  flagLabel: string | null;
  decision: "ACCEPTED" | "DISCARDED" | null;
  decisionReason: string | null;
  used: boolean;
}
export async function listSwipes(q: SwipeQuery): Promise<{ from: string; to: string; total: number; page: number; pageSize: number; entries: Swipe[] }> {
  return (await apiClient.get("/api/attendance/swipes", { params: q })).data;
}
export async function swipeOptions(): Promise<{ devices: Array<{ id: string; name: string; locationId: string; branch: string }>; routes: string[] }> {
  return (await apiClient.get("/api/attendance/swipes/options")).data;
}
export async function exportSwipes(q: SwipeQuery): Promise<Blob> {
  return (await apiClient.get("/api/attendance/swipes/export", { params: { ...q, page: undefined, pageSize: undefined }, responseType: "blob" })).data as Blob;
}

// ── Exceptions queue (Phase 3 commit 3) ──
export type DayExceptionType = "MISSING_PUNCH" | "SHORTFALL" | "HALF_DAY_MIN_NOT_MET" | "NO_SHIFT" | "CLOCK_FLAGGED";
export type ExceptionType = DayExceptionType | "UNMAPPED_ID";
export const EXCEPTION_TYPE_LABEL: Record<ExceptionType, string> = {
  MISSING_PUNCH: "Missing punch",
  SHORTFALL: "Short of the full day",
  HALF_DAY_MIN_NOT_MET: "Half-day minimum not met",
  NO_SHIFT: "No shift assigned",
  CLOCK_FLAGGED: "A punch was set aside (clock)",
  UNMAPPED_ID: "Unmapped device ID",
};
export interface ExceptionFilter {
  from?: string;
  to?: string;
  locationId?: string;
  departmentId?: string;
}
export interface ExceptionQuery extends ExceptionFilter {
  type?: ExceptionType;
  page: number;
  pageSize: number;
}
export interface ExceptionDay {
  key: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string | null;
  date: string;
  status: string;
  types: DayExceptionType[];
  shiftCode: string | null;
  firstIn: string | null;
  lastOut: string | null;
  shortfallMinutes: number | null;
  actualMinutes: number | null;
  branch: string | null;
  department: string | null;
  locked: boolean;
  provisional: boolean;
}
export interface UnmappedGroup {
  deviceUserId: string;
  punches: number;
  days: number;
  firstDay: string;
  lastDay: string;
  devices: string[];
  branches: string[];
  suggestion: null | { employeeId: string; employeeCode: string; employeeName: string | null; canMap: boolean; problem: string | null; partial: boolean };
}
export interface ExceptionList {
  kind: "DAYS" | "UNMAPPED";
  from: string;
  to: string;
  counts: Record<ExceptionType | "ALL_DAYS", number>;
  total: number;
  page: number;
  pageSize: number;
  days: ExceptionDay[];
  unmapped: UnmappedGroup[];
}
export async function listExceptions(q: ExceptionQuery): Promise<ExceptionList> {
  return (await apiClient.get<ExceptionList>("/api/attendance/exceptions", { params: q })).data;
}

export interface MapSelection {
  deviceUserIds?: string[];
  filter?: ExceptionFilter;
}
export interface MapPreview {
  count: number;
  punches: number;
  ownLeftOut: number;
  fingerprint: string;
  items: Array<{ deviceUserId: string; employeeId: string; employeeCode: string; employeeName: string | null; punches: number; firstDay: string; lastDay: string; partial: boolean }>;
  skipped: Array<{ deviceUserId: string; punches: number; reason: string }>;
}
export async function previewMapDeviceIds(sel: MapSelection): Promise<MapPreview> {
  return (await apiClient.post<MapPreview>("/api/attendance/exceptions/map-device-ids/preview", sel)).data;
}
export async function confirmMapDeviceIds(sel: MapSelection, fingerprint: string): Promise<{ bulkId: string; mapped: number; punchesResolved: number; failed: Array<{ deviceUserId: string; message: string }> }> {
  return (await apiClient.post("/api/attendance/exceptions/map-device-ids", { ...sel, fingerprint, confirm: true })).data;
}

export interface AssignSelection {
  keys?: Array<{ employeeId: string; date: string }>;
  filter?: ExceptionFilter;
}
export interface AssignPreview {
  shift: { id: string; code: string; name: string };
  employees: number;
  days: number;
  blockedEmployees: number;
  ownLeftOut: number;
  fingerprint: string;
  items: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string | null;
    from: string;
    noShiftDays: number;
    lockedDays: number;
    currentShift: string | null;
    hasAssignment: boolean;
    problem: string | null;
    problemText: string | null;
  }>;
}
export async function previewAssignShift(sel: AssignSelection, shiftId: string): Promise<AssignPreview> {
  return (await apiClient.post<AssignPreview>("/api/attendance/exceptions/assign-shift/preview", { ...sel, shiftId })).data;
}
export async function confirmAssignShift(sel: AssignSelection, shiftId: string, fingerprint: string, note: string): Promise<{ bulkId: string; employees: number; days: number; shiftCode: string }> {
  return (await apiClient.post("/api/attendance/exceptions/assign-shift", { ...sel, shiftId, fingerprint, note, confirm: true })).data;
}
