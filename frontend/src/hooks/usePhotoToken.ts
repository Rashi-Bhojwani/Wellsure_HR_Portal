import { useQuery } from "@tanstack/react-query";
import { getPhotoToken } from "../api/people";

// One photo-only token per session, shared by every avatar on screen (the
// directory renders hundreds). The backend issues it for 1 hour; refetch a
// little early so an image never requests with an expired token.
export function usePhotoToken(enabled = true): string | undefined {
  const { data } = useQuery({
    queryKey: ["people", "photo-token"],
    queryFn: getPhotoToken,
    enabled,
    staleTime: 50 * 60 * 1000,
    refetchInterval: 50 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return data?.token;
}
