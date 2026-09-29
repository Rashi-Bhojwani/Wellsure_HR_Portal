import { apiClient } from "./client";

export type LeaveRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type LeaveDayPart = "FULL" | "FIRST_HALF" | "SECOND_HALF";

export interface LeaveBalanceCard {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  granted: number;
  balance: number;
}

export async function getLeaveBalances(employeeId?: string): Promise<LeaveBalanceCard[]> {
  const { data } = await apiClient.get<{ balances: LeaveBalanceCard[] }>("/api/leave/balances", { params: employeeId ? { employeeId } : undefined });
  return data.balances;
}

export interface LeaveRequestRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  fromDayPart: LeaveDayPart;
  toDayPart: LeaveDayPart;
  totalDays: number;
  reason: string | null;
  status: LeaveRequestStatus;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionComments: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
}

export interface ApplyLeaveInput {
  employeeId?: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  fromDayPart: LeaveDayPart;
  toDayPart: LeaveDayPart;
  reason?: string;
}

export async function applyForLeave(input: ApplyLeaveInput): Promise<LeaveRequestRow> {
  const { data } = await apiClient.post<LeaveRequestRow>("/api/leave/requests", input);
  return data;
}

export interface ListLeaveRequestsParams {
  employeeId?: string;
  status?: LeaveRequestStatus;
  leaveTypeId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export async function listLeaveRequests(params: ListLeaveRequestsParams = {}): Promise<{ total: number; page: number; pageSize: number; rows: LeaveRequestRow[] }> {
  const { data } = await apiClient.get("/api/leave/requests", { params });
  return data as { total: number; page: number; pageSize: number; rows: LeaveRequestRow[] };
}

export async function approveLeaveRequest(id: string, comments?: string): Promise<LeaveRequestRow> {
  const { data } = await apiClient.post<LeaveRequestRow>(`/api/leave/requests/${id}/approve`, { comments });
  return data;
}

export async function rejectLeaveRequest(id: string, comments: string): Promise<LeaveRequestRow> {
  const { data } = await apiClient.post<LeaveRequestRow>(`/api/leave/requests/${id}/reject`, { comments });
  return data;
}

export async function bulkApproveLeaveRequests(ids: string[], comments?: string): Promise<{ results: Array<{ id: string; status: "approved" | "failed"; error?: string }> }> {
  const { data } = await apiClient.post("/api/leave/requests/bulk-approve", { ids, comments });
  return data as { results: Array<{ id: string; status: "approved" | "failed"; error?: string }> };
}

export async function cancelLeaveRequest(id: string, reason?: string): Promise<LeaveRequestRow> {
  const { data } = await apiClient.post<LeaveRequestRow>(`/api/leave/requests/${id}/cancel`, { reason });
  return data;
}

export interface LeaveCalendarEntry {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeCode: string;
  fromDate: string;
  toDate: string;
  fromDayPart: LeaveDayPart;
  toDayPart: LeaveDayPart;
}

export async function getLeaveCalendar(fromDate: string, toDate: string, params: { locationId?: string; departmentId?: string } = {}): Promise<LeaveCalendarEntry[]> {
  const { data } = await apiClient.get<{ entries: LeaveCalendarEntry[] }>("/api/leave/calendar", { params: { fromDate, toDate, ...params } });
  return data.entries;
}

export interface HolidayRow {
  id: string;
  date: string;
  name: string;
}

export async function listHolidays(year?: number): Promise<HolidayRow[]> {
  const { data } = await apiClient.get<{ holidays: HolidayRow[] }>("/api/holidays", { params: { year } });
  return data.holidays;
}

export async function listRestrictedHolidays(year?: number): Promise<HolidayRow[]> {
  const { data } = await apiClient.get<{ holidays: HolidayRow[] }>("/api/restricted-holidays", { params: { year } });
  return data.holidays;
}

export interface LeaveTypeOption {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  allowHalfDay: boolean;
}

export async function listLeaveTypes(): Promise<LeaveTypeOption[]> {
  const { data } = await apiClient.get<{ leaveTypes: LeaveTypeOption[] }>("/api/leave/types");
  return data.leaveTypes;
}

// ── Admin: leave types & policies (leave.policy.manage) ─────────────────

export interface LeavePolicy {
  id: string;
  leaveTypeId: string;
  accrualEnabled: boolean;
  accrualDaysPerMonth: number | null;
  eligibilityMode: "DAYS" | "CALENDAR_MONTHS" | null;
  eligibilityValue: number | null;
  carryForwardCapDays: number | null;
  negativeBalanceAllowed: boolean;
  skipBalanceCheck: boolean;
  yearEndEncashment: boolean;
  compOffMinHoursWorked: number | null;
  compOffExpiryDays: number | null;
  wfhMonthlyLimit: number | null;
  wfhYearlyLimit: number | null;
  rhYearlyQuota: number | null;
}

export interface LeaveTypeAdminRow {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  isActive: boolean;
  policy: LeavePolicy | null;
}

export async function listAllLeaveTypes(): Promise<LeaveTypeAdminRow[]> {
  const { data } = await apiClient.get<{ leaveTypes: LeaveTypeAdminRow[] }>("/api/leave/types/all");
  return data.leaveTypes;
}

export async function createLeaveType(input: { code: string; name: string; isPaid: boolean; allowHalfDay: boolean }) {
  const { data } = await apiClient.post("/api/leave/types", input);
  return data as { id: string; code: string; name: string; isPaid: boolean; allowHalfDay: boolean; isActive: boolean };
}

export async function updateLeaveType(id: string, input: Partial<{ name: string; isPaid: boolean; allowHalfDay: boolean; isActive: boolean }>) {
  const { data } = await apiClient.patch(`/api/leave/types/${id}`, input);
  return data as { id: string; code: string; name: string; isPaid: boolean; allowHalfDay: boolean; isActive: boolean };
}

export async function upsertLeavePolicy(leaveTypeId: string, input: Partial<Omit<LeavePolicy, "id" | "leaveTypeId">>): Promise<LeavePolicy> {
  const { data } = await apiClient.put<LeavePolicy>(`/api/leave/types/${leaveTypeId}/policy`, input);
  return data;
}

// ── Admin: holidays / restricted holidays mutations (leave.policy.manage) ─

export interface HolidayInput {
  date: string;
  name: string;
}

export async function createHoliday(input: HolidayInput): Promise<HolidayRow> {
  const { data } = await apiClient.post<HolidayRow>("/api/holidays", input);
  return data;
}
export async function updateHoliday(id: string, input: Partial<HolidayInput>): Promise<HolidayRow> {
  const { data } = await apiClient.patch<HolidayRow>(`/api/holidays/${id}`, input);
  return data;
}
export async function deleteHoliday(id: string): Promise<void> {
  await apiClient.delete(`/api/holidays/${id}`);
}

export async function createRestrictedHoliday(input: HolidayInput): Promise<HolidayRow> {
  const { data } = await apiClient.post<HolidayRow>("/api/restricted-holidays", input);
  return data;
}
export async function updateRestrictedHoliday(id: string, input: Partial<HolidayInput>): Promise<HolidayRow> {
  const { data } = await apiClient.patch<HolidayRow>(`/api/restricted-holidays/${id}`, input);
  return data;
}
export async function deleteRestrictedHoliday(id: string): Promise<void> {
  await apiClient.delete(`/api/restricted-holidays/${id}`);
}

// ── Admin: manual grant/debit + comp-off grant (leave.grant) ────────────

export interface ManualGrantResult {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  entryType: "GRANT" | "DEBIT";
  days: number;
  entryDate: string;
  remarks: string | null;
}

export async function manualGrant(input: { employeeId: string; leaveTypeId: string; days: number; entryDate: string; remarks?: string }): Promise<ManualGrantResult> {
  const { data } = await apiClient.post<ManualGrantResult>("/api/leave/grants", input);
  return data;
}

export interface CompOffCreditRow {
  id: string;
  earnedDate: string;
  earnedDays: number;
  remainingDays: number;
  expiresOn: string;
  status: "AVAILABLE" | "CONSUMED" | "EXPIRED";
  source: "MANUAL_GRANT" | "ATTENDANCE";
}

export async function manualCompOffGrant(input: { employeeId: string; earnedDate: string; hoursWorked: number; remarks?: string }): Promise<CompOffCreditRow> {
  const { data } = await apiClient.post<CompOffCreditRow>("/api/leave/comp-off/grant", input);
  return data;
}

export async function listCompOffCredits(employeeId: string): Promise<CompOffCreditRow[]> {
  const { data } = await apiClient.get<{ credits: CompOffCreditRow[] }>("/api/leave/comp-off", { params: { employeeId } });
  return data.credits;
}

// ── Admin: Year End Process (leave.yearend.manage) ──────────────────────

export type YearEndRunStatus = "PREVIEW" | "SUPERSEDED" | "COMMITTED";

export interface YearEndRunRow {
  id: string;
  leaveYear: number;
  status: YearEndRunStatus;
  previewedByUserId: string;
  previewedAt: string;
  supersededAt: string | null;
  committedByUserId: string | null;
  committedAt: string | null;
  totalEmployees: number;
  totalEncashedDays: number;
  totalEncashedAmount: number;
}

export interface YearEndRunItemRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  closingPlBalance: number;
  encashedDays: number;
  dailyRate: number;
  rateSource: string;
  encashedAmount: number;
  ledgerEncashmentEntryId: string | null;
}

