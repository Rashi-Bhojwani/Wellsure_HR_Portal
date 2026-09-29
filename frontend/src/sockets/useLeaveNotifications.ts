import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { notification } from "antd";
import { useSocket } from "./SocketProvider";

interface LeaveEventPayload {
  leaveRequestId: string;
  employeeId: string;
  employeeName: string;
  leaveTypeCode: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
}
interface LeaveDecidedPayload extends LeaveEventPayload {
  status: "APPROVED" | "REJECTED";
}

// leave.applied / leave.decided (spec §8) — the server only ever routes
// these into `manager:{id}`/`user:{id}` rooms the signed-in socket is a
// member of (see realtime/socket.ts), so every event received here is
// already meant for this user; no client-side filtering needed.
export function useLeaveNotifications(): void {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    function invalidateLeaveQueries(): void {
      void queryClient.invalidateQueries({ queryKey: ["leave", "requests"] });
      void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
    }

    function onApplied(payload: LeaveEventPayload): void {
      notification.info({
        message: "New leave request",
        description: `${payload.employeeName} applied for ${payload.totalDays} day(s) of ${payload.leaveTypeCode} (${payload.fromDate} to ${payload.toDate}).`,
        placement: "topRight",
      });
      invalidateLeaveQueries();
    }

    function onDecided(payload: LeaveDecidedPayload): void {
      const approved = payload.status === "APPROVED";
      notification[approved ? "success" : "warning"]({
        message: approved ? "Leave approved" : "Leave rejected",
        description: `Your ${payload.leaveTypeCode} request (${payload.fromDate} to ${payload.toDate}) was ${payload.status.toLowerCase()}.`,
        placement: "topRight",
      });
      invalidateLeaveQueries();
    }

    socket.on("leave.applied", onApplied);
    socket.on("leave.decided", onDecided);
    return () => {
      socket.off("leave.applied", onApplied);
      socket.off("leave.decided", onDecided);
    };
  }, [socket, queryClient]);
}
