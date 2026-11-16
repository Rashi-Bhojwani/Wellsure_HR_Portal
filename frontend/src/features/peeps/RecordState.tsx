import type { ReactNode } from "react";
import { EmptyState, QueryState, errorStatus } from "../../ui";

/**
 * QueryState for a Peeps record page. The API answers 404 for a record that does not exist or that this person may not see (it never says
 * which), so a 404 shows "not found", with no "Try again" that could never help; every other state is QueryState's own.
 */
export function RecordState({ isLoading, error, onRetry, children }: { isLoading: boolean; error: unknown; onRetry: () => void; children: ReactNode }) {
  if (!isLoading && errorStatus(error) === 404) return <EmptyState kind="no-results" title="Not found" description="This record does not exist, or it is not open to you." />;
  return <QueryState isLoading={isLoading} error={error} onRetry={onRetry}>{children}</QueryState>;
}
