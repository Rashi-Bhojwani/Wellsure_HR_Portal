import { apiClient } from "../../api/client";

// Badges and cheers (D-36, public, along the reporting line, a reason always), nudge tags (Peeps Stage 3: public light-hearted tags from the
// directors, a week each) and the old corrective notes (read-only) API (backend/src/modules/recognition).

export interface PersonRef {
  employeeId: string;
  employeeCode: string;
  name: string;
}
export interface Badge {
  id: string;
  badgeCode: string;
  badge: string;
  message?: string | null; // public views show it unless the directors hid it
  duration?: "WEEK" | "MONTH" | "PERMANENT" | null;
  retiredBadge?: boolean;
  givenAt: string;
  expiresAt: string | null;
  revoked: boolean;
  active: boolean;
  from?: string;
  recipient?: PersonRef | null;
  giverKind?: string;
}
export interface NudgeTag {
  id: string;
  tagCode: string;
  tag: string;
  givenAt: string;
  expiresAt: string;
  removed: boolean;
  active: boolean;
  from: string;
  review: { requestedAt: string; outcome: "KEPT" | "REMOVED" | null } | null;
  recipient?: PersonRef | null;
}
export interface Note {
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
  catalogue: Array<{ code: string; label: string; description?: string; duration: "WEEK" | "MONTH" | "PERMANENT" }>;
}
export interface NudgeStatus {
  active: boolean;
  missing: string[];
  canGive: boolean;
  tags: Array<{ code: string; label: string }>;
  lifetimeDays: number;
}

const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);
export const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const badgeStatus = () => data<BadgeStatus>(apiClient.get("/api/badges/status"));
export const badgeRecipients = (q: string) => data<PersonRef[]>(apiClient.get("/api/badges/recipients", { params: { q } }));
export const myBadges = () => data<Badge[]>(apiClient.get("/api/badges/mine"));
export const givenBadges = () => data<Badge[]>(apiClient.get("/api/badges/given"));
export const personBadges = (employeeId: string) => data<{ shown: boolean; badges: Badge[] }>(apiClient.get(`/api/badges/people/${employeeId}`));
export const giveBadge = (input: { recipientEmployeeId: string; badgeCode: string; message: string; idempotencyKey: string }) => data<Badge>(apiClient.post("/api/badges", input));
export const revokeBadge = (id: string, reason: string) => data<{ revoked: boolean }>(apiClient.post(`/api/badges/${id}/revoke`, { reason }));
export const allBadges = () => data<Badge[]>(apiClient.get("/api/badges/admin/all"));
export const badgeCounts = () => data<{ counts: Record<string, number> }>(apiClient.get("/api/badges/counts"));
export const recentBadges = () => data<Badge[]>(apiClient.get("/api/badges/recent"));

export const nudgeStatus = () => data<NudgeStatus>(apiClient.get("/api/nudges/status"));
export const nudgeRecipients = (q: string) => data<PersonRef[]>(apiClient.get("/api/nudges/recipients", { params: { q } }));
export const myNudges = () => data<NudgeTag[]>(apiClient.get("/api/nudges/mine"));
export const personNudges = (employeeId: string) => data<{ tags: NudgeTag[] }>(apiClient.get(`/api/nudges/people/${employeeId}`));
export const nudgeCounts = () => data<{ counts: Record<string, number> }>(apiClient.get("/api/nudges/counts"));
export const recentNudges = () => data<NudgeTag[]>(apiClient.get("/api/nudges/recent"));
export const giveNudge = (input: { recipientEmployeeId: string; tagCode: string; idempotencyKey: string }) => data<NudgeTag>(apiClient.post("/api/nudges", input));
export const removeNudge = (id: string, reason: string) => data<{ removed: boolean }>(apiClient.post(`/api/nudges/${id}/remove`, { reason }));
export const requestNudgeReview = (id: string) => data<{ requested: boolean }>(apiClient.post(`/api/nudges/${id}/review`, {}));
export const decideNudgeReview = (id: string, outcome: "KEPT" | "REMOVED", reason?: string) => data<{ decided: string }>(apiClient.post(`/api/nudges/${id}/review/decide`, { outcome, ...(reason ? { reason } : {}) }));
export const allNudges = () => data<NudgeTag[]>(apiClient.get("/api/nudges/admin/all"));

export const myNotes = () => data<{ readOnly: true; notes: Note[] }>(apiClient.get("/api/nudges/notes/mine"));
export const allNotes = () => data<{ readOnly: true; notes: Note[] }>(apiClient.get("/api/nudges/notes/admin/all"));
