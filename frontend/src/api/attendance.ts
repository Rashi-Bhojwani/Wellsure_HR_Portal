import type { HistoryStatus } from "../lib/effectiveDate";
import type { SessionInput, WeekOffRule } from "@shared/utils/attendance";
import { apiClient } from "./client";

// Attendance (Phase 2) — backend/src/modules/attendance. P2-A: Attendance Settings.

export interface ShiftRow {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  graceInMinutes: number;
  graceOutMinutes: number;
  windowBeforeMinutes: number;
  windowAfterMinutes: number;
  sessions: SessionInput[];
  workMinutes: number;
  breakMinutes: number;
  placeholderFields: string[];
  isActive: boolean;
  isDefault: boolean;
  employeeCount: number;
}
export type ShiftInput = Omit<ShiftRow, "id" | "crossesMidnight" | "workMinutes" | "breakMinutes" | "placeholderFields" | "isActive" | "isDefault" | "employeeCount">;

export interface WeekOffPatternRow {
  id: string;
  code: string;
  name: string;
  rules: WeekOffRule[];
  summary: string;
  isActive: boolean;
  isDefault: boolean;
  employeeCount: number;
}

export interface PolicyRow {
  id: string;
  code: string;
  name: string;
  fullDayMinMinutes: number;
  halfDayMinMinutes: number;
  halfDayMinNotMetLopDays: number;
  nearDuplicateSeconds: number;
  inferBreakPairing: boolean;
  penaltyRules: unknown[];
  futureToleranceMinutes: number;
  maxPunchAgeDays: number;
  placeholderFields: string[];
  isActive: boolean;
  isDefault: boolean;
  employeeCount: number;
}
export type PolicyInput = Omit<PolicyRow, "id" | "penaltyRules" | "placeholderFields" | "isActive" | "isDefault" | "employeeCount">;

export interface Ref {
  id: string;
  code: string;
  name: string;
}
export interface Defaults {
  shift: Ref | null;
  weekOffPattern: Ref | null;
  policy: Ref | null;
}

export interface CycleView {
  start: string;
  end: string;
  startDay: number;
  label: string;
}
export interface CycleInfo {
  current: CycleView;
  recent: CycleView[];
  rules: Array<{ id: string; effectiveFrom: string; startDay: number; status: string }>;
}

export interface AssignmentRow {
  id: string;
  shift: Ref & { startTime: string; endTime: string };
  weekOffPattern: Ref & { summary: string };
  policy: Ref;
  effectiveFrom: string;
  effectiveTo: string | null;
  lastDay: string | null;
  status: HistoryStatus;
  changeReason: string | null;
}
export type Capture = "DEVICE" | "MANUAL";
export interface AssignmentListRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  departmentId: string | null;
  location: string | null;
  locationId: string | null;
  capture: Capture;
  current: AssignmentRow | null;
  scheduled: AssignmentRow | null;
}
export interface AssignmentChange {
  shiftId?: string;
  weekOffPatternId?: string;
  policyId?: string;
  effectiveFrom: string;
  changeReason?: string | null;
}

export interface ManualBranchHolder {
  userId: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  roles: string[];
  allBranches: boolean;
  branches: Ref[];
}

const base = "/api/attendance/config";

export async function listShifts(): Promise<ShiftRow[]> {
  return (await apiClient.get<{ shifts: ShiftRow[] }>(`${base}/shifts`)).data.shifts;
}
export async function createShift(body: ShiftInput): Promise<ShiftRow> {
  return (await apiClient.post<ShiftRow>(`${base}/shifts`, body)).data;
}
export async function updateShift(id: string, body: Partial<ShiftInput> & { isActive?: boolean; confirmPlaceholders?: string[] }): Promise<ShiftRow> {
  return (await apiClient.patch<ShiftRow>(`${base}/shifts/${id}`, body)).data;
}

