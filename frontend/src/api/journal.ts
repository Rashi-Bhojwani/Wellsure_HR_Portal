import { apiClient } from "./client";

// PY-41: the payroll journal of a finalised run; every key is mapped to a ledger account by a director (none preset).
const base = "/api/payroll-journal";
export interface Journal {
  run: string;
  keys: Array<{ key: string; debit: string; credit: string; account: string | null }>;
  notSet: string[];
  accounts: Array<{ account: string; debit: string; credit: string; keys: string[] }>;
  totalDebit: string;
  totalCredit: string;
  note: string;
}
export const journalOfRun = async (runId: string) => (await apiClient.get<Journal>(`${base}/runs/${runId}`)).data;
export const saveLedgerMappings = async (mappings: Array<{ key: string; account: string }>, reason: string) => (await apiClient.put(`${base}/mappings`, { mappings, reason })).data;
export const exportJournal = async (runId: string, format: "xlsx" | "csv") => (await apiClient.get(`${base}/runs/${runId}/export`, { params: { format }, responseType: "blob" })).data as Blob;
