import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notifyInfo } from "./notify";
import { useSocket } from "./SocketProvider";

interface NotificationEventPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
}

// notification.new / tasks.counts (spec §8) — mirrors useLeaveNotifications
// exactly. notification.new is the generic delivery event every module's
// write path emits once its Notification row is persisted (see
// realtime/emit.ts's emitNotificationNew); tasks.counts is signal-only
// (no payload), so the handler here just invalidates the query rather than
// trying to read a count off the event itself.
export function useNotifications(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    function onNotificationNew(payload: NotificationEventPayload): void {
      notifyInfo({
        title: payload.title,
        description: payload.body,
        placement: "topRight",
      });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      // HR shared a document with this employee (Phase 5 commit C) — refresh
      // My Documents live rather than waiting for a reload.
      if (payload.type.startsWith("document.")) void queryClient.invalidateQueries({ queryKey: ["documents", "mine"] });
      // Anything that lands as a notification may also have changed what's
      // waiting on this person or the state of one of their requests.
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
    }

    function onTasksCounts(): void {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tasks", "counts"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      // HR's Employee Leave queue (its "no manager can approve" flags move
      // with leave grants and new requests, not only with leave.* events).
      void queryClient.invalidateQueries({ queryKey: ["leave", "requests", "admin"] });
    }

    socket.on("notification.new", onNotificationNew);
    socket.on("tasks.counts", onTasksCounts);
    return () => {
      socket.off("notification.new", onNotificationNew);
      socket.off("tasks.counts", onTasksCounts);
    };
  }, [socket, queryClient]);
}
