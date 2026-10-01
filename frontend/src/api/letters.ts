import type { LetterExtraField } from "@shared/constants/letters";
import { apiClient } from "./client";

export interface LetterTemplateSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  visibleToEmployeeDefault: boolean;
  currentVersion: number;
  extraFields: LetterExtraField[];
  lastEditedAt: string;
}

export interface LetterTemplateVersion {
  id: string;
  version: number;
  bodyHtml: string;
  extraFields: LetterExtraField[];
  createdByUserId: string | null;
  createdAt: string;
}

export interface LetterTemplateDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  visibleToEmployeeDefault: boolean;
  versions: LetterTemplateVersion[]; // newest first
}

export interface IssuedLetter {
  id: string;
  reference: string;
  employeeId: string;
  template: { id: string; code: string; name: string };
  templateVersion: number;
  status: "QUEUED" | "GENERATED" | "FAILED";
  failureReason: string | null;
  visibleToEmployee: boolean;
  generatedAt: string;
  document: { id: string; title: string; archived: boolean } | null;
  pdfSha256: string | null;
  rendererVersion: string | null;
  reissueOf: { id: string; reference: string } | null;
  reissuedAs: Array<{ id: string; reference: string }>;
  extraValues: Record<string, string>;
}

export interface Letterhead {
  legalName: string;
  registeredAddress: string;
  hasLogo: boolean;
  signatoryName: string;
  signatoryDesignation: string;
}

// ── Templates ─────────────────────────────────────────────────────────
export async function listTemplates(): Promise<LetterTemplateSummary[]> {
  const { data } = await apiClient.get<LetterTemplateSummary[]>("/api/letters/templates");
  return data;
}
export async function getTemplate(id: string): Promise<LetterTemplateDetail> {
  const { data } = await apiClient.get<LetterTemplateDetail>(`/api/letters/templates/${id}`);
  return data;
}
export async function createTemplate(input: { code: string; name: string; description?: string | null; visibleToEmployeeDefault?: boolean; bodyHtml: string; extraFields: LetterExtraField[] }): Promise<LetterTemplateDetail> {
  const { data } = await apiClient.post<LetterTemplateDetail>("/api/letters/templates", input);
  return data;
}
export async function saveNewVersion(id: string, input: { bodyHtml: string; extraFields: LetterExtraField[] }): Promise<LetterTemplateDetail> {
  const { data } = await apiClient.post<LetterTemplateDetail>(`/api/letters/templates/${id}/versions`, input);
  return data;
}
export async function updateTemplate(id: string, input: { name?: string; description?: string | null; isActive?: boolean; visibleToEmployeeDefault?: boolean }): Promise<LetterTemplateDetail> {
  const { data } = await apiClient.patch<LetterTemplateDetail>(`/api/letters/templates/${id}`, input);
  return data;
}
export async function previewTemplate(input: { templateName: string; bodyHtml: string; extraFields: LetterExtraField[]; employeeId: string; extraValues: Record<string, string> }): Promise<Blob> {
  const { data } = await apiClient.post<Blob>("/api/letters/templates/preview", input, { responseType: "blob" });
  return data;
}

// ── Letterhead ────────────────────────────────────────────────────────
export async function getLetterhead(): Promise<Letterhead> {
  const { data } = await apiClient.get<Letterhead>("/api/letters/letterhead");
  return data;
}
export async function updateLetterhead(input: Partial<Omit<Letterhead, "hasLogo">>): Promise<Letterhead> {
  const { data } = await apiClient.put<Letterhead>("/api/letters/letterhead", input);
  return data;
}
export async function getLogo(): Promise<Blob> {
  const { data } = await apiClient.get<Blob>("/api/letters/letterhead/logo", { responseType: "blob" });
  return data;
}
export async function uploadLogo(file: File): Promise<Letterhead> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<Letterhead>("/api/letters/letterhead/logo", form);
  return data;
}
export async function removeLogo(): Promise<Letterhead> {
  const { data } = await apiClient.delete<Letterhead>("/api/letters/letterhead/logo");
  return data;
}

// ── Issued letters ────────────────────────────────────────────────────
export async function listEmployeeLetters(employeeId: string): Promise<IssuedLetter[]> {
  const { data } = await apiClient.get<IssuedLetter[]>(`/api/letters/employees/${employeeId}`);
  return data;
}
export async function issueLetter(employeeId: string, input: { templateId: string; extraValues: Record<string, string>; visibleToEmployee: boolean }): Promise<IssuedLetter> {
  const { data } = await apiClient.post<IssuedLetter>(`/api/letters/employees/${employeeId}`, input);
  return data;
}
export async function reissueLetter(id: string, input: { extraValues?: Record<string, string>; visibleToEmployee?: boolean }): Promise<IssuedLetter> {
  const { data } = await apiClient.post<IssuedLetter>(`/api/letters/${id}/reissue`, input);
  return data;
}
export async function reproduceLetter(id: string): Promise<{ pdf: Blob; matches: boolean }> {
  const res = await apiClient.post<Blob>(`/api/letters/${id}/reproduce`, {}, { responseType: "blob" });
  return { pdf: res.data, matches: res.headers["x-letter-reproduction"] === "match" };
}

// Opens a PDF blob in a new tab (the object URL is released after a minute).
export function openPdf(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
