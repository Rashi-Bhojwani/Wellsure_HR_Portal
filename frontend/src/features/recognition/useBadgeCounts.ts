import { useQuery } from "@tanstack/react-query";
import { badgeCounts, nudgeCounts } from "./api";

/** Everyone's active badge count (shown company-wide), one request shared by every directory card and org-chart node. Nothing for the Developer. */
export function useBadgeCounts() {
  return useQuery({ queryKey: ["recognition", "badge-counts"], queryFn: badgeCounts, staleTime: 60_000, retry: false });
}

/** Everyone's active nudge-tag count (public), for the directory cards. */
export function useNudgeCounts() {
  return useQuery({ queryKey: ["recognition", "nudge-counts"], queryFn: nudgeCounts, staleTime: 60_000, retry: false });
}
