import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "../../sockets/SocketProvider";

// assets.changed reaches the perm:assets.view room (the register's readers); notification.new already refreshes the bell for the holder. Signal only:
// no asset content rides on the socket, so the handlers just invalidate. The holder's own list refreshes on their notification too.
export function useAssetsRealtime(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    function onChanged(): void {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    }
    function onNotification(payload: { type?: string }): void {
      if (payload.type?.startsWith("assets.")) void queryClient.invalidateQueries({ queryKey: ["assets", "mine"] });
    }
    socket.on("assets.changed", onChanged);
    socket.on("notification.new", onNotification);
    return () => {
      socket.off("assets.changed", onChanged);
      socket.off("notification.new", onNotification);
    };
  }, [socket, queryClient]);
}
