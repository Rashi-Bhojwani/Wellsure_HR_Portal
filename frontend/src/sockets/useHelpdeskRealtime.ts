import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "./SocketProvider";

// helpdesk.queue / helpdesk.ticket (Phase 5 commit D) — both signal-only
// (no ticket content ever rides on a socket event), so the handlers just
// invalidate. helpdesk.queue reaches the HR role rooms; HR's open thread
// refreshes on it too, since the person viewing may not be the assignee.
// helpdesk.ticket reaches the raiser and assignee of one ticket. Either can
// also change the Request Hub and Tasks inbox.
export function useHelpdeskRealtime(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    function onQueue(): void {
      void queryClient.invalidateQueries({ queryKey: ["helpdesk", "queue"] });
      void queryClient.invalidateQueries({ queryKey: ["helpdesk", "ticket"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
    function onTicket(payload: { ticketId: string }): void {
      void queryClient.invalidateQueries({ queryKey: ["helpdesk", "ticket", payload.ticketId] });
      void queryClient.invalidateQueries({ queryKey: ["helpdesk", "mine"] });
      void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }

    socket.on("helpdesk.queue", onQueue);
    socket.on("helpdesk.ticket", onTicket);
    return () => {
      socket.off("helpdesk.queue", onQueue);
      socket.off("helpdesk.ticket", onTicket);
    };
  }, [socket, queryClient]);
}
