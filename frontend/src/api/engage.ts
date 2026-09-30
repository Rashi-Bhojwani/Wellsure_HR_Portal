import { apiClient } from "./client";

export type PostKind = "USER" | "KUDOS" | "POLL" | "AUTO_BIRTHDAY" | "AUTO_JOINING" | "AUTO_ANNIVERSARY";

export interface PollOptionRow {
  id: string;
  label: string;
  voteCount: number;
}

export interface PostRow {
  id: string;
  kind: PostKind;
  body: string;
  authorEmployeeId: string | null;
  authorName: string | null;
  subjectEmployeeId: string | null;
  subjectName: string | null;
  groupId: string | null;
  groupName: string | null;
  occurredOn: string | null;
  isModerated: boolean;
  createdAt: string;
  kudos: { fromEmployeeId: string; fromName: string | null; toEmployeeId: string; toName: string | null; message: string } | null;
  poll: {
    id: string;
    question: string;
    closesAt: string | null;
    closedAt: string | null;
    totalVotes: number;
    viewerVotedOptionId: string | null;
    options: PollOptionRow[];
  } | null;
  reactions: { emoji: string; count: number }[];
  viewerReaction: string | null;
  commentCount: number;
}

export interface EmployeePickerRow {
  id: string;
  employeeCode: string;
  name: string;
}

export async function searchEmployees(q: string): Promise<EmployeePickerRow[]> {
  const { data } = await apiClient.get<{ employees: EmployeePickerRow[] }>("/api/engage/employees/search", { params: { q } });
  return data.employees;
}

export interface ListFeedParams {
  kind?: PostKind;
  groupId?: string;
  locationId?: string;
  departmentId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listFeed(params: ListFeedParams = {}): Promise<{ total: number; page: number; pageSize: number; rows: PostRow[] }> {
  const { data } = await apiClient.get("/api/engage/posts", { params });
  return data as { total: number; page: number; pageSize: number; rows: PostRow[] };
}

export async function getPost(id: string): Promise<PostRow> {
  const { data } = await apiClient.get<PostRow>(`/api/engage/posts/${id}`);
  return data;
}

export async function createPost(input: { body: string; groupId?: string }): Promise<PostRow> {
  const { data } = await apiClient.post<PostRow>("/api/engage/posts", input);
  return data;
}

export async function giveKudos(input: { toEmployeeId: string; message: string; groupId?: string }): Promise<PostRow> {
  const { data } = await apiClient.post<PostRow>("/api/engage/kudos", input);
  return data;
}

export async function createPoll(input: { question: string; options: string[]; groupId?: string; closesAt?: string }): Promise<PostRow> {
  const { data } = await apiClient.post<PostRow>("/api/engage/polls", input);
  return data;
}

export async function votePoll(pollOptionId: string): Promise<PostRow> {
  const { data } = await apiClient.post<PostRow>("/api/engage/polls/vote", { pollOptionId });
  return data;
}

export async function closePoll(postId: string): Promise<PostRow> {
  const { data } = await apiClient.post<PostRow>(`/api/engage/posts/${postId}/close-poll`);
  return data;
}

export async function toggleReaction(postId: string, emoji: string): Promise<{ postId: string; reactions: { emoji: string; count: number }[]; viewerReaction: string | null }> {
  const { data } = await apiClient.post(`/api/engage/posts/${postId}/react`, { emoji });
  return data as { postId: string; reactions: { emoji: string; count: number }[]; viewerReaction: string | null };
}

export interface CommentRow {
  id: string;
  postId: string;
  authorEmployeeId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export async function listComments(postId: string): Promise<CommentRow[]> {
  const { data } = await apiClient.get<{ comments: CommentRow[] }>(`/api/engage/posts/${postId}/comments`);
  return data.comments;
}

export async function addComment(postId: string, body: string): Promise<CommentRow> {
  const { data } = await apiClient.post<CommentRow>(`/api/engage/posts/${postId}/comments`, { body });
  return data;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export async function listActiveGroups(): Promise<GroupRow[]> {
  const { data } = await apiClient.get<{ groups: GroupRow[] }>("/api/engage/groups/active");
  return data.groups;
}

// ── Admin: Groups (engage.groups.manage) ─────────────────────────────────

export interface GroupAdminRow extends GroupRow {
  memberCount: number;
  postCount: number;
}

export async function listGroups(): Promise<GroupAdminRow[]> {
  const { data } = await apiClient.get<{ groups: GroupAdminRow[] }>("/api/engage/groups");
  return data.groups;
}

export async function createGroup(input: { name: string; description?: string }): Promise<GroupRow> {
  const { data } = await apiClient.post<GroupRow>("/api/engage/groups", input);
  return data;
}

export async function updateGroup(id: string, input: Partial<{ name: string; description: string | null; isActive: boolean }>): Promise<GroupRow> {
  const { data } = await apiClient.patch<GroupRow>(`/api/engage/groups/${id}`, input);
  return data;
}

export interface GroupMemberRow {
  employeeId: string;
  employeeName: string;
  joinedAt: string;
}

export async function listGroupMembers(groupId: string): Promise<GroupMemberRow[]> {
  const { data } = await apiClient.get<{ members: GroupMemberRow[] }>(`/api/engage/groups/${groupId}/members`);
  return data.members;
}

export async function addGroupMember(groupId: string, employeeId: string): Promise<void> {
  await apiClient.post(`/api/engage/groups/${groupId}/members/${employeeId}`);
}

export async function removeGroupMember(groupId: string, employeeId: string): Promise<void> {
  await apiClient.delete(`/api/engage/groups/${groupId}/members/${employeeId}`);
}

// ── Admin: Moderation (engage.moderate) ──────────────────────────────────

export async function listPostsForModeration(params: { moderated?: boolean; page?: number; pageSize?: number } = {}): Promise<{ total: number; page: number; pageSize: number; rows: PostRow[] }> {
  const { data } = await apiClient.get("/api/engage/moderation/posts", { params });
  return data as { total: number; page: number; pageSize: number; rows: PostRow[] };
}

export async function moderatePost(id: string): Promise<PostRow> {
  const { data } = await apiClient.post<PostRow>(`/api/engage/moderation/posts/${id}/hide`);
  return data;
}

export async function unmoderatePost(id: string): Promise<PostRow> {
  const { data } = await apiClient.post<PostRow>(`/api/engage/moderation/posts/${id}/unhide`);
  return data;
}

// ── Admin: Auto-post settings (engage.autopost.manage) ───────────────────

export type AutoPostKind = "BIRTHDAY" | "JOINING" | "ANNIVERSARY";

export interface AutoPostSettingRow {
  kind: AutoPostKind;
  enabled: boolean;
  template: string;
  updatedAt: string | null;
}

export async function listAutoPostSettings(): Promise<{ settings: AutoPostSettingRow[]; dailyRunHour: number }> {
  const { data } = await apiClient.get<{ settings: AutoPostSettingRow[]; dailyRunHour: number }>("/api/engage/autopost-settings");
  return data;
}

export async function updateAutoPostSetting(kind: AutoPostKind, input: Partial<{ enabled: boolean; template: string }>): Promise<AutoPostSettingRow> {
  const { data } = await apiClient.patch<AutoPostSettingRow>(`/api/engage/autopost-settings/${kind}`, input);
  return data;
}

export async function updateDailyRunHour(dailyRunHour: number): Promise<number> {
  const { data } = await apiClient.put<{ dailyRunHour: number }>("/api/engage/autopost-settings/daily-run-hour", { dailyRunHour });
  return data.dailyRunHour;
}