export interface YearEndRunDetail extends YearEndRunRow {
  items: YearEndRunItemRow[];
}

export async function listYearEndRuns(year?: number): Promise<YearEndRunRow[]> {
  const { data } = await apiClient.get<{ runs: YearEndRunRow[] }>("/api/leave/year-end", { params: { year } });
  return data.runs;
}

export async function getYearEndRun(id: string): Promise<YearEndRunDetail> {
  const { data } = await apiClient.get<YearEndRunDetail>(`/api/leave/year-end/${id}`);
  return data;
}

export async function previewYearEnd(leaveYear: number): Promise<YearEndRunDetail> {
  const { data } = await apiClient.post<YearEndRunDetail>("/api/leave/year-end/preview", { leaveYear });
  return data;
}

export async function discardYearEndRun(id: string): Promise<void> {
  await apiClient.post(`/api/leave/year-end/${id}/discard`);
}

export async function commitYearEndRun(id: string, confirmText: string): Promise<YearEndRunRow> {
  const { data } = await apiClient.post<YearEndRunRow>(`/api/leave/year-end/${id}/commit`, { confirmText });
  return data;
}

export async function downloadYearEndReport(id: string): Promise<Blob> {
  const { data } = await apiClient.get(`/api/leave/year-end/${id}/report`, { responseType: "blob" });
  return data as Blob;
}

