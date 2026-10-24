import type { ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { DeleteOutlined, EditOutlined, EyeOutlined } from "@ant-design/icons";
import { radius, v } from "../../theme/tokens";
import { useIsPhone } from "../../ui";

type Kind = "edit" | "delete" | "view";

const FILL: Record<Kind, string> = { edit: v.edit, delete: v.danger, view: v.view };
const ICON: Record<Kind, ReactNode> = { edit: <EditOutlined />, delete: <DeleteOutlined />, view: <EyeOutlined /> };

// The board's solid square row actions (time-off-09: blue edit, red delete; DESIGN_SYSTEM.md §6.7). Icon-only, so always an aria-label and a
// tooltip; 44px on phones (touch target), 32px on desktop.
export function RowActionButton({ kind, label, onClick, loading, disabled }: { kind: Kind; label: string; onClick: () => void; loading?: boolean; disabled?: boolean }) {
  const phone = useIsPhone();
  const size = phone ? 44 : 32;
  return (
    <Tooltip title={label}>
      <Button
        aria-label={label}
        icon={ICON[kind]}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        loading={loading}
        disabled={disabled}
        style={{
          width: size,
          height: size,
          minWidth: size,
          padding: 0,
          borderRadius: radius.xs,
          border: "none",
          background: disabled ? v.bgSubtle : FILL[kind],
          color: disabled ? v.textSecondary : v.navActiveText,
        }}
      />
    </Tooltip>
  );
}
