import type { RuleShape } from "@shared/constants/payrollRules";
import { apiClient } from "./client";

// Payroll (Phase 6) — backend/src/modules/payroll. P6-1: Rules and setup, who can check, the Payroll audit trail.

export type RuleStatus = "NOT_SET" | "PLACEHOLDER" | "CONFIRMED";

export interface VersionView {
  version: number;
  value: unknown;
  valueHash: string;
  note: string;
  authorUserId: string | null;
  authorName: string;
  createdAt: string;
  confirmation: { confirmedByUserId: string; confirmedByName: string; confirmedAt: string; note: string } | null;
}

export interface RuleView {
  key: string;
  group: string;
  label: string;
  description: string;
  affects: string;
  shape: RuleShape;
  origin: "STATUTORY" | "COMPANY";
  whoConfirms: string;
  suggestion: string | null;
  status: RuleStatus;
  sourceLabel: string | null;
  requiresRetype: boolean;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
}

export interface EditPreview {
  key: string;
  label: string;
  before: { version: number; value: unknown; status: RuleStatus } | null;
  after: { value: unknown; valueHash: string };
  unchanged: boolean;
  willResetConfirmation: boolean;
  lastConfirmed: VersionView | null;
  impact: string;
  fingerprint: string;
}

export interface Checker {
  userId: string;
  name: string;
}
export interface CheckerAvailability {
  eligible: Checker[];
  excluded: Array<Checker & { reason: string }>;
  state: "NONE" | "ONE" | "MANY";
  message: string;
}

export interface ConfirmPreview {
  key: string;
  label: string;
  version: number;
  value: unknown;
  valueHash: string;
  sourceLabel: string | null;
  requiresRetype: boolean;
  authorName: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}

export interface Watermark {
  test: boolean;
  text: string;
  rules: Array<{ key: string; label: string }>;
}

const base = "/api/payroll";

export async function listRules(): Promise<RuleView[]> {
  return (await apiClient.get<{ rules: RuleView[] }>(`${base}/rules`)).data.rules;
}
export async function getRule(key: string): Promise<{ rule: RuleView; history: VersionView[] }> {
  return (await apiClient.get<{ rule: RuleView; history: VersionView[] }>(`${base}/rules/${key}`)).data;
}
export async function previewRuleEdit(key: string, value: unknown): Promise<EditPreview> {
  return (await apiClient.post<EditPreview>(`${base}/rules/${key}/edit-preview`, { value })).data;
}
export async function saveRule(key: string, body: { value: unknown; note: string; fingerprint: string }): Promise<RuleView> {
  return (await apiClient.put<RuleView>(`${base}/rules/${key}`, body)).data;
}
export async function previewRuleConfirm(key: string): Promise<ConfirmPreview> {
  return (await apiClient.post<ConfirmPreview>(`${base}/rules/${key}/confirm-preview`)).data;
}
export async function confirmRule(key: string, body: { version: number; typedValue?: unknown; note: string; fingerprint: string }): Promise<RuleView> {
  return (await apiClient.post<RuleView>(`${base}/rules/${key}/confirm`, body)).data;
}
export async function getCheckers(subject: string): Promise<CheckerAvailability> {
  return (await apiClient.get<CheckerAvailability>(`${base}/approvals/checkers`, { params: { subject } })).data;
}
