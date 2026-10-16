import { Space, Tag, Typography } from "antd";
import type { ItemStatus } from "../../api/payroll";

const STATUS: Record<ItemStatus, { color: string; label: string }> = {
  CONFIRMED: { color: "green", label: "Confirmed" },
  PLACEHOLDER: { color: "orange", label: "Placeholder" },
  NOT_SET: { color: "default", label: "Not set" },
};

/** Placeholder or Confirmed, with where the value came from in words underneath. */
export function ItemStatusTag({ status, sourceLabel }: { status: ItemStatus; sourceLabel?: string | null }) {
  return (
    <Space orientation="vertical" size={2}>
      <Tag color={STATUS[status].color} style={{ marginInlineEnd: 0 }}>
        {STATUS[status].label}
      </Tag>
      {sourceLabel && (
        <Typography.Text type={status === "PLACEHOLDER" ? "warning" : "secondary"} style={{ fontSize: 12 }}>
          {sourceLabel}
        </Typography.Text>
      )}
    </Space>
  );
}
