import { Tag, Tooltip } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";

// Shared bits of Attendance Settings (Phase 2 P2-A).

/** "Placeholder — awaiting HR" beside a value HR hasn't confirmed yet. */
export function PlaceholderTag({ field, placeholders }: { field: string; placeholders: string[] }) {
  if (!placeholders.includes(field)) return null;
  return (
    <Tooltip title="Not confirmed by HR yet. Enter HR's value, or confirm this one as it is.">
      <Tag color="orange" icon={<ExclamationCircleOutlined />} style={{ marginInlineStart: 6 }}>
        Placeholder — awaiting HR
      </Tag>
    </Tooltip>
  );
}

export function ActiveTag({ isActive, isDefault }: { isActive: boolean; isDefault?: boolean }) {
  return (
    <>
      <Tag color={isActive ? "green" : "default"}>{isActive ? "Active" : "Inactive"}</Tag>
      {isDefault && <Tag color="blue">Company default</Tag>}
    </>
  );
}
