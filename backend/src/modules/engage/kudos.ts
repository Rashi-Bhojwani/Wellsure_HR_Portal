import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { emitEngageKudos } from "../../realtime/emit";
import { FEED_INCLUDE, formatPost } from "./posts";
import type { ActorMeta, EngageViewer } from "./types";

export async function giveKudos(viewer: EngageViewer, input: { toEmployeeId: string; message: string; groupId?: string }, meta: ActorMeta) {
  if (input.toEmployeeId === viewer.employeeId) {
    throw new HttpError(400, "You can't give kudos to yourself.", "SELF_KUDOS");
  }
  const recipient = await prisma.employee.findUnique({ where: { id: input.toEmployeeId } });
  if (!recipient || recipient.status !== "ACTIVE") throw new HttpError(404, "Employee not found.", "NOT_FOUND");

  if (input.groupId) {
    const group = await prisma.group.findUnique({ where: { id: input.groupId } });
    if (!group || !group.isActive) throw new HttpError(404, "Group not found.", "NOT_FOUND");
  }

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: { authorEmployeeId: viewer.employeeId, groupId: input.groupId ?? null, kind: "KUDOS", body: input.message },
    });
    await tx.kudos.create({
      data: { postId: created.id, fromEmployeeId: viewer.employeeId, toEmployeeId: input.toEmployeeId, message: input.message },
    });
    return tx.post.findUniqueOrThrow({ where: { id: created.id }, include: FEED_INCLUDE() });
  });

  await writeAuditLog({ ...meta, action: "engage.kudos.give", entityType: "Post", entityId: post.id, after: { toEmployeeId: input.toEmployeeId } });

  const formatted = formatPost(post, viewer.employeeId);
  emitEngageKudos(formatted);
  return formatted;
}

// Always a live COUNT, never a stored counter — a moderated kudos post
// stops counting immediately, with no separate decrement to get wrong
// (see schema.prisma's Post comment on the moderation convention this
// codebase uses everywhere else).
export async function getKudosReceivedCount(employeeId: string): Promise<number> {
  return prisma.kudos.count({ where: { toEmployeeId: employeeId, post: { moderatedAt: null } } });
}

export async function getKudosGivenCount(employeeId: string): Promise<number> {
  return prisma.kudos.count({ where: { fromEmployeeId: employeeId, post: { moderatedAt: null } } });
}
