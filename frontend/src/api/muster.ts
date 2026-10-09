import { apiClient } from "./client";

// The Attendance Muster and manual entry (Phase 2 P2-D, docs/plans/PHASE_2.md §5).

export interface MusterCell {
  date: string;
  code: string | null;
  status: string | null;
  source: string | null;
  capture: "DEVICE" | "MANUAL" | null;
  editable: boolean;
  offDayOnly: boolean;
  reason: string | null;
  firstIn: string | null;
  lastOut: string | null;
  actualMinutes: number | null;
  lateInMinutes: number | null;
  earlyOutMinutes: number | null;
  lopDays: number;
  flags: string[];
  statusOnly: boolean;
  missingPunch: boolean;
  corrected: boolean;
  workedOnOffDay: boolean;
  provisional: boolean;
  locked: boolean;
  entry: { kind: string; text: string; via: string; remark: string | null; enteredAt: string } | null;
}

export interface MusterTotals {
  paidDays: number;
  present: number;
  absent: number;
  halfDays: number;
  lop: number;
  leave: number;
  holidays: number;
  off: number;
  notMarked: number;
  missingPunch: number;
}

export interface MusterRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  branch: string | null;
  cells: MusterCell[];
  totals: MusterTotals;
}

export interface Muster {
  cycle: { start: string; end: string; label: string };
  today: string;
  days: Array<{ date: string; weekday: number; notMarked: number }>;
  canMark: boolean;
  filters: { locations: Array<{ id: string; name: string }>; departments: Array<{ id: string; name: string }>; employees: Array<{ id: string; employeeCode: string; name: string }> };
  rows: MusterRow[];
  legend: Array<{ code: string; label: string }>;
  inputHelp: Array<{ code: string; label: string }>;
}

export interface MusterQuery {
  cycleStart?: string;
  locationId?: string;
  departmentId?: string;
  employeeId?: string;
}

export interface MusterCycle {
  start: string;
  end: string;
  label: string;
}

export async function cycles(): Promise<{ current: MusterCycle; cycles: MusterCycle[] }> {
  return (await apiClient.get("/api/attendance/muster/cycles")).data;
}
export async function getMuster(q: MusterQuery): Promise<Muster> {
  return (await apiClient.get<Muster>("/api/attendance/muster", { params: q })).data;
}
export async function exportMuster(q: MusterQuery): Promise<Blob> {
  return (await apiClient.get("/api/attendance/muster/export", { params: q, responseType: "blob" })).data as Blob;
}
export async function saveEntries(entries: Array<{ employeeId: string; date: string; text: string; remark?: string | null }>): Promise<{ saved: number; unchanged: number }> {
  return (await apiClient.post("/api/attendance/muster/entries", { entries })).data;
}
export async function markAllPresent(body: { date: string; locationId: string }): Promise<{ marked: number; skipped: number }> {
  return (await apiClient.post("/api/attendance/muster/mark-present", body)).data;
}
export async function downloadTemplate(q: { locationId: string; cycleStart?: string }): Promise<Blob> {
  return (await apiClient.get("/api/attendance/muster/template", { params: q, responseType: "blob" })).data as Blob;
}

export interface UploadPreview {
  uploadId: string;
  branch: string;
  cycle: MusterCycle;
  fileName: string;
  counts: { timed: number; statusOnly: number; cleared: number; unchanged: number; blank: number; issues: number };
  changes: Array<{ employee: string; date: string; before: string | null; entry: string; kind: string }>;
  issues: Array<{ row: number; employeeCode: string | null; date: string | null; issue: string }>;
}
export async function previewUpload(file: File): Promise<UploadPreview> {
  const form = new FormData();
  form.append("file", file);
  return (await apiClient.post<UploadPreview>("/api/attendance/muster/upload", form)).data;
}
export async function commitUpload(id: string): Promise<{ saved: number; unchanged: number }> {
  return (await apiClient.post(`/api/attendance/muster/upload/${id}/commit`)).data;
}

/** Save a downloaded file. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
