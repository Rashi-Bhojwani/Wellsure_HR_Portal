import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { emitEnginePostCommentCount } from "../../realtime/emit";
import type { EngageViewer } from "./types";

const NAME_INCLUDE = { nameHistory: { where: { effectiveTo: null as null } } } as const;

function currentName(employee: { nameHistory: { fullName: string }[]; employeeCode: string }): string {
  return employee.nameHistory[0]?.fullName ?? employee.employeeCode;
}

export async function listComments(postId: string) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.moderatedAt) throw new HttpError(404, "Post not found.", "NOT_FOUND");

  const rows = await prisma.comment.findMany({
    where: { postId },
    include: { author: { include: NAME_INCLUDE } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((c) => ({
    id: c.id,
    postId: c.postId,
    authorEmployeeId: c.authorEmployeeId,
    authorName: currentName(c.author),
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function addComment(postId: string, body: string, viewer: EngageViewer) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.moderatedAt) throw new HttpError(404, "Post not found.", "NOT_FOUND");

  const comment = await prisma.comment.create({
    data: { postId, authorEmployeeId: viewer.employeeId, body },
    include: { author: { include: NAME_INCLUDE } },
  });

  const commentCount = await prisma.comment.count({ where: { postId } });
  emitEnginePostCommentCount({ postId, commentCount });

  return {
    id: comment.id,
    postId: comment.postId,
    authorEmployeeId: comment.authorEmployeeId,
    authorName: currentName(comment.author),
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}
