// PEEPS-BEGIN recruitment
import { recruitmentNotificationWhere } from "../recruitment/audience";
// PEEPS-END recruitment
// PEEPS-BEGIN exits
import { exitNotificationAudienceWhere } from "../exits/audience";
// PEEPS-END exits
// PEEPS-BEGIN helpdesk-visibility
import { notificationAudienceWhere } from "../helpdesk/categoryVisibility";
// PEEPS-END helpdesk-visibility
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import type { CreateNotificationInput } from "./types";

// The one function every other module's write path calls to persist a
// notification (spec §8: "every notification is also persisted in
// notifications... and optionally emailed"). Deliberately separate from
// realtime/emit.ts's emitNotificationNew — persistence must never depend
// on whether anyone is connected to receive the socket event, so callers
// invoke this directly, as its own step, before they emit, never through
// the emit helper.
// PEEPS-BEGIN helpdesk-moves
export async function createNotification(input: CreateNotificationInput, client: Pick<Prisma.TransactionClient, "notification"> = prisma) {
  return client.notification.create({
// PEEPS-END helpdesk-moves
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      payload: input.payload ? (input.payload as Prisma.InputJsonValue) : undefined,
    },
  });
}

function formatNotification(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  payload: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    payload: row.payload,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ListNotificationsQuery {
  page: number;
  pageSize: number;
}

// Unread-first (explicit NULLS FIRST — never rely on a DB engine's ASC/
// DESC null-ordering default), newest-first within each group.
export async function listNotifications(userId: string, query: ListNotificationsQuery) {
  // PEEPS-BEGIN helpdesk-visibility
  // PEEPS-BEGIN exits
  // PEEPS-BEGIN recruitment
  const audience = { AND: [await notificationAudienceWhere(userId), await exitNotificationAudienceWhere(userId), await recruitmentNotificationWhere(userId)] };
  // PEEPS-END recruitment
  // PEEPS-END exits
  // PEEPS-END helpdesk-visibility
  const [total, unreadCount, rows] = await Promise.all([
    // PEEPS-BEGIN helpdesk-visibility
    prisma.notification.count({ where: { userId, AND: [audience] } }),
    // PEEPS-END helpdesk-visibility
    // PEEPS-BEGIN helpdesk-visibility
    prisma.notification.count({ where: { userId, readAt: null, AND: [audience] } }),
    // PEEPS-END helpdesk-visibility
    prisma.notification.findMany({
      // PEEPS-BEGIN helpdesk-visibility
      where: { userId, AND: [audience] },
      // PEEPS-END helpdesk-visibility
      orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, unreadCount, page: query.page, pageSize: query.pageSize, rows: rows.map(formatNotification) };
}

export async function getUnreadCount(userId: string): Promise<number> {
  // PEEPS-BEGIN helpdesk-visibility
  // PEEPS-BEGIN exits
  // PEEPS-BEGIN recruitment
  const audience = { AND: [await notificationAudienceWhere(userId), await exitNotificationAudienceWhere(userId), await recruitmentNotificationWhere(userId)] };
  // PEEPS-END recruitment
  // PEEPS-END exits
  // PEEPS-END helpdesk-visibility
  // PEEPS-BEGIN helpdesk-visibility
  return prisma.notification.count({ where: { userId, readAt: null, AND: [audience] } });
  // PEEPS-END helpdesk-visibility
}

// A notification only ever belongs to its target user — 404, not 403, on
// someone else's id or a non-existent one, same "don't confirm existence"
// convention every other self-only lookup in this codebase follows.
export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  // PEEPS-BEGIN helpdesk-visibility
  // PEEPS-BEGIN exits
  // PEEPS-BEGIN recruitment
  const audience = { AND: [await notificationAudienceWhere(userId), await exitNotificationAudienceWhere(userId), await recruitmentNotificationWhere(userId)] };
  // PEEPS-END recruitment
  // PEEPS-END exits
  // PEEPS-END helpdesk-visibility
  const result = await prisma.notification.updateMany({
    // PEEPS-BEGIN helpdesk-visibility
    where: { id: notificationId, userId, AND: [audience] },
    // PEEPS-END helpdesk-visibility
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    throw new HttpError(404, "Notification not found.", "NOT_FOUND");
  }
}

export async function markAllAsRead(userId: string): Promise<void> {
  // PEEPS-BEGIN helpdesk-visibility
  // PEEPS-BEGIN exits
  // PEEPS-BEGIN recruitment
  const audience = { AND: [await notificationAudienceWhere(userId), await exitNotificationAudienceWhere(userId), await recruitmentNotificationWhere(userId)] };
  // PEEPS-END recruitment
  // PEEPS-END exits
  // PEEPS-END helpdesk-visibility
  // PEEPS-BEGIN helpdesk-visibility
  await prisma.notification.updateMany({ where: { userId, readAt: null, AND: [audience] }, data: { readAt: new Date() } });
  // PEEPS-END helpdesk-visibility
}
