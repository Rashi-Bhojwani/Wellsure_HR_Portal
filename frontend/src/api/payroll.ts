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

// ── Salary (P6-2): components, structures, people's salaries, revisions, adjustments ──

export type ComponentType = "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
export type ItemStatus = RuleStatus;

export interface ComponentValue {
  name: string;
  type: ComponentType;
  taxable: boolean;
  pfApplicable: boolean;
  esiApplicable: boolean;
  prorates: boolean;
  payslipLabel: string;
  payslipOrder: number;
}

export interface ComponentView {
  code: string;
  value: ComponentValue | null;
  status: ItemStatus;
  sourceLabel: string | null;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
  usedBy: Array<{ structure: string; structureName: string; pinnedVersion: number; behind: boolean }>;
}

export interface ItemSavePreview<V> {
  code: string;
  isNew: boolean;
  before: { version: number; value?: V; status: ItemStatus } | null;
  after: { value: V; valueHash: string };
  unchanged: boolean;
  willResetConfirmation: boolean;
  lastConfirmed: VersionView | null;
  impact: string;
  fingerprint: string;
}
export type ComponentSavePreview = ItemSavePreview<ComponentValue> & { usedBy: ComponentView["usedBy"] };

export interface ItemConfirmPreview<V> {
  code: string;
  version: number;
  value: V;
  valueHash: string;
  sourceLabel: string | null;
  authorName: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}

export type LineCalc =
  | { method: "PERCENT"; of: string; percent: string }
  | { method: "FIXED_AMOUNT"; amount: string }
  | { method: "PER_PERSON" }
  | { method: "FORMULA"; formula: string }
  | { method: "BALANCE" };

export interface StructureLine {
  component: string;
  componentVersion: number;
  componentHash: string;
  calc: LineCalc;
}
export interface StructureValue {
  name: string;
  description: string;
  ctcIncludes: ComponentType[];
  lines: StructureLine[];
}
export interface StructureView {
  code: string;
  value: StructureValue | null;
  status: ItemStatus;
  sourceLabel: string | null;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
  components: Array<{ component: string; pinnedVersion: number; status: ItemStatus; newerVersion: number | null }>;
}

export interface BreakupJson {
  monthlyCtc: string;
  lines: Array<{ component: string; componentVersion: number; type: ComponentType; amount: string; order: number }>;
}
export interface StructureSavePreview extends ItemSavePreview<StructureValue> {
  sample: { annualCtc: string; breakup: BreakupJson };
  unconfirmedComponents: string[];
}
export type StructureConfirmPreview = ItemConfirmPreview<StructureValue> & { unconfirmedComponents: string[] };

export interface SalaryRowView {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "past" | "current" | "scheduled";
  reason: "JOINING" | "REVISION" | "CORRECTION";
  annualCtc: string;
  monthlyCtc: string;
  structure: string;
  structureKey: string;
  structureVersion: number;
  revisionId: string | null;
  note: string;
  lines: Array<{ component: string; componentVersion: number; type: ComponentType; amount: string }>;
}
export interface EmployeeSalaryRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  branch: string | null;
  joinedOn: string;
  current: { annualCtc: string; monthlyCtc: string; structure: string; since: string } | null;
  scheduled: { effectiveFrom: string; annualCtc: string; structure: string } | null;
}
export interface PersonHit {
  employeeId: string;
  employeeCode: string;
  name: string;
  branch: string | null;
  hasSalary: boolean;
}

export type RevisionSelection =
  | { kind: "EMPLOYEES"; employeeIds: string[] }
  | { kind: "BRANCH"; locationId: string }
  | { kind: "GRADE"; gradeId: string }
  | { kind: "STRUCTURE"; structureKey: string; structureVersion?: number }
  | { kind: "ALL" };
