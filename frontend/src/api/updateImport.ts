import { apiClient } from "./client";

// M session block 2, IE-07 / IE-08: HR's update import of existing employees.
export interface ImportRowView { rowNumber: number; employeeCode: string; changes: string[]; errors: string[]; personalApplied: boolean; jobApplied: boolean }
export interface ImportBatchView { id: string; jobNeedsDirector: boolean; rows: ImportRowView[]; applied?: { personal: number; jobs: number; waitingForDirector: number } }
export const downloadTemplate = async () => (await apiClient.get("/api/update-import/template", { responseType: "blob" })).data as Blob;
export const previewImport = async (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return (await apiClient.post<ImportBatchView>("/api/update-import/preview", form)).data;
};
export const applyImport = async (id: string) => (await apiClient.post<ImportBatchView>(`/api/update-import/${id}/apply`)).data;
export const getImport = async (id: string) => (await apiClient.get<ImportBatchView>(`/api/update-import/${id}`)).data;
export const waitingImports = async () => (await apiClient.get<{ batches: Array<{ id: string; fileName: string; createdAt: string; jobRows: number }> }>("/api/update-import/waiting")).data.batches;
