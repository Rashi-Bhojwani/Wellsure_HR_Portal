import { apiClient } from "./client";
import type { SalaryRowView } from "./payroll";

// A-9 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md): saved filters and segments, the contact reveal, the profile's Pay tab, remembered grid columns.

export interface SegmentCriteria {
  search?: string;
  departmentId?: string;
  designationId?: string;
  locationId?: string;
  cityId?: string;
  status?: "ACTIVE" | "INACTIVE" | "SEPARATED";
  employmentType?: string;
  population?: "current" | "past" | "all";
}
export interface Segment {
  id: string;
  name: string;
  kind: "FILTER" | "LIST";
  shared: boolean;
  criteria: SegmentCriteria | null;
  isOwner: boolean;
  ownerName: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}
export interface SegmentMember {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  status: string;
}

export const listSegments = async () => (await apiClient.get<{ segments: Segment[] }>("/api/employee-segments")).data.segments;
export const createSegment = async (input: { kind: "FILTER"; name: string; shared: boolean; criteria: SegmentCriteria } | { kind: "LIST"; name: string; shared: boolean; employeeIds: string[] }) =>
  (await apiClient.post<Segment>("/api/employee-segments", input)).data;
export const updateSegment = async (id: string, input: { name?: string; shared?: boolean; criteria?: SegmentCriteria; employeeIds?: string[] }) =>
  (await apiClient.patch<Segment>(`/api/employee-segments/${id}`, input)).data;
export const archiveSegment = async (id: string) => void (await apiClient.post(`/api/employee-segments/${id}/archive`));
export const segmentMembers = async (id: string, page: number, pageSize: number) =>
  (await apiClient.get<{ total: number; page: number; pageSize: number; rows: SegmentMember[] }>(`/api/employee-segments/${id}/members`, { params: { page, pageSize } })).data;

export const getGridColumns = async (gridKey: "employees") => (await apiClient.get<{ columns: string[] | null }>(`/api/employee-extras/grid-columns/${gridKey}`)).data.columns;
export const saveGridColumns = async (gridKey: "employees", columns: string[]) => (await apiClient.put<{ columns: string[] }>(`/api/employee-extras/grid-columns/${gridKey}`, { columns })).data.columns;

export const revealContact = async (employeeId: string, reason: string) =>
  (await apiClient.get<{ mobile: string; emergencyContactPhone: string }>(`/api/employee-extras/${employeeId}/contact`, { params: { reason } })).data;

export interface EmployeePay {
  employeeId: string;
  employeeCode: string;
  name: string;
  joinedOn: string;
  lastWorkingDate: string | null;
  history: SalaryRowView[];
  pendingAdjustments: Array<{ id: string; componentCode: string; direction: string; amount: string; reason: string; source: string; periodStart: string | null; periodEnd: string | null }>;
}
export const openPay = async (employeeId: string) => (await apiClient.get<EmployeePay>(`/api/employee-extras/${employeeId}/pay`)).data;