export interface RevisionChange {
  ctc?: { mode: "SET"; annual: string } | { mode: "INCREASE_PERCENT"; percent: string };
  structure?: { key: string; version: number };
  perPerson?: Record<string, Record<string, string>>;
}
export interface RevisionInput {
  selection: RevisionSelection;
  change: RevisionChange;
  effectiveFrom: string;
  reason?: "REVISION" | "CORRECTION";
  note?: string;
}

export interface PlanPerson {
  employeeId: string;
  employeeCode: string;
  name: string;
  rowReason: "JOINING" | "REVISION" | "CORRECTION";
  problems: string[];
  previous: { annualCtc: string; monthlyCtc: string; structure: string; startedOn: string } | null;
  next: { annualCtc: string; monthlyCtc: string; structure: string; lines: Array<{ component: string; type: ComponentType; amount: string }> } | null;
  differences: Array<{ component: string; old: string; next: string; difference: string }>;
  firstCycle: string;
  lockedCycles: string[];
  arrears: Array<{ cycle: string; cycleStart: string; cycleEnd: string; total: string; lines: Array<{ component: string; amount: string }> }>;
}
export interface RevisionPlanView {
  effectiveFrom: string;
  reason: string;
  blockers: string[];
  hash: string;
  people: PlanPerson[];
}
export interface RevisionPreview extends RevisionPlanView {
  skipped: Array<{ employeeId: string; name: string; reason: string }>;
  canSubmit: boolean;
  checkers: CheckerAvailability;
  fingerprint: string;
}

export type RevisionStatus = "DRAFT" | "WAITING_FOR_CHECKER" | "APPROVED" | "REJECTED" | "VOIDED" | "APPLIED" | "WITHDRAWN";
export interface RevisionListItem {
  id: string;
  status: RevisionStatus;
  effectiveFrom: string;
  reason: string;
  people: number;
  createdAt: string;
  createdBy: string;
  note: string;
}
export interface RevisionDetail {
  id: string;
  status: RevisionStatus;
  effectiveFrom: string;
  reason: string;
  note: string;
  createdAt: string;
  createdBy: string;
  createdByUserId: string;
  appliedAt: string | null;
  appliedBy: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  approval: { status: string; decidedBy: string | null; decisionNote: string | null; voidReason: string | null } | null;
  plan: RevisionPlanView;
  fingerprint: string;
  blockers: string[];
  checkers: CheckerAvailability | null;
  includesViewer: boolean;
}

export interface AdjustmentRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  componentCode: string;
  direction: "EARNING" | "DEDUCTION";
  amount: string;
  reason: string;
  source: "MANUAL" | "SALARY_ARREARS" | "IMPORT";
  periodStart: string | null;
  periodEnd: string | null;
  breakdown: unknown;
  status: "PENDING" | "CONSUMED" | "CANCELLED";
  createdAt: string;
  cancelReason: string | null;
}
export interface AdjustmentInput {
  employeeId: string;
  componentCode: string;
  direction: "EARNING" | "DEDUCTION";
  amount: string;
  reason: string;
}
export interface AdjustmentPreview {
  employeeId: string;
  employeeName: string;
  componentCode: string;
  componentName: string;
  direction: "EARNING" | "DEDUCTION";
  amount: string;
  reason: string;
  alreadyPending: Array<{ componentCode: string; direction: string; amount: string; reason: string }>;
  effect: string;
  fingerprint: string;
}

const get = async <T>(path: string, params?: object): Promise<T> => (await apiClient.get<T>(`${base}${path}`, { params })).data;
const post = async <T>(path: string, body?: object): Promise<T> => (await apiClient.post<T>(`${base}${path}`, body)).data;
const put = async <T>(path: string, body?: object): Promise<T> => (await apiClient.put<T>(`${base}${path}`, body)).data;

