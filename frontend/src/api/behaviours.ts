import { apiClient } from "./client";

// D-37 (docs/plans/D37_DEFAULTS.md): behaviour settings, directors only. A change is proposed by one director and confirmed by a different one.
const base = "/api/behaviours";
export type BehaviourKey = "loan.shortfall" | "leave.leavingMonthAccrual" | "leave.proRataRounding" | "access.developerSeesSwipes" | "identity.directorConfirmsHrChanges" | "letters.employeeMayAsk" | "loan.maxTotalDeductionPercent";
export interface Behaviour {
  key: BehaviourKey;
  title: string;
  what: string;
  d37: boolean;
  value: unknown;
  state: "DEFAULT" | "CONFIRMED" | "NOT_SET";
  label: string | null;
  defaultText: string;
  confirmed: { reason: string; proposedBy: string; confirmedBy: string; at: string } | null;
  pending: Array<{ id: string; value: unknown; reason: string; proposedBy: string; mine: boolean; at: string }>;
}
export const listBehaviours = async () => (await apiClient.get<{ behaviours: Behaviour[] }>(base)).data.behaviours;
export const proposeBehaviour = async (key: BehaviourKey, value: unknown, reason: string) => (await apiClient.post<{ id: string }>(`${base}/${key}/proposals`, { value, reason })).data;
export const confirmBehaviour = async (id: string) => (await apiClient.post(`${base}/proposals/${id}/confirm`)).data;
