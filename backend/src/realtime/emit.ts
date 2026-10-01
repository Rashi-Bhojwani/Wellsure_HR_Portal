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

// Engage (spec §4, §7.7, §8's "engage.post/.kudos/.reaction | org (or
// scoped)" and "engage.birthday/.joining/.anniversary | org (daily 08:00
// cron + on joining)"). Every event fires to the org-wide `org` room —
// the feed itself isn't location/department-scoped on the post (see
// schema.prisma's Group comment), so there's no narrower room to target;
// the frontend's own filters decide what to show after invalidating.
// Payload is `unknown` here rather than the full formatted-post type to
// avoid a circular import with modules/engage/posts.ts (whose
// formatPost() return shape is the actual payload) — this module is a
// pure transport layer, it never inspects the payload it forwards.
export function emitEngagePost(payload: unknown): void {
  if (!io) return;
  io.to("org").emit("engage.post", payload);
}

export function emitEngageKudos(payload: unknown): void {
  if (!io) return;
  io.to("org").emit("engage.kudos", payload);
}

export interface EngageReactionPayload {
  postId: string;
  reactions: { emoji: string; count: number }[];
}

export function emitEngageReaction(payload: EngageReactionPayload): void {
  if (!io) return;
  io.to("org").emit("engage.reaction", payload);
}

export interface EngageCommentCountPayload {
  postId: string;
  commentCount: number;
}

// Not a named event in spec §8's table — comments don't get their own
// realtime event there, but a live comment count is worth the same
// query-invalidation treatment reactions get, so it rides the same `org`
// room under its own event name rather than overloading `engage.post`.
export function emitEnginePostCommentCount(payload: EngageCommentCountPayload): void {
  if (!io) return;
  io.to("org").emit("engage.comment", payload);
}

export function emitEngageBirthday(payload: unknown): void {
  if (!io) return;
  io.to("org").emit("engage.birthday", payload);
}

export function emitEngageJoining(payload: unknown): void {
  if (!io) return;
  io.to("org").emit("engage.joining", payload);
}

export function emitEngageAnniversary(payload: unknown): void {
  if (!io) return;
  io.to("org").emit("engage.anniversary", payload);
}

// Helpdesk (Phase 5 commit D). Both are signal-only — clients refetch, so
// no ticket content (and never an internal note) rides on a broadcast.
// helpdesk.queue → the HR rooms that may hold helpdesk.manage; the queue
// endpoint itself decides what each of them may see (sensitive categories).
export function emitHelpdeskQueue(): void {
  if (!io) return;
  io.to(["role:HR_ADMIN", "role:HR_EXECUTIVE", "role:SUPER_ADMIN"]).emit("helpdesk.queue");
}

// helpdesk.ticket → the people on one ticket, so an open thread refreshes live.
export function emitHelpdeskTicket(ticketId: string, employeeIds: Array<string | null | undefined>): void {
  if (!io) return;
  const rooms = [...new Set(employeeIds.filter((id): id is string => Boolean(id)))].map((id) => `user:${id}`);
  if (rooms.length > 0) io.to(rooms).emit("helpdesk.ticket", { ticketId });
}
