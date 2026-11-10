import { apiClient } from "./client";

// Tax: the person's own declaration, proofs and IT statement, and the directors' tax years, windows and proof queue (docs/plans/STAGE_7_PLAN.md).
const base = "/api/tax";
const get = async <T>(path: string, params?: object): Promise<T> => (await apiClient.get<T>(`${base}${path}`, { params })).data;
const post = async <T>(path: string, body?: object): Promise<T> => (await apiClient.post<T>(`${base}${path}`, body)).data;
const put = async <T>(path: string, body?: object): Promise<T> => (await apiClient.put<T>(`${base}${path}`, body)).data;

export type Regime = "NEW" | "OLD";
export interface WindowView {
  kind: "DECLARATION" | "PROOF";
  state: "NOT_SET" | "NOT_OPEN_YET" | "OPEN" | "CLOSED";
  opensOn: string | null;
  closesOn: string | null;
}
export interface SectionWorking { code: string; label: string; requested: string; counted: string; why: string }
export interface EngineResult {
  regime: Regime;
  taxablePay: string;
  standardDeduction: string;
  sections: SectionWorking[];
  sectionsTotal: string;
  taxableIncome: string;
  slabTax: string;
  rebate: string;
  surchargeRate: string;
  surcharge: string;
  cessPercent: string;
  cess: string;
  beforeRounding: string;
  annualTax: string;
  notModelled: string[];
}
export interface RegimeComparison {
  available: boolean;
  missing: string[];
  draft: boolean;
  basis: "DECLARED" | "VERIFIED";
  taxablePay: string | null;
  results: Partial<Record<Regime, EngineResult>>;
  chosen: Regime | null;
  defaultRegime: Regime | null;
}
export interface ProofView {
  id: string;
  section: string;
  fileName: string;
  uploadedAt: string;
  decision: null | { decision: "ACCEPTED" | "REJECTED"; amountVerified: string | null; reason: string; at: string };
}
export interface SectionDef { code: string; label: string; appliesTo: "OLD" | "NEW" | "BOTH"; cap: string | null; proofRequired: boolean }
export interface MyTax {
  year: string;
  windows: { declaration: WindowView; proof: WindowView };
  sections: SectionDef[];
  sectionsConfirmed: boolean;
  declaration: null | { version: number; regime: Regime; submittedAt: string; lines: Array<{ section: string; amount: string }> };
  proofs: ProofView[];
  comparison: RegimeComparison;
}
export const myTax = (fy?: string) => get<MyTax>("/me", fy ? { fy } : undefined);
export const saveMyDeclaration = (body: { fy: string; regime: Regime; lines: Array<{ section: string; amount: string }> }) => put<MyTax>("/me/declaration", body);
export async function uploadMyProof(fy: string, section: string, file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.append("fy", fy);
  form.append("section", section);
  form.append("file", file);
  return (await apiClient.post(`${base}/me/proofs`, form)).data;
}
export const myProofLink = (id: string) => get<{ url: string; fileName: string }>(`/me/proofs/${id}/file`);

export interface Statement {
  year: string;
  employeeCode: string;
  draft: boolean;
  watermark: string | null;
  chosenRegime: Regime | null;
  defaultRegime: Regime | null;
  available: boolean;
  missing: string[];
  basis: "DECLARED" | "VERIFIED";
  taxablePayProjected: string | null;
  regimes: Partial<Record<Regime, EngineResult>>;
  paidSoFar: { taxable: string; tds: string; months: Array<{ month: string; kind: "PAID"; taxablePay: string; tds: string }> };
  toCome: null | { monthsLeft: number; remaining: string; perMonth: string };
  note: string;
}
export const myStatement = (fy?: string) => get<Statement>("/me/statement", fy ? { fy } : undefined);

// Directors
export interface VersionView { version: number; sourceNote: string; effectiveFrom: string | null; authorName: string; createdAt: string; confirmation: null | { confirmedByName: string; confirmedAt: string } }
export interface TaxYearView {
  year: string;
  start: string;
  end: string;
  value: Record<string, unknown> | null;
  status: "NOT_SET" | "PLACEHOLDER" | "CONFIRMED";
  sourceLabel: string | null;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
  missing: string[];
}
export const taxYears = () => get<{ years: TaxYearView[] }>("/years");
export const taxYear = (fy: string) => get<{ year: TaxYearView; history: VersionView[] }>(`/years/${fy}`);
export const previewTaxYear = (fy: string, value: unknown) => post<{ fingerprint: string; missing: string[]; unchanged: boolean; willResetConfirmation: boolean }>(`/years/${fy}/save-preview`, { value });
export const saveTaxYear = (fy: string, value: unknown, fingerprint: string, note?: string) => put<TaxYearView>(`/years/${fy}`, { value, fingerprint, ...(note ? { note } : {}) });
export const previewTaxYearConfirm = (fy: string) => post<{ version: number; fingerprint: string; blocked: string | null }>(`/years/${fy}/confirm-preview`);
export const confirmTaxYear = (fy: string, body: { version: number; note: string; fingerprint: string }) => post<TaxYearView>(`/years/${fy}/confirm`, body);

