import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "./SocketProvider";

// Attendance (Phase 2 P2-E, spec §8): a punch, a recompute or a
// forgot-to-punch request/decision refreshes whatever attendance screen is
// open (Attendance Info, the muster, the queues) within seconds; a sync agent's
// heartbeat (P2-F) refreshes the device screens. Signal-only.
export function useAttendanceRealtime(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!socket) return;
    const attendance = () => void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    const regularization = () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
    };
    // P2-F: a sync agent reported in — the Devices screen and Admin Home's
    // device warnings (clock drift, retention) refresh.
    const devices = () => void queryClient.invalidateQueries({ queryKey: ["biometric"] });
    socket.on("device.status", devices);
    socket.on("punch.received", attendance);
    socket.on("attendance.updated", attendance);
    socket.on("regularization.submitted", regularization);
    socket.on("regularization.decided", regularization);
    return () => {
      socket.off("device.status", devices);
      socket.off("punch.received", attendance);
      socket.off("attendance.updated", attendance);
      socket.off("regularization.submitted", regularization);
      socket.off("regularization.decided", regularization);
    };
  }, [socket, queryClient]);
}
