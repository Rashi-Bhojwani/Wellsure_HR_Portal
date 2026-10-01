import type { RequestHubItem, RequestHubState, RequestHubType, TaskItem } from "@shared/types/inbox";
import { apiClient } from "./client";

export async function listMyRequests(params: { type?: RequestHubType; state?: RequestHubState; limit?: number } = {}): Promise<RequestHubItem[]> {
  const { data } = await apiClient.get<RequestHubItem[]>("/api/request-hub", { params });
  return data;
}

export async function listMyTasks(): Promise<TaskItem[]> {
  const { data } = await apiClient.get<TaskItem[]>("/api/tasks/mine");
  return data;
}
