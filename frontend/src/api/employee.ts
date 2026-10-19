import { apiClient } from "./client";

// ── Device code check + create (Add Employee wizard, spec §3) ──────────

export interface DeviceCodeCheckResult {
  deviceUserId: string;
  suggestedEmployeeCode: string;
  collision: { employeeCode: string; fullName: string; separatedOn: string | null } | null;
}
export async function checkDeviceCode(deviceUserId: string): Promise<DeviceCodeCheckResult> {
  const { data } = await apiClient.get<DeviceCodeCheckResult>("/api/employees/device-code-check", { params: { deviceUserId } });
  return data;
}

export interface CreateEmployeeInput {
  official: {
    // Phase 2 (D2): a deliberate choice. MANUAL = no biometric machine, no Device User ID.
    attendanceCapture: "DEVICE" | "MANUAL";
    deviceUserId?: string;
    employeeCode: string;
    dateOfJoining: string;
    departmentId: string;
    designationId: string;
    locationId: string;
    gradeId?: string | null;
    costCentreId?: string | null;
    reportingManagerId?: string | null;
    employmentType: "PERMANENT" | "CONTRACT" | "INTERN" | "CONSULTANT" | "PROBATION";
    officialEmail?: string | null;
  };
  personal: {
    fullName: string;
    dateOfBirth: string;
    gender: "MALE" | "FEMALE" | "OTHER";
    personalEmail: string;
    mobile: string;
    currentAddress: string;
    permanentAddress: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    emergencyContactRelation: string;
    bloodGroup?: string | null;
  };
  statutory?: { pan?: string; aadhaar?: string; uan?: string; esiNumber?: string };
  bank?: { accountHolderName: string; accountNumber: string; accountNumberConfirm: string; ifsc: string; bankName: string; branchName: string };
}
// What really happened to an invitation email. SENT = a mail server accepted it; FILE_ONLY = development writes it to a file and sends nothing;
// FAILED = sending was tried and failed (`error` says why); NOT_SENT = no invitation has been issued yet.
export interface InvitationDelivery {
  status: "SENT" | "FILE_ONLY" | "FAILED" | "NOT_SENT";
  to: string;
  driver?: string;
  error?: string;
  attemptedAt?: string;
  sentAt?: string;
}
export interface CreatedEmployee {
  id: string;
  employeeCode: string;
  invitation: InvitationDelivery;
}
export async function createEmployee(input: CreateEmployeeInput): Promise<CreatedEmployee> {
  const { data } = await apiClient.post<CreatedEmployee>("/api/employees", input);
  return data;
}
export async function resendInvite(employeeId: string): Promise<InvitationDelivery> {
  const { data } = await apiClient.post<InvitationDelivery>(`/api/employees/${employeeId}/resend-invite`);
  return data;
}

export interface PendingInvitation {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  email: string;
  delivery: InvitationDelivery;
  skipped?: string;
}
export async function listPendingInvitations(page = 1, pageSize = 50): Promise<{ total: number; items: PendingInvitation[] }> {
  const { data } = await apiClient.get<{ total: number; items: PendingInvitation[] }>("/api/employees/invitations", { params: { page, pageSize } });
  return data;
}
export interface InvitationBatchResult {
  requested: number;
  sent: number;
  fileOnly: number;
  failed: number;
  results: PendingInvitation[];
}
export async function sendInvitations(employeeIds: string[]): Promise<InvitationBatchResult> {
  const { data } = await apiClient.post<InvitationBatchResult>("/api/employees/invitations/send", { employeeIds });
  return data;
}

// ── Grid ─────────────────────────────────────────────────────────────────

export interface EmployeeGridRow {
  id: string;
  employeeCode: string;
  fullName: string;
  photoVersion: string | null;
  department: string;
  designation: string;
  location: string;
  city: string | null;
  manager: string | null;
  dateOfJoining: string;
  status: "ACTIVE" | "INACTIVE" | "SEPARATED";
  employmentType: string;
  mobile: string;
  officialEmail: string | null;
  personalEmail: string;
  bankLast4?: string | null;
  panLast4?: string | null;
  aadhaarLast4?: string | null;
}
export interface EmployeeListQuery {
  search?: string;
  departmentId?: string;
  designationId?: string;
  locationId?: string;
  cityId?: string;
  status?: string;
  employmentType?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}
