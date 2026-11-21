import { apiClient } from "./client";

// Lateness rule (docs/plans/LATE_CHECKLIST.md). Amounts arrive only where the server allows them (a person's own view, the directors' screens).
export type Edge = "INCLUSIVE" | "EXCLUSIVE";
export interface Cutoff { time: string; edge: Edge }
export type Outcome = { kind: "NOT_SET" } | { kind: "NONE" } | { kind: "MARK" } | { kind: "CUT"; days: string } | { kind: "PENALTY"; amount: string };
export type Applies = { mode: "EVERY_TIME" } | { mode: "AFTER_FREE"; free: number };
export interface Band { outcome: Outcome; applies: Applies }
export interface LateRule { effectiveFrom: string; active: boolean; cutoffs: [Cutoff, Cutoff, Cutoff]; bands: [Band, Band, Band]; penaltyHead: string | null }
export type Consequence = { kind: "WAIVED" } | { kind: "FREE"; allowanceNo: number; of: number } | { kind: "NOT_SET" } | { kind: "NONE" } | { kind: "MARK" } | { kind: "CUT"; days: number } | { kind: "PENALTY"; amount: string };
export interface Arrival { date: string; time: string; band: 1 | 2 | 3; bandLabel: string; consequence: Consequence; says: string; dayLop: string; waiver: { id: string; status: WaiverStatus; reason: string; decisionNote: string | null } | null }
export interface PersonMonth { employeeId: string; employeeCode: string; name: string; arrivals: Arrival[]; allowances: Array<{ band: number; bandLabel: string; free: number; used: number; left: number }> }
export interface RuleSummary { effectiveFrom: string; cutoffs: Cutoff[]; bands: Array<{ band: number; label: string; outcome: Outcome; applies: Applies }> }
export interface MyLateness { month: string; active: boolean; rule: RuleSummary | null; me: PersonMonth | null }
export interface TeamLateness { month: string; active: boolean; isManager: boolean; rule: RuleSummary | null; finalised: boolean; people: PersonMonth[] }
export type WaiverStatus = "PENDING" | "HR_APPROVED" | "APPROVED" | "REJECTED" | "WITHDRAWN"; // FIX-M8: HR_APPROVED waits for a director
export interface WaiverRow { id: string; employeeId: string; employeeCode: string; fullName: string; date: string; time: string | null; bandLabel: string | null; reason: string; status: WaiverStatus; decisionNote: string | null; requestedBy: string; mine: boolean }
export type SettingKey = "late.rule" | "late.missingPunch" | "late.halfDay";
export interface MissingPunch { effectiveFrom: string; outcome: "ABSENT_FULL_DAY" | "HALF_DAY" | "PRESENT_FLAGGED" }
export interface HalfDay { effectiveFrom: string; fullDayMinMinutes: number; halfDayMinMinutes: number; halfDayMinNotMetLopDays: "0.5" | "1" }
export interface LateSetting {
  key: SettingKey;
  title: string;
  what: string;
  defaultText: string;
  inForce: LateRule | MissingPunch | HalfDay | null;
  defaultInUse: boolean;
  starting: LateRule | null;
  history: Array<{ id: string; value: unknown; reason: string; proposedBy: string; confirmedBy: string; at: string }>;
  pending: Array<{ id: string; value: unknown; reason: string; proposedBy: string; mine: boolean; at: string }>;
}
export interface PenaltyRow { employeeId: string; employeeCode: string; name: string; date: string; time: string; bandLabel: string; penalty: string; hoursLop: string; hoursValue: string | null; charge: string | null; status: "TO_POST" | "POSTED" | "NOTHING_TO_CHARGE" | "NEEDS_CALCULATED_RUN" | "OWN_PAY" | "ALREADY_PAID"; note: string }
export interface PenaltyPlan { month: string; active: boolean; penaltyHead: string | null; rows: PenaltyRow[]; toCancel: Array<{ id: string; sourceRef: string; employeeId: string }>; fingerprint: string; blocked: boolean }

