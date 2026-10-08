import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { emitEngagePost } from "../../realtime/emit";
import { FEED_INCLUDE, formatPost } from "./posts";
import type { ActorMeta, EngageViewer } from "./types";

export async function createPoll(viewer: EngageViewer, input: { question: string; options: string[]; groupId?: string; closesAt?: string }, meta: ActorMeta) {
  if (input.groupId) {
    const group = await prisma.group.findUnique({ where: { id: input.groupId } });
    if (!group || !group.isActive) throw new HttpError(404, "Group not found.", "NOT_FOUND");
  }

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: { authorEmployeeId: viewer.employeeId, groupId: input.groupId ?? null, kind: "POLL", body: input.question },
    });
    await tx.poll.create({
      data: {
        postId: created.id,
        question: input.question,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        options: { create: input.options.map((label, rank) => ({ label, rank })) },
      },
    });
    return tx.post.findUniqueOrThrow({ where: { id: created.id }, include: FEED_INCLUDE() });
  });

  await writeAuditLog({ ...meta, action: "engage.poll.create", entityType: "Post", entityId: post.id, after: { optionCount: input.options.length } });

  const formatted = formatPost(post, viewer.employeeId);
  emitEngagePost(formatted);
  return formatted;
}

// One vote per employee per poll (schema's plain unique index on
// [pollId, employeeId]) — voting again just moves the existing vote to
// the newly-picked option rather than adding a second row.
export async function votePoll(pollOptionId: string, viewer: EngageViewer) {
  const option = await prisma.pollOption.findUnique({ where: { id: pollOptionId }, include: { poll: { include: { post: true } } } });
  if (!option) throw new HttpError(404, "Poll option not found.", "NOT_FOUND");
  if (option.poll.closedAt || (option.poll.closesAt && option.poll.closesAt <= new Date())) {
    throw new HttpError(409, "This poll is closed.", "POLL_CLOSED");
  }

  await prisma.pollVote.upsert({
    where: { pollId_employeeId: { pollId: option.pollId, employeeId: viewer.employeeId } },
    create: { pollId: option.pollId, pollOptionId, employeeId: viewer.employeeId },
    update: { pollOptionId },
  });

  const post = await prisma.post.findUniqueOrThrow({ where: { id: option.poll.postId }, include: FEED_INCLUDE() });
  const formatted = formatPost(post, viewer.employeeId);
  emitEngagePost(formatted);
  return formatted;
}

// Closing early — the poll author or an engage.moderate holder; a poll
// with no closesAt otherwise stays open indefinitely.
export async function closePoll(postId: string, viewer: EngageViewer, meta: ActorMeta) {
  const post = await prisma.post.findUnique({ where: { id: postId }, include: { poll: true } });
  if (!post || !post.poll) throw new HttpError(404, "Poll not found.", "NOT_FOUND");
  if (post.authorEmployeeId !== viewer.employeeId && !viewer.permissions.has("engage.moderate")) {
    throw new HttpError(403, "Only the poll's author or a moderator can close it.", "FORBIDDEN");
  }
  if (post.poll.closedAt) throw new HttpError(409, "This poll is already closed.", "ALREADY_CLOSED");

  await prisma.poll.update({ where: { id: post.poll.id }, data: { closedAt: new Date() } });
  await writeAuditLog({ ...meta, action: "engage.poll.close", entityType: "Post", entityId: postId });

  const reloaded = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: FEED_INCLUDE() });
  const formatted = formatPost(reloaded, viewer.employeeId);
  emitEngagePost(formatted);
  return formatted;
}
