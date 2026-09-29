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
export async function createNotification(input: CreateNotificationInput) {
  return prisma.notification.create({
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
  const [total, unreadCount, rows] = await Promise.all([
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, unreadCount, page: query.page, pageSize: query.pageSize, rows: rows.map(formatNotification) };
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

// A notification only ever belongs to its target user — 404, not 403, on
// someone else's id or a non-existent one, same "don't confirm existence"
// convention every other self-only lookup in this codebase follows.
export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    throw new HttpError(404, "Notification not found.", "NOT_FOUND");
  }
}

export async function markAllAsRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
