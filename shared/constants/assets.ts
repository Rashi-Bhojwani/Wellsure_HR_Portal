// Peeps module 1 — the asset register (docs/plans/PEEPS_PLAN.md §B.2). Shared by backend and frontend.
//
// Nothing here is a business value: categories, statuses and conditions are owner settings with no defaults (an empty register refuses to take an
// asset until each list is entered and confirmed). This file only holds the shapes, the ID format and the screen paths.

export const ASSET_SETTING_KINDS = ["CATEGORIES", "STATUSES", "CONDITIONS"] as const;
export type AssetSettingKind = (typeof ASSET_SETTING_KINDS)[number];

export const ASSET_SETTING_LABELS: Record<AssetSettingKind, { label: string; what: string }> = {
  CATEGORIES: { label: "Categories", what: "What kinds of asset the company keeps (for example laptops or phones)." },
  STATUSES: { label: "Statuses", what: "The states an asset can be in while nobody holds it, and whether an asset in that state can be issued." },
  CONDITIONS: { label: "Conditions", what: "How an asset's condition is recorded when it is issued, returned or reported damaged." },
};

export const ASSET_EVENT_KINDS = ["CREATED", "EDITED", "ISSUED", "ACKNOWLEDGED", "RETURNED", "REASSIGNED", "LOST", "DAMAGED"] as const;
export type AssetEventKind = (typeof ASSET_EVENT_KINDS)[number];

export const ASSET_EVENT_LABELS: Record<AssetEventKind, string> = {
  CREATED: "Added to the register",
  EDITED: "Details changed",
  ISSUED: "Issued",
  ACKNOWLEDGED: "Receipt acknowledged",
  RETURNED: "Returned",
  REASSIGNED: "Transferred",
  LOST: "Reported lost",
  DAMAGED: "Reported damaged",
};

export const ASSET_END_REASONS = ["RETURNED", "REASSIGNED", "LOST"] as const;
export type AssetEndReason = (typeof ASSET_END_REASONS)[number];

/** One entry of a setting list. `issuable` is used by statuses only. */
export interface AssetSettingItem {
  code: string;
  label: string;
  issuable?: boolean;
}

export const ASSET_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;
export const MAX_ASSET_SETTING_ITEMS = 100;

/** The stable asset ID shown everywhere. The number is never reused. */
export function formatAssetId(n: number): string {
  return `AST-${String(n).padStart(6, "0")}`;
}

export const myAssetsPath = "/app/my-assets";
export const assetAdminPath = (assetId: string) => `/admin/assets/register?asset=${assetId}`;
