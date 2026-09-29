import { apiClient } from "./client";

// ── Dashboard widgets (employee.view) ────────────────────────────────────

export interface BucketCount {
  bucket: string;
  count: number;
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface MonthAdditionAttrition {
  month: string;
  joined: number;
  resigned: number;
}

export interface DashboardWidgets {
  yearsInService: BucketCount[];
  additionsAttrition: MonthAdditionAttrition[];
  headcountByLocation: NamedCount[];
  headcountByCity: NamedCount[];
  ageDistribution: BucketCount[];
  genderSplit: { gender: string; count: number }[];
  departmentHeadcount: NamedCount[];
}

export async function getDashboardWidgets(): Promise<DashboardWidgets> {
  const { data } = await apiClient.get<DashboardWidgets>("/api/admin/dashboard");
  return data;
}

// ── My Favourites (self-serve) ───────────────────────────────────────────

export interface FavouriteRow {
  id: string;
  label: string;
  icon: string;
  path: string;
  rank: number;
}

export async function listFavourites(): Promise<FavouriteRow[]> {
  const { data } = await apiClient.get<{ favourites: FavouriteRow[] }>("/api/admin/favourites");
  return data.favourites;
}

export async function createFavourite(input: { label: string; icon: string; path: string }): Promise<FavouriteRow> {
  const { data } = await apiClient.post<FavouriteRow>("/api/admin/favourites", input);
  return data;
}

export async function deleteFavourite(id: string): Promise<void> {
  await apiClient.delete(`/api/admin/favourites/${id}`);
}

export async function reorderFavourites(orderedIds: string[]): Promise<void> {
  await apiClient.post("/api/admin/favourites/reorder", { orderedIds });
}

// ── Dashboard layout (self-serve) ────────────────────────────────────────

export const DASHBOARD_WIDGET_KEYS = [
  "yearsInService",
  "additionsAttrition",
  "headcountByLocation",
  "headcountByCity",
  "ageDistribution",
  "genderSplit",
  "departmentHeadcount",
] as const;

export type DashboardWidgetKey = (typeof DASHBOARD_WIDGET_KEYS)[number];

export interface WidgetLayoutEntry {
  key: DashboardWidgetKey;
  visible: boolean;
}

export async function getLayout(): Promise<WidgetLayoutEntry[]> {
  const { data } = await apiClient.get<{ layout: WidgetLayoutEntry[] }>("/api/admin/dashboard-layout");
  return data.layout;
}

export async function saveLayout(layout: WidgetLayoutEntry[]): Promise<WidgetLayoutEntry[]> {
  const { data } = await apiClient.put<{ layout: WidgetLayoutEntry[] }>("/api/admin/dashboard-layout", { layout });
  return data.layout;
}

// ── My Tasks (self-serve) ────────────────────────────────────────────────

export interface TaskCountsByType {
  type: string;
  label: string;
  count: number;
}

export interface TaskCounts {
  review: { total: number; byType: TaskCountsByType[] };
  monitor: { total: number; byType: TaskCountsByType[] };
}

export async function getTaskCounts(): Promise<TaskCounts> {
  const { data } = await apiClient.get<TaskCounts>("/api/admin/tasks/counts");
  return data;
}
