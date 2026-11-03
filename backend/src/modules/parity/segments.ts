import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { buildWhere, type EmployeeListQuery } from "../employee/grid";
import type { ParityMeta, ParityViewer } from "./types";
import type { SegmentCriteria } from "./validators";

// A-9 G1 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 7). A FILTER is saved criteria; a LIST is named people. Both are resolved, every time, inside the
// VIEWER's own data scope: a filter shared by a director and used by someone who sees a team resolves to that team only, and a list naming people outside the
// viewer's scope simply does not show them. Sharing never widens access. Only the owner changes or archives a segment; nothing is ever deleted.

type SegmentRow = Prisma.EmployeeSegmentGetPayload<{ include: { owner: { include: { employee: { include: { nameHistory: true } } } } } }>;

const ownerInclude = { owner: { include: { employee: { include: { nameHistory: { where: inForceOn() } } } } } } as const;

/** The where-clause that resolves a segment for this viewer: the segment's own definition AND the viewer's scope. */
async function resolvedWhere(segment: { id: string; kind: "FILTER" | "LIST"; criteria: Prisma.JsonValue }, viewer: ParityViewer): Promise<Prisma.EmployeeWhereInput> {
  if (segment.kind === "FILTER") {
    // buildWhere already ANDs the viewer's scope (the same function the All Employees grid uses).
    return buildWhere(segment.criteria as unknown as EmployeeListQuery, viewer.employeeId, viewer.dataScope);
  }
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  return { AND: [scope, { segmentMemberships: { some: { segmentId: segment.id } } }] };
}

/** A segment this viewer may use: their own, or one another person shared. Archived ones are gone for everyone. Otherwise 404 (never says it exists). */
async function visibleSegment(id: string, viewer: ParityViewer): Promise<SegmentRow> {
  const row = await prisma.employeeSegment.findFirst({ where: { id, archivedAt: null, OR: [{ ownerUserId: viewer.userId }, { shared: true }] }, include: ownerInclude });
  if (!row) throw new HttpError(404, "Segment not found.", "NOT_FOUND");
  return row;
}

async function ownSegment(id: string, viewer: ParityViewer): Promise<SegmentRow> {
  const row = await visibleSegment(id, viewer);
  if (row.ownerUserId !== viewer.userId) throw new HttpError(403, "Only the person who saved it can change it.", "NOT_OWNER");
  return row;
}

