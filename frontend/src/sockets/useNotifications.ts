import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notification as antdNotification } from "antd";
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
      antdNotification.info({
        message: payload.title,
        description: payload.body,
        placement: "topRight",
      });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }

    function onTasksCounts(): void {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tasks", "counts"] });
    }

    socket.on("notification.new", onNotificationNew);
    socket.on("tasks.counts", onTasksCounts);
    return () => {
      socket.off("notification.new", onNotificationNew);
      socket.off("tasks.counts", onTasksCounts);
    };
  }, [socket, queryClient]);
}
