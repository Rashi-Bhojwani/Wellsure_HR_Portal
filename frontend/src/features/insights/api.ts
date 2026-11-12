import { apiClient } from "../../api/client";

export type Metric = "turnover" | "tenure" | "exit-reasons" | "hiring-funnel";
export type Status = { allowed: boolean; isDirector: boolean; missing: Partial<Record<Metric, string[]>> };
export type Setting = { key: string; state: "NOT_SET" | "CONFIRMED"; version: number; value: unknown };
export type Cell = { key: string; label: string; suppressed: boolean; n: number | null; value: Record<string, string | number | null> | null };
export type Result = { metric: Metric; window: { from: string; to: string }; minimumGroupSize: number; definition: unknown; table: { cells: Cell[]; total: { suppressed: boolean; n: number | null; value: Record<string, string | number | null> | null } } };
const root = "/api/insights";
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);
export const status = () => data<Status>(apiClient.get(root + "/status"));
export const settings = () => data<{ canEdit: boolean; settings: Setting[] }>(apiClient.get(root + "/settings"));
export const saveSetting = (s: Setting, value: unknown, reason: string) => data<{ canEdit: boolean; settings: Setting[] }>(apiClient.put(`${root}/settings/${s.key}`, { value, version: s.version, reason }));
export const metric = (m: Metric) => data<Result>(apiClient.get(`${root}/metrics/${m}`));
export const exportCsv = (m: Metric) => apiClient.get<Blob>(`${root}/metrics/${m}/export`, { responseType: "blob" }).then((r) => r.data);
