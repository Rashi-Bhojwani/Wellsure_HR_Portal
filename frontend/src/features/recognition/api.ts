import { apiClient } from "../../api/client";

// Badges and private nudges API (backend/src/modules/recognition).

export interface PersonRef {
  employeeId: string;
  employeeCode: string;
  name: string;
}
export interface Badge {
  id: string;
  badgeCode: string;
  badge: string;
  message: string | null;
  givenAt: string;
  expiresAt: string | null;
  revoked: boolean;
  active: boolean;
  from?: string;
  recipient?: PersonRef | null;
  giverKind?: string;
}
export interface Nudge {
  id: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  withdrawn: boolean;
  from: string;
  recipient?: PersonRef | null;
}
export interface BadgeStatus {
  active: boolean;
  missing: string[];
  canGive: boolean;
  catalogue: Array<{ code: string; label: string; description?: string }>;
}
export interface NudgeStatus {
  active: boolean;
  missing: string[];
  canSend: boolean;
}

const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);
export const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const badgeStatus = () => data<BadgeStatus>(apiClient.get("/api/badges/status"));
export const badgeRecipients = (q: string) => data<PersonRef[]>(apiClient.get("/api/badges/recipients", { params: { q } }));
export const myBadges = () => data<Badge[]>(apiClient.get("/api/badges/mine"));
export const givenBadges = () => data<Badge[]>(apiClient.get("/api/badges/given"));
export const personBadges = (employeeId: string) => data<{ shown: boolean; badges: Badge[] }>(apiClient.get(`/api/badges/people/${employeeId}`));
export const giveBadge = (input: { recipientEmployeeId: string; badgeCode: string; message?: string; idempotencyKey: string }) => data<Badge>(apiClient.post("/api/badges", input));
export const revokeBadge = (id: string, reason: string) => data<{ revoked: boolean }>(apiClient.post(`/api/badges/${id}/revoke`, { reason }));
export const allBadges = () => data<Badge[]>(apiClient.get("/api/badges/admin/all"));

export const nudgeStatus = () => data<NudgeStatus>(apiClient.get("/api/nudges/status"));
export const nudgeRecipients = (q: string) => data<PersonRef[]>(apiClient.get("/api/nudges/recipients", { params: { q } }));
export const myNudges = () => data<Nudge[]>(apiClient.get("/api/nudges/mine"));
export const sentNudges = () => data<Nudge[]>(apiClient.get("/api/nudges/sent"));
export const sendNudge = (input: { recipientEmployeeId: string; body: string; idempotencyKey: string }) => data<Nudge>(apiClient.post("/api/nudges", input));
export const revokeNudge = (id: string, reason: string) => data<{ withdrawn: boolean }>(apiClient.post(`/api/nudges/${id}/revoke`, { reason }));
export const allNudges = () => data<Nudge[]>(apiClient.get("/api/nudges/admin/all"));
