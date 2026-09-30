import type { Post, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import { emitEngagePost } from "../../realtime/emit";
import type { ActorMeta, EngageViewer } from "./types";

const NAME_INCLUDE = { nameHistory: { where: { effectiveTo: null as null } } } as const;

// Every field a feed card / detail view needs, fetched in one query per
// page (Prisma batches the nested includes — no N+1 per post). Comments
// are counted here but fetched in full via their own endpoint, since a
// popular post's comment list can grow independently of the feed page.
export const FEED_INCLUDE = {
  author: { include: NAME_INCLUDE },
  subject: { include: NAME_INCLUDE },
  group: true,
  kudos: { include: { fromEmployee: { include: NAME_INCLUDE }, toEmployee: { include: NAME_INCLUDE } } },
  poll: { include: { options: { include: { votes: true }, orderBy: { rank: "asc" as const } } } },
  reactions: true,
  _count: { select: { comments: true } },
} satisfies Prisma.PostInclude;

export type PostWithIncludes = Prisma.PostGetPayload<{ include: typeof FEED_INCLUDE }>;

function currentName(employee: { nameHistory: { fullName: string }[]; employeeCode: string } | null): string | null {
  if (!employee) return null;
  return employee.nameHistory[0]?.fullName ?? employee.employeeCode;
}

export function formatPost(post: PostWithIncludes, viewerEmployeeId: string) {
  const reactionCounts = new Map<string, number>();
  let viewerReaction: string | null = null;
  for (const r of post.reactions) {
    reactionCounts.set(r.emoji, (reactionCounts.get(r.emoji) ?? 0) + 1);
    if (r.employeeId === viewerEmployeeId) viewerReaction = r.emoji;
  }

  return {
    id: post.id,
    kind: post.kind,
    body: post.body,
    authorEmployeeId: post.authorEmployeeId,
    authorName: currentName(post.author),
    subjectEmployeeId: post.subjectEmployeeId,
    subjectName: currentName(post.subject),
    groupId: post.groupId,
    groupName: post.group?.name ?? null,
    occurredOn: post.occurredOn ? post.occurredOn.toISOString().slice(0, 10) : null,
    isModerated: post.moderatedAt !== null,
    createdAt: post.createdAt.toISOString(),
    kudos: post.kudos
      ? {
          fromEmployeeId: post.kudos.fromEmployeeId,
          fromName: currentName(post.kudos.fromEmployee),
          toEmployeeId: post.kudos.toEmployeeId,
          toName: currentName(post.kudos.toEmployee),
          message: post.kudos.message,
        }
      : null,
    poll: post.poll
      ? {
          id: post.poll.id,
          question: post.poll.question,
          closesAt: post.poll.closesAt?.toISOString() ?? null,
          closedAt: post.poll.closedAt?.toISOString() ?? null,
          totalVotes: post.poll.options.reduce((sum, o) => sum + o.votes.length, 0),
          viewerVotedOptionId: post.poll.options.find((o) => o.votes.some((v) => v.employeeId === viewerEmployeeId))?.id ?? null,
          options: post.poll.options.map((o) => ({ id: o.id, label: o.label, voteCount: o.votes.length })),
        }
      : null,
    reactions: [...reactionCounts.entries()].map(([emoji, count]) => ({ emoji, count })),
    viewerReaction,
    commentCount: post._count.comments,
  };
}

export interface ListFeedQuery {
  kind?: Post["kind"];
  groupId?: string;
  locationId?: string;
  departmentId?: string;
  search?: string;
  page: number;
  pageSize: number;
}

// The feed is org-wide by design (see schema.prisma's Group comment) —
// location/department filters narrow by the author's (or, for AUTO_*
// posts with no author, the subject's) CURRENT job history, not a scope
// stored on the post itself. A moderated post never appears here.
export async function listFeed(query: ListFeedQuery, viewerEmployeeId: string) {
  const and: Prisma.PostWhereInput[] = [];
  if (query.locationId) {
    and.push({
      OR: [
        { author: { jobHistory: { some: { effectiveTo: null, locationId: query.locationId } } } },
        { subject: { jobHistory: { some: { effectiveTo: null, locationId: query.locationId } } } },
      ],
    });
  }
  if (query.departmentId) {
    and.push({
      OR: [
        { author: { jobHistory: { some: { effectiveTo: null, departmentId: query.departmentId } } } },
        { subject: { jobHistory: { some: { effectiveTo: null, departmentId: query.departmentId } } } },
      ],
    });
  }

  const where: Prisma.PostWhereInput = {
    moderatedAt: null,
    ...(query.kind && { kind: query.kind }),
    ...(query.groupId && { groupId: query.groupId }),
    ...(query.search && { body: { contains: query.search, mode: "insensitive" } }),
    ...(and.length > 0 && { AND: and }),
  };

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

export async function getPost(id: string, viewerEmployeeId: string) {
  const post = await prisma.post.findUnique({ where: { id }, include: FEED_INCLUDE });
  if (!post || post.moderatedAt) throw new HttpError(404, "Post not found.", "NOT_FOUND");
  return formatPost(post, viewerEmployeeId);
}

export async function createPost(viewer: EngageViewer, input: { body: string; groupId?: string }, meta: ActorMeta) {
  if (input.groupId) {
    const group = await prisma.group.findUnique({ where: { id: input.groupId } });
    if (!group || !group.isActive) throw new HttpError(404, "Group not found.", "NOT_FOUND");
  }

  const post = await prisma.post.create({
    data: { authorEmployeeId: viewer.employeeId, groupId: input.groupId ?? null, kind: "USER", body: input.body },
    include: FEED_INCLUDE,
  });
  await writeAuditLog({ ...meta, action: "engage.post.create", entityType: "Post", entityId: post.id, after: { kind: post.kind, groupId: post.groupId } });

  const formatted = formatPost(post, viewer.employeeId);
  emitEngagePost(formatted);
  return formatted;
}
