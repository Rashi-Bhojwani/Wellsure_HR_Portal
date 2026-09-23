import { Empty } from "antd";
import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  extra?: ReactNode;
  // Tighter vertical padding for cards sharing a grid row with content-heavy
  // siblings (e.g. Employee Home's Review/Track cards), so the row doesn't
  // stretch taller than it needs to.
  compact?: boolean;
}

// Icon/empty-state in place of greytHR's illustrations, per the branding
// constraint in docs/UI_REFERENCE.md (e.g. "Nothing to review", "Nothing
// new to track", "No records found").
export function EmptyState({ message, extra, compact = false }: EmptyStateProps) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={message}
      style={{ padding: compact ? "8px 0" : "24px 0" }}
    >
      {extra}
    </Empty>
  );
}
