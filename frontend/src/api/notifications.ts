import { apiClient } from "./client";

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(page = 1, pageSize = 20): Promise<{ total: number; unreadCount: number; page: number; pageSize: number; rows: NotificationRow[] }> {
  const { data } = await apiClient.get("/api/notifications", { params: { page, pageSize } });
  return data as { total: number; unreadCount: number; page: number; pageSize: number; rows: NotificationRow[] };
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await apiClient.get<{ count: number }>("/api/notifications/unread-count");
  return data.count;
}

export async function markAsRead(id: string): Promise<void> {
  await apiClient.post(`/api/notifications/${id}/read`);
}

export async function markAllAsRead(): Promise<void> {
  await apiClient.post("/api/notifications/read-all");
}