// ── Admin: Leave Recalculator (leave.recalculate) ────────────────────────

export interface RecalcAction {
  type: "CREDIT" | "REVERSE";
  accrualMonth: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  days: number;
  existingLedgerId?: string;
}

export interface RecalcEmployeeResult {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  actions: RecalcAction[];
}

export async function previewRecalculation(employeeIds: string[], fromDate: string): Promise<RecalcEmployeeResult[]> {
  const { data } = await apiClient.post<RecalcEmployeeResult[]>("/api/leave/recalculate/preview", { employeeIds, fromDate });
  return data;
}

export async function commitRecalculation(employeeIds: string[], fromDate: string, confirmText: string): Promise<RecalcEmployeeResult[]> {
  const { data } = await apiClient.post<RecalcEmployeeResult[]>("/api/leave/recalculate/commit", { employeeIds, fromDate, confirmText });
  return data;
}

// ── Admin: Workforce Overview dashboard (leave.view) ─────────────────────

export interface WorkforceDashboardResult {
  year: number;
  leaveTypes: string[];
  byMonthAndType: { month: number; leaveTypeCode: string; days: number }[];
  rhBreakdown: { date: string; name: string; employeeCount: number }[];
}

export async function getWorkforceDashboard(year: number): Promise<WorkforceDashboardResult> {
  const { data } = await apiClient.get<WorkforceDashboardResult>("/api/leave/dashboard", { params: { year } });
  return data;
}
