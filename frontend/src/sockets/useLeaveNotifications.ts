import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "./SocketProvider";

// leave.applied / leave.decided (spec §8) — the server only ever routes
// these into `manager:{id}`/`user:{id}` rooms the signed-in socket is a
// member of (see realtime/socket.ts), so every event received here is
// already meant for this user; no client-side filtering needed.
//
// Cache invalidation only — no toast here. Every leave.applied/
// leave.decided is now paired with a persisted Notification row (see
// modules/leave/requests.ts's notifyEmployee), and useNotifications
// already shows a toast for that generic notification.new event. Showing
// a toast from both hooks for the same action means the user sees the
// same message twice.
export function useLeaveNotifications(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    function invalidateLeaveQueries(): void {
      void queryClient.invalidateQueries({ queryKey: ["leave", "requests"] });
      void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
    }

    socket.on("leave.applied", invalidateLeaveQueries);
    socket.on("leave.decided", invalidateLeaveQueries);
    socket.on("leave.balance.changed", invalidateLeaveQueries);
    return () => {
      socket.off("leave.applied", invalidateLeaveQueries);
      socket.off("leave.decided", invalidateLeaveQueries);
      socket.off("leave.balance.changed", invalidateLeaveQueries);
    };
  }, [socket, queryClient]);
}
