import type { ReactNode } from "react";
import { EmptyState as UiEmptyState } from "../../ui/EmptyState";
import type { IllustrationName } from "../../ui/Illustrations";

interface EmptyStateProps {
  message: string;
  extra?: ReactNode;
  // Tighter vertical padding for cards sharing a grid row with content-heavy
  // siblings (e.g. Employee Home's Review/Track cards), so the row doesn't
  // stretch taller than it needs to.
  compact?: boolean;
  description?: ReactNode;
  illustration?: IllustrationName;
}

// Kept for the screens that already use it; it is the design system's EmptyState (src/ui) with our own illustration (docs/DESIGN_SYSTEM.md §6.13).
export function EmptyState({ message, extra, compact = false, description = null, illustration }: EmptyStateProps) {
  return <UiEmptyState title={message} description={description} action={extra} compact={compact} illustration={illustration} />;
}
