import type { AssetSettingItem } from "@shared/constants/assets";
import { isHidden, type AssetDetail, type AssetInput, type HolderRef } from "./api";

// Plain helpers shared by the asset screens (kept out of component files so fast refresh keeps working).

export type AssetAction = "create" | "edit" | "issue" | "return" | "transfer" | "lost" | "damaged";

export interface Lists {
  categories: AssetSettingItem[];
  statuses: AssetSettingItem[];
  conditions: AssetSettingItem[];
}

export interface ActionValues {
  name?: string;
  categoryCode?: string;
  statusCode?: string;
  serialNumber?: string;
  model?: string;
  notes?: string;
  employeeId?: string;
  toEmployeeId?: string;
  conditionCode?: string;
  note?: string;
}

export const holderText = (h: HolderRef | null): string => (h === null ? "Nobody" : isHidden(h) ? "Someone outside your scope" : `${h.name} (${h.employeeCode})`);

/** The request body for each action, from the form's values. */
export function bodyFor(action: AssetAction, v: ActionValues, asset: AssetDetail | null): unknown {
  const blank = (s?: string) => (s && s.trim() ? s.trim() : null);
  switch (action) {
    case "create":
    case "edit": {
      const body: AssetInput = { name: v.name!, categoryCode: v.categoryCode!, statusCode: v.statusCode!, serialNumber: blank(v.serialNumber), model: blank(v.model), notes: blank(v.notes) };
      return body;
    }
    case "issue":
      return { employeeId: v.employeeId!, conditionCode: v.conditionCode!, ...(v.note ? { note: v.note } : {}) };
    case "return":
      return { assignmentId: asset!.openAssignmentId!, conditionCode: v.conditionCode!, ...(v.statusCode ? { statusCode: v.statusCode } : {}), ...(v.note ? { note: v.note } : {}) };
    case "transfer":
      return { toEmployeeId: v.toEmployeeId!, conditionCode: v.conditionCode!, ...(v.note ? { note: v.note } : {}) };
    case "lost":
      return { statusCode: v.statusCode!, note: v.note! };
    case "damaged":
      return { conditionCode: v.conditionCode!, ...(v.statusCode ? { statusCode: v.statusCode } : {}), note: v.note! };
  }
}
