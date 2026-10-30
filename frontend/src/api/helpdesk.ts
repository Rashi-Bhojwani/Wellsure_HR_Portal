import type { HelpdeskPriority, HelpdeskStatus } from "@shared/constants/helpdesk";
import { apiClient } from "./client";
import type { SignedDownload } from "./documents";

export interface PersonRef {
  id: string;
  employeeCode: string;
  name: string;
}

export interface HelpdeskCategory {
  id: string;
  code: string;
  name: string;
  isSensitive: boolean;
  /** Tickets in this category are the directors' alone (Payroll & Salary). */
  directorsOnly?: boolean;
}

export interface HelpdeskCategoryAdmin extends HelpdeskCategory {
  isActive: boolean;
  sortOrder: number;
  defaultAssignee: PersonRef | null;
  ticketCount: number;
}

export interface HelpdeskTicketSummary {
  id: string;
  number: string;
  subject: string;
  category: HelpdeskCategory;
  priority: HelpdeskPriority;
  status: HelpdeskStatus;
  raisedBy: PersonRef;
  assignee: PersonRef | null;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  autoClosesAt: string | null;
  reopenUntil: string | null;
}

export interface HelpdeskAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface HelpdeskMessage {
  id: string;
  author: PersonRef;
  fromRaiser: boolean;
  body: string;
  isInternalNote?: boolean; // only present in HR's view
  createdAt: string;
  attachments: HelpdeskAttachment[];
}

export interface HelpdeskTicket extends HelpdeskTicketSummary {
  viewerRole: "raiser" | "hr";
  messages: HelpdeskMessage[];
}

export interface QueuePage {
  items: HelpdeskTicketSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Categories ────────────────────────────────────────────────────────
export async function listCategories(): Promise<HelpdeskCategory[]> {
  const { data } = await apiClient.get<HelpdeskCategory[]>("/api/helpdesk/categories");
  return data;
}
export async function listAllCategories(): Promise<HelpdeskCategoryAdmin[]> {
  const { data } = await apiClient.get<HelpdeskCategoryAdmin[]>("/api/helpdesk/categories/all");
  return data;
}
export async function createCategory(input: { code: string; name: string; isSensitive?: boolean; sortOrder?: number; defaultAssigneeEmployeeId?: string | null }) {
  const { data } = await apiClient.post("/api/helpdesk/categories", input);
  return data;
}
export async function updateCategory(id: string, input: { name?: string; isSensitive?: boolean; directorsOnly?: boolean; isActive?: boolean; sortOrder?: number; defaultAssigneeEmployeeId?: string | null }) {
  const { data } = await apiClient.patch(`/api/helpdesk/categories/${id}`, input);
  return data;
}
export async function listAssignees(): Promise<PersonRef[]> {
  const { data } = await apiClient.get<PersonRef[]>("/api/helpdesk/assignees");
  return data;
}

// ── Tickets ───────────────────────────────────────────────────────────
export async function raiseTicket(fields: { categoryId: string; subject: string; body: string; priority?: HelpdeskPriority }, files: File[]): Promise<HelpdeskTicket> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
  for (const f of files) form.append("files", f);
  const { data } = await apiClient.post<HelpdeskTicket>("/api/helpdesk/tickets", form);
  return data;
}
export async function listMyTickets(status?: HelpdeskStatus): Promise<HelpdeskTicketSummary[]> {
  const { data } = await apiClient.get<HelpdeskTicketSummary[]>("/api/helpdesk/tickets/mine", { params: { status } });
  return data;
}
export async function listQueue(params: { status?: HelpdeskStatus; categoryId?: string; assignee?: string; page: number; pageSize: number }): Promise<QueuePage> {
  const { data } = await apiClient.get<QueuePage>("/api/helpdesk/queue", { params });
  return data;
}
export async function getTicket(id: string): Promise<HelpdeskTicket> {
  const { data } = await apiClient.get<HelpdeskTicket>(`/api/helpdesk/tickets/${id}`);
  return data;
}
export async function addMessage(id: string, fields: { body: string; isInternalNote?: boolean }, files: File[]): Promise<HelpdeskTicket> {
  const form = new FormData();
  form.append("body", fields.body);
  if (fields.isInternalNote) form.append("isInternalNote", "true");
  for (const f of files) form.append("files", f);
  const { data } = await apiClient.post<HelpdeskTicket>(`/api/helpdesk/tickets/${id}/messages`, form);
  return data;
}
export async function updateTicket(id: string, input: { status?: HelpdeskStatus; priority?: HelpdeskPriority; assigneeEmployeeId?: string | null }): Promise<HelpdeskTicket> {
  const { data } = await apiClient.patch<HelpdeskTicket>(`/api/helpdesk/tickets/${id}`, input);
  return data;
}
export async function reopenTicket(id: string): Promise<HelpdeskTicket> {
  const { data } = await apiClient.post<HelpdeskTicket>(`/api/helpdesk/tickets/${id}/reopen`);
  return data;
}
export async function downloadAttachment(id: string): Promise<SignedDownload> {
  const { data } = await apiClient.post<SignedDownload>(`/api/helpdesk/attachments/${id}/download`);
  return data;
}
