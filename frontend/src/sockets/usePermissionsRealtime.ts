import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../hooks/useAuth";
import { useSocket } from "./SocketProvider";

// permissions.changed (Phase 5 commit E1) — signal-only, sent to someone
// whose roles or per-user exceptions just changed (or whose role was
// edited). Refetch /me so menus, buttons and route gates match the new
// access without a reload; the server has already moved this socket into
// the right permission rooms. Also refresh any open access screens.
export function usePermissionsRealtime(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();

  useEffect(() => {
    if (!socket) return;
    function onChanged(): void {
      void refreshUser();
      void queryClient.invalidateQueries({ queryKey: ["access"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
    socket.on("permissions.changed", onChanged);
    return () => {
      socket.off("permissions.changed", onChanged);
    };
  }, [socket, queryClient, refreshUser]);
}
