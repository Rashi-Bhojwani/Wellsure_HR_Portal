import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

// M session block 2, ER-27: divisions, an optional grouping of departments. Unused until a division is created. A department belongs to at most one;
// an employee's division is their department's (so it follows the effective-dated job history without a column of its own).

export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const divisionBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, "Code: capitals, digits, - or _"), name: z.string().trim().min(2).max(80) }).strict();
export const departmentsBody = z.object({ departmentIds: z.array(z.string().min(1).max(64)).max(500) }).strict();

const unique = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "A division with this code or name already exists.", "DUPLICATE");
    throw e;
  }
};

export async function list() {
  const rows = await prisma.division.findMany({ orderBy: { name: "asc" }, include: { departments: { include: { department: { select: { id: true, code: true, name: true } } } } } });
  return rows.map((d) => ({ id: d.id, code: d.code, name: d.name, departments: d.departments.map((x) => x.department).sort((a, b) => a.name.localeCompare(b.name)) }));
}

export async function create(input: z.infer<typeof divisionBody>, meta: ActorMeta) {
  const row = await unique(() => prisma.division.create({ data: input }));
  await writeAuditLog({ ...meta, action: "org.division.created", entityType: "Division", entityId: row.id, after: input });
  return { id: row.id };
}

export async function update(id: string, input: z.infer<typeof divisionBody>, meta: ActorMeta) {
  const before = await prisma.division.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Division not found.", "NOT_FOUND");
  await unique(() => prisma.division.update({ where: { id }, data: input }));
  await writeAuditLog({ ...meta, action: "org.division.updated", entityType: "Division", entityId: id, before: { code: before.code, name: before.name }, after: input });
  return { id };
}

export async function remove(id: string, meta: ActorMeta) {
  const before = await prisma.division.findUnique({ where: { id }, include: { _count: { select: { departments: true } } } });
  if (!before) throw new HttpError(404, "Division not found.", "NOT_FOUND");
  if (before._count.departments > 0) throw new HttpError(409, `This division has ${before._count.departments} department(s). Move them first.`, "IN_USE");
  await prisma.division.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "org.division.deleted", entityType: "Division", entityId: id, before: { code: before.code, name: before.name } });
}

/** The departments of a division, replacing the list. A department moved here leaves its previous division. */
export async function setDepartments(id: string, departmentIds: string[], meta: ActorMeta) {
  const division = await prisma.division.findUnique({ where: { id }, include: { departments: true } });
  if (!division) throw new HttpError(404, "Division not found.", "NOT_FOUND");
  const ids = [...new Set(departmentIds)];
  if ((await prisma.department.count({ where: { id: { in: ids } } })) !== ids.length) throw new HttpError(400, "One of the departments does not exist.", "VALIDATION_ERROR");
  const before = division.departments.map((d) => d.departmentId).sort();
  await prisma.$transaction(async (tx) => {
    await tx.departmentDivision.deleteMany({ where: { divisionId: id, departmentId: { notIn: ids } } });
    for (const departmentId of ids) {
      await tx.departmentDivision.upsert({ where: { departmentId }, create: { departmentId, divisionId: id, setByUserId: meta.actorUserId }, update: { divisionId: id, setByUserId: meta.actorUserId, setAt: new Date() } });
    }
  });
  await writeAuditLog({ ...meta, action: "org.division.departments_set", entityType: "Division", entityId: id, before: { departmentIds: before }, after: { departmentIds: ids.sort() } });
  return { id, departments: ids.length };
}
