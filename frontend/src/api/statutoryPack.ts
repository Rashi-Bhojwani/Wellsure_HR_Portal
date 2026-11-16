import { apiClient } from "./client";

// The Standard statutory defaults pack (docs/plans/STATUTORY_DEFAULTS_PLAN.md). Directors only; the Developer role is refused by the server.
const base = "/api/payroll-statutory-pack";
export interface PackEntryView {
  from: string | null;
  value: unknown;
  source: { name: string; url: string };
  checkedOn: string;
  verification: "OFFICIAL" | "UNVERIFIED";
  reviewNeeded: boolean;
  note: string;
}
export interface StatutoryPackStatus {
  version: number;
  checkedOn: string;
  label: string;
  lastReviewedOn: string;
  reviewIntervalMonths: number;
  reviewDue: string[];
  acknowledged: boolean;
  acknowledgedBy: Array<{ name: string; at: string; mine: boolean }>;
  reviewNeeded: Array<{ key: string; label: string; note: string }>;
  ctcIncludesEmployerStatutory: boolean;
  rules: Array<{ key: string; label: string; inUse: "STANDARD" | "DIRECTOR"; today: PackEntryView; series: PackEntryView[] }>;
  state: { key: string; label: string; loaded: boolean; professionalTax: PackEntryView | null; labourWelfareFund: PackEntryView | null; minimumWages: PackEntryView | null; notLoadedText: string | null };
  taxYears: Array<{ year: string; inUse: "STANDARD" | "DIRECTOR"; verification: string; unverifiedParts: string[] }>;
}
export const getStatutoryPack = async () => (await apiClient.get<StatutoryPackStatus>(base)).data;
export const acknowledgeStatutoryPack = async () => (await apiClient.post<{ acknowledged: boolean }>(`${base}/acknowledge`)).data;
export const reviewStatutoryPack = async () => (await apiClient.post<{ lastReviewedOn: string }>(`${base}/review`)).data;