export const listComponents = async () => (await get<{ components: ComponentView[] }>("/components")).components;
export const getComponent = (code: string) => get<{ component: ComponentView; history: VersionView[] }>(`/components/${code}`);
export const previewComponentSave = (code: string, value: ComponentValue) => post<ComponentSavePreview>(`/components/${code}/save-preview`, { value });
export const saveComponent = (code: string, body: { value: ComponentValue; note: string; fingerprint: string }) => put<ComponentView>(`/components/${code}`, body);
export const previewComponentConfirm = (code: string) => post<ItemConfirmPreview<ComponentValue>>(`/components/${code}/confirm-preview`);
export const confirmComponent = (code: string, body: { version: number; note: string; fingerprint: string }) => post<ComponentView>(`/components/${code}/confirm`, body);

export const listStructures = async () => (await get<{ structures: StructureView[] }>("/structures")).structures;
export const getStructure = (code: string) => get<{ structure: StructureView; history: VersionView[] }>(`/structures/${code}`);
export const previewStructureSave = (code: string, value: StructureValue, sampleAnnualCtc: string) => post<StructureSavePreview>(`/structures/${code}/save-preview`, { value, sampleAnnualCtc });
export const saveStructure = (code: string, body: { value: StructureValue; sampleAnnualCtc: string; note: string; fingerprint: string }) => put<StructureView>(`/structures/${code}`, body);
export const previewStructureConfirm = (code: string) => post<StructureConfirmPreview>(`/structures/${code}/confirm-preview`);
export const confirmStructure = (code: string, body: { version: number; note: string; fingerprint: string }) => post<StructureView>(`/structures/${code}/confirm`, body);
export const previewBreakup = (value: StructureValue, annualCtc: string, perPerson?: Record<string, string>) => post<{ annualCtc: string; breakup: BreakupJson }>("/structures/breakup-preview", { value, annualCtc, perPerson });

export const listEmployeeSalaries = (params: { q?: string; missing?: boolean; page: number; pageSize: number }) =>
  get<{ total: number; items: EmployeeSalaryRow[] }>("/salary/employees", { ...params, missing: params.missing ? "true" : undefined });
export const getEmployeeSalary = (employeeId: string) =>
  get<{ employeeId: string; employeeCode: string; name: string; joinedOn: string; lastWorkingDate: string | null; history: SalaryRowView[]; pendingAdjustments: Array<{ id: string; componentCode: string; direction: string; amount: string; reason: string; source: string; periodStart: string | null; periodEnd: string | null }> }>(`/salary/employees/${employeeId}`);
export const searchPeople = async (q: string) => (await get<{ people: PersonHit[] }>("/salary/people", { q })).people;

export const listRevisions = (page: number, pageSize: number) => get<{ total: number; items: RevisionListItem[] }>("/salary/revisions", { page, pageSize });
export const getRevision = (id: string) => get<RevisionDetail>(`/salary/revisions/${id}`);
export const previewRevision = (input: RevisionInput) => post<RevisionPreview>("/salary/revisions/preview", { input });
export const createRevision = (input: RevisionInput, fingerprint: string) => post<{ id: string }>("/salary/revisions", { input, fingerprint });
export const submitRevision = (id: string, fingerprint: string) => post<{ id: string }>(`/salary/revisions/${id}/submit`, { fingerprint });
export const withdrawRevision = (id: string, reason: string) => post<{ ok: true }>(`/salary/revisions/${id}/withdraw`, { reason });
export const decideRevision = (id: string, body: { decision: "APPROVE" | "REJECT"; note?: string; fingerprint: string }) => post<{ status: string }>(`/salary/revisions/${id}/decision`, body);
export const applyRevision = (id: string) => post<{ id: string; applied: number }>(`/salary/revisions/${id}/apply`);

export const listAdjustments = (params: { employeeId?: string; status?: string; page: number; pageSize: number }) => get<{ total: number; items: AdjustmentRow[] }>("/adjustments", params);
export const previewAdjustment = (input: AdjustmentInput) => post<AdjustmentPreview>("/adjustments/preview", { input });
export const addAdjustment = (input: AdjustmentInput, fingerprint: string) => post<{ id: string }>("/adjustments", { input, fingerprint });
export const cancelAdjustment = (id: string, reason: string) => post<{ ok: true }>(`/adjustments/${id}/cancel`, { reason });
