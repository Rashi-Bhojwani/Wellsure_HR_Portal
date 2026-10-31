import { useQuery } from "@tanstack/react-query";
import { badgeCounts } from "./api";

/** Everyone's active badge count (Q-16: shown company-wide), one request shared by every directory card and org-chart node. Nothing for the Developer. */
export function useBadgeCounts() {
  return useQuery({ queryKey: ["recognition", "badge-counts"], queryFn: badgeCounts, staleTime: 60_000, retry: false });
}
