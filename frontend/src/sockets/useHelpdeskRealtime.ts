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

    // letter.updated (Phase 5 commit D2): a letter this user issued finished
    // generating (or failed) — refresh that employee's letters and documents.
    function onLetter(payload: { letterId: string; employeeId: string }): void {
      void queryClient.invalidateQueries({ queryKey: ["letters", "employee", payload.employeeId] });
      void queryClient.invalidateQueries({ queryKey: ["documents", "employee", payload.employeeId] });
    }

    socket.on("helpdesk.queue", onQueue);
    socket.on("helpdesk.ticket", onTicket);
    socket.on("letter.updated", onLetter);
    return () => {
      socket.off("helpdesk.queue", onQueue);
      socket.off("helpdesk.ticket", onTicket);
      socket.off("letter.updated", onLetter);
    };
  }, [socket, queryClient]);
}
