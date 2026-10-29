import type { DirectorNoticeView, DirectorSwitchView } from "@shared/constants/directorAuthority";
import { apiClient } from "./client";

// Director authority (docs/plans/DIRECTOR_AUTHORITY.md) — backend/src/modules/director.

export type { DirectorNoticeView, DirectorSwitchView };

export async function listSwitches(): Promise<DirectorSwitchView[]> {
  const { data } = await apiClient.get<{ switches: DirectorSwitchView[] }>("/api/director/switches");
  return data.switches;
}

export async function setSwitch(step: string, requireSecondDirector: boolean): Promise<DirectorSwitchView[]> {
  const { data } = await apiClient.put<{ switches: DirectorSwitchView[] }>(`/api/director/switches/${step}`, { requireSecondDirector });
  return data.switches;
}

export async function listNotices(status: "open" | "all" = "open"): Promise<DirectorNoticeView[]> {
  const { data } = await apiClient.get<{ notices: DirectorNoticeView[] }>("/api/director/notices", { params: { status } });
  return data.notices;
}

export async function acknowledgeNotice(id: string, note: string): Promise<void> {
  await apiClient.post(`/api/director/notices/${id}/acknowledge`, { note });
}
