import type { DirectorNoticeView, DirectorSwitchView } from "@shared/constants/directorAuthority";
import { apiClient } from "./client";

// Director authority (docs/plans/DIRECTOR_AUTHORITY.md) — backend/src/modules/director.

export type { DirectorNoticeView, DirectorSwitchView };

export async function listSwitches(): Promise<DirectorSwitchView[]> {
  const { data } = await apiClient.get<{ switches: DirectorSwitchView[] }>("/api/director/switches");
  return data.switches;
}

export type DirectorChoiceMode = "SECOND_DIRECTOR" | "DIRECTOR_AUTHORITY";

/** Proposes the choice for a step; it takes effect only when the other director confirms it. */
export async function setSwitch(step: string, mode: DirectorChoiceMode): Promise<DirectorSwitchView[]> {
  const { data } = await apiClient.put<{ switches: DirectorSwitchView[] }>(`/api/director/switches/${step}`, { mode });
  return data.switches;
}

/** The other director confirms the proposal they were shown. */
export async function confirmSwitch(step: string, mode: DirectorChoiceMode): Promise<DirectorSwitchView[]> {
  const { data } = await apiClient.post<{ switches: DirectorSwitchView[] }>(`/api/director/switches/${step}/confirm`, { mode });
  return data.switches;
}

export async function listNotices(status: "open" | "all" = "open"): Promise<DirectorNoticeView[]> {
  const { data } = await apiClient.get<{ notices: DirectorNoticeView[] }>("/api/director/notices", { params: { status } });
  return data.notices;
}

export async function acknowledgeNotice(id: string, note: string): Promise<void> {
  await apiClient.post(`/api/director/notices/${id}/acknowledge`, { note });
}
