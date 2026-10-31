import type { AssetSettingItem, AssetSettingKind } from "@shared/constants/assets";
import { apiClient } from "../../api/client";

// The asset register API (backend/src/modules/assets). Types mirror backend/src/modules/assets/types.ts.

export interface PersonRef {
  employeeId: string;
  employeeCode: string;
  name: string;
}
export type HolderRef = PersonRef | { hidden: true };
export const isHidden = (h: HolderRef): h is { hidden: true } => "hidden" in h;

export interface CodeLabel {
  code: string;
  label: string;
}

export interface AssetSummary {
  id: string;
  assetId: string;
  name: string;
  category: CodeLabel;
  status: CodeLabel & { issuable: boolean };
  serialNumber: string | null;
  model: string | null;
  holder: HolderRef | null;
  openAssignmentId: string | null;
  acknowledged: boolean | null;
  updatedAt: string;
}

export interface AssignmentView {
  id: string;
  holder: HolderRef;
  issuedAt: string;
  issueCondition: CodeLabel;
  issueNote: string | null;
  acknowledgedAt: string | null;
  endedAt: string | null;
  endReason: "RETURNED" | "REASSIGNED" | "LOST" | null;
  returnCondition: CodeLabel | null;
  endNote: string | null;
}

export interface AssetEventView {
  id: string;
  kind: string;
  at: string;
  actorName: string | null;
  holder: HolderRef | null;
  condition: CodeLabel | null;
  status: CodeLabel | null;
  note: string | null;
}

export interface AssetDetail extends AssetSummary {
  notes: string | null;
  createdAt: string;
  assignments: AssignmentView[];
  events: AssetEventView[];
}

export interface AssetList {
  total: number;
  items: AssetSummary[];
  ready: boolean;
  missing: AssetSettingKind[];
}

export interface MyAsset {
  assignmentId: string;
  assetId: string;
  name: string;
  category: string;
  serialNumber: string | null;
  model: string | null;
  issuedAt: string;
  issueCondition: string;
  acknowledgedAt: string | null;
  endedAt: string | null;
  endReason: "RETURNED" | "REASSIGNED" | "LOST" | null;
}
export interface MyAssets {
  current: MyAsset[];
  past: MyAsset[];
}

export interface SettingVersion {
  version: number;
  items: AssetSettingItem[];
  note: string;
  enteredByMe: boolean;
  enteredByName: string | null;
  enteredAt: string;
  confirmedByName: string | null;
  confirmedAt: string | null;
}
export interface SettingKind {
  kind: AssetSettingKind;
  label: string;
  what: string;
  inForce: SettingVersion | null;
  pending: SettingVersion | null;
}
export interface AssetSettings {
  ready: boolean;
  missing: AssetSettingKind[];
  kinds: SettingKind[];
}

export interface ListQuery {
  q?: string;
  categoryCode?: string;
  statusCode?: string;
  holder?: "any" | "assigned" | "unassigned";
  page?: number;
  pageSize?: number;
}

export interface AssetInput {
  name: string;
  categoryCode: string;
  statusCode: string;
  serialNumber?: string | null;
  model?: string | null;
  notes?: string | null;
}

const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);

export const listMine = () => data<MyAssets>(apiClient.get("/api/assets/mine"));
export const acknowledge = (assignmentId: string) => data<MyAssets>(apiClient.post(`/api/assets/mine/${assignmentId}/acknowledge`));

export const listAssets = (q: ListQuery) => data<AssetList>(apiClient.get("/api/assets", { params: q }));
export const getAsset = (id: string) => data<AssetDetail>(apiClient.get(`/api/assets/${id}`));
export const searchHolders = (q: string) => data<PersonRef[]>(apiClient.get("/api/assets/holders", { params: { q } }));
export const createAsset = (input: AssetInput) => data<AssetDetail>(apiClient.post("/api/assets", input));
export const updateAsset = (id: string, input: Partial<AssetInput>) => data<AssetDetail>(apiClient.patch(`/api/assets/${id}`, input));
export const issueAsset = (id: string, input: { employeeId: string; conditionCode: string; note?: string }) => data<AssetDetail>(apiClient.post(`/api/assets/${id}/issue`, input));
export const returnAsset = (id: string, input: { assignmentId: string; conditionCode: string; statusCode?: string; note?: string }) =>
  data<AssetDetail & { alreadyReturned: boolean }>(apiClient.post(`/api/assets/${id}/return`, input));
export const transferAsset = (id: string, input: { toEmployeeId: string; conditionCode: string; note?: string }) => data<AssetDetail>(apiClient.post(`/api/assets/${id}/transfer`, input));
export const markLost = (id: string, input: { statusCode: string; note: string }) => data<AssetDetail>(apiClient.post(`/api/assets/${id}/lost`, input));
export const markDamaged = (id: string, input: { conditionCode: string; statusCode?: string; note: string }) => data<AssetDetail>(apiClient.post(`/api/assets/${id}/damaged`, input));

export const getSettings = () => data<AssetSettings>(apiClient.get("/api/assets/settings"));
export const proposeSetting = (kind: AssetSettingKind, input: { items: AssetSettingItem[]; note?: string }) => data<SettingKind>(apiClient.post(`/api/assets/settings/${kind}`, input));
export const confirmSetting = (kind: AssetSettingKind, input: { version: number; note?: string }) => data<SettingKind>(apiClient.post(`/api/assets/settings/${kind}/confirm`, input));

export interface AssetLists {
  ready: boolean;
  missing: AssetSettingKind[];
  categories: AssetSettingItem[];
  statuses: AssetSettingItem[];
  conditions: AssetSettingItem[];
}
export const getLists = () => data<AssetLists>(apiClient.get("/api/assets/lists"));

export interface OnboardingAvailable {
  assets: Array<{ id: string; assetId: string; name: string; category: string; serialNumber: string | null }>;
  conditions: Array<{ code: string; label: string }>;
}
export const onboardingAvailable = () => data<OnboardingAvailable>(apiClient.get("/api/assets/onboarding/available"));
export const issueAtOnboarding = (id: string, input: { employeeId: string; conditionCode: string; note?: string }) => data<{ assetId: string; issued: true }>(apiClient.post(`/api/assets/${id}/issue-onboarding`, input));
