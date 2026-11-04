import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Mounted inside authentication, even when the exit screens are not open.
export function useExitCacheBoundary(employeeId: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    client.removeQueries({ predicate: query => query.queryKey[0] === "exits" &&
      (!employeeId || query.queryKey[1] !== "viewer" || query.queryKey[2] !== employeeId) });
  }, [client, employeeId]);
}
