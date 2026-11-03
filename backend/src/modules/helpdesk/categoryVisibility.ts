import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { writeAuditLogs } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta, HelpdeskViewer } from "./service";

// General desk only. Never materialize Payroll tickets or change their routing.
export const PAYROLL_CATEGORY = "PAYROLL_SALARY";
const missing = () => new HttpError(404, "Category not found.", "NOT_FOUND");
export const visibilitySchema = z.object({
  hrRoleCodes: z.array(z.enum(["HR_ADMIN", "HR_EXECUTIVE"])),
  employeeIds: z.array(z.string().min(1)),
  reason: z.string().trim().min(1).max(2000),
  version: z.number().int().min(0),
}).refine((v) => v.hrRoleCodes.length + v.employeeIds.length > 0, "Choose who can work this category.");
export type VisibilityInput = z.infer<typeof visibilitySchema>;

// Use the existing effective-access resolver, including the Developer ceiling.
// A permission grant by itself can never turn a person into a director.
export async function requireVisibilityDirector(userId: string) {
  const access = await resolveAccess(userId);
  if (!access.isSuperAdmin || !access.permissions.has("helpdesk.visibility.manage")) throw new HttpError(403, "Only a director can set category visibility.", "FORBIDDEN");
}

export async function visibilityPeople() {
  const rows = await prisma.user.findMany({
    where: { status: "ACTIVE", employee: { status: "ACTIVE" } },
    select: { id: true, employeeId: true, employee: { select: { employeeCode: true } } },
  });
  const eligible = await Promise.all(rows.map(async (u) => ({ ...u, access: await resolveAccess(u.id) })));
  return eligible.filter((u) => u.access.permissions.has("helpdesk.manage") && !u.access.roleCodes.includes("DEVELOPER"))
    .map((u) => ({ id: u.employeeId, employeeCode: u.employee.employeeCode, director: u.access.isSuperAdmin }));
}

export async function readVisibility(categoryId: string, viewer: HelpdeskViewer) {
  await requireVisibilityDirector(viewer.userId);
  const category = await prisma.helpdeskCategory.findFirst({ where: { id: categoryId, code: { not: PAYROLL_CATEGORY } }, select: { id: true } });
  if (!category) throw missing();
  const [current, history, people] = await Promise.all([
    prisma.helpdeskCategoryVisibility.findUnique({ where: { categoryId } }),
    prisma.helpdeskCategoryVisibilityHistory.findMany({ where: { categoryId }, orderBy: { version: "desc" } }),
    visibilityPeople(),
  ]);
  return { state: !current ? "LEGACY" : current.configured ? "CONFIGURED" : "NOT_SET", version: current?.version ?? 0, hrRoleCodes: current?.hrRoleCodes ?? [], employeeIds: current?.employeeIds ?? [], history, people };
}

export async function setVisibility(categoryId: string, input: VisibilityInput, viewer: HelpdeskViewer, meta: ActorMeta) {
  await requireVisibilityDirector(viewer.userId);
  const parsed = visibilitySchema.parse(input);
  const eligible = new Set((await visibilityPeople()).map((p) => p.id));
  if (parsed.employeeIds.some((id) => !eligible.has(id))) throw new HttpError(400, "Choose active helpdesk handlers or directors.", "VALIDATION_ERROR");
  await prisma.$transaction(async (tx) => {
    const categories = await tx.$queryRaw<Array<{ id: string; code: string }>>`SELECT id, code FROM helpdesk_categories WHERE id = ${categoryId} AND code <> ${PAYROLL_CATEGORY} FOR UPDATE`;
    const category = categories[0];
    if (!category) throw missing();
    const before = await tx.helpdeskCategoryVisibility.findUnique({ where: { categoryId } });
    if ((before?.version ?? 0) !== parsed.version) throw new HttpError(409, "Visibility changed. Reload it before saving.", "CONFLICT");
    const data = { categoryId, categoryCode: category.code, hrRoleCodes: [...new Set(parsed.hrRoleCodes)], employeeIds: [...new Set(parsed.employeeIds)], configured: true, version: parsed.version + 1, changedByUserId: viewer.userId, changedAt: new Date() };
    await tx.helpdeskCategoryVisibility.upsert({ where: { categoryId }, create: data, update: data });
    const { configured: _configured, ...history } = data;
    await tx.helpdeskCategoryVisibilityHistory.create({ data: { ...history, reason: parsed.reason } });
    await writeAuditLogs([{ ...meta, action: "helpdesk.visibility.changed", entityType: "HelpdeskCategory", entityId: categoryId, before, after: { ...data, reason: parsed.reason } }], tx);
  });
  return readVisibility(categoryId, viewer);
}
