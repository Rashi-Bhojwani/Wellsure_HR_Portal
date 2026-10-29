import type { ItemStatus } from "../../api/payroll";
import { StatusChip, type ChipTone } from "../../ui";
import { fs, v } from "../../theme/tokens";

const STATUS: Record<ItemStatus, { tone: ChipTone; label: string }> = {
  CONFIRMED: { tone: "success", label: "Confirmed" },
  PLACEHOLDER: { tone: "warning", label: "Placeholder" },
  NOT_SET: { tone: "neutral", label: "Not set" },
};

/** Placeholder or Confirmed, with where the value came from in words underneath. */
export function ItemStatusTag({ status, sourceLabel }: { status: ItemStatus; sourceLabel?: string | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <StatusChip tone={STATUS[status].tone}>{STATUS[status].label}</StatusChip>
      {sourceLabel && <span style={{ fontSize: fs.sm, color: status === "PLACEHOLDER" ? v.warningText : v.textSecondary }}>{sourceLabel}</span>}
    </div>
  );
}
