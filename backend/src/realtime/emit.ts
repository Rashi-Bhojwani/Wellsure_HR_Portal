import type { Server as SocketIOServer } from "socket.io";

// A module-level singleton rather than passing `io` through every service
// call. Two processes emit:
//   - `api` sets the real Socket.IO server (realtime/socket.ts);
//   - `worker` sets a Socket.IO *Redis emitter*
//     (realtime/emitter.ts), which publishes through the same Redis adapter
//     the api's server listens on — so a background job (a letter finishing,
//     a ticket auto-closing, a birthday post) reaches open screens live too.
//     Until Phase 5 commit D2 these modes set nothing and every emit from a
//     job was silently dropped.
// `scheduler` (only registers schedules), `migrate`, and tests that never
// set one get no-ops — a write must still
// succeed with no one connected to notify.
export interface RoomEmitter {
  to(room: string | string[]): { emit(event: string, ...args: unknown[]): unknown };
  // Both the real server and the Redis emitter can move a user's sockets
  // between rooms across every api instance.
  in?(room: string | string[]): { socketsJoin(rooms: string | string[]): unknown; socketsLeave(rooms: string | string[]): unknown };
}
let io: RoomEmitter | null = null;

// Permission-keyed room (E1): every socket joins perm:{key} for each
// permission its user effectively holds (realtime/socket.ts).
export const permissionRoom = (key: string) => `perm:${key}`;

export function setSocketServer(server: RoomEmitter | SocketIOServer | null): void {
  io = server as RoomEmitter | null;
}

export function getSocketServer(): RoomEmitter | null {
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
// (their own "review" count may have changed) plus everyone who can approve
// or monitor leave — by effective permission (E1), so a custom role or a
// per-user grant is included; one emit to the union of rooms, so nobody
// gets it twice.
export function emitTasksCounts(reportingManagerId: string | null): void {
  if (!io) return;
  const rooms = [permissionRoom("leave.approve"), permissionRoom("leave.view")];
  if (reportingManagerId) rooms.push(`manager:${reportingManagerId}`);
  io.to(rooms).emit("tasks.counts", {});
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
// helpdesk.queue → everyone holding helpdesk.manage (perm room); the queue
// endpoint itself decides what each of them may see (sensitive categories).
export function emitHelpdeskQueue(): void {
  if (!io) return;
  // Whoever can work the queue — by effective permission, not role (E1).
  io.to(permissionRoom("helpdesk.manage")).emit("helpdesk.queue");
}

// helpdesk.ticket → the people on one ticket, so an open thread refreshes live.
export function emitHelpdeskTicket(ticketId: string, employeeIds: Array<string | null | undefined>): void {
  if (!io) return;
  const rooms = [...new Set(employeeIds.filter((id): id is string => Boolean(id)))].map((id) => `user:${id}`);
  if (rooms.length > 0) io.to(rooms).emit("helpdesk.ticket", { ticketId });
}

// Letters (Phase 5 commit D2) — signal-only: the issuer's screen refetches
// when a queued letter finishes (generated or failed).
export function emitLetterUpdated(issuerEmployeeId: string | null, payload: { letterId: string; employeeId: string }): void {
  if (!io || !issuerEmployeeId) return;
  io.to(`user:${issuerEmployeeId}`).emit("letter.updated", payload);
}

// ── Access changes (Phase 5 commit E1) ──────────────────────────────────


// After someone's roles or overrides change: move their connected sockets
// to the permission rooms they now hold (and out of the ones they lost),
// then tell their browser to refetch /me so menus and buttons update without
// a reload. Signal-only payload.
export function emitPermissionsChanged(employeeId: string, effectivePermissions: Iterable<string>, allKeys: readonly string[]): void {
  if (!io) return;
  const keep = new Set(effectivePermissions);
  if (io.in) {
    const userRoom = `user:${employeeId}`;
    io.in(userRoom).socketsLeave(allKeys.filter((k) => !keep.has(k)).map(permissionRoom));
    io.in(userRoom).socketsJoin([...keep].map(permissionRoom));
  }
  io.to(`user:${employeeId}`).emit("permissions.changed", {});
}
