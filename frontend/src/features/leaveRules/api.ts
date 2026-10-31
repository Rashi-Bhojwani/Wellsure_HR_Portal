import { apiClient } from "../../api/client";
import type { PeepsLeaveTypeCode } from "@shared/constants/peepsLeave";

// The four new leave types: their rules (prepared by HR, approved by a different director) and their supporting documents.

export interface LeaveRules {
  paid: boolean;
  entitlement: { kind: "CAP"; period: "PER_REQUEST" | "PER_CALENDAR_YEAR" | "PER_EMPLOYMENT"; days: string } | { kind: "GRANTED_BALANCE" };
  eligibility: { minServiceDays: number; employmentTypes: string[] };
  units: "FULL_DAY" | "HALF_DAY";
  counting: "WORKING_DAYS" | "CALENDAR_DAYS";
  document: { required: boolean; whenMoreThanDays: number };
  approvalRoute: "MANAGER_OR_HR" | "HR_ONLY";
  yearEnd: { carryForward: "LAPSE" | "CARRY_FORWARD"; encashment: "NONE" | "ENCASH_UNUSED" } | null;
}

export interface RuleVersion {
  version: number;
  rules: LeaveRules;
  note: string;
  preparedByUserId: string;
  preparedBy: string;
  preparedByMe: boolean;
  preparedAt: string;
  approval: { approvedByUserId: string; approvedAt: string; effectiveFrom: string; note: string } | null;
  approvedBy: string | null;
}

export interface LeaveTypeRules {
  code: PeepsLeaveTypeCode;
  leaveTypeId: string;
  name: string;
  isActive: boolean;
  state: "NOT_SET" | "AWAITING_APPROVAL" | "APPROVED";
  inForce: RuleVersion | null;
  awaiting: RuleVersion | null;
  voidedVersion: number | null;
  yearEnd: "EXCLUDED";
  history: RuleVersion[];
}

const data = async <T>(p: Promise<{ data: T }>) => (await p).data;

export const listRules = () => data<LeaveTypeRules[]>(apiClient.get("/api/leave-rules"));
export const prepareRules = (code: string, rules: LeaveRules, note?: string) => data<{ code: string; version: number }>(apiClient.post(`/api/leave-rules/${code}/versions`, { rules, note }));
export const approveRules = (code: string, version: number, effectiveFrom: string, note?: string) => data<LeaveTypeRules>(apiClient.post(`/api/leave-rules/${code}/versions/${version}/approve`, { effectiveFrom, note }));

export interface LeaveDocuments {
  attached: number;
  documents: Array<{ id: string; label: string; contentType: string; sizeBytes: number; uploadedAt: string }>;
}
export const listDocuments = (requestId: string) => data<LeaveDocuments>(apiClient.get(`/api/leave-documents/requests/${requestId}`));
export async function attachDocument(requestId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  await apiClient.post(`/api/leave-documents/requests/${requestId}`, form);
}
/** Opens a document in a new tab (HR and the directors; the server records every open). */
export async function openDocument(documentId: string): Promise<void> {
  const res = await apiClient.get<Blob>(`/api/leave-documents/${documentId}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
