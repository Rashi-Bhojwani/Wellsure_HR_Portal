/* eslint-disable react-refresh/only-export-components -- context + hook are colocated by design */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { getAccessToken } from "../api/client";

// Socket.IO client wrapper (spec §8). Connection is opt-in via `enabled`
// — App.tsx flips this on/off with useAuth()'s isAuthenticated, so a
// socket only ever connects for a signed-in user. Handshake auth sends
// the same in-memory access token every REST call already uses (see
// realtime/socket.ts's server-side verification); useLeaveNotifications
// is what actually listens for events once connected.

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
  const socket = useMemo(() => (enabled ? io(API_BASE_URL, { withCredentials: true, auth: { token: getAccessToken() } }) : null), [enabled]);
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
