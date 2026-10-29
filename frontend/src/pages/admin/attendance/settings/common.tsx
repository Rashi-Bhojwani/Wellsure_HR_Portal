import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { StatusChip } from "../../../../ui";
import { fs, fw, space, v } from "../../../../theme/tokens";

// Shared bits of Attendance Settings (Phase 2 P2-A).

/** "Placeholder — awaiting HR" beside a value HR hasn't confirmed yet. */
export function PlaceholderTag({ field, placeholders }: { field: string; placeholders: string[] }) {
  if (!placeholders.includes(field)) return null;
  return (
    <Tooltip title="Not confirmed by HR yet. Enter HR's value, or confirm this one as it is.">
      <span tabIndex={0} style={{ display: "inline-flex", marginInlineStart: space[2], verticalAlign: "middle" }}>
        <StatusChip tone="warning" icon={<ExclamationCircleOutlined />}>
          Placeholder — awaiting HR
        </StatusChip>
      </span>
    </Tooltip>
  );
}

export function ActiveTag({ isActive, isDefault }: { isActive: boolean; isDefault?: boolean }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: space[1] }}>
      <StatusChip status={isActive ? "ACTIVE" : "INACTIVE"}>{isActive ? "Active" : "Inactive"}</StatusChip>
      {isDefault && <StatusChip tone="info">Company default</StatusChip>}
    </span>
  );
}

/** Code over name, the first column of every settings list. */
export function CodeName({ code, name }: { code: string; name: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{name}</div>
      <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{code}</div>
    </div>
  );
}

/** Grey explanatory line under a panel title or above a form group. */
export function Hint({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p style={{ margin: `0 0 ${space[4]}px`, color: v.textSecondary, fontSize: fs.sm, lineHeight: 1.6, ...style }}>{children}</p>;
}

/** Responsive field grid for drawer forms: as many columns as fit at `min` px, one on phones. */
export function FieldGrid({ children, min = 180 }: { children: ReactNode; min?: number }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, gap: `0 ${space[4]}px` }}>{children}</div>;
}