export const windows = (fy: string) => get<{ year: string; declaration: WindowView; proof: WindowView }>("/windows", { fy });
export const setWindow = (body: { fy: string; kind: "DECLARATION" | "PROOF"; opensOn: string; closesOn: string }) => put<WindowView>("/windows", body);
export interface DeclarationRow { employeeCode: string; name: string; version: number; regime: Regime; total: string; lines: number; submittedAt: string }
export const declarations = (fy: string) => get<{ year: string; declarations: DeclarationRow[] }>("/declarations", { fy });
export interface QueueProof { id: string; employeeCode: string; name: string; section: string; declared: string; fileName: string; uploadedAt: string; decision: null | { decision: "ACCEPTED" | "REJECTED"; amountVerified: string | null; reason: string } }
export const proofQueue = (fy: string) => get<{ year: string; proofs: QueueProof[] }>("/proofs", { fy });
export const decideProof = (id: string, body: { decision: "ACCEPTED" | "REJECTED"; amountVerified?: string; reason?: string }) => post<{ id: string; decision: string }>(`/proofs/${id}/decision`, body);
export const proofLink = (id: string) => get<{ url: string; fileName: string }>(`/proofs/${id}/file`);

// A-3: opening figures (directors only).
export type OpeningKind = "GO_LIVE" | "PREVIOUS_EMPLOYER";
export interface OpeningRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  kind: OpeningKind;
  kindLabel: string;
  taxable: string;
  tds: string;
  sourceNote: string;
  enteredAt: string;
}
export interface OpeningsView {
  year: string;
  state: "NOT_CONFIRMED" | "WAITING" | "CONFIRMED";
  waiting: { makerUserId: string; mine: boolean } | null;
  fingerprint: string;
  totals: { people: number; taxable: string; tds: string };
  rows: OpeningRow[];
}
export interface OpeningsImportPreview {
  year: string;
  fileName: string;
  fingerprint: string;
  valid: number;
  rows: Array<{ line: number; employeeCode: string; kind: string; taxable: string; tds: string; note: string; problem: string | null }>;
}
export const openings = (fy: string) => get<OpeningsView>("/openings", { fy });
export const enterOpening = (body: { year: string; employeeId: string; kind: OpeningKind; clear?: boolean; taxable?: string; tds?: string; sourceNote: string }) => post<{ written: number; voidedConfirmation: boolean }>("/openings", body);
export async function previewOpeningsImport(fy: string, file: File): Promise<OpeningsImportPreview> {
  const form = new FormData();
  form.append("fy", fy);
  form.append("file", file);
  return (await apiClient.post(`${base}/openings/import/preview`, form)).data;
}
export async function applyOpeningsImport(fy: string, file: File, fingerprint: string, reason: string): Promise<{ written: number }> {
  const form = new FormData();
  form.append("fy", fy);
  form.append("fingerprint", fingerprint);
  form.append("reason", reason);
  form.append("file", file);
  return (await apiClient.post(`${base}/openings/import/apply`, form)).data;
}
export const openingsTemplate = async () => (await apiClient.get(`${base}/openings/template`, { responseType: "blob" })).data as Blob;
export const requestOpeningsConfirmation = (year: string, fingerprint: string) => post("/openings/confirm", { year, fingerprint });
export const decideOpenings = (year: string, fingerprint: string, decision: "APPROVE" | "REJECT", note?: string) => post(`/openings/${year}/decision`, { fingerprint, decision, ...(note ? { note } : {}) });

// P7-3: the person's own year-to-date report and salary revisions.
export interface YtdReport {
  year: string;
  months: Array<{ end: string; label: string }>;
  earnings: Array<{ code: string; label: string; kind: string; byMonth: Record<string, string>; total: string }>;
  deductions: Array<{ code: string; label: string; kind: string; byMonth: Record<string, string>; total: string }>;
  totals: { earnings: string; deductions: string };
  note: string;
}
export const myYtd = (fy?: string) => get<YtdReport>("/me/ytd", fy ? { fy } : undefined);
export interface MyRevision {
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  annualCtc: string;
  monthlyCtc: string;
  previousAnnualCtc: string | null;
  change: string | null;
  breakup: Array<{ code: string; name: string; type: string; monthly: string }>;
}
export const mySalaryRevisions = () => get<{ revisions: MyRevision[] }>("/me/salary-revisions");

// P7-7: challans, quarterly data, Form 16 data.
export interface ChallanView { id: string; month: string; depositedOn: string; amount: string; bsr: string; serial: string; confirmed: boolean; enteredByMe: boolean }
export interface ChallanRegister { year: string; challans: ChallanView[]; reconciliation: Array<{ month: string; deducted: string; deposited: string; difference: string }> }
export const challanRegister = (fy: string) => get<ChallanRegister>("/challans", { fy });
export const enterChallan = (body: { fy: string; month: string; depositedOn: string; amount: string; bsrCode: string; serial: string }) => post<{ id: string }>("/challans", body);
export const confirmChallan = (id: string, body: { amount: string; serial: string }) => post(`/challans/${id}/confirm`, body);
export interface Form16Row { employeeId?: string; name?: string; year: string; employeeCode: string; regime: Regime | null; taxablePay: string; tdsDeducted: string; computation: { annualTax?: string } | null; missing: string[]; taxYearConfirmed: boolean }
export const form16Year = (fy: string) => get<{ year: string; state: "DRAFT" | "WAITING" | "CONFIRMED"; waitingMine: boolean | null; fingerprint: string; rows: Form16Row[] }>("/form16", { fy });
export const askForm16 = (fy: string, fingerprint: string) => post(`/form16/${fy}/confirm`, { fingerprint });
export const decideForm16 = (fy: string, fingerprint: string, decision: "APPROVE" | "REJECT") => post(`/form16/${fy}/decision`, { fingerprint, decision });
export const myForm16 = (fy: string) => get<Form16Row & { draft: boolean; watermark: string | null; partA: string }>("/me/form16", { fy });
