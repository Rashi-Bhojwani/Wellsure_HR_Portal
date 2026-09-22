/* eslint-disable react-refresh/only-export-components -- context + hook are colocated by design */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

// Socket.IO client wrapper (spec §8). Connection is opt-in via `enabled`
// — nothing should auto-connect until real sessions exist in Phase 1, and
// none of the real-time events (attendance.updated, leave.applied, ...)
// are wired up until the modules that emit them land in Phase 2+.

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export function SocketProvider({
  children,
  enabled = false,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  // `enabled` only flips on login/logout, so recreating the instance on
  // change (rather than mutating one in a ref) is cheap and keeps the
  // instance safe to read during render.
  const socket = useMemo(() => (enabled ? io(API_BASE_URL, { withCredentials: true }) : null), [enabled]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!socket) return;

    const onConnect = (): void => setConnected(true);
    const onDisconnect = (): void => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.disconnect();
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