export async function listWeekOffPatterns(): Promise<WeekOffPatternRow[]> {
  return (await apiClient.get<{ patterns: WeekOffPatternRow[] }>(`${base}/week-off-patterns`)).data.patterns;
}
export async function createWeekOffPattern(body: { code: string; name: string; rules: WeekOffRule[] }): Promise<WeekOffPatternRow> {
  return (await apiClient.post<WeekOffPatternRow>(`${base}/week-off-patterns`, body)).data;
}
export async function updateWeekOffPattern(id: string, body: Partial<{ name: string; rules: WeekOffRule[]; isActive: boolean }>): Promise<WeekOffPatternRow> {
  return (await apiClient.patch<WeekOffPatternRow>(`${base}/week-off-patterns/${id}`, body)).data;
}

export async function listPolicies(): Promise<PolicyRow[]> {
  return (await apiClient.get<{ policies: PolicyRow[] }>(`${base}/policies`)).data.policies;
}
export async function createPolicy(body: PolicyInput): Promise<PolicyRow> {
  return (await apiClient.post<PolicyRow>(`${base}/policies`, body)).data;
}
export async function updatePolicy(id: string, body: Partial<PolicyInput> & { isActive?: boolean; confirmPlaceholders?: string[] }): Promise<PolicyRow> {
  return (await apiClient.patch<PolicyRow>(`${base}/policies/${id}`, body)).data;
}

export async function getDefaults(): Promise<Defaults> {
  return (await apiClient.get<Defaults>(`${base}/defaults`)).data;
}
export async function setDefaults(body: { shiftId: string; weekOffPatternId: string; policyId: string }): Promise<Defaults> {
  return (await apiClient.put<Defaults>(`${base}/defaults`, body)).data;
}

export async function getEngineStart(): Promise<{ date: string | null }> {
  return (await apiClient.get<{ date: string | null }>(`${base}/engine-start`)).data;
}
export async function setEngineStart(date: string | null): Promise<{ date: string | null }> {
  return (await apiClient.put<{ date: string | null }>(`${base}/engine-start`, { date })).data;
}

export async function getCycle(): Promise<CycleInfo> {
  return (await apiClient.get<CycleInfo>(`${base}/cycle`)).data;
}
export async function scheduleCycleChange(body: { effectiveFrom: string; startDay: number }): Promise<CycleInfo> {
  return (await apiClient.post<CycleInfo>(`${base}/cycle`, body)).data;
}
export async function cancelCycleChange(id: string): Promise<CycleInfo> {
  return (await apiClient.post<CycleInfo>(`${base}/cycle/${id}/cancel`)).data;
}

export async function listAssignments(params: { search?: string; locationId?: string; departmentId?: string; shiftId?: string; capture?: Capture }): Promise<AssignmentListRow[]> {
  return (await apiClient.get<{ employees: AssignmentListRow[] }>(`${base}/assignments`, { params })).data.employees;
}
export async function assignmentHistory(employeeId: string): Promise<AssignmentRow[]> {
  return (await apiClient.get<{ history: AssignmentRow[] }>(`${base}/assignments/${employeeId}`)).data.history;
}
export async function changeAssignment(employeeId: string, body: AssignmentChange): Promise<AssignmentRow[]> {
  return (await apiClient.post<{ history: AssignmentRow[] }>(`${base}/assignments/${employeeId}`, body)).data.history;
}
export async function bulkChangeAssignment(body: AssignmentChange & { employeeIds: string[] }): Promise<{ changed: number }> {
  return (await apiClient.post<{ changed: number }>(`${base}/assignments/bulk`, body)).data;
}
export async function cancelAssignmentChange(employeeId: string, rowId: string): Promise<AssignmentRow[]> {
  return (await apiClient.post<{ history: AssignmentRow[] }>(`${base}/assignments/${employeeId}/${rowId}/cancel`)).data.history;
}

export async function listManualBranchHolders(): Promise<ManualBranchHolder[]> {
  return (await apiClient.get<{ holders: ManualBranchHolder[] }>(`${base}/manual-branches`)).data.holders;
}
export async function setManualBranches(userId: string, locationIds: string[]): Promise<ManualBranchHolder | null> {
  return (await apiClient.put<ManualBranchHolder | null>(`${base}/manual-branches/${userId}`, { locationIds })).data;
}

