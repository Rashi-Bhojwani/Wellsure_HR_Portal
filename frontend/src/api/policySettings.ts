import { apiClient } from "./client";
import type { PolicyArea, PolicyField, PolicyKind } from "@shared/constants/policySettings";

// M session block 2: policy settings of the decision rows, directors only. One director proposes, a different director confirms.
const base = "/api/policy-settings";
export interface PolicySetting {
  key: string;
  area: PolicyArea;
  row: string;
  title: string;
  what: string;
  kind: PolicyKind;
  fields: PolicyField[];
  value: Record<string, unknown> | null;
  active: boolean | null;
  state: "DEFAULT" | "CONFIRMED" | "INACTIVE" | "NOT_SET";
  label: string | null;
  suggestion: Record<string, unknown> | null;
  confirmed: { reason: string; proposedBy: string; confirmedBy: string; at: string } | null;
  pending: Array<{ id: string; value: Record<string, unknown>; reason: string; proposedBy: string; mine: boolean; at: string }>;
}
export const listPolicySettings = async () => (await apiClient.get<{ settings: PolicySetting[] }>(base)).data.settings;
export const proposePolicy = async (key: string, value: Record<string, unknown>, reason: string) => (await apiClient.post<{ id: string }>(`${base}/${key}/proposals`, { value, reason })).data;
export const confirmPolicy = async (id: string) => (await apiClient.post(`${base}/proposals/${id}/confirm`)).data;
