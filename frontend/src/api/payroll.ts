import type { RuleShape } from "@shared/constants/payrollRules";
import { apiClient } from "./client";

// Payroll (Phase 6) — backend/src/modules/payroll. P6-1: Rules and setup, who can check, the Payroll audit trail.

export type RuleStatus = "NOT_SET" | "PLACEHOLDER" | "CONFIRMED";

export interface VersionView {
  version: number;
  value: unknown;
  valueHash: string;
  note: string;
  /** Where the number came from, in the author's words, and the date it applies from (a statutory rule has both). */
  sourceNote?: string;
  effectiveFrom?: string | null;
  authorUserId: string | null;
  authorName: string;
  createdAt: string;
  confirmation: { confirmedByUserId: string; confirmedByName: string; confirmedAt: string; note: string } | null;
}

export interface RuleView {
  key: string;
  /** An owner's secret (a company identifier): stored encrypted and never in this response; Reveal shows it to someone who may. */
  sealed: boolean;
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
  /** An unanswered question that stops this rule being Confirmed, when it applies to the value it has now. */
  openQuestion: { id: string; question: string } | null;
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
  state: "NONE" | "ONE" | "MANY" | "SELF";
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
  sourceNote?: string;
  effectiveFrom?: string | null;
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
export async function saveRule(key: string, body: { value: unknown; note: string; sourceNote?: string; effectiveFrom?: string; fingerprint: string }): Promise<RuleView> {
  return (await apiClient.put<RuleView>(`${base}/rules/${key}`, body)).data;
}
export async function revealRule(key: string): Promise<{ key: string; version: number; value: unknown }> {
  return (await apiClient.post(`${base}/rules/${key}/reveal`)).data;
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
export type HeadKind = "EARNING" | "DEDUCTION" | "ONE_OFF" | "REIMBURSEMENT" | "COUNTER" | "STATUTORY";
export type ItemStatus = RuleStatus;

export interface ComponentValue {
  name: string;
  type: ComponentType;
  /** null is "Not set": the head cannot be used until somebody chooses. */
  taxable: boolean | null;
  pfApplicable: boolean;
  esiApplicable: boolean;
  prorates: boolean;
  payslipLabel: string;
  payslipOrder: number;
  headKind?: HeadKind;
  oneTime?: boolean;
  carryForward?: boolean;
  reimbursement?: boolean;
  ctcGroup?: string;
  ytd?: boolean;
  bankTransfer?: boolean;
  payslipVisible?: boolean;
  activeFrom?: string;
  activeTo?: string;
  arrearsHead?: string;
  reversalHead?: string;
  inputItem?: boolean;
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
  | { method: "BALANCE" }
  | { method: "SLAB"; of: string; slabs: Array<{ from: string; to: string | null; amount: string }> };

export interface CalculationStep {
  component: string;
  step: number;
  dependsOn: string[];
}

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
/** Each line over twelve months, the total of the lines that count toward CTC, and its distance from the yearly CTC (the rounding), to show beside the monthly figures. */
export interface AnnualView {
  annualCtc: string;
  lines: Array<{ component: string; annual: string }>;
  total: string;
  difference: string;
}
export interface SampleResult {
  annualCtc: string;
  breakup: BreakupJson;
  annual: AnnualView;
}
export interface StructureSavePreview extends ItemSavePreview<StructureValue> {
  sample: SampleResult;
  unconfirmedComponents: string[];
  calculationOrder: CalculationStep[];
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
  kind: "CHANGE" | "CANCEL_SCHEDULED";
  status: RevisionStatus;
  effectiveFrom: string;
  reason: string;
  people: number;
  createdAt: string;
  createdBy: string;
  note: string;
}
/** Cancelling a salary row that has been written but has not started: the row that goes, and the salary that stays. */
export interface CancelPlanView {
  kind: "CANCEL_SCHEDULED";
  employeeId: string;
  employeeCode: string;
  name: string;
  problems: string[];
  hash: string;
  scheduled: { salaryId: string; startsOn: string; annualCtc: string; monthlyCtc: string; structure: string; lines: Array<{ component: string; amount: string }> } | null;
  stays: { salaryId: string; startsOn: string; startedOn: string; annualCtc: string; monthlyCtc: string; structure: string; lines: Array<{ component: string; amount: string }> } | null;
}
export interface CancelPreview extends CancelPlanView {
  blockers: string[];
  canSubmit: boolean;
  checkers: CheckerAvailability;
  fingerprint: string;
}
export interface RevisionDetail {
  id: string;
  kind: "CHANGE" | "CANCEL_SCHEDULED";
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
  plan: RevisionPlanView | CancelPlanView;
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
  source: "MANUAL" | "SALARY_ARREARS" | "IMPORT" | "YEAR_END_ENCASHMENT" | "LOP_REVERSAL";
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
export const previewBreakup = (value: StructureValue, annualCtc: string, perPerson?: Record<string, string>) => post<SampleResult>("/structures/breakup-preview", { value, annualCtc, perPerson });

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
export interface LopCorrectionInput {
  employeeId: string;
  cycleStart: string;
  correctionRef: string;
  days: Array<{ date: string; restored: string }>;
  reason: string;
  overrideReason?: string;
}
export interface LopCorrectionPreview {
  employeeName: string;
  cycleLabel: string;
  correctionRef: string;
  days: Array<{ date: string; restored: string; hadLop: string }>;
  lines: Array<{ component: string; amount: string; exact: string }>;
  net: string;
  lookbackMonths: number;
  monthsBack: number;
  needsOverride: boolean;
  overrideReason: string | null;
  effect: string;
  fingerprint: string;
}
export const previewLopCorrection = (input: LopCorrectionInput) => post<LopCorrectionPreview>("/lop-corrections/preview", { input });
export const addLopCorrection = (input: LopCorrectionInput, fingerprint: string) => post<{ id: string }>("/lop-corrections", { input, fingerprint });
export interface HoldRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  cycleStart: string;
  reason: string;
  heldAt: string;
  status: "HELD" | "RELEASED";
  releasedAt: string | null;
  releaseNote: string | null;
  runFinal: boolean;
}
export const listHolds = async (status?: "HELD" | "RELEASED") => (await get<{ holds: HoldRow[] }>("/holds", status ? { status } : undefined)).holds;
export const addHold = (input: { employeeId: string; cycleStart: string; reason: string }) => post<{ id: string }>("/holds", { input });
export const releaseHold = (id: string, note: string) => post<{ id: string; adjustmentId: string | null }>(`/holds/${id}/release`, { input: { note } });
export interface RuleOverrideView {
  itemKey: string;
  ruleKey: string;
  ruleLabel: string;
  level: "DEPARTMENT" | "EMPLOYEE";
  targetId: string;
  targetName: string;
  value: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  status: ItemStatus;
  sourceLabel: string | null;
  sourceNote: string;
  reason: string;
  registrationRef: string | null;
}
export interface RuleOverrideInput {
  ruleKey: string;
  level: "DEPARTMENT" | "EMPLOYEE";
  targetId: string;
  value: unknown;
  effectiveFrom: string;
  effectiveTo?: string | null;
  reason: string;
  sourceNote: string;
  registrationRef?: string | null;
}
export interface RuleOverridePreview {
  key: string;
  isNew: boolean;
  unchanged: boolean;
  willResetConfirmation: boolean;
  impact: string;
  fingerprint: string;
}
export interface RuleOverrideConfirmPreview {
  key: string;
  version: number;
  value: { ruleKey: string; level: string; targetId: string; value: unknown; effectiveFrom: string; effectiveTo: string | null; reason: string; registrationRef: string | null };
  authorName: string;
  sourceLabel: string | null;
  sourceNote: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}
export const listRuleOverrides = async () => (await get<{ overrides: RuleOverrideView[] }>("/rule-overrides")).overrides;
export const previewRuleOverride = (input: RuleOverrideInput) => post<RuleOverridePreview>("/rule-overrides/preview", { input });
export const saveRuleOverride = (input: RuleOverrideInput, fingerprint: string) => put<RuleOverrideView>("/rule-overrides", { input, fingerprint });
export const previewRuleOverrideConfirm = (key: string) => post<RuleOverrideConfirmPreview>(`/rule-overrides/${key}/confirm-preview`);
export const confirmRuleOverride = (key: string, body: { version: number; typedValue: unknown; note: string; fingerprint: string }) => post<{ ok: true }>(`/rule-overrides/${key}/confirm`, body);
export const cancelAdjustment = (id: string, reason: string) => post<{ ok: true }>(`/adjustments/${id}/cancel`, { reason });
export const previewCancelScheduled = (input: { employeeId: string; salaryId: string; note?: string }) => post<CancelPreview>("/salary/revisions/cancel-preview", { input });
export const createCancelScheduled = (input: { employeeId: string; salaryId: string; note?: string }, fingerprint: string) => post<{ id: string }>("/salary/revisions/cancel", { input, fingerprint });

// ── Payroll runs (P6-3): readiness, a run, its people, the difference from last month ──

export type RunStatus = "NEW" | "CALCULATING" | "CALCULATED" | "SUBMITTED" | "APPROVED" | "FAILED" | "VOID" | "FINALISED";
export interface RunSummary {
  id: string;
  cycle: { start: string; end: string; label: string };
  status: RunStatus;
  statusLabel: string;
  calcVersion: number;
  progress: { done: number; total: number };
  totals: { gross: string; deductions: string; net: string; employerCost: string };
  counts: { people: number; payable: number; held: number; excluded: number; exceptions: number };
  runHash: string | null;
  calculatedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  voidReason: string | null;
  finalisedAt: string | null;
  test?: boolean;
}
export interface RunRuleStatus {
  key: string;
  kind: "RULE" | "COMPONENT" | "STRUCTURE";
  version: number;
  label: string;
  status: "CONFIRMED" | "PLACEHOLDER";
  stale: boolean;
  notSet: boolean;
  frozen: boolean;
}
export interface RunDetail extends RunSummary {
  createdBy: string;
  calculatedBy: string | null;
  watermark: Watermark;
  rules: RunRuleStatus[];
  stale: boolean;
  notices: string[];
  /** People left out of this run because a director marked them as not on payroll (a different director confirmed it). */
  skipped?: Array<{ employeeId: string; employeeCode: string; name: string; reason: string }>;
  events: Array<{ type: string; at: string }>;
}
export interface PersonProblem {
  employeeId: string;
  name: string;
  days: number;
  firstDays: string[];
}
export interface RunReadiness {
  cycle: { start: string; end: string; label: string };
  cycleOver: boolean;
  paymentDate: string | null;
  people: number;
  attendance: { unfinalisedCount: number; unfinalised: PersonProblem[] };
  salary: { gapCount: number; gaps: PersonProblem[] };
  bank: { missingCount: number; missing: Array<{ employeeId: string; name: string }> };
  rules: { missing: Array<{ key: string; label: string }>; placeholders: Array<{ key: string; kind: string; label: string; notSet: boolean }> };
  adjustments: { pending: number; arrears: number; encashments: number; encashmentsPaidLater: number };
  existingRun: { id: string; status: RunStatus } | null;
  canCreate: boolean;
}
export type HoldReasonCode = "ATTENDANCE_NOT_FINAL" | "NO_SALARY" | "WORKING_DAYS_PART_MONTH" | "FINAL_SETTLEMENT" | "NEGATIVE_NET" | "ZERO_NET" | "NO_BANK_ACCOUNT";
export interface RunItemRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  isYou: boolean;
  status: "PAYABLE" | "HELD" | "EXCLUDED";
  holdReason: HoldReasonCode | null;
  holdDetail: string | null;
  paidDays: string;
  lopDays: string;
  gross: string;
  deductions: string;
  net: string;
  exceptions: number;
  blocking: boolean;
}
export interface RunLine {
  code: string;
  label: string;
  kind: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION" | "ROUNDING";
  source: string;
  sourceRef: string | null;
  amount: string;
  basis: Record<string, unknown>;
}
export interface RunItemDetail {
  employeeId: string;
  employeeCode: string;
  name: string;
  isYou: boolean;
  status: "PAYABLE" | "HELD" | "EXCLUDED";
  holdReason: HoldReasonCode | null;
  holdDetail: string | null;
  employedFrom: string | null;
  employedTo: string | null;
  days: { basis: string; lopDivisor: string; lop: string; paid: string };
  totals: { gross: string; deductions: string; employerContributions: string; netBeforeRounding: string; roundingAdjustment: string; net: string };
  employmentType: string;
  structure: { key: string; version: number } | null;
  inputs: {
    days?: { cycleDays: number; employedDays: number; notEmployedDays: number; basisDays: string; lopDivisorDays: string; lopDays: string; employedShare: string; lopShare: string; factor: string; payBasis: string; lopDivisor: string; lopByDay: Array<{ date: string; lop: string }> };
    segments?: Array<{ from: string; to: string; days: number; lop: string; factor: string; structure: string }>;
    state?: { text: string | null; key: string | null; onDay: string };
    missingDays?: string[];
    salaryGapDays?: string[];
  };
  notices: string[];
  exceptions: Array<{ code: string; severity: "BLOCKING" | "WARNING"; message: string }>;
  itemHash: string;
  lines: RunLine[];
}
export interface CalcPreview {
  fingerprint: string;
  first: boolean;
  status: RunStatus;
  cycle: string;
  people: number;
  unchanged: number;
  changedCount: number;
  removedCount: number;
  changes: Array<{ employeeId: string; name: string; change: "NEW" | "CHANGED"; netBefore: string | null; netAfter: string; netChange: string | null }>;
  totals: { gross: string; deductions: string; net: string; payable: number; held: number; excluded: number; exceptions: number };
  before: { gross: string; deductions: string; net: string } | null;
  watermark: Watermark;
  runNotices: string[];
  willVoidApproval: boolean;
}
export type VarianceTagCode = "JOINED" | "LEFT" | "SALARY_REVISED" | "LOP_CHANGED" | "ADJUSTMENT" | "ARREARS" | "ENCASHMENT" | "STATUTORY_CHANGE" | "HELD" | "NOT_CALCULATED" | "NOT_IN_THIS_RUN";
export interface Figures {
  gross: string;
  deductions: string;
  net: string;
}
export interface VarianceRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  status: string;
  current: Figures | null;
  previous: Figures | null;
  change: Figures | null;
  percent: string | null;
  tags: VarianceTagCode[];
  flagged: boolean;
}
export interface VarianceView {
  cycle: { start: string; end: string; label: string };
  baseline: { runId: string; status: RunStatus; final: boolean; cycleLabel: string } | null;
  thresholds: { percent: string | null; minAmount: string | null; set: boolean };
  totals: { current: Figures | null; previous: Figures | null; change: Figures | null };
  tagCounts: Record<string, number>;
  flaggedCount: number;
  total: number;
  items: VarianceRow[];
}

export const listRuns = (page: number, pageSize: number) => get<{ total: number; items: RunSummary[] }>("/runs", { page, pageSize });
export const getRunReadiness = (cycleStart: string) => get<RunReadiness>("/runs/readiness", { cycleStart });
export const createRun = (cycleStart: string) => post<{ id: string }>("/runs", { cycleStart });
export const getRun = (id: string) => get<RunDetail>(`/runs/${id}`);
export const listRunItems = (id: string, params: { status?: string; search?: string; exceptionsOnly?: boolean; page: number; pageSize: number }) =>
  get<{ total: number; items: RunItemRow[] }>(`/runs/${id}/items`, { ...params, exceptionsOnly: params.exceptionsOnly ? "true" : undefined });
export const getRunItem = (id: string, employeeId: string) => get<RunItemDetail>(`/runs/${id}/items/${employeeId}`);
export const getRunVariance = (id: string, params: { changedOnly: boolean; flaggedOnly: boolean; page: number; pageSize: number }) =>
  get<VarianceView>(`/runs/${id}/variance`, { ...params, changedOnly: String(params.changedOnly), flaggedOnly: String(params.flaggedOnly) });
export const previewCalculation = (id: string) => post<CalcPreview>(`/runs/${id}/calculate-preview`);
export const requestCalculation = (id: string, fingerprint: string) => post<{ id: string; resumed: boolean }>(`/runs/${id}/calculate`, { fingerprint });
export const voidRun = (id: string, reason: string) => post<{ ok: true }>(`/runs/${id}/void`, { reason });
export async function downloadRunWorkbook(id: string): Promise<void> {
  const res = await apiClient.get<Blob>(`${base}/runs/${id}/export`, { responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "payroll-register.xlsx";
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Submit, approve, finalise, unlock, publish, bank file (P6-4): one shape for every step ──

export type StepSlug = "run" | "finalise" | "unlock" | "publish" | "bank-file";
export interface Blocker {
  code: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}
export interface PersonNote {
  employeeId: string;
  employeeCode: string;
  name: string;
  code: string;
  reason: string;
  detail: string | null;
}
/** Someone in the run who will not get a payslip: held or not calculated, why, and what to do about it. */
export interface NoPayslipPerson {
  employeeId: string;
  employeeCode: string;
  name: string;
  kind: "HELD" | "EXCLUDED";
  reason: string | null;
  reasonLabel: string;
  detail: string | null;
  action: string;
}
export interface StepPreview {
  slug: StepSlug;
  subject: string;
  title: string;
  runId: string;
  cycle: { start: string; end: string; label: string };
  runStatus: RunStatus;
  runStatusLabel: string;
  blockers: Blocker[];
  canRequest: boolean;
  /** The submit preview of a run that is already waiting: shown to the checker, not offered for submission. */
  review?: boolean;
  checkers: CheckerAvailability;
  fingerprint: string;
  watermark: Watermark;
  totals: { gross: string; deductions: string; net: string; employerCost: string };
  counts: { people: number; payable: number; held: number; excluded: number; exceptions: number };
  leftOut?: PersonNote[];
  blockingExceptions?: PersonNote[];
  held?: PersonNote[];
  variance?: VarianceView;
  affected?: { people: number; payable: number; held: number; ownLine: { employeeId: string; name: string; net: string } | null; changes: Record<string, number> };
  approvedBy?: string | null;
  lock?: { from: string; to: string; refuses: string[] };
  adjustmentsMarkedPaid?: { count: number; bySource: Record<string, number> };
  allows?: string[];
  adjustmentsReturned?: number;
  rows?: number;
  rowsTotal?: string;
  // Publishing payslips (P6-5)
  payslips?: number;
  netTotal?: string;
  noPayslip?: NoPayslipPerson[];
  // The bank file (P6-5)
  paymentDate?: string | null;
  excluded?: Array<{ employeeId: string; employeeCode: string; name: string; reason: string; detail: string }>;
  people?: Array<{ employeeCode: string; name: string; bankName: string; accountLast4: string; ifsc: string; amount: string }>;
  willDo?: string[];
}
export interface ApprovalView {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "VOIDED" | "CONSUMED";
  hash: string;
  maker: { userId: string; name: string };
  submittedAt: string;
  note: string;
  checker: { userId: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  consumedAt: string | null;
}
export interface StepState {
  slug: StepSlug;
  subject: string;
  label: string;
  live: ApprovalView | null;
  last: ApprovalView | null;
  checkers: CheckerAvailability | null;
  you: { canMake: boolean; canDecide: boolean; isMaker: boolean; editedFigures: boolean };
}
export interface ApprovalState {
  runId: string;
  runStatus: RunStatus;
  runStatusLabel: string;
  cycle: string;
  steps: StepState[];
}
export interface WithdrawPreview {
  slug: StepSlug;
  runId: string;
  cycle: string;
  runStatus: RunStatus;
  willVoid: Array<{ approvalId: string; subject: string; status: string; maker: string; checker: string | null; decidedAt: string | null }>;
  runWill: string | null;
  fingerprint: string;
}

export const getApprovalState = (id: string) => get<ApprovalState>(`/runs/${id}/approvals`);
export const previewStep = (id: string, slug: StepSlug) => post<StepPreview>(`/runs/${id}/approvals/${slug}/preview`);
export const requestStep = (id: string, slug: StepSlug, body: { fingerprint: string; note?: string }) => post<{ approvalId: string; status: string; authority?: "SECOND_DIRECTOR" | "DIRECTOR_AUTHORITY"; runStatus: RunStatus }>(`/runs/${id}/approvals/${slug}/request`, body);
export const decideStep = (id: string, slug: StepSlug, body: { decision: "APPROVE" | "REJECT"; note?: string; hash?: string }) => post<{ approvalId: string; status: string }>(`/runs/${id}/approvals/${slug}/decision`, body);
export const previewWithdraw = (id: string, slug: StepSlug) => post<WithdrawPreview>(`/runs/${id}/approvals/${slug}/withdraw-preview`);
export const withdrawStep = (id: string, slug: StepSlug, body: { reason: string; fingerprint: string }) => post<{ ok: true; runStatus: RunStatus }>(`/runs/${id}/approvals/${slug}/withdraw`, body);
export const finaliseRun = (id: string) => post<{ id: string; status: "FINALISED"; lockedFrom: string; lockedTo: string; adjustmentsPaid: number }>(`/runs/${id}/finalise`);
export const unlockRun = (id: string) => post<{ id: string; status: "VOID"; adjustmentsReturned: number }>(`/runs/${id}/unlock`);


// ── P6-5: payslips, the bank file, statutory files, layouts ──

export async function publishPayslips(runId: string): Promise<{ runId: string; published: number }> {
  return (await apiClient.post(`${base}/runs/${runId}/payslips/publish`)).data;
}
export async function generateBankFile(runId: string): Promise<{ batchId: string; rows: number; total: string; excluded: number; fileName: string }> {
  return (await apiClient.post(`${base}/runs/${runId}/bank-file/generate`)).data;
}

export type EmailStatus = "SENT" | "FILE_ONLY" | "FAILED" | "PENDING";
export interface PayslipRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  net: string;
  publishedAt: string;
  pdfReady: boolean;
  delivery: { rendered: boolean; renderError: string | null; notified: boolean; emailStatus: EmailStatus; emailTo: string | null; emailError: string | null };
}
export async function listRunPayslips(runId: string): Promise<{ runId: string; cycle: string; noPayslip: NoPayslipPerson[]; payslips: PayslipRow[] }> {
  return (await apiClient.get(`${base}/runs/${runId}/payslips`)).data;
}
export async function preparePayslipsAgain(runId: string): Promise<{ queued: boolean }> {
  return (await apiClient.post(`${base}/runs/${runId}/payslips/prepare-again`)).data;
}

export interface PayslipLine {
  code: string;
  label: string;
  amount: string;
}
export interface PayslipContent {
  version: 1;
  company: { legalName: string; address: string };
  period: { label: string; start: string; end: string };
  employee: { code: string; name: string; dateOfJoining: string; department: string; designation: string; location: string };
  days: { paid: string; lop: string; basis: string };
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  rounding: string | null;
  totals: { gross: string; deductions: string; net: string; employerContributions: string };
  netInWords: string;
  bank: { bankName: string; accountLast4: string } | null;
  // esiNumber: payslips published before P7-0 stored the whole ESI number; they are immutable, so the screen shows only its last four.
  statutory: { panLast4: string | null; uanLast4: string | null; esiLast4?: string | null; esiNumber?: string | null };
  runHash: string;
}
export interface PayslipSummary {
  id: string;
  cycleLabel: string;
  cycleStart: string;
  cycleEnd: string;
  net: string;
  netInWords: string;
  publishedAt: string;
  pdfReady: boolean;
}
export async function getPayslip(id: string): Promise<PayslipSummary & { content: PayslipContent }> {
  return (await apiClient.get(`${base}/payslips/${id}`)).data;
}
export type PdfLink = { ready: true; url: string; expiresInSeconds: number } | { ready: false; message: string };
export async function getPayslipPdf(id: string): Promise<PdfLink> {
  return (await apiClient.get(`${base}/payslips/${id}/pdf`)).data;
}
export async function previewPayslip(runId: string, employeeId: string): Promise<{ content: PayslipContent; watermark: string | null }> {
  return (await apiClient.get(`${base}/runs/${runId}/items/${employeeId}/payslip-preview`)).data;
}

export interface BankBatchView {
  id: string;
  runId: string;
  cycle: string;
  status: "GENERATED" | "PAID";
  paymentDate: string;
  rowCount: number;
  total: string;
  excluded: Array<{ employeeId: string; employeeCode: string; name: string; reason: string; detail: string }>;
  fileName: string;
  fileSha256: string;
  generatedAt: string;
  paid: { at: string | null; on: string | null; reference: string | null } | null;
  response: { fileName: string | null; sha256: string | null; attachedAt: string | null } | null;
}
export interface BankBatchDetail extends BankBatchView {
  rows: Array<{ serial: number; employeeCode: string; name: string; accountLast4: string; ifsc: string; amount: string; narration: string }>;
}
export async function getBankBatchForRun(runId: string): Promise<{ batch: BankBatchView | null }> {
  return (await apiClient.get(`${base}/runs/${runId}/bank-batch`)).data;
}
export async function getBankBatch(id: string): Promise<BankBatchDetail> {
  return (await apiClient.get(`${base}/bank-batches/${id}`)).data;
}
export async function bankBatchFileLink(id: string): Promise<{ url: string; fileName: string; sha256: string; expiresInSeconds: number }> {
  return (await apiClient.get(`${base}/bank-batches/${id}/file`)).data;
}
export async function markBatchPaid(id: string, body: { reference: string; paidOn: string; confirm: string }): Promise<BankBatchDetail> {
  return (await apiClient.post(`${base}/bank-batches/${id}/mark-paid`, body)).data;
}
export async function attachBatchResponse(id: string, file: File): Promise<BankBatchDetail> {
  const form = new FormData();
  form.append("file", file);
  return (await apiClient.post(`${base}/bank-batches/${id}/response`, form)).data;
}

export type OutputKind = "PF_ECR" | "ESI" | "PT" | "LWF" | "SALARY_REGISTER";
export interface OutputRow {
  id: string;
  kind: OutputKind;
  rows: number;
  fileName: string;
  sha256: string;
  generatedAt: string;
  templateVersion: number | null;
}
export async function listOutputs(runId: string): Promise<{ outputs: OutputRow[]; layouts: Array<{ kind: OutputKind; ready: boolean; status: RuleStatus }> }> {
  return (await apiClient.get(`${base}/runs/${runId}/outputs`)).data;
}
export async function generateOutput(runId: string, kind: OutputKind): Promise<OutputRow> {
  return (await apiClient.post(`${base}/runs/${runId}/outputs`, { kind })).data;
}
export async function outputFileLink(id: string): Promise<{ url: string; fileName: string; sha256: string; expiresInSeconds: number }> {
  return (await apiClient.get(`${base}/outputs/${id}/file`)).data;
}

export type LayoutKey = "BANK_TEMPLATE" | "PF_ECR" | "ESI" | "PT" | "LWF";
export interface LayoutView {
  key: LayoutKey;
  label: string;
  description: string;
  whoConfirms: string;
  layoutKind: "BANK" | "PF_ECR" | "ESI" | "PT" | "LWF";
  fields: Array<{ name: string; description: string; isAmount: boolean; isDate: boolean }>;
  tokens: string[];
  status: RuleStatus;
  sourceLabel: string | null;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
}
export interface LayoutColumn {
  header?: string;
  source: "FIELD" | "CONSTANT" | "PATTERN";
  value: string;
  width?: number;
  align?: "LEFT" | "RIGHT";
  pad?: string;
  numeric?: boolean;
}
export interface LayoutValue {
  format: "DELIMITED" | "FIXED_WIDTH" | "XLSX";
  delimiter?: string;
  quote?: boolean;
  lineEnding?: "LF" | "CRLF";
  extension: string;
  dateFormat?: string;
  amountDecimals?: number;
  header?: LayoutColumn[][];
  trailer?: LayoutColumn[][];
  columnHeaders?: boolean;
  columns: LayoutColumn[];
  narrationPattern?: string;
  hasDebitAccount?: boolean;
  debitAccountLast4?: string;
  /** Sent only when the account is being entered or changed. */
  debitAccountNumber?: string;
}
export async function listLayouts(): Promise<LayoutView[]> {
  return (await apiClient.get(`${base}/layouts`)).data.layouts;
}
export async function getLayout(key: LayoutKey): Promise<{ layout: LayoutView; history: VersionView[] }> {
  return (await apiClient.get(`${base}/layouts/${key}`)).data;
}
export interface LayoutSavePreview {
  key: LayoutKey;
  isNew: boolean;
  before: { version: number; value: LayoutValue; status: RuleStatus } | null;
  after: { value: LayoutValue };
  unchanged: boolean;
  willResetConfirmation: boolean;
  fingerprint: string;
}
export async function previewLayoutSave(key: LayoutKey, value: LayoutValue): Promise<LayoutSavePreview> {
  return (await apiClient.post(`${base}/layouts/${key}/save-preview`, { value })).data;
}
export async function saveLayout(key: LayoutKey, body: { value: LayoutValue; note?: string; fingerprint: string }): Promise<LayoutView> {
  return (await apiClient.put(`${base}/layouts/${key}`, body)).data;
}
export interface LayoutConfirmPreview {
  key: LayoutKey;
  version: number;
  value: LayoutValue;
  valueHash: string;
  sourceLabel: string | null;
  authorName: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}
export async function previewLayoutConfirm(key: LayoutKey): Promise<LayoutConfirmPreview> {
  return (await apiClient.post(`${base}/layouts/${key}/confirm-preview`)).data;
}
export async function confirmLayout(key: LayoutKey, body: { version: number; note: string; fingerprint: string }): Promise<LayoutView> {
  return (await apiClient.post(`${base}/layouts/${key}/confirm`, body)).data;
}

// ── An employee's own payslips ──
export async function myPayslips(): Promise<{ payslips: PayslipSummary[] }> {
  return (await apiClient.get("/api/payslips/mine")).data;
}
export async function myPayslip(id: string): Promise<PayslipSummary & { content: PayslipContent }> {
  return (await apiClient.get(`/api/payslips/mine/${id}`)).data;
}
export interface WhyRule {
  key: string;
  label: string;
  value: unknown;
  version: number;
  status: "CONFIRMED" | "PLACEHOLDER" | "NOT_SET";
  sourceNote: string | null;
  effectiveFrom: string | null;
  enteredBy: string | null;
  confirmedBy: string | null;
  confirmedOn: string | null;
  level: "COMPANY" | "DEPARTMENT" | "EMPLOYEE";
  overridden: boolean;
  registrationRef: string | null;
}
export interface WhyLine {
  code: string;
  label: string;
  kind: string;
  source: string;
  amount: string;
  explanation: string[];
  working: Array<{ name: string; value: string }>;
  rules: WhyRule[];
}
export interface PayslipWhy {
  payslipId: string;
  cycleLabel: string;
  lines: WhyLine[];
}
export async function myPayslipWhy(id: string): Promise<PayslipWhy> {
  return (await apiClient.get(`/api/payslips/mine/${id}/why`)).data;
}
export async function getPayslipWhy(id: string): Promise<PayslipWhy> {
  return (await apiClient.get(`${base}/payslips/${id}/why`)).data;
}
export async function myPayslipPdf(id: string): Promise<PdfLink> {
  return (await apiClient.get(`/api/payslips/mine/${id}/pdf`)).data;
}

// ── The Setup Checklist and "Ready for first real run" (P6-6) ──

export type SetupStatus = "NOT_SET" | "PLACEHOLDER" | "CONFIRMED";
export type SetupArea = "SALARIES" | "BANK_ACCOUNTS" | "STATUTORY_IDS";
export interface SetupItem {
  id: string;
  section: string;
  category?: string;
  title: string;
  why: string;
  required: boolean;
  notRequiredReason?: string;
  status: SetupStatus;
  enteredBy: { name: string; at: string } | null;
  confirmedBy: { name: string; at: string } | null;
  detail: string;
  where: { label: string; path: string };
  permissionNote?: string;
  problem?: string;
  coverage?: { covered: number; total: number; missing: Array<{ employeeId: string; code: string; name: string }> };
  signoffArea?: SetupArea;
  question?: string;
}
export interface SetupSection {
  id: string;
  title: string;
  intro: string;
  items: SetupItem[];
}
export interface Readiness {
  ready: boolean;
  demo: boolean;
  generatedAt: string;
  required: number;
  confirmed: number;
  blockers: Array<{ itemId: string; section: string; sectionTitle: string; title: string; status: SetupStatus; missing: string; where: { label: string; path: string } }>;
  /** Prominent, non-blocking: they never turn Ready red. */
  warnings?: Array<{ itemId: string; title: string; warning: string; where: { label: string; path: string } }>;
  notRequiredYet: Array<{ itemId: string; title: string; status: SetupStatus; reason: string }>;
}
export interface SetupReport {
  generatedAt: string;
  environment: string;
  demo: boolean;
  sections: SetupSection[];
  readiness: Readiness;
}
export interface AccessHolder {
  userId: string;
  name: string;
  employeeCode: string;
  roles: string[];
  via: string[];
  isDeveloper: boolean;
}
export interface AccessReport {
  classes: Array<{ id: string; label: string; what: string; view: AccessHolder[]; edit: AccessHolder[]; confirm: AccessHolder[] }>;
  developers: Array<{ userId: string; name: string; employeeCode: string; holdsAnySecret: boolean; isSuperAdmin: boolean }>;
}
export interface SignoffPreview {
  area: SetupArea;
  label: string;
  covered: number;
  total: number;
  missing: Array<{ employeeId: string; code: string; name: string }>;
  enteredBy: string[];
  blocked: string | null;
  fingerprint: string;
}
export async function getSetup(): Promise<SetupReport> {
  return (await apiClient.get(`${base}/setup`)).data;
}
export async function getReadiness(): Promise<Readiness> {
  return (await apiClient.get(`${base}/setup/ready`)).data;
}
export async function getAccessReport(): Promise<AccessReport> {
  return (await apiClient.get(`${base}/setup/access`)).data;
}
export async function previewSignoff(area: SetupArea): Promise<SignoffPreview> {
  return (await apiClient.post(`${base}/setup/signoffs/${area}/preview`)).data;
}
export async function giveSignoff(area: SetupArea, body: { fingerprint: string; note: string }): Promise<{ id: string }> {
  return (await apiClient.post(`${base}/setup/signoffs/${area}`, body)).data;
}

// ── Comparing two registers (P6-6) ──

export type RegisterSource = "OWN" | "GENERIC" | "GREYTHR";
export interface CompareDifference {
  label: string;
  a: string | null;
  b: string | null;
  difference: string;
  percent: string | null;
  flagged: boolean;
}
export interface CompareResult {
  a: { label: string; people: number; columns: string[]; ignoredColumns: string[] };
  b: { label: string; people: number; columns: string[]; ignoredColumns: string[] };
  options: { toleranceAmount: string; tolerancePercent: string };
  summary: { matchedPeople: number; identical: number; differing: number; flagged: number; onlyInA: number; onlyInB: number };
  people: Array<{ code: string; name: string | null; flagged: boolean; differences: CompareDifference[] }>;
  onlyInA: Array<{ code: string; name: string | null }>;
  onlyInB: Array<{ code: string; name: string | null }>;
  columns: { matched: string[]; onlyInA: string[]; onlyInB: string[] };
  totals: Array<{ label: string; a: string; b: string; difference: string }>;
}
export interface CompareForm {
  a: File;
  b: File;
  labelA: string;
  labelB: string;
  sourceA: RegisterSource;
  sourceB: RegisterSource;
  toleranceAmount: string;
  tolerancePercent: string;
  aliases: Record<string, string>;
}
function compareBody(f: CompareForm, format: "json" | "xlsx"): FormData {
  const body = new FormData();
  body.append("a", f.a);
  body.append("b", f.b);
  for (const k of ["labelA", "labelB", "sourceA", "sourceB", "toleranceAmount", "tolerancePercent"] as const) body.append(k, f[k]);
  body.append("aliases", JSON.stringify(f.aliases));
  body.append("format", format);
  return body;
}
export async function compareRegisters(f: CompareForm): Promise<CompareResult> {
  return (await apiClient.post(`${base}/compare`, compareBody(f, "json"))).data;
}
export async function downloadComparison(f: CompareForm): Promise<Blob> {
  return (await apiClient.post(`${base}/compare`, compareBody(f, "xlsx"), { responseType: "blob" })).data as Blob;
}

// ── Stage 4: Monthly Inputs (directors only) ──

export type MonthState = "CLOSED" | "OPEN" | "CONFIRMED" | "LOCKED";
export interface InputHead {
  code: string;
  name: string;
  type: "EARNING" | "DEDUCTION";
  version: number;
}
export interface MonthView {
  cycleStart: string;
  cycleEnd: string;
  label: string;
  state: MonthState;
  reason: string | null;
  heads: InputHead[];
  people: number;
  cells: number;
  entered: number;
  blank: number;
  peopleWithBlanks: number;
  confirmation: { status: "NONE" | "PENDING" | "CONFIRMED" | "OUT_OF_DATE"; approvalId: string | null; makerName: string | null; checkerName: string | null; at: string | null; authority: string | null };
  hash: string;
}
export interface InputGridRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  cells: Array<{ head: string; amount: string | null; entries: number; lastAt: string | null }>;
}
export interface InputGridQuery {
  cycleStart: string;
  departmentId?: string;
  employeeId?: string;
  head?: string;
  status?: "NOT_ENTERED" | "ENTERED" | "CHANGED";
  page: number;
  pageSize: number;
}
export interface InputHistoryEntry {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  head: string;
  amount: string | null;
  cleared: boolean;
  reason: string;
  by: string;
  at: string;
  fromFile: boolean;
}
export interface InputConfirmPreview {
  month: MonthView;
  fingerprint: string;
  mode: "SECOND_DIRECTOR" | "DIRECTOR_AUTHORITY" | "NOT_SET";
  checkers: CheckerAvailability;
  warnings: string[];
}
export interface ImportRow {
  line: number;
  employeeNumber: string;
  employeeId: string | null;
  name: string | null;
  from: string | null;
  till: string | null;
  months: string[];
  figures: Record<string, string>;
  principal: string | null;
  interest: string | null;
  remarks: string;
  problems: string[];
}
export interface ImportView {
  id: string;
  fileName: string;
  fileHash: string;
  status: "PREVIEW" | "APPLIED" | "DISCARDED";
  analysis: {
    columns: Array<{ header: string; kind: "FIXED" | "HEAD" | "IGNORED_EMPTY" | "UNKNOWN"; head?: string }>;
    fileProblems: string[];
    rows: ImportRow[];
    valid: number;
    invalid: number;
    cells: number;
    months: string[];
    notices: string[];
  };
  alreadyApplied: { batchId: string; at: string } | null;
  fingerprint: string;
  canApply: boolean;
  canApplySkippingInvalid: boolean;
}
export interface ImportListRow {
  id: string;
  fileName: string;
  status: string;
  summary: { rows?: number; valid?: number; invalid?: number; cells?: number };
  createdAt: string;
  appliedAt: string | null;
}

const mi = "/monthly-inputs";
export const inputMonths = async () => (await get<{ months: Array<{ cycleStart: string; cycleEnd: string; label: string }> }>(`${mi}/months`)).months;
export const inputMonth = (cycleStart: string) => get<MonthView>(`${mi}/month`, { cycleStart });
export const inputGrid = (q: InputGridQuery) => get<{ month: MonthView; rows: InputGridRow[]; total: number; page: number; pageSize: number }>(mi, q);
export const inputHistory = async (q: { cycleStart: string; employeeId?: string; head?: string }) => (await get<{ entries: InputHistoryEntry[] }>(`${mi}/history`, q)).entries;
export const enterInputs = (body: { cycleStart: string; entries: Array<{ employeeId: string; head: string; amount: string | null }>; reason: string }) => post<{ written: number; voidedConfirmation: boolean }>(`${mi}/entries`, body);
export const fillInputBlanks = (body: { cycleStart: string; head?: string; reason: string }) => post<{ written: number; voidedConfirmation: boolean }>(`${mi}/fill-blanks`, body);
export const previewInputConfirmation = (cycleStart: string) => post<InputConfirmPreview>(`${mi}/confirm-preview`, { cycleStart });
export const requestInputConfirmation = (body: { cycleStart: string; fingerprint: string; note?: string }) => post<{ status: string; authority: string }>(`${mi}/confirm`, body);
export const decideInputConfirmation = (cycleStart: string, body: { decision: "APPROVE" | "REJECT"; fingerprint: string; note?: string }) => post<{ status: string }>(`${mi}/decision/${cycleStart}`, body);
export const listImports = async () => (await get<{ batches: ImportListRow[] }>(`${mi}/import`)).batches;
export const getImport = (id: string) => get<ImportView>(`${mi}/import/${id}`);
export async function uploadImport(file: File): Promise<ImportView> {
  const form = new FormData();
  form.append("file", file);
  return (await apiClient.post<ImportView>(`${base}${mi}/import`, form)).data;
}
export const applyImport = (id: string, body: { fingerprint: string; skipInvalid: boolean; reason: string }) => post<{ written: number; skippedRows: number; months: string[] }>(`${mi}/import/${id}/apply`, body);
export const discardImport = (id: string) => post<{ ok: true }>(`${mi}/import/${id}/discard`, {});
export async function downloadImportTemplate(format: "xlsx" | "csv"): Promise<void> {
  const res = await apiClient.get<Blob>(`${base}${mi}/import/template`, { params: { format }, responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `monthly-inputs-template.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Stage 5b: rows the bank rejected, and paying them again ──
export interface BankRejectionRow {
  rowId: string;
  serial: number;
  employeeCode: string;
  name: string;
  accountLast4: string;
  amount: string;
  reason: string;
  source: "ENTERED" | "RETURN_FILE";
  at: string;
  repaidInBatch: string | null;
}
export interface RepaymentPlanView {
  id: string;
  batchId: string;
  cycle: string;
  paymentDate: string;
  rows: Array<{ serial: number; employeeCode: string; name: string; accountLast4: string; ifsc: string; amount: string }>;
  excluded: Array<{ sourceRowId: string; employeeCode: string; reason: string }>;
  total: string;
  layoutReady: boolean;
  hash: string;
  generated: string | null;
  approval: { status: string; authority: string } | null;
  checkers: CheckerAvailability;
}
export const bankRejections = (batchId: string) => get<{ batchId: string; cycle: string; rows: BankRejectionRow[] }>(`/bank-batches/${batchId}/rejections`);
export const recordBankRejections = (batchId: string, rows: Array<{ employeeCode: string; reason: string }>) => post<{ recorded: number; alreadyRecorded: number }>(`/bank-batches/${batchId}/rejections`, { rows });
export async function importBankReturn(batchId: string, file: File): Promise<{ rows: number; rejected: number; alreadyRecorded: number }> {
  const form = new FormData();
  form.append("file", file);
  return (await apiClient.post(`${base}/bank-batches/${batchId}/rejections/import`, form)).data;
}
export const planRepayment = (batchId: string, paymentDate: string, rowIds?: string[]) => post<RepaymentPlanView>(`/bank-batches/${batchId}/repayment-plans`, { paymentDate, ...(rowIds ? { rowIds } : {}) });
export const getRepaymentPlan = (id: string) => get<RepaymentPlanView>(`/repayment-plans/${id}`);
export const requestRepayment = (id: string, hash: string, note?: string) => post<{ status: string }>(`/repayment-plans/${id}/request`, { hash, ...(note ? { note } : {}) });
export const decideRepayment = (id: string, decision: "APPROVE" | "REJECT", hash: string, note?: string) => post<{ status: string }>(`/repayment-plans/${id}/decision`, { decision, hash, ...(note ? { note } : {}) });
export const generateRepayment = (id: string) => post<{ batchId: string; rows: number; total: string; fileName: string }>(`/repayment-plans/${id}/generate`);
export const repaymentFileLink = (batchId: string) => get<{ url: string; fileName: string }>(`/repayment-batches/${batchId}/file`);

// ── Stage 5b, B4/B5: payslip links, the link settings, and a query on a payslip ──
export const openPayslipLink = async (token: string) => (await apiClient.post<{ payslipId: string }>("/api/payslips/mine/links/open", { token })).data;
export const payslipLinkSettings = () => get<{ expiryDays: number | null; passwordProtectedPdf: { enabled: false; status: "NEEDS_OWNER_APPROVAL" } }>("/payslip-link-settings");
export const savePayslipLinkSettings = async (expiryDays: number | null) => (await apiClient.put(`${base}/payslip-link-settings`, { expiryDays })).data as { expiryDays: number | null };
export const revokePayslipLinks = (runId: string) => post<{ revoked: number }>(`/runs/${runId}/payslip-links/revoke`);
export const raisePayslipQuery = async (payslipId: string, message: string) => (await apiClient.post<{ ticketId: string; number: number }>(`/api/payslips/mine/${payslipId}/query`, { message })).data;

// ── Stage 5b, B6: not on payroll ──
export interface ExclusionRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  kind: "EXCLUDE" | "INCLUDE";
  fromDate: string;
  toDate: string | null;
  reason: string;
  madeBy: string;
  confirmed: boolean;
  confirmedAt: string | null;
  createdAt: string;
}
export interface SkippedPerson {
  employeeId: string;
  employeeCode: string;
  name: string;
  reason: string;
}
export const listExclusions = async () => (await get<{ exclusions: ExclusionRow[] }>("/exclusions")).exclusions;
export const addExclusion = (body: { employeeId: string; kind: "EXCLUDE" | "INCLUDE"; fromDate: string; toDate?: string | null; reason: string }) => post<{ id: string }>("/exclusions", body);
export const confirmExclusion = (id: string) => post<{ id: string }>(`/exclusions/${id}/confirm`);