// ── Process Attendance (P2-C) ──
export type ProcessStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
export interface ProcessRun {
  id: string;
  fromDate: string;
  toDate: string;
  employeeIds: string[];
  locationId: string | null;
  reason: string;
  status: ProcessStatus;
  requestedByUserId: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  totalDays: number;
  processedDays: number;
  changedDays: number;
  lockedDays: number;
  error: string | null;
}
export interface ProcessRunDetail extends ProcessRun {
  changes: Array<{ employeeId: string; employeeCode: string | null; date: string; before: string | null; after: string | null }>;
}

export async function listProcessRuns(): Promise<ProcessRun[]> {
  return (await apiClient.get<{ runs: ProcessRun[] }>("/api/attendance/process")).data.runs;
}
export async function getProcessRun(id: string): Promise<ProcessRunDetail> {
  return (await apiClient.get<ProcessRunDetail>(`/api/attendance/process/${id}`)).data;
}
export async function startProcessRun(body: { fromDate: string; toDate: string; employeeIds?: string[]; locationId?: string | null; reason: string }): Promise<ProcessRun> {
  return (await apiClient.post<ProcessRun>("/api/attendance/process", body)).data;
}
export async function processScope(from: string): Promise<{ from: string; to: string; employees: number; days: number }> {
  return (await apiClient.get("/api/attendance/process/scope", { params: { from } })).data;
}

// ── Finalisation: the gate, the periods and the lock (Phase 3 commit 3) ──
export type FinalisationBlocker =
  | { code: "PERIOD_NOT_OVER"; message: string }
  | { code: "FLAGGED_PUNCHES"; message: string; count: number; punches: Array<{ id: string; deviceUserId: string; employeeId: string | null; employeeName: string | null; date: string; flag: string }> }
  | { code: "PENDING_REGULARIZATIONS"; message: string; count: number; days: Array<{ employeeId: string; employeeName: string; date: string }> }
  | { code: "PLACEHOLDER_RULES"; message: string; rules: Array<{ kind: "SHIFT" | "POLICY"; id: string; code: string; name: string; fields: string[] }> }
  | { code: "NOT_MARKED" | "NO_SHIFT" | "NOT_UP_TO_DATE"; message: string; count: number; days: Array<{ employeeId: string; employeeName: string; date: string }> };
export type FinalisationBlockerCode = FinalisationBlocker["code"];
export interface FinalisationWarning {
  code: "UNMAPPED_PUNCHES";
  message: string;
  count: number;
}
export interface FinalisationReadiness {
  from: string;
  to: string;
  ready: boolean;
  blockers: FinalisationBlocker[];
  warnings: FinalisationWarning[];
}
export async function finalisationReadiness(from: string, to: string): Promise<FinalisationReadiness> {
  return (await apiClient.get<FinalisationReadiness>("/api/attendance/finalisation/readiness", { params: { from, to } })).data;
}

export type PeriodStatus = "OPEN" | "FINALISED" | "UNLOCKED";
export interface PeriodRow {
  from: string;
  to: string;
  label: string;
  isOver: boolean;
  status: PeriodStatus;
  lockedDays: number;
  last: { action: "FINALISE" | "UNLOCK"; at: string; by: string | null; reason: string; payrollConsumed: boolean } | null;
  /** Finalised cycles only: people with days in it that are not locked (the engine writes nothing inside a locked cycle). */
  unprocessed: { employees: number; days: number; people: Array<{ employeeId: string; employeeCode: string; name: string | null; days: number }> } | null;
}
export async function listPeriods(asOf?: string): Promise<PeriodRow[]> {
  return (await apiClient.get<{ periods: PeriodRow[] }>("/api/attendance/finalisation/periods", { params: { asOf } })).data.periods;
}
export async function finalisePeriod(body: { from: string; to: string; note?: string }): Promise<{ locked: number }> {
  return (await apiClient.post<{ locked: number }>("/api/attendance/finalisation", { ...body, confirm: true })).data;
}
export async function unlockPeriod(body: { from: string; to: string; reason: string; confirmPayrollConsumed?: boolean }): Promise<{ unlocked: number }> {
  return (await apiClient.post<{ unlocked: number }>("/api/attendance/finalisation/unlock", { ...body, confirm: true })).data;
}
