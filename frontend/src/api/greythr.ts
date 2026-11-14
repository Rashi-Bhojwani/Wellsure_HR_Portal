import { apiClient } from "./client";
import type { LayoutValue } from "./payroll";

// Stage 8 (docs/plans/STAGE_8_PLAN.md): greytHR's salary statement (the parallel-run kit) and bank transfer file. Directors only; the server decides.
const base = "/api/payroll-greythr";

export interface ComparableRun {
  id: string;
  label: string;
  cycleStart: string;
  status: string;
  test: boolean;
}
export interface CompareLine {
  item: string;
  kind: "HEAD" | "TOTAL" | "DAYS";
  greythr: string | null;
  portal: string | null;
  difference: string | null;
  higher: "GREYTHR" | "PORTAL" | null;
  matched: boolean;
  hint: string | null;
}
export interface ComparePerson {
  code: string;
  side: "BOTH" | "GREYTHR_ONLY" | "PORTAL_ONLY";
  matched: boolean;
  hint: string | null;
  lines: CompareLine[];
}
export interface CompareCounts {
  matchedPeople: number;
  peopleWithDifferences: number;
  greythrOnly: number;
  portalOnly: number;
  differences: number;
}
export interface Comparison {
  id: string;
  createdAt: string;
  fileName: string;
  run: ComparableRun;
  mapping: Record<string, string | null>;
  portalHeads: Array<{ code: string; label: string }>;
  statement: { title: string | null; headColumns: string[]; notCompared: string[]; people: number };
  result: {
    allowance: string;
    people: ComparePerson[];
    heads: { onlyInGreythr: string[]; onlyInPortal: string[]; compared: Array<{ portal: string; label: string; greythr: string[] }> };
    totals: Array<{ item: string; greythr: string; portal: string; difference: string }>;
    overallNetDifference: string;
    counts: CompareCounts;
  };
}
export interface ComparisonRow {
  id: string;
  month: string;
  runId: string;
  fileName: string;
  counts: CompareCounts;
  createdAt: string;
  by: string;
}
export interface ComparisonList {
  tolerance: { allowance: string; isDefault: boolean };
  retentionDays: number | null;
  comparisons: ComparisonRow[];
}
export interface BankCheck {
  fileName: string;
  dataRows: number;
  layout: { status: "NOT_SET" | "PLACEHOLDER" | "CONFIRMED"; version: number | null; extension: string | null; dateFormat: string | null; columnHeaders: boolean };
  columns: Array<{ position: number; fileHeader: string; layoutHeader: string | null; verdict: "SAME" | "DIFFERS_ONLY_IN_SPACES_OR_CASE" | "DIFFERENT" | "ONLY_IN_FILE" | "ONLY_IN_LAYOUT"; suggested: string | null }>;
  headersMatch: boolean;
  notes: string[];
  suggestedLayout: LayoutValue | null;
}

export const comparableRuns = async () => (await apiClient.get<{ runs: ComparableRun[] }>(`${base}/parallel/runs`)).data.runs;
export const listComparisons = async () => (await apiClient.get<ComparisonList>(`${base}/parallel`)).data;
export const getComparison = async (id: string) => (await apiClient.get<Comparison>(`${base}/parallel/${id}`)).data;
export async function compare(runId: string, file: File): Promise<Comparison> {
  const form = new FormData();
  form.append("runId", runId);
  form.append("file", file);
  return (await apiClient.post<Comparison>(`${base}/parallel`, form)).data;
}
export const recompare = async (id: string, mapping: Record<string, string | null>) => (await apiClient.post<Comparison>(`${base}/parallel/${id}/recompare`, { mapping })).data;
export const deleteComparison = async (id: string) => void (await apiClient.delete(`${base}/parallel/${id}`));
export const exportComparison = async (id: string, format: "xlsx" | "csv") => (await apiClient.get(`${base}/parallel/${id}/export`, { params: { format }, responseType: "blob" })).data as Blob;
export async function checkBankFile(file: File): Promise<BankCheck> {
  const form = new FormData();
  form.append("file", file);
  return (await apiClient.post<BankCheck>(`${base}/bank-check`, form)).data;
}
