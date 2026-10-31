import type { OfficeCapabilityId, OfficeChangeKind, PeepsSettingKey } from "@shared/constants/peeps";
import { apiClient } from "../../api/client";

// Peeps core API (backend/src/modules/peeps): the caller's workspace status, settings, and Wellsure Office membership.

export interface PeepsMe {
  isDirector: boolean;
  isMember: boolean;
  capabilities: OfficeCapabilityId[];
  officeName: string;
  capabilityCatalog: Array<{ id: OfficeCapabilityId; label: string; what: string }>;
}

export interface SettingView {
  key: PeepsSettingKey;
  module: string;
  label: string;
  what: string;
  enteredBy: "DIRECTOR" | "OFFICE";
  inForce: { version: number; value: unknown; enteredByName: string | null; confirmedByName: string | null; confirmedAt: string } | null;
  pending: { version: number; value: unknown; note: string; enteredByName: string | null; enteredByMe: boolean; enteredAt: string } | null;
}

export interface PersonRef {
  employeeId: string;
  employeeCode: string;
  name: string;
}

export interface Membership {
  members: Array<PersonRef & { capabilities: OfficeCapabilityId[]; since: string }>;
  changes: Array<{
    id: string;
    kind: OfficeChangeKind;
    person: PersonRef;
    from: PersonRef | null;
    capabilities: OfficeCapabilityId[];
    effectiveFrom: string;
    reason: string;
    proposedByMe: boolean;
    proposedAt: string;
    confirmedAt: string | null;
    appliedAt: string | null;
  }>;
}

export interface GrantDrift {
  employeeId: string;
  key: string;
  problem: "MISSING" | "UNEXPECTED" | "REVOKED_BY_HAND";
}

const data = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);

export const me = () => data<PeepsMe>(apiClient.get("/api/peeps/me"));
export const listSettings = () => data<SettingView[]>(apiClient.get("/api/peeps/settings"));
export const enterSetting = (key: PeepsSettingKey, value: unknown, note?: string) => data<SettingView>(apiClient.post(`/api/peeps/settings/${key}`, { value, ...(note ? { note } : {}) }));
export const confirmSetting = (key: PeepsSettingKey, version: number) => data<SettingView>(apiClient.post(`/api/peeps/settings/${key}/confirm`, { version }));
export const membership = () => data<Membership>(apiClient.get("/api/peeps/office/members"));
export const people = (q: string) => data<PersonRef[]>(apiClient.get("/api/peeps/office/people", { params: { q } }));
export const drift = () => data<GrantDrift[]>(apiClient.get("/api/peeps/office/drift"));
export const proposeChange = (input: { kind: OfficeChangeKind; employeeId: string; fromEmployeeId?: string; capabilities?: OfficeCapabilityId[]; effectiveFrom?: string; reason: string }) =>
  data<{ id: string }>(apiClient.post("/api/peeps/office/changes", input));
export const confirmChange = (id: string) => data<{ applied: boolean }>(apiClient.post(`/api/peeps/office/changes/${id}/confirm`));