export async function listEmployees(query: EmployeeListQuery): Promise<{ rows: EmployeeGridRow[]; total: number; page: number; pageSize: number }> {
  const { data } = await apiClient.get("/api/employees", { params: query });
  return data;
}
export async function exportEmployees(query: EmployeeListQuery & { includeSensitive?: boolean }): Promise<Blob> {
  const { data } = await apiClient.get("/api/employees/export", { params: query, responseType: "blob" });
  return data as Blob;
}

export interface SavedView {
  id: string;
  gridKey: string;
  name: string;
  config: Record<string, unknown>;
}
export async function listSavedViews(gridKey = "employees"): Promise<SavedView[]> {
  const { data } = await apiClient.get<{ views: SavedView[] }>("/api/employees/saved-views", { params: { gridKey } });
  return data.views;
}
export async function createSavedView(input: { gridKey?: string; name: string; config: Record<string, unknown> }): Promise<SavedView> {
  const { data } = await apiClient.post<SavedView>("/api/employees/saved-views", input);
  return data;
}
export async function deleteSavedView(id: string): Promise<void> {
  await apiClient.delete(`/api/employees/saved-views/${id}`);
}

// ── Profile / reveal / history ──────────────────────────────────────────

export interface EmployeeProfile {
  id: string;
  employeeCode: string;
  fullName: string;
  officialEmail: string | null;
  dateOfJoining: string;
  lastWorkingDate: string | null;
  employmentType: string;
  status: string;
  // Phase 2: MANUAL = no device mapping in force — attendance is marked by hand.
  attendanceCapture: "DEVICE" | "MANUAL";
  accountStatus: string | null;
  // Only while the account is still waiting for its owner to set a password.
  invitation: InvitationDelivery | null;
  totpEnabled: boolean;
  personal: {
    dateOfBirth: string;
    gender: string;
    personalEmail: string;
    mobile: string;
    currentAddress: string;
    permanentAddress: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    emergencyContactRelation: string;
    bloodGroup: string | null;
    photoVersion: string | null;
  } | null;
  job: {
    department: { id: string; name: string };
    designation: { id: string; name: string };
    location: { id: string; name: string };
    grade: { id: string; name: string } | null;
    costCentre: { id: string; name: string } | null;
    reportingManager: { id: string; fullName: string } | null;
    effectiveFrom: string;
  } | null;
  statutory?: { panLast4: string | null; aadhaarLast4: string | null; uanLast4: string | null; esiNumber: string | null; hasPan: boolean; hasAadhaar: boolean; hasUan: boolean } | null;
  bank?: { accountHolderName: string; accountNumberLast4: string; ifsc: string; bankName: string; branchName: string; effectiveFrom: string } | null;
}
export async function getEmployeeProfile(id: string): Promise<EmployeeProfile> {
  const { data } = await apiClient.get<EmployeeProfile>(`/api/employees/${id}`);
  return data;
}
export async function getMyProfile(): Promise<EmployeeProfile> {
  const { data } = await apiClient.get<EmployeeProfile>("/api/employees/me");
  return data;
}

export async function revealStatutory(id: string): Promise<{ pan: string | null; aadhaar: string | null; uan: string | null; esiNumber: string | null }> {
  const { data } = await apiClient.get(`/api/employees/${id}/statutory/reveal`);
  return data;
}
export async function revealBank(id: string): Promise<{ accountHolderName: string; accountNumber: string; ifsc: string; bankName: string; branchName: string }> {
  const { data } = await apiClient.get(`/api/employees/${id}/bank/reveal`);
  return data;
}

export interface JobHistoryEntry {
  id: string;
  department: string;
  designation: string;
  location: string;
  grade: string | null;
  costCentre: string | null;
  reportingManager: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "past" | "current" | "scheduled";
  changeReason: string | null;
}
export interface NameHistoryEntry {
  id: string;
  fullName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "past" | "current" | "scheduled";
  changeReason: string | null;
}
export interface BankHistoryEntry {
  id: string;
  accountHolderName: string;
  accountNumberLast4: string;
  ifsc: string;
  bankName: string;
  branchName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "past" | "current" | "scheduled";
}
export async function getJobHistory(id: string): Promise<JobHistoryEntry[]> {
  const { data } = await apiClient.get<{ history: JobHistoryEntry[] }>(`/api/employees/${id}/history/job`);
  return data.history;
}
export async function getNameHistory(id: string): Promise<NameHistoryEntry[]> {
  const { data } = await apiClient.get<{ history: NameHistoryEntry[] }>(`/api/employees/${id}/history/name`);
  return data.history;
}
export async function getBankHistory(id: string): Promise<BankHistoryEntry[]> {
  const { data } = await apiClient.get<{ history: BankHistoryEntry[] }>(`/api/employees/${id}/history/bank`);
  return data.history;
}

