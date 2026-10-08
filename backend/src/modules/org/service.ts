import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";

interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function conflict(message: string): HttpError {
  return new HttpError(409, message, "CONFLICT");
}

// Prisma's unique-constraint violation (P2002) → a friendly 409 instead of
// a raw 500, for any create/update across this module's six resources.
async function runUnique<T>(fn: () => Promise<T>, onConflict: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict(onConflict);
    }
    throw err;
  }
}

// ── Cities ───────────────────────────────────────────────────────────────

export async function listCities() {
  return prisma.city.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { locations: true } } } });
}

export async function createCity(data: { name: string; state: string }, meta: ActorMeta) {
  const city = await runUnique(() => prisma.city.create({ data }), `A city named "${data.name}" already exists.`);
  await writeAuditLog({ ...meta, action: "org.city.created", entityType: "City", entityId: city.id, after: city });
  return city;
}

export async function updateCity(id: string, data: Partial<{ name: string; state: string }>, meta: ActorMeta) {
  const before = await prisma.city.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "City not found.", "NOT_FOUND");
  const after = await runUnique(
    () => prisma.city.update({ where: { id }, data }),
    `A city named "${data.name}" already exists.`,
  );
  await writeAuditLog({ ...meta, action: "org.city.updated", entityType: "City", entityId: id, before, after });
  return after;
}

export async function deleteCity(id: string, meta: ActorMeta): Promise<void> {
  const before = await prisma.city.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "City not found.", "NOT_FOUND");
  const referencedCount = await prisma.location.count({ where: { cityId: id } });
  if (referencedCount > 0) {
    throw conflict(`This city has ${referencedCount} branch(es) assigned to it. Reassign or delete them first.`);
  }
  await prisma.city.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "org.city.deleted", entityType: "City", entityId: id, before });
}

// ── Locations (branches) ────────────────────────────────────────────────

export async function listLocations(includeInactive: boolean) {
  return prisma.location.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: "asc" },
    include: { cityMaster: true, _count: { select: { jobHistory: true } } },
  });
}

interface LocationInput {
  code: string;
  name: string;
  cityId?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  pincode: string;
  hasBiometricDevice?: boolean;
}

export async function createLocation(data: LocationInput, meta: ActorMeta) {
  const location = await runUnique(
    () => prisma.location.create({ data }),
    `A branch with code "${data.code}" or name "${data.name}" already exists.`,
  );
  await writeAuditLog({ ...meta, action: "org.location.created", entityType: "Location", entityId: location.id, after: location });
  return location;
}

export async function updateLocation(id: string, data: Partial<LocationInput> & { isActive?: boolean }, meta: ActorMeta) {
  const before = await prisma.location.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Branch not found.", "NOT_FOUND");
  const after = await runUnique(
    () => prisma.location.update({ where: { id }, data }),
    `A branch with code "${data.code}" or name "${data.name}" already exists.`,
  );
  await writeAuditLog({
    ...meta,
    action: before.isActive !== after.isActive ? (after.isActive ? "org.location.reactivated" : "org.location.deactivated") : "org.location.updated",
    entityType: "Location",
    entityId: id,
    before,
    after,
  });
  return after;
}

export async function deleteLocation(id: string, meta: ActorMeta): Promise<void> {
  const before = await prisma.location.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Branch not found.", "NOT_FOUND");
  const referencedCount = await prisma.employeeJobHistory.count({ where: { locationId: id } });
  if (referencedCount > 0) {
    throw conflict(
      `This branch has ${referencedCount} employee job-history record(s) attached. Deactivate it instead of deleting — history must stay intact.`,
    );
  }
  await assertNoScopedContent({ scopeLocationId: id }, "branch");
  await prisma.location.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "org.location.deleted", entityType: "Location", entityId: id, before });
}

// Announcements and company documents can be scoped to a branch or
// department. Deleting one of those must never silently widen that content
// to the whole company, so delete is refused while anything is scoped to it.
async function assertNoScopedContent(
  where: { scopeLocationId: string } | { scopeDepartmentId: string },
  label: "branch" | "department",
): Promise<void> {
  const [announcements, documents] = await Promise.all([prisma.announcement.count({ where }), prisma.companyDocument.count({ where })]);
  if (announcements + documents > 0) {
    throw conflict(
      `This ${label} has ${announcements} announcement(s) and ${documents} company document(s) scoped to it. ` +
        `Re-scope or remove them first${label === "branch" ? ", or merge this branch into another (scoped content moves with it)" : ""}.`,
    );
  }
}

// Merges a near-duplicate branch into another: every EmployeeJobHistory row
// pointing at the source is repointed to the target, then the (now
// unreferenced) source is deleted. Both branches' own fields are untouched
// — HR picks which one is the "real" record and merges the duplicate away.
export async function mergeLocations(sourceId: string, targetId: string, meta: ActorMeta): Promise<void> {
  if (sourceId === targetId) {
    throw new HttpError(400, "Cannot merge a branch into itself.", "VALIDATION_ERROR");
  }
  const [source, target] = await Promise.all([
    prisma.location.findUnique({ where: { id: sourceId } }),
    prisma.location.findUnique({ where: { id: targetId } }),
  ]);
  if (!source || !target) {
    throw new HttpError(404, "Branch not found.", "NOT_FOUND");
  }

  const movedCount = await prisma.$transaction(async (tx) => {
    const result = await tx.employeeJobHistory.updateMany({ where: { locationId: sourceId }, data: { locationId: targetId } });
    // Content scoped to the duplicate branch follows it to the real one —
    // otherwise deleting the source would leave it pointing nowhere (the
    // FK is RESTRICT; it used to be SET NULL, which silently made scoped
    // content org-wide).
    await tx.announcement.updateMany({ where: { scopeLocationId: sourceId }, data: { scopeLocationId: targetId } });
    await tx.companyDocument.updateMany({ where: { scopeLocationId: sourceId }, data: { scopeLocationId: targetId } });
    await tx.location.delete({ where: { id: sourceId } });
    return result.count;
  });

  await writeAuditLog({
    ...meta,
    action: "org.location.merged",
    entityType: "Location",
    entityId: targetId,
    before: { mergedFrom: source, movedJobHistoryRows: movedCount },
    after: target,
  });
}

