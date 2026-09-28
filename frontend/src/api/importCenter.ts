import { apiClient } from "./client";

export type ImportDataset = "org-masters" | "employees" | "statutory" | "bank" | "leave-grants";

export interface StagingRow {
  rowNumber: number;
  errors: string[];
  warnings: string[];
  data: Record<string, string>;
}

export interface UploadResult {
  batchId: string;
  dataset: ImportDataset;
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: StagingRow[];
}

export interface BatchSummary {
  id: string;
  dataset: ImportDataset;
  fileName: string;
  status: "VALIDATED" | "COMMITTED";
  totalRows: number;
  validRows: number;
  errorRows: number;
  uploadedAt: string;
  committedAt: string | null;
}

export interface BatchDetail extends BatchSummary {
  rows: StagingRow[];
}

export async function downloadTemplate(dataset: ImportDataset): Promise<Blob> {
  const { data } = await apiClient.get(`/api/import/${dataset}/template`, { responseType: "blob" });
  return data as Blob;
}

export async function uploadFile(dataset: ImportDataset, file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<UploadResult>(`/api/import/${dataset}/upload`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function listBatches(dataset?: ImportDataset): Promise<BatchSummary[]> {
  const { data } = await apiClient.get<{ batches: BatchSummary[] }>("/api/import/batches", { params: dataset ? { dataset } : undefined });
  return data.batches;
}

export async function getBatch(id: string): Promise<BatchDetail> {
  const { data } = await apiClient.get<BatchDetail>(`/api/import/batches/${id}`);
  return data;
}

export async function downloadErrorReport(id: string): Promise<Blob> {
  const { data } = await apiClient.get(`/api/import/batches/${id}/error-report`, { responseType: "blob" });
  return data as Blob;
}

export async function commitBatch(id: string, confirmText?: string): Promise<{ committedRows: number }> {
  const { data } = await apiClient.post<{ committedRows: number }>(`/api/import/batches/${id}/commit`, { confirmText });
  return data;
}

export interface HeadcountRow {
  id: string;
  code: string;
  name: string;
  count: number;
}

export async function reconciliationReport(): Promise<{ totalActive: number; byLocation: HeadcountRow[]; byDepartment: HeadcountRow[] }> {
  const { data } = await apiClient.get("/api/import/reconciliation");
  return data as { totalActive: number; byLocation: HeadcountRow[]; byDepartment: HeadcountRow[] };
}
