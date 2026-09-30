import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "./types";

const NAME_INCLUDE = { nameHistory: { where: { effectiveTo: null as null } } } as const;

function formatGroup(row: { id: string; name: string; description: string | null; isActive: boolean; createdAt: Date }) {
  return { id: row.id, name: row.name, description: row.description, isActive: row.isActive, createdAt: row.createdAt.toISOString() };
}

export async function listGroups() {
  const rows = await prisma.group.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: true, posts: true } } } });
  return rows.map((r) => ({ ...formatGroup(r), memberCount: r._count.members, postCount: r._count.posts }));
}

// Employee-facing — only active groups, for the feed's "Groups" filter and
// the create-post group picker.
export async function listActiveGroups() {
  const rows = await prisma.group.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  return rows.map(formatGroup);
}

export async function createGroup(input: { name: string; description?: string }, meta: ActorMeta) {
  const row = await prisma.group.create({ data: { name: input.name, description: input.description ?? null } });
  await writeAuditLog({ ...meta, action: "engage.group.create", entityType: "Group", entityId: row.id, after: formatGroup(row) });
  return formatGroup(row);
}

export async function updateGroup(id: string, input: { name?: string; description?: string | null; isActive?: boolean }, meta: ActorMeta) {
  const existing = await prisma.group.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Group not found.", "NOT_FOUND");

  const row = await prisma.group.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  });
  await writeAuditLog({ ...meta, action: "engage.group.update", entityType: "Group", entityId: id, before: formatGroup(existing), after: formatGroup(row) });
  return formatGroup(row);
}

export async function listMembers(groupId: string) {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) throw new HttpError(404, "Group not found.", "NOT_FOUND");

  const rows = await prisma.groupMember.findMany({
    where: { groupId },
    include: { employee: { include: NAME_INCLUDE } },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((m) => ({
    employeeId: m.employeeId,
    employeeName: m.employee.nameHistory[0]?.fullName ?? m.employee.employeeCode,
    joinedAt: m.joinedAt.toISOString(),
  }));
}

export async function addMember(groupId: string, employeeId: string, meta: ActorMeta): Promise<void> {
  const [group, employee] = await Promise.all([
    prisma.group.findUnique({ where: { id: groupId } }),
    prisma.employee.findUnique({ where: { id: employeeId } }),
  ]);
  if (!group) throw new HttpError(404, "Group not found.", "NOT_FOUND");
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");

  const existing = await prisma.groupMember.findUnique({ where: { groupId_employeeId: { groupId, employeeId } } });
  if (existing) return; // already a member — idempotent, not an error

  await prisma.groupMember.create({ data: { groupId, employeeId } });
  await writeAuditLog({ ...meta, action: "engage.group.member.add", entityType: "Group", entityId: groupId, after: { employeeId } });
}

export async function removeMember(groupId: string, employeeId: string, meta: ActorMeta): Promise<void> {
  const result = await prisma.groupMember.deleteMany({ where: { groupId, employeeId } });
  if (result.count === 0) throw new HttpError(404, "This employee is not a member of this group.", "NOT_FOUND");
  await writeAuditLog({ ...meta, action: "engage.group.member.remove", entityType: "Group", entityId: groupId, before: { employeeId } });
}
