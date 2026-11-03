import { useQuery } from "@tanstack/react-query";
import { getAvatarMap } from "./api";

/** Everyone's avatar choice and photo version, one request shared by every avatar on screen (refreshed after the caller changes their own). */
export function useAvatarMap() {
  return useQuery({ queryKey: ["avatars", "map"], queryFn: getAvatarMap, staleTime: 5 * 60_000, retry: false });
}

/** Where the catalogue's art is served from (frontend/public/avatars/; swap the files there to change the art). */
export const AVATAR_BASE = "/avatars/";
