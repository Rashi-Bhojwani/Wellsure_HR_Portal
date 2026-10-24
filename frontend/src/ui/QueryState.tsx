import type { ReactNode } from "react";
import { apiErrorMessage } from "../lib/apiError";
import { EmptyState } from "./EmptyState";
import { isForbidden, isOffline } from "./hooks";
import { SkeletonCard } from "./Skeletons";

interface QueryStateProps {
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown while loading (defaults to a card skeleton). Shape it like the final content. */
  skeleton?: ReactNode;
  /** True when loaded and there is nothing to show. */
  isEmpty?: boolean;
  empty?: ReactNode;
  children: ReactNode;
  compact?: boolean;
}

// The five states every screen must have (loading, empty, error, forbidden, content), in one place. Forbidden comes from the API's 403 — the UI never decides access itself.
export function QueryState({ isLoading, error, onRetry, skeleton, isEmpty, empty, children, compact }: QueryStateProps) {
  if (isLoading) return <>{skeleton ?? <SkeletonCard lines={4} />}</>;
  if (error) {
    if (isForbidden(error)) return <EmptyState kind="forbidden" compact={compact} />;
    if (isOffline(error)) return <EmptyState kind="offline" onRetry={onRetry} compact={compact} />;
    return <EmptyState kind="error" description={apiErrorMessage(error, "We couldn't load this. Try again.")} onRetry={onRetry} compact={compact} />;
  }
  if (isEmpty) return <>{empty ?? <EmptyState compact={compact} />}</>;
  return <>{children}</>;
}