// ── Departments / Designations / Grades / Cost Centres ─────────────────
// Same CRUD shape for all four — a small generic helper set keyed by the
// Prisma delegate, rather than four near-identical copies of each function.

type SimpleMasterDelegate = "department" | "designation" | "grade" | "costCentre";

const RESOURCE_LABEL: Record<SimpleMasterDelegate, string> = {
  department: "Department",
  designation: "Designation",
  grade: "Grade",
  costCentre: "Cost centre",
};
const AUDIT_ENTITY: Record<SimpleMasterDelegate, string> = {
  department: "Department",
  designation: "Designation",
  grade: "Grade",
  costCentre: "CostCentre",
};
const REFERENCE_FIELD: Record<SimpleMasterDelegate, "departmentId" | "designationId" | "gradeId" | "costCentreId"> = {
  department: "departmentId",
  designation: "designationId",
  grade: "gradeId",
  costCentre: "costCentreId",
};

// Department/Designation/Grade/CostCentre are structurally identical
// (id/code/name/timestamps, Grade adding `rank`) but Prisma generates a
// distinct delegate type per model whose method signatures don't unify
// across a union — calling them generically needs one narrow, explicit
// interface asserted at the single point where the resource name is
// turned into a delegate, rather than per call site.
interface SimpleMasterRow {
  id: string;
  code: string;
  name: string;
  rank?: number | null;
}
interface SimpleMasterModel {
  findMany(args: { orderBy: { name: "asc" } }): Promise<SimpleMasterRow[]>;
  findUnique(args: { where: { id: string } }): Promise<SimpleMasterRow | null>;
  create(args: { data: { code: string; name: string; rank?: number } }): Promise<SimpleMasterRow>;
  update(args: {
    where: { id: string };
    data: Partial<{ code: string; name: string; rank: number }>;
  }): Promise<SimpleMasterRow>;
  delete(args: { where: { id: string } }): Promise<SimpleMasterRow>;
}

function delegateFor(resource: SimpleMasterDelegate): SimpleMasterModel {
  return prisma[resource] as unknown as SimpleMasterModel;
}

export async function listSimpleMaster(resource: SimpleMasterDelegate) {
  return delegateFor(resource).findMany({ orderBy: { name: "asc" } });
}

export async function createSimpleMaster(
  resource: SimpleMasterDelegate,
  data: { code: string; name: string; rank?: number },
  meta: ActorMeta,
) {
  const label = RESOURCE_LABEL[resource];
  const created = await runUnique(
    () => delegateFor(resource).create({ data }),
    `A ${label.toLowerCase()} with code "${data.code}" or name "${data.name}" already exists.`,
  );
  await writeAuditLog({
    ...meta,
    action: `org.${resource}.created`,
    entityType: AUDIT_ENTITY[resource],
    entityId: created.id,
    after: created,
  });
  return created;
}

export async function updateSimpleMaster(
  resource: SimpleMasterDelegate,
  id: string,
  data: Partial<{ code: string; name: string; rank: number }>,
  meta: ActorMeta,
) {
  const label = RESOURCE_LABEL[resource];
  const before = await delegateFor(resource).findUnique({ where: { id } });
  if (!before) throw new HttpError(404, `${label} not found.`, "NOT_FOUND");
  const after = await runUnique(
    () => delegateFor(resource).update({ where: { id }, data }),
    `A ${label.toLowerCase()} with code "${data.code}" or name "${data.name}" already exists.`,
  );
  await writeAuditLog({ ...meta, action: `org.${resource}.updated`, entityType: AUDIT_ENTITY[resource], entityId: id, before, after });
  return after;
}

export async function deleteSimpleMaster(resource: SimpleMasterDelegate, id: string, meta: ActorMeta): Promise<void> {
  const label = RESOURCE_LABEL[resource];
  const before = await delegateFor(resource).findUnique({ where: { id } });
  if (!before) throw new HttpError(404, `${label} not found.`, "NOT_FOUND");
  const referencedCount = await prisma.employeeJobHistory.count({ where: { [REFERENCE_FIELD[resource]]: id } });
  if (referencedCount > 0) {
    throw conflict(`This ${label.toLowerCase()} has ${referencedCount} employee job-history record(s) attached and can't be deleted.`);
  }
  if (resource === "department") await assertNoScopedContent({ scopeDepartmentId: id }, "department");
  await delegateFor(resource).delete({ where: { id } });
  await writeAuditLog({ ...meta, action: `org.${resource}.deleted`, entityType: AUDIT_ENTITY[resource], entityId: id, before });
}
