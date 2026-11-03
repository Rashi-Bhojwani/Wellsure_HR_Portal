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

// ── G2: position history ──
export type PositionAttribute = "department" | "designation" | "location" | "grade" | "costCentre" | "shift";
export interface PositionEntry {
  valueId: string | null;
  value: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  status: "past" | "current" | "scheduled";
}
export interface PositionHistory {
  employeeId: string;
  attributes: Array<{ key: PositionAttribute; label: string; current: PositionEntry | null; entries: PositionEntry[] }>;
  division: { built: boolean; note: string };
}
export const getPosition = async (employeeId: string) => (await apiClient.get<PositionHistory>(`/api/employee-extras/${employeeId}/position`)).data;
export const changePosition = async (employeeId: string, input: { attribute: PositionAttribute; valueId: string | null; effectiveFrom: string; reason: string }) =>
  (await apiClient.post<PositionHistory>(`/api/employee-extras/${employeeId}/position`, input)).data;

// ── G3: letters — prepare, sign, issue, void; starters, grants, serial (directors) ──
export interface LetterRequest {
  id: string;
  batchId: string;
  status: "IN_PROGRESS" | "ISSUED" | "VOID";
  template: { id: string; code: string; name: string };
  employee: { id: string; employeeCode: string; fullName: string };
  extraValues: Record<string, string>;
  remarks: string | null;
  serial: string | null;
  signatories: Array<{ position: number; employeeId: string; name: string; status: "PENDING" | "SIGNED"; signedAt: string | null; isMe: boolean }>;
  letter: { id: string; reference: string; status: string; documentId: string | null } | null;
  preparedAt: string;
  issuedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}
export interface PreparableTemplate {
  id: string;
  code: string;
  name: string;
  payFree: boolean;
  mayIssue: boolean;
}
export const preparableTemplates = async () => (await apiClient.get<{ templates: PreparableTemplate[] }>("/api/letters/requests/templates")).data.templates;
export const listLetterRequests = async (status: LetterRequest["status"], page: number, pageSize: number) =>
  (await apiClient.get<{ total: number; page: number; pageSize: number; rows: LetterRequest[] }>("/api/letters/requests", { params: { status, page, pageSize } })).data;
export const lettersToSign = async () => (await apiClient.get<{ requests: Array<Pick<LetterRequest, "id" | "template" | "employee" | "signatories" | "preparedAt" | "remarks">> }>("/api/letters/requests/to-sign")).data.requests;
export const prepareLetters = async (input: { clientKey: string; templateId: string; employeeIds?: string[]; segmentId?: string; extraValues: Record<string, string>; remarks?: string | null; signatoryEmployeeIds: string[] }) =>
  (await apiClient.post<{ batchId: string; created: number; requests: LetterRequest[] }>("/api/letters/requests", input)).data;
export const updateLetterRequest = async (id: string, input: { extraValues?: Record<string, string>; remarks?: string | null; signatoryEmployeeIds?: string[] }) => (await apiClient.patch<LetterRequest>(`/api/letters/requests/${id}`, input)).data;
export const signLetterRequest = async (id: string, position: number) => (await apiClient.post<LetterRequest>(`/api/letters/requests/${id}/sign`, { position })).data;
export const issueLetterRequest = async (id: string) => (await apiClient.post<LetterRequest>(`/api/letters/requests/${id}/issue`)).data;
export const voidLetterRequest = async (id: string, reason: string) => (await apiClient.post<LetterRequest>(`/api/letters/requests/${id}/void`, { reason })).data;
export const previewLetterRequest = async (id: string) => (await apiClient.get<Blob>(`/api/letters/requests/${id}/preview`, { responseType: "blob" })).data;

export interface LetterStarterView {
  code: string;
  name: string;
  description: string;
  carriesPay: boolean;
  directorOnly: boolean;
  loaded: boolean;
}
export const listStarters = async () => (await apiClient.get<{ starters: LetterStarterView[] }>("/api/letters/starters")).data.starters;
export const loadStarter = async (code: string) => (await apiClient.post<{ id: string; code: string; isActive: boolean }>(`/api/letters/starters/${code}/load`)).data;
export interface LetterGrant {
  id: string;
  template: { id: string; code: string; name: string };
  action: "PREPARE" | "ISSUE";
  roleCode: string | null;
  userId: string | null;
  grantedAt: string;
}
export const listLetterGrants = async () => (await apiClient.get<{ grants: LetterGrant[] }>("/api/letters/grants")).data.grants;
export const createLetterGrant = async (input: { templateId: string; action: "PREPARE" | "ISSUE"; roleCode?: string; userId?: string }) => (await apiClient.post<{ id: string; created: boolean }>("/api/letters/grants", input)).data;
export const revokeLetterGrant = async (id: string) => void (await apiClient.post(`/api/letters/grants/${id}/revoke`));
export const getLetterSerial = async () => (await apiClient.get<{ serial: { prefix: string; nextNumber: number } | null }>("/api/letters/serial")).data.serial;
export const setLetterSerial = async (input: { prefix: string; nextNumber: number }) => (await apiClient.put<{ serial: { prefix: string; nextNumber: number } }>("/api/letters/serial", input)).data.serial;
