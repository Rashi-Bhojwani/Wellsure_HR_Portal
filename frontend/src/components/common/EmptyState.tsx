import { Empty } from "antd";
import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  extra?: ReactNode;
}

// Icon/empty-state in place of greytHR's illustrations, per the branding
// constraint in docs/UI_REFERENCE.md (e.g. "Nothing to review", "Nothing
// new to track", "No records found").
export function EmptyState({ message, extra }: EmptyStateProps) {
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={message} style={{ padding: "24px 0" }}>
      {extra}
    </Empty>
  );
}