// EF3: cancel a scheduled (not yet in force) change; the previous row reopens.
export async function cancelScheduledChange(id: string, kind: "job" | "name" | "bank", rowId: string): Promise<void> {
  await apiClient.post(`/api/employees/${id}/history/${kind}/${rowId}/cancel`, {});
}

// ── Effective-dated + direct updates ────────────────────────────────────

export async function updateJob(id: string, input: { departmentId?: string; designationId?: string; locationId?: string; gradeId?: string | null; costCentreId?: string | null; reportingManagerId?: string | null; effectiveFrom: string; changeReason?: string }): Promise<void> {
  await apiClient.patch(`/api/employees/${id}/job`, input);
}
export async function updateBank(id: string, input: { accountHolderName: string; accountNumber: string; accountNumberConfirm: string; ifsc: string; bankName: string; branchName: string; effectiveFrom?: string }): Promise<void> {
  await apiClient.patch(`/api/employees/${id}/bank`, input);
}
export async function updateName(id: string, input: { fullName: string; effectiveFrom: string; changeReason?: string }): Promise<void> {
  await apiClient.patch(`/api/employees/${id}/name`, input);
}
export async function updateStatutory(id: string, input: { pan?: string; aadhaar?: string; uan?: string; esiNumber?: string | null }): Promise<void> {
  await apiClient.patch(`/api/employees/${id}/statutory`, input);
}
export async function updatePersonal(id: string, input: Record<string, unknown>): Promise<void> {
  await apiClient.patch(`/api/employees/${id}/personal`, input);
}
export async function updateSelfService(input: { currentAddress?: string; permanentAddress?: string; emergencyContactName?: string; emergencyContactPhone?: string; emergencyContactRelation?: string }): Promise<void> {
  await apiClient.patch("/api/employees/me", input);
}

// ── Change requests ──────────────────────────────────────────────────────

export interface ChangeRequestSummary {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  fieldGroup: "bank" | "statutory" | "personal";
  status: "PENDING" | "APPROVED" | "REJECTED";
  remarks: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export type CreateChangeRequestInput =
  | { fieldGroup: "bank"; changes: { accountHolderName: string; accountNumber: string; accountNumberConfirm: string; ifsc: string; bankName: string; branchName: string } }
  | { fieldGroup: "statutory"; changes: { pan?: string; aadhaar?: string; uan?: string; esiNumber?: string } }
  | { fieldGroup: "personal"; changes: { mobile?: string; personalEmail?: string; bloodGroup?: string } };
export async function createChangeRequest(input: CreateChangeRequestInput): Promise<{ id: string }> {
  const { data } = await apiClient.post("/api/employees/change-requests", input);
  return data;
}
export async function listChangeRequests(status?: string): Promise<ChangeRequestSummary[]> {
  const { data } = await apiClient.get<{ requests: ChangeRequestSummary[] }>("/api/employees/change-requests", { params: { status } });
  return data.requests;
}
export async function approveChangeRequest(id: string, remarks?: string): Promise<void> {
  await apiClient.post(`/api/employees/change-requests/${id}/approve`, { remarks });
}
export async function rejectChangeRequest(id: string, remarks?: string): Promise<void> {
  await apiClient.post(`/api/employees/change-requests/${id}/reject`, { remarks });
}

// ── Separations ──────────────────────────────────────────────────────────

export interface SeparationSummary {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  lastWorkingDate: string;
  reason: string;
  notes: string | null;
  status: "INITIATED" | "COMPLETED" | "CANCELLED";
  initiatedAt: string;
  cancelledAt: string | null;
  completedAt: string | null;
}
export async function initiateSeparation(employeeId: string, input: { lastWorkingDate: string; reason: string; notes?: string }): Promise<SeparationSummary> {
  const { data } = await apiClient.post(`/api/employees/${employeeId}/separations`, input);
  return data;
}
export async function cancelSeparation(id: string): Promise<void> {
  await apiClient.post(`/api/employees/separations/${id}/cancel`);
}
export async function listSeparations(): Promise<SeparationSummary[]> {
  const { data } = await apiClient.get<{ separations: SeparationSummary[] }>("/api/employees/separations");
  return data.separations;
}
