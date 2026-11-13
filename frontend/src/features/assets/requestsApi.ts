import { apiClient } from "../../api/client";

// Employees' asset requests (Peeps Stage 3, backend/src/modules/assets/requests.ts).
export type AssetRequestStatus = "SUBMITTED" | "APPROVED" | "DECLINED" | "FULFILLED" | "CANCELLED";
export interface AssetRequestView {
  id: string;
  category: string;
  categoryCode: string;
  note: string | null;
  status: AssetRequestStatus;
  requestedAt: string;
  updatedAt: string;
  decisionNote: string | null;
  employee?: { employeeId: string; employeeCode: string; name: string } | null;
}
export const STATUS_LABEL: Record<AssetRequestStatus, string> = { SUBMITTED: "Waiting", APPROVED: "Approved", DECLINED: "Declined", FULFILLED: "Fulfilled", CANCELLED: "Cancelled" };
export const STATUS_TONE: Record<AssetRequestStatus, "info" | "success" | "danger" | "neutral"> = { SUBMITTED: "info", APPROVED: "success", DECLINED: "danger", FULFILLED: "success", CANCELLED: "neutral" };

const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);
export const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const options = () => data<{ ready: boolean; categories: Array<{ code: string; label: string }> }>(apiClient.get("/api/assets/requests/options"));
export const mine = () => data<AssetRequestView[]>(apiClient.get("/api/assets/requests/mine"));
export const create = (input: { categoryCode: string; note?: string; idempotencyKey: string }) => data<AssetRequestView>(apiClient.post("/api/assets/requests", input));
export const cancel = (id: string) => data<AssetRequestView>(apiClient.post(`/api/assets/requests/${id}/cancel`, {}));
export const all = (status?: AssetRequestStatus) => data<AssetRequestView[]>(apiClient.get("/api/assets/requests", { params: status ? { status } : {} }));
export const decide = (id: string, outcome: "APPROVED" | "DECLINED" | "FULFILLED", note?: string) => data<AssetRequestView>(apiClient.post(`/api/assets/requests/${id}/decide`, { outcome, ...(note ? { note } : {}) }));
