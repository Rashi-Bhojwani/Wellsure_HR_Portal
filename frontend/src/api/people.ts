import { apiClient } from "./client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export interface NamedRef {
  id: string;
  name: string;
}

// Only what the backend's directory allowlist (modules/people/fieldPolicy.ts)
// and the current System Settings toggles let through — optional fields are
// simply absent when switched off.
export interface DirectoryEntry {
  id: string;
  employeeCode: string;
  name: string;
  photoVersion: string | null;
  designation: NamedRef;
  department: NamedRef;
  location: NamedRef;
  officialEmail?: string | null;
  mobile?: string;
  personalEmail?: string;
  birthday?: string; // "MM-DD"
  dateOfJoining?: string;
  reportingManager?: NamedRef | null;
}

export interface DirectoryPage {
  items: DirectoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  visibleFields: string[];
}

export async function listDirectory(params: { search?: string; departmentId?: string; locationId?: string; page: number; pageSize: number }): Promise<DirectoryPage> {
  const { data } = await apiClient.get<DirectoryPage>("/api/people", { params });
  return data;
}

export async function getPerson(id: string): Promise<DirectoryEntry> {
  const { data } = await apiClient.get<DirectoryEntry>(`/api/people/${id}`);
  return data;
}

// E2: what someone is in the three-level structure. A manager always shows
// as one (even with no team yet); an HR Admin sits at the top level but
// never has a team; Super Admins form the Admin root.
export type OrgChartKind = "admin" | "manager" | "adminStaff" | "employee";

export interface OrgChartNode {
  id: string;
  kind: OrgChartKind;
  code: string;
  name: string;
  photoVersion: string | null;
  designationId: string;
  departmentId: string;
  locationId: string;
  managerId: string | null;
}

export interface OrgChart {
  nodes: OrgChartNode[];
  adminIds: string[]; // the Super Admins — the synthetic Admin root
  rootIds: string[]; // directly under Admin: managers and HR Admins
  unassignedIds: string[];
  designations: Record<string, string>;
  departments: Record<string, string>;
  locations: Record<string, string>;
}

export async function getOrgChart(): Promise<OrgChart> {
  const { data } = await apiClient.get<OrgChart>("/api/people/org-chart");
  return data;
}

// A short-lived, photo-only token: <img> tags can't send the Authorization
// header, so photo URLs carry this instead (backend modules/people/photos.ts).
export async function getPhotoToken(): Promise<{ token: string; expiresAt: string }> {
  const { data } = await apiClient.get<{ token: string; expiresAt: string }>("/api/people/photo-token");
  return data;
}

export function photoUrl(employeeId: string, photoVersion: string, size: "thumb" | "full", token: string): string {
  const params = new URLSearchParams({ v: photoVersion, t: token });
  return `${API_BASE_URL}/api/people/photos/${employeeId}/${size}?${params.toString()}`;
}

function photoForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

export async function uploadMyPhoto(file: File): Promise<{ photoVersion: string }> {
  const { data } = await apiClient.put<{ photoVersion: string }>("/api/employees/me/photo", photoForm(file));
  return data;
}

export async function removeMyPhoto(): Promise<void> {
  await apiClient.delete("/api/employees/me/photo");
}

export async function uploadEmployeePhoto(employeeId: string, file: File): Promise<{ photoVersion: string }> {
  const { data } = await apiClient.put<{ photoVersion: string }>(`/api/employees/${employeeId}/photo`, photoForm(file));
  return data;
}

export async function removeEmployeePhoto(employeeId: string): Promise<void> {
  await apiClient.delete(`/api/employees/${employeeId}/photo`);
}