async function format(row: SegmentRow, viewer: ParityViewer) {
  const count = await prisma.employee.count({ where: await resolvedWhere(row, viewer) });
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    shared: row.shared,
    criteria: row.kind === "FILTER" ? (row.criteria as SegmentCriteria) : null,
    isOwner: row.ownerUserId === viewer.userId,
    ownerName: row.owner.employee.nameHistory[0]?.fullName ?? row.owner.employee.employeeCode,
    // How many people it holds FOR THIS VIEWER (inside their scope) — never the owner's count.
    count,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertNameFree(ownerUserId: string, name: string, exceptId?: string) {
  const clash = await prisma.employeeSegment.findFirst({ where: { ownerUserId, archivedAt: null, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw new HttpError(409, `You already have a saved filter or segment called "${name}".`, "CONFLICT");
}

/** Every id must be someone the viewer can see — the same 404 for "out of scope" and "no such person" (never confirms an id). */
async function assertInScope(employeeIds: string[], viewer: ParityViewer): Promise<string[]> {
  const unique = [...new Set(employeeIds)];
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const found = await prisma.employee.count({ where: { AND: [scope, { id: { in: unique } }] } });
  if (found !== unique.length) throw new HttpError(404, "One or more of those people were not found.", "NOT_FOUND");
  return unique;
}

export async function listSegments(viewer: ParityViewer) {
  const rows = await prisma.employeeSegment.findMany({
    where: { archivedAt: null, OR: [{ ownerUserId: viewer.userId }, { shared: true }] },
    include: ownerInclude,
    orderBy: [{ name: "asc" }],
  });
  return Promise.all(rows.map((r) => format(r, viewer)));
}

export async function getSegment(id: string, viewer: ParityViewer) {
  return format(await visibleSegment(id, viewer), viewer);
}

export type CreateSegmentInput = { name: string; shared: boolean } & ({ kind: "FILTER"; criteria: SegmentCriteria } | { kind: "LIST"; employeeIds: string[] });

export async function createSegment(input: CreateSegmentInput, viewer: ParityViewer, meta: ParityMeta) {
  await assertNameFree(viewer.userId, input.name);
  const members = input.kind === "LIST" ? await assertInScope(input.employeeIds, viewer) : [];
  const row = await prisma.employeeSegment.create({
    data: {
      name: input.name,
      kind: input.kind,
      shared: input.shared,
      criteria: (input.kind === "FILTER" ? input.criteria : {}) as Prisma.InputJsonValue,
      ownerUserId: viewer.userId,
      members: { create: members.map((employeeId) => ({ employeeId })) },
    },
    include: ownerInclude,
  });
  await writeAuditLog({ ...meta, action: "employee.segment.created", entityType: "EmployeeSegment", entityId: row.id, after: { name: row.name, kind: row.kind, shared: row.shared, criteria: input.kind === "FILTER" ? input.criteria : null, memberCount: members.length } });
  return format(row, viewer);
}

export async function updateSegment(id: string, input: { name?: string; shared?: boolean; criteria?: SegmentCriteria; employeeIds?: string[] }, viewer: ParityViewer, meta: ParityMeta) {
  const before = await ownSegment(id, viewer);
  if (input.criteria && before.kind !== "FILTER") throw new HttpError(400, "A named group has people, not criteria.", "VALIDATION_ERROR");
  if (input.employeeIds && before.kind !== "LIST") throw new HttpError(400, "A saved filter has criteria, not people.", "VALIDATION_ERROR");
  if (input.name !== undefined) await assertNameFree(viewer.userId, input.name, id);
  const members = input.employeeIds ? await assertInScope(input.employeeIds, viewer) : null;
  const beforeCount = before.kind === "LIST" ? await prisma.employeeSegmentMember.count({ where: { segmentId: id } }) : null;
  await prisma.$transaction(async (tx) => {
    await tx.employeeSegment.update({
      where: { id },
      data: { ...(input.name !== undefined && { name: input.name }), ...(input.shared !== undefined && { shared: input.shared }), ...(input.criteria && { criteria: input.criteria as Prisma.InputJsonValue }) },
    });
    if (members) {
      await tx.employeeSegmentMember.deleteMany({ where: { segmentId: id, employeeId: { notIn: members } } });
      await tx.employeeSegmentMember.createMany({ data: members.map((employeeId) => ({ segmentId: id, employeeId })), skipDuplicates: true });
    }
  });
  await writeAuditLog({
    ...meta,
    action: "employee.segment.updated",
    entityType: "EmployeeSegment",
    entityId: id,
    before: { name: before.name, shared: before.shared, criteria: before.kind === "FILTER" ? before.criteria : null, memberCount: beforeCount },
    after: { name: input.name ?? before.name, shared: input.shared ?? before.shared, criteria: input.criteria ?? (before.kind === "FILTER" ? before.criteria : null), memberCount: members ? members.length : beforeCount },
  });
  return getSegment(id, viewer);
}

export async function archiveSegment(id: string, viewer: ParityViewer, meta: ParityMeta) {
  const row = await ownSegment(id, viewer);
  await prisma.employeeSegment.update({ where: { id }, data: { archivedAt: new Date() } });
  await writeAuditLog({ ...meta, action: "employee.segment.archived", entityType: "EmployeeSegment", entityId: id, before: { name: row.name, shared: row.shared } });
}

/** The people a segment holds for this viewer, as ids. Used by anything that takes a segment as an audience (mass email, letters). */
export async function resolveSegmentEmployeeIds(id: string, viewer: ParityViewer): Promise<string[]> {
  const row = await visibleSegment(id, viewer);
  const rows = await prisma.employee.findMany({ where: await resolvedWhere(row, viewer), select: { id: true }, orderBy: { employeeCode: "asc" } });
  return rows.map((r) => r.id);
}

export async function segmentMembers(id: string, viewer: ParityViewer, page: number, pageSize: number) {
  const row = await visibleSegment(id, viewer);
  const where = await resolvedWhere(row, viewer);
  const [total, people] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      orderBy: { employeeCode: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { nameHistory: { where: inForceOn() }, jobHistory: { where: inForceOn(), include: { department: true, designation: true } } },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    rows: people.map((e) => ({
      id: e.id,
      employeeCode: e.employeeCode,
      fullName: e.nameHistory[0]?.fullName ?? e.employeeCode,
      department: e.jobHistory[0]?.department.name ?? "—",
      designation: e.jobHistory[0]?.designation.name ?? "—",
      status: e.status,
    })),
  };
}
