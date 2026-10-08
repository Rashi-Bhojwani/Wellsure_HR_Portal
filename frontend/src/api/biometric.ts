import { apiClient } from "./client";

// Biometric ingestion admin (Phase 2 P2-B) — backend/src/modules/biometric.

export type DeviceRoute = "AGENT" | "PUSH";

export interface DeviceRow {
  id: string;
  serialNumber: string;
  name: string;
  location: { id: string; name: string; hasBiometricDevice: boolean };
  timezone: string;
  model: string | null;
  firmware: string | null;
  route: DeviceRoute;
  agent: { id: string; name: string } | null;
  lanIp: string | null;
  isSimulated: boolean;
  isActive: boolean;
  lastHeartbeatAt: string | null;
  lastPunchAt: string | null;
  lastReceivedAt: string | null;
}
export interface DeviceInput {
  serialNumber?: string;
  name?: string;
  locationId?: string;
  timezone?: string;
  model?: string | null;
  firmware?: string | null;
  route?: DeviceRoute;
  agentId?: string | null;
  lanIp?: string | null;
  isSimulated?: boolean;
  isActive?: boolean;
}

export interface AgentRow {
  id: string;
  name: string;
  keyPrefix: string;
  host: string | null;
  version: string | null;
  lastHeartbeatAt: string | null;
  lastHeartbeat: unknown;
  isActive: boolean;
  devices: Array<{ id: string; name: string; serialNumber: string }>;
  createdAt: string;
}

export interface RejectedLine {
  lineNumber: number;
  raw: string;
  reason: string;
}
export interface BatchRow {
  id: string;
  route: "AGENT" | "PUSH" | "IMPORT";
  device: { name: string; serialNumber: string };
  agent: { name: string } | null;
  fileName: string | null;
  reason: string | null;
  receivedAt: string;
  totalLines: number;
  newCount: number;
  duplicateCount: number;
  unmappedCount: number;
  rejectedCount: number;
  flaggedCount: number;
  rejectedLines: RejectedLine[];
}

export interface UnmappedRow {
  deviceUserId: string;
  punches: number;
  firstAt: string;
  lastAt: string;
  firstDay: string;
  devices: string[];
}

export interface FlaggedRow {
  id: string;
  device: string;
  deviceUserId: string;
  localTime: string;
  punchedAt: string;
  receivedAt: string;
  flag: "FUTURE" | "TOO_OLD";
  employee: { id: string; name: string | null } | null;
}

export interface ImportCounts {
  totalLines: number;
  newCount: number;
  duplicateCount: number;
  unmappedCount: number;
  rejectedCount: number;
  flaggedCount: number;
  rejected: RejectedLine[];
}
export interface ImportPreview extends ImportCounts {
  batchId: string;
  device: { id: string; name: string };
  fileName: string;
  sample: Array<{ lineNumber: number; deviceUserId: string; localTime: string; outcome: string }>;
}

const base = "/api/biometric";

export async function listDevices(): Promise<DeviceRow[]> {
  return (await apiClient.get<{ devices: DeviceRow[] }>(`${base}/devices`)).data.devices;
}
export async function createDevice(body: DeviceInput): Promise<DeviceRow> {
  return (await apiClient.post<DeviceRow>(`${base}/devices`, body)).data;
}
export async function updateDevice(id: string, body: DeviceInput): Promise<DeviceRow> {
  return (await apiClient.patch<DeviceRow>(`${base}/devices/${id}`, body)).data;
}

export async function listAgents(): Promise<AgentRow[]> {
  return (await apiClient.get<{ agents: AgentRow[] }>(`${base}/agents`)).data.agents;
}
export async function createAgent(name: string): Promise<{ agent: AgentRow; key: string }> {
  return (await apiClient.post<{ agent: AgentRow; key: string }>(`${base}/agents`, { name })).data;
}
export async function rotateAgentKey(id: string): Promise<{ agent: AgentRow; key: string }> {
  return (await apiClient.post<{ agent: AgentRow; key: string }>(`${base}/agents/${id}/rotate-key`)).data;
}
export async function updateAgent(id: string, body: { name?: string; isActive?: boolean }): Promise<AgentRow> {
  return (await apiClient.patch<AgentRow>(`${base}/agents/${id}`, body)).data;
}

export async function listBatches(deviceId?: string): Promise<BatchRow[]> {
  return (await apiClient.get<{ batches: BatchRow[] }>(`${base}/batches`, { params: deviceId ? { deviceId } : {} })).data.batches;
}

export async function listUnmapped(): Promise<UnmappedRow[]> {
  return (await apiClient.get<{ unmapped: UnmappedRow[] }>(`${base}/unmapped`)).data.unmapped;
}
export async function mapUnmapped(body: { deviceUserId: string; employeeId: string; effectiveFrom?: string }): Promise<{ resolved: number; stillUnmapped: number; mapping: { deviceUserId: string; validFrom: string; plan: string } }> {
  return (await apiClient.post(`${base}/unmapped/map`, body)).data;
}

export async function listFlagged(): Promise<FlaggedRow[]> {
  return (await apiClient.get<{ flagged: FlaggedRow[] }>(`${base}/flagged`)).data.flagged;
}
export async function resolveFlag(id: string, body: { decision: "ACCEPTED" | "DISCARDED"; reason: string }): Promise<void> {
  await apiClient.post(`${base}/flagged/${id}/resolve`, body);
}

export async function previewImport(deviceId: string, file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append("deviceId", deviceId);
  form.append("file", file);
  return (await apiClient.post<ImportPreview>(`${base}/import/preview`, form)).data;
}
export async function commitImport(batchId: string, reason: string): Promise<ImportCounts & { batchId: string }> {
  return (await apiClient.post(`${base}/import/${batchId}/commit`, { reason })).data;
}
