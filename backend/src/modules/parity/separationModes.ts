import { Prisma } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { findScopedEmployee } from "../employee/service";
import type { ParityMeta, ParityViewer } from "./types";

// A-9 G7 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 10). The modes of leaving are the company's own list (org.manage): nothing is seeded, so until the
// company makes its list every separation's mode is Not set. A mode is switched off, never deleted (old separations keep theirs). The mode of one separation is
// set by whoever may separate employees (employee.separate), for a person in their scope, with a reason, audited. The status (initiated, completed, cancelled)
// and the reason text stay exactly as the existing separation module keeps them.

export async function listModes(includeInactive: boolean) {
  const rows = await prisma.separationMode.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { label: "asc" } });
  return rows.map((m) => ({ id: m.id, code: m.code, label: m.label, isActive: m.isActive }));
}

export async function createMode(input: { code: string; label: string }, viewer: ParityViewer, meta: ParityMeta) {
  try {
    const m = await prisma.separationMode.create({ data: { code: input.code, label: input.label, createdByUserId: viewer.userId } });
    await writeAuditLog({ ...meta, action: "separation.mode.created", entityType: "SeparationMode", entityId: m.id, after: { code: m.code, label: m.label } });
    return { id: m.id, code: m.code, label: m.label, isActive: m.isActive };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, `A mode with code "${input.code}" already exists.`, "CONFLICT");
    throw err;
  }
}

export async function updateMode(id: string, input: { label?: string; isActive?: boolean }, meta: ParityMeta) {
  const before = await prisma.separationMode.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Mode not found.", "NOT_FOUND");
  const m = await prisma.separationMode.update({ where: { id }, data: input });
  await writeAuditLog({ ...meta, action: "separation.mode.updated", entityType: "SeparationMode", entityId: id, before: { label: before.label, isActive: before.isActive }, after: { label: m.label, isActive: m.isActive } });
  return { id: m.id, code: m.code, label: m.label, isActive: m.isActive };
}

export async function setSeparationMode(separationId: string, modeId: string | null, reason: string, viewer: ParityViewer, meta: ParityMeta) {
  const sep = await prisma.separation.findUnique({ where: { id: separationId } });
  if (!sep) throw new HttpError(404, "Separation not found.", "NOT_FOUND");
  try {
    await findScopedEmployee(sep.employeeId, viewer.employeeId, viewer.dataScope);
  } catch {
    throw new HttpError(404, "Separation not found.", "NOT_FOUND");
  }
  if (sep.status === "CANCELLED") throw new HttpError(409, "This separation was cancelled.", "CANCELLED");
  if ((sep.modeId ?? null) === modeId) return { id: separationId, modeId }; // unchanged: nothing written (a mode switched off since stays on the separation)
  if (modeId && !(await prisma.separationMode.findFirst({ where: { id: modeId, isActive: true } }))) throw new HttpError(400, "Choose a mode from the list.", "VALIDATION_ERROR");
  await prisma.separation.update({ where: { id: separationId }, data: { modeId } });
  await writeAuditLog({ ...meta, action: "separation.mode.set", entityType: "Separation", entityId: separationId, before: { modeId: sep.modeId }, after: { modeId, reason, employeeId: sep.employeeId } });
  return { id: separationId, modeId };
}

/** The mode of each separation, for the Separations list (the existing list, which is not scoped either, stays as it is; this adds one column). */
export async function separationModesFor() {
  const rows = await prisma.separation.findMany({ where: { modeId: { not: null } }, select: { id: true, mode: { select: { id: true, label: true } } } });
  return Object.fromEntries(rows.map((r) => [r.id, r.mode]));
}