export const myLateness = async (month: string) => (await apiClient.get<MyLateness>("/api/lateness/mine", { params: { month } })).data;
export const teamLateness = async (month: string) => (await apiClient.get<TeamLateness>("/api/lateness/team", { params: { month } })).data;
export const askWaiver = async (input: { employeeId: string; date: string; reason: string }) => (await apiClient.post("/api/lateness/waivers", input)).data;
export const withdrawWaiver = async (id: string) => (await apiClient.post(`/api/lateness/waivers/${id}/withdraw`)).data;
export const listWaivers = async (status: "PENDING" | "HR_APPROVED" | "APPROVED" | "REJECTED") => (await apiClient.get<{ waivers: WaiverRow[] }>("/api/lateness/waivers", { params: { status } })).data.waivers;
export const approveWaiver = async (id: string) => (await apiClient.post(`/api/lateness/waivers/${id}/approve`)).data;
export const rejectWaiver = async (id: string, note: string) => (await apiClient.post(`/api/lateness/waivers/${id}/reject`, { note })).data;
// FIX-M8 (independent audit 2026-11-20): a director confirms or turns down a waiver HR approved.
export const confirmWaiver = async (id: string) => (await apiClient.post<{ status: WaiverStatus }>(`/api/lateness/waivers/${id}/confirm`)).data;
export const directorRejectWaiver = async (id: string, note: string) => (await apiClient.post(`/api/lateness/waivers/${id}/director-reject`, { note })).data;
export const lateSettings = async () => (await apiClient.get<{ month: string; settings: LateSetting[] }>("/api/lateness/settings")).data;
export const proposeLate = async (key: SettingKey, value: unknown, reason: string) => (await apiClient.post<{ id: string }>(`/api/lateness/settings/${key}/proposals`, { value, reason })).data;
export const confirmLate = async (id: string) => (await apiClient.post(`/api/lateness/settings/proposals/${id}/confirm`)).data;
export const penaltyPlan = async (month: string) => (await apiClient.get<PenaltyPlan>("/api/lateness/penalties", { params: { month } })).data;
export const postPenalties = async (month: string, fingerprint: string) => (await apiClient.post<{ posted: number; cancelled: number }>("/api/lateness/penalties/post", { month, fingerprint })).data;

export const WAIVER_LABEL: Record<WaiverStatus, string> = { HR_APPROVED: "Approved by HR: waits for a director", PENDING: "Waiting for HR", APPROVED: "Waived", REJECTED: "Not waived", WITHDRAWN: "Withdrawn" };
export const WAIVER_TONE: Record<WaiverStatus, "info" | "success" | "danger" | "neutral" | "warning"> = { HR_APPROVED: "warning", PENDING: "info", APPROVED: "success", REJECTED: "danger", WITHDRAWN: "neutral" };
export const CONSEQUENCE_LABEL: Record<Consequence["kind"], string> = { WAIVED: "Waived", FREE: "Allowance used", NOT_SET: "Late mark", NONE: "No consequence", MARK: "Late mark", CUT: "Salary cut", PENALTY: "Penalty" };
export const CONSEQUENCE_TONE: Record<Consequence["kind"], "info" | "success" | "danger" | "neutral" | "warning"> = { WAIVED: "success", FREE: "info", NOT_SET: "neutral", NONE: "neutral", MARK: "neutral", CUT: "danger", PENALTY: "danger" };

export function outcomeText(o: Outcome, a?: Applies): string {
  const base = o.kind === "NOT_SET" ? "Not set (no consequence)" : o.kind === "NONE" ? "No consequence" : o.kind === "MARK" ? "Late mark only" : o.kind === "CUT" ? `Salary cut of ${o.days} day` : o.amount ? `Penalty of ₹${o.amount}` : "Penalty";
  return a?.mode === "AFTER_FREE" ? `${a.free} free a month, then: ${base}` : base;
}
