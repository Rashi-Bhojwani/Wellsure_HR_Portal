import { apiClient } from "./client";

export type CategoryScope = "COMPANY" | "EMPLOYEE";

export interface DocumentCategory {
  id: string;
  code: string;
  name: string;
  appliesTo: CategoryScope;
  isActive: boolean;
  sortOrder: number;
}

interface Ref {
  id: string;
  name: string;
}

export interface CompanyDocument {
  id: string;
  title: string;
  description: string | null;
  category: Ref & { code: string };
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  scopeLocation: Ref | null;
  scopeDepartment: Ref | null;
  uploadedAt: string;
  archivedAt: string | null;
  downloadedByCount?: number;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  title: string;
  category: Ref & { code: string };
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibleToEmployee: boolean;
  uploadedAt: string;
  archivedAt: string | null;
}

export interface SignedDownload {
  url: string;
  fileName: string;
  expiresInSeconds: number;
}

export interface DocumentDownloads {
  audienceSize: number;
  downloadedByCount: number;
  downloads: Array<{ employeeId: string; employeeCode: string; name: string; firstDownloadedAt: string; lastDownloadedAt: string; downloadCount: number }>;
}

// The signed URL is short-lived and carries Content-Disposition: attachment,
// so navigating to it downloads the file without leaving the page.
export function startDownload(download: SignedDownload): void {
  window.location.assign(download.url);
}

// ── Categories ────────────────────────────────────────────────────────
export async function listCategories(params: { appliesTo?: CategoryScope; includeInactive?: boolean } = {}): Promise<DocumentCategory[]> {
  const { data } = await apiClient.get<DocumentCategory[]>("/api/documents/categories", { params });
  return data;
}
export async function createCategory(input: { code: string; name: string; appliesTo: CategoryScope; sortOrder?: number }): Promise<DocumentCategory> {
  const { data } = await apiClient.post<DocumentCategory>("/api/documents/categories", input);
  return data;
}
export async function updateCategory(id: string, input: { name?: string; isActive?: boolean; sortOrder?: number }): Promise<DocumentCategory> {
  const { data } = await apiClient.patch<DocumentCategory>(`/api/documents/categories/${id}`, input);
  return data;
}

// ── Company documents ─────────────────────────────────────────────────
export async function listCompanyDocuments(): Promise<CompanyDocument[]> {
  const { data } = await apiClient.get<CompanyDocument[]>("/api/documents/company");
  return data;
}
export async function listManagedCompanyDocuments(includeArchived: boolean): Promise<CompanyDocument[]> {
  const { data } = await apiClient.get<CompanyDocument[]>("/api/documents/company/manage", { params: { includeArchived } });
  return data;
}
export async function uploadCompanyDocument(
  file: File,
  fields: { title: string; description?: string; categoryId: string; scopeLocationId?: string; scopeDepartmentId?: string },
): Promise<CompanyDocument> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
  const { data } = await apiClient.post<CompanyDocument>("/api/documents/company", form);
  return data;
}
export async function updateCompanyDocument(
  id: string,
  input: { title?: string; description?: string | null; categoryId?: string; scopeLocationId?: string | null; scopeDepartmentId?: string | null },
): Promise<CompanyDocument> {
  const { data } = await apiClient.patch<CompanyDocument>(`/api/documents/company/${id}`, input);
  return data;
}
export async function setCompanyDocumentArchived(id: string, archived: boolean): Promise<CompanyDocument> {
  const { data } = await apiClient.post<CompanyDocument>(`/api/documents/company/${id}/${archived ? "archive" : "unarchive"}`);
  return data;
}
export async function downloadCompanyDocument(id: string): Promise<SignedDownload> {
  const { data } = await apiClient.post<SignedDownload>(`/api/documents/company/${id}/download`);
  return data;
}
export async function getCompanyDocumentDownloads(id: string): Promise<DocumentDownloads> {
  const { data } = await apiClient.get<DocumentDownloads>(`/api/documents/company/${id}/downloads`);
  return data;
}

// ── My documents ──────────────────────────────────────────────────────
export async function listMyDocuments(): Promise<EmployeeDocument[]> {
  const { data } = await apiClient.get<EmployeeDocument[]>("/api/documents/me");
  return data;
}
export async function downloadMyDocument(id: string): Promise<SignedDownload> {
  const { data } = await apiClient.post<SignedDownload>(`/api/documents/me/${id}/download`);
  return data;
}

// ── An employee's documents (HR) ──────────────────────────────────────
export async function listEmployeeDocuments(employeeId: string): Promise<EmployeeDocument[]> {
  const { data } = await apiClient.get<EmployeeDocument[]>(`/api/documents/employees/${employeeId}`);
  return data;
}
export async function uploadEmployeeDocument(
  employeeId: string,
  file: File,
  fields: { title: string; categoryId: string; visibleToEmployee: boolean },
): Promise<EmployeeDocument> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", fields.title);
  form.append("categoryId", fields.categoryId);
  form.append("visibleToEmployee", String(fields.visibleToEmployee));
  const { data } = await apiClient.post<EmployeeDocument>(`/api/documents/employees/${employeeId}`, form);
  return data;
}
export async function updateEmployeeDocument(id: string, input: { title?: string; categoryId?: string; visibleToEmployee?: boolean }): Promise<EmployeeDocument> {
  const { data } = await apiClient.patch<EmployeeDocument>(`/api/documents/employee-documents/${id}`, input);
  return data;
}
export async function setEmployeeDocumentArchived(id: string, archived: boolean): Promise<EmployeeDocument> {
  const { data } = await apiClient.post<EmployeeDocument>(`/api/documents/employee-documents/${id}/${archived ? "archive" : "unarchive"}`);
  return data;
}
export async function downloadEmployeeDocument(id: string): Promise<SignedDownload> {
  const { data } = await apiClient.post<SignedDownload>(`/api/documents/employee-documents/${id}/download`);
  return data;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
