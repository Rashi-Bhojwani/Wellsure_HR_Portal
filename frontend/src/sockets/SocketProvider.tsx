/* eslint-disable react-refresh/only-export-components -- context + hook are colocated by design */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
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
  // instance safe to read during render. The client library itself loads
  // only once someone is signed in, so the login screen never downloads it
  // (bundle budget, docs/DESIGN_SYSTEM.md §7).
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void import("socket.io-client").then(({ io }) => {
      if (!cancelled) setSocket(io(API_BASE_URL, { withCredentials: true, auth: { token: getAccessToken() } }));
    });
    return () => {
      // Signing out (or unmounting) drops the instance; the effect below then disconnects it.
      cancelled = true;
      setSocket(null);
    };
  }, [enabled]);

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
    <SocketContext.Provider value={{ socket, connected: socket ? connected : false }}>{children}</SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
