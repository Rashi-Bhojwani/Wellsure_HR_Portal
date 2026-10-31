import { useQuery } from "@tanstack/react-query";
import * as peepsApi from "./api";

/** The caller's place in the Wellsure Office (director, member, capabilities) and the workspace's name. */
export function usePeepsMe() {
  return useQuery({ queryKey: ["peeps", "me"], queryFn: peepsApi.me, staleTime: 60_000 });
}
