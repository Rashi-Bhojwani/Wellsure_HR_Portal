import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "./SocketProvider";

// Attendance (Phase 2 P2-E, spec §8): a punch, a recompute or a
// forgot-to-punch request/decision refreshes whatever attendance screen is
// open (Attendance Info, the muster, the queues) within seconds. Signal-only.
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
    socket.on("punch.received", attendance);
    socket.on("attendance.updated", attendance);
    socket.on("regularization.submitted", regularization);
    socket.on("regularization.decided", regularization);
    return () => {
      socket.off("punch.received", attendance);
      socket.off("attendance.updated", attendance);
      socket.off("regularization.submitted", regularization);
      socket.off("regularization.decided", regularization);
    };
  }, [socket, queryClient]);
}
