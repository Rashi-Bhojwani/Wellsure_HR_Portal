import { apiClient } from "./client";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  linkLabel: string | null;
  linkUrl: string | null;
  scopeLocationId: string | null;
  scopeDepartmentId: string | null;
  activeFrom: string;
  activeTo: string;
  isActive: boolean;
  createdByUserId: string;
  createdAt: string;
}

export async function getActiveAnnouncement(): Promise<AnnouncementRow | null> {
  const { data } = await apiClient.get<{ announcement: AnnouncementRow | null }>("/api/announcements/active");
  return data.announcement;
}

// ── Admin (announcements.manage) ─────────────────────────────────────────

export async function listAnnouncements(): Promise<AnnouncementRow[]> {
  const { data } = await apiClient.get<{ announcements: AnnouncementRow[] }>("/api/announcements");
  return data.announcements;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  linkLabel?: string | null;
  linkUrl?: string | null;
  scopeLocationId?: string | null;
  scopeDepartmentId?: string | null;
  activeFrom: string;
  activeTo: string;
}

export async function createAnnouncement(input: AnnouncementInput): Promise<AnnouncementRow> {
  const { data } = await apiClient.post<AnnouncementRow>("/api/announcements", input);
  return data;
}

export async function updateAnnouncement(id: string, input: Partial<AnnouncementInput & { isActive: boolean }>): Promise<AnnouncementRow> {
  const { data } = await apiClient.patch<AnnouncementRow>(`/api/announcements/${id}`, input);
  return data;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await apiClient.delete(`/api/announcements/${id}`);
}
