import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { FEED_INCLUDE, formatPost } from "./posts";
import type { ActorMeta, EngageViewer } from "./types";

// A soft hide only — moderatedAt/moderatedByUserId get set, the row (and
// its backing Kudos/Poll/Comment/Reaction rows) stay in the database, same
// append-only convention as YearEndRun's SUPERSEDED status or
// Location.isActive. Every feed/count query already filters on
// moderatedAt IS NULL, so a moderated post disappears from the feed and
// stops counting toward kudos-received immediately, with no separate
// decrement step.
export async function moderatePost(postId: string, viewer: EngageViewer, meta: ActorMeta) {
  const existing = await prisma.post.findUnique({ where: { id: postId } });
  if (!existing) throw new HttpError(404, "Post not found.", "NOT_FOUND");
  if (existing.moderatedAt) throw new HttpError(409, "This post is already moderated.", "ALREADY_MODERATED");

  await prisma.post.update({ where: { id: postId }, data: { moderatedAt: new Date(), moderatedByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "engage.post.moderate", entityType: "Post", entityId: postId, before: { moderatedAt: null } });

  const reloaded = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: FEED_INCLUDE });
  return formatPost(reloaded, viewer.employeeId);
}

export async function unmoderatePost(postId: string, viewer: EngageViewer, meta: ActorMeta) {
  const existing = await prisma.post.findUnique({ where: { id: postId } });
  if (!existing) throw new HttpError(404, "Post not found.", "NOT_FOUND");
  if (!existing.moderatedAt) throw new HttpError(409, "This post isn't moderated.", "NOT_MODERATED");

  await prisma.post.update({ where: { id: postId }, data: { moderatedAt: null, moderatedByUserId: null } });
  await writeAuditLog({ ...meta, action: "engage.post.unmoderate", entityType: "Post", entityId: postId, before: { moderatedAt: existing.moderatedAt } });

  const reloaded = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: FEED_INCLUDE });
  return formatPost(reloaded, viewer.employeeId);
}

// Admin queue (spec §7.7 "moderate posts") — unlike the employee feed,
// this sees moderated posts too, so HR can review/un-hide.
export async function listPostsForModeration(query: { moderated?: boolean; page: number; pageSize: number }, viewerEmployeeId: string) {
  const where = query.moderated === undefined ? {} : query.moderated ? { moderatedAt: { not: null } } : { moderatedAt: null };
  const [total, rows] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      include: FEED_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { total, page: query.page, pageSize: query.pageSize, rows: rows.map((r) => formatPost(r, viewerEmployeeId)) };
}
