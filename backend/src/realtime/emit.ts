import type { Server as SocketIOServer } from "socket.io";

// A module-level singleton rather than passing `io` through every service
// call: `runApi()` (modes/api.ts) is the one process that ever has a real
// Socket.IO server, and every leave write path already runs inside that
// same process for the `api` mode. `worker`/`scheduler`/`migrate` modes,
// and every test that never calls createSocketServer, simply never set
// this — every emit* helper below no-ops in that case rather than throwing,
// since a leave write must still succeed with no one connected to notify.
let io: SocketIOServer | null = null;

export function setSocketServer(server: SocketIOServer): void {
  io = server;
}

export function getSocketServer(): SocketIOServer | null {
  return io;
}

// Payload shape shared by leave.applied/leave.decided (spec §8) — enough
// for the frontend to invalidate its pending-approvals/leave-request
// caches and show a toast without a follow-up fetch.
export interface LeaveEventPayload {
  leaveRequestId: string;
  employeeId: string;
  employeeName: string;
  leaveTypeCode: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
}

// Rooms: `manager:{id}` is joined by the employee who IS manager `id` (see
// socket.ts) — notifies the applicant's current reporting manager that a
// request is awaiting their decision. No-ops when the employee has no
// reporting manager on their current job history (e.g. the top of the org
// chart) — nothing to notify.
export function emitLeaveApplied(payload: LeaveEventPayload, reportingManagerId: string | null): void {
  if (!io || !reportingManagerId) return;
  io.to(`manager:${reportingManagerId}`).emit("leave.applied", payload);
}

// Rooms: `user:{id}` is joined by the employee who IS `id` — notifies the
// applicant their request was approved/rejected.
export function emitLeaveDecided(payload: LeaveEventPayload & { status: "APPROVED" | "REJECTED" }): void {
  if (!io) return;
  io.to(`user:${payload.employeeId}`).emit("leave.decided", payload);
}
