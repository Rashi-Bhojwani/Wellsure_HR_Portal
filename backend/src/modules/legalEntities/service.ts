import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { requireDirector } from "../../lib/directorAuthority";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

// M session block 2, AD-08: more than one company. The main company (company table) is unchanged and is every employee's company by default
// (one company is the conventional case for 150 to 500 people). Directors add further legal entities and move employees to one. Payroll does not
// read this yet: running payroll, statutory files and the bank file per entity is Session A's (request).
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}
export const entityBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/), name: z.string().trim().min(2).max(120), registeredAddress: z.string().trim().max(300).nullable().optional() }).strict();
export const assignBody = z.object({ employeeCodes: z.array(z.string().trim().min(1).max(40)).min(1).max(500), legalEntityId: z.string().min(1).max(64).nullable() }).strict();

export async function list() {
  const main = await prisma.company.findFirst({ orderBy: { createdAt: "asc" }, select: { name: true, legalName: true } });
  const entities = await prisma.legalEntity.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: true } } } });
  const assigned = entities.reduce((n, e) => n + e._count.employees, 0);
  const total = await prisma.employee.count({ where: { status: "ACTIVE" } });
  return { main: { name: main?.legalName ?? main?.name ?? "The company", activeEmployees: total - assigned }, entities: entities.map((e) => ({ id: e.id, code: e.code, name: e.name, registeredAddress: e.registeredAddress, employees: e._count.employees })) };
}

export async function create(input: z.infer<typeof entityBody>, meta: ActorMeta) {
  await requireDirector(meta.actorUserId, "add a company");
  try {
    const row = await prisma.legalEntity.create({ data: { code: input.code, name: input.name, registeredAddress: input.registeredAddress ?? null, createdByUserId: meta.actorUserId } });
    await writeAuditLog({ ...meta, action: "org.legal_entity.created", entityType: "LegalEntity", entityId: row.id, after: input });
    return { id: row.id };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "A company with this code already exists.", "DUPLICATE");
    throw e;
  }
}

export async function update(id: string, input: z.infer<typeof entityBody>, meta: ActorMeta) {
  await requireDirector(meta.actorUserId, "change a company");
  const before = await prisma.legalEntity.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Not found.", "NOT_FOUND");
  await prisma.legalEntity.update({ where: { id }, data: { code: input.code, name: input.name, registeredAddress: input.registeredAddress ?? null } });
  await writeAuditLog({ ...meta, action: "org.legal_entity.updated", entityType: "LegalEntity", entityId: id, before: { code: before.code, name: before.name, registeredAddress: before.registeredAddress }, after: input });
  return { id };
}

/** Moves employees to an entity, or back to the main company (null). */
export async function assign(input: z.infer<typeof assignBody>, meta: ActorMeta) {
  await requireDirector(meta.actorUserId, "move employees between companies");
  if (input.legalEntityId && !(await prisma.legalEntity.findUnique({ where: { id: input.legalEntityId }, select: { id: true } }))) throw new HttpError(404, "No such company.", "NOT_FOUND");
  const people = await prisma.employee.findMany({ where: { employeeCode: { in: input.employeeCodes } }, select: { id: true, employeeCode: true } });
  const missing = input.employeeCodes.filter((c) => !people.some((p) => p.employeeCode === c));
  if (missing.length) throw new HttpError(400, `No employee ${missing.slice(0, 10).join(", ")}`, "VALIDATION_ERROR");
  await prisma.$transaction(async (tx) => {
    for (const p of people) {
      if (input.legalEntityId) await tx.employeeLegalEntity.upsert({ where: { employeeId: p.id }, create: { employeeId: p.id, legalEntityId: input.legalEntityId, setByUserId: meta.actorUserId }, update: { legalEntityId: input.legalEntityId, setByUserId: meta.actorUserId, setAt: new Date() } });
      else await tx.employeeLegalEntity.deleteMany({ where: { employeeId: p.id } });
    }
  });
  await writeAuditLog({ ...meta, action: "org.legal_entity.assigned", entityType: "LegalEntity", entityId: input.legalEntityId ?? "main", after: { employees: people.length } });
  return { moved: people.length };
}

/** The company an employee belongs to (for the profile): an entity, or the main company. */
export async function ofEmployee(employeeId: string) {
  const row = await prisma.employeeLegalEntity.findUnique({ where: { employeeId }, include: { legalEntity: { select: { code: true, name: true } } } });
  return row ? { main: false, code: row.legalEntity.code, name: row.legalEntity.name } : { main: true, code: null, name: null };
}
