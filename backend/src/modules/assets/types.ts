import type { DataScope } from "@shared/constants/roles";

export interface ActorMeta {
  actorUserId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AssetViewer {
  userId: string;
  employeeId: string;
  dataScope: DataScope;
  permissions: Set<string>;
}

export interface PersonRef {
  employeeId: string;
  employeeCode: string;
  name: string;
}

/** A holder the viewer may not see (outside their data scope) is shown as hidden, never named. */
export type HolderRef = PersonRef | { hidden: true };

export interface CodeLabel {
  code: string;
  label: string;
}

export interface AssetSummary {
  id: string;
  assetId: string;
  name: string;
  category: CodeLabel;
  status: CodeLabel & { issuable: boolean };
  serialNumber: string | null;
  model: string | null;
  holder: HolderRef | null;
  openAssignmentId: string | null;
  acknowledged: boolean | null;
  updatedAt: string;
}

export interface AssignmentView {
  id: string;
  holder: HolderRef;
  issuedAt: string;
  issueCondition: CodeLabel;
  issueNote: string | null;
  acknowledgedAt: string | null;
  endedAt: string | null;
  endReason: "RETURNED" | "TRANSFERRED" | "LOST" | null;
  returnCondition: CodeLabel | null;
  endNote: string | null;
}

export interface AssetEventView {
  id: string;
  kind: string;
  at: string;
  actorName: string | null;
  holder: HolderRef | null;
  condition: CodeLabel | null;
  status: CodeLabel | null;
  note: string | null;
}

export interface AssetDetail extends AssetSummary {
  notes: string | null;
  createdAt: string;
  assignments: AssignmentView[];
  events: AssetEventView[];
}

export interface MyAssetView {
  assignmentId: string;
  assetId: string;
  name: string;
  category: string;
  serialNumber: string | null;
  model: string | null;
  issuedAt: string;
  issueCondition: string;
  acknowledgedAt: string | null;
  endedAt: string | null;
  endReason: "RETURNED" | "TRANSFERRED" | "LOST" | null;
}
