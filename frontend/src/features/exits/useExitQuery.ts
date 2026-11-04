import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useAuth } from "../../hooks/useAuth";

// Private exit responses are never placeholder data for another query or viewer.
export function useExitQuery<T>(options: Omit<UseQueryOptions<T>, "enabled" | "placeholderData"> & { enabled?: boolean }) {
  const employeeId = useAuth().user?.employeeId;
  return useQuery<T>({
    ...options,
    gcTime: 0,
    queryKey: ["exits", "viewer", employeeId, ...options.queryKey.slice(1)],
    enabled: Boolean(employeeId) && options.enabled !== false,
  });
}
