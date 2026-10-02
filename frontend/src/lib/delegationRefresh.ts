import type { QueryClient } from "@tanstack/react-query";

// After a delegation is created or revoked (Phase 5 commit E3): refresh the
// delegation lists, Tasks and the leave review queue. Balances are only
// marked stale, not refetched: a revoked delegation drops rows from the
// queue, and refetching their balance cells first would just 404 on people
// who are no longer in reach. Cells still on screen refetch when remounted.
export function refreshAfterDelegationChange(queryClient: QueryClient): void {
  for (const key of [["delegations"], ["tasks"], ["leave", "requests"]]) void queryClient.invalidateQueries({ queryKey: key });
  void queryClient.invalidateQueries({ queryKey: ["leave", "balances"], refetchType: "none" });
}
