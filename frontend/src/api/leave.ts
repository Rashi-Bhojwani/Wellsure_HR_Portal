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

export async function listHolidays(locationId?: string, year?: number): Promise<{ holidays: HolidayRow[]; locationId: string | null }> {
  const { data } = await apiClient.get("/api/holidays", { params: { locationId, year } });
  return data as { holidays: HolidayRow[]; locationId: string | null };
}

export async function listRestrictedHolidays(locationId?: string, year?: number): Promise<{ holidays: HolidayRow[]; locationId: string | null }> {
  const { data } = await apiClient.get("/api/restricted-holidays", { params: { locationId, year } });
  return data as { holidays: HolidayRow[]; locationId: string | null };
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
