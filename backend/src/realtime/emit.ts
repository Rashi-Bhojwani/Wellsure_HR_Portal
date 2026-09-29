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

// Delivery for an already-persisted Notification row (spec §8) — never
// the write itself, see modules/notifications/service.ts's
// createNotification, which every caller invokes first, as its own step,
// before it ever reaches this function. `targetEmployeeId` is the
// notification's *employee* id, not its `Notification.userId` DB column
// — rooms are keyed by employeeId (see realtime/socket.ts), so callers
// must resolve that themselves rather than passing the raw user id.
export interface NotificationEventPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
}

export function emitNotificationNew(targetEmployeeId: string, payload: NotificationEventPayload): void {
  if (!io) return;
  io.to(`user:${targetEmployeeId}`).emit("notification.new", payload);
}

// Signal-only, no payload — the frontend just invalidates its task-counts
// query on receipt rather than trying to keep a server-computed number in
// sync purely from event fields. Rooms: the applicant's reporting manager
// (their own "review" count may have changed) plus every HR_ADMIN/
// HR_EXECUTIVE-held role room (an org-wide "monitor" count may have
// changed too, for any ALL-scope viewer, not just this one manager).
export function emitTasksCounts(reportingManagerId: string | null): void {
  if (!io) return;
  if (reportingManagerId) io.to(`manager:${reportingManagerId}`).emit("tasks.counts", {});
  io.to("role:HR_ADMIN").emit("tasks.counts", {});
  io.to("role:HR_EXECUTIVE").emit("tasks.counts", {});
}
