import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { emitEngageReaction } from "../../realtime/emit";
import type { EngageViewer } from "./types";

// One row per (post, employee) — picking a different emoji replaces it,
// picking the same emoji again removes it (a toggle), matching how every
// reaction UI (Slack, greytHR itself) behaves. Never a second row.
export async function toggleReaction(postId: string, emoji: string, viewer: EngageViewer) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.moderatedAt) throw new HttpError(404, "Post not found.", "NOT_FOUND");

  const existing = await prisma.reaction.findUnique({
    where: { postId_employeeId: { postId, employeeId: viewer.employeeId } },
  });

  if (existing && existing.emoji === emoji) {
    await prisma.reaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.reaction.upsert({
      where: { postId_employeeId: { postId, employeeId: viewer.employeeId } },
      create: { postId, employeeId: viewer.employeeId, emoji },
      update: { emoji },
    });
  }

  const reactions = await prisma.reaction.findMany({ where: { postId } });
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  const viewerReaction = reactions.find((r) => r.employeeId === viewer.employeeId)?.emoji ?? null;

  const payload = {
    postId,
    reactions: [...counts.entries()].map(([e, count]) => ({ emoji: e, count })),
  };
  emitEngageReaction(payload);
  return { ...payload, viewerReaction };
}
