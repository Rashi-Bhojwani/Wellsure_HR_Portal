import { z } from "zod";
import type { DataScope } from "../../lib/dataScope";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { writeAuditLog } from "../../lib/audit";
import { isDirector, requireDirector } from "../../lib/directorAuthority";
import { decryptField, encryptField } from "../../lib/encryption";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

// M session block 2, ER-28: custom fields. Directors define them (none by default): a label, a type (text, number, date, a choice), whether the
// employee sees their own value, and whether the value is sensitive. HR (employee.edit) fills values within its data scope, never on its own record;
// whoever may view the employee (employee.view, data scope) reads plain values; a sensitive value is stored only encrypted and shown masked to the
// last four characters; only a director reveals it, audited. The audit log records that a value changed, never the value.

export interface Viewer {
  userId: string;
  employeeId: string;
  dataScope: DataScope;
}
export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "CHOICE"] as const;
export const createBody = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "Lower-case letters, digits and _ (starting with a letter)"),
    label: z.string().trim().min(2).max(60),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    visibleToEmployee: z.boolean().default(false),
    sensitive: z.boolean().default(false),
  })
  .strict()
  .refine((b) => (b.type === "CHOICE") === b.options.length > 0, { message: "A choice field needs options; other types have none", path: ["options"] });
export const updateBody = z.object({ label: z.string().trim().min(2).max(60).optional(), options: z.array(z.string().trim().min(1).max(60)).max(30).optional(), visibleToEmployee: z.boolean().optional(), active: z.boolean().optional(), position: z.number().int().min(0).max(999).optional() }).strict();
export const valuesBody = z.object({ values: z.record(z.string().min(1).max(64), z.string().max(200).nullable()) }).strict();

const mask = (last4: string | null) => (last4 ? `••••${last4}` : "••••");

export async function definitions(includeInactive: boolean) {
  const rows = await prisma.customFieldDefinition.findMany({ where: includeInactive ? {} : { active: true }, orderBy: [{ position: "asc" }, { label: "asc" }] });
  return rows.map((d) => ({ id: d.id, key: d.key, label: d.label, type: d.type, options: d.options, visibleToEmployee: d.visibleToEmployee, sensitive: d.sensitive, active: d.active, position: d.position }));
}

export async function createDefinition(input: z.infer<typeof createBody>, meta: ActorMeta) {
  await requireDirector(meta.actorUserId, "define a custom field");
  try {
    const row = await prisma.customFieldDefinition.create({ data: { ...input, createdByUserId: meta.actorUserId } });
    await writeAuditLog({ ...meta, action: "employee.custom_field.defined", entityType: "CustomFieldDefinition", entityId: row.id, after: input });
    return { id: row.id };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "A field with this key already exists.", "DUPLICATE");
    throw e;
  }
}

export async function updateDefinition(id: string, input: z.infer<typeof updateBody>, meta: ActorMeta) {
  await requireDirector(meta.actorUserId, "change a custom field");
  const before = await prisma.customFieldDefinition.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Field not found.", "NOT_FOUND");
  if (input.options && (before.type === "CHOICE") !== input.options.length > 0) throw new HttpError(400, "A choice field needs options; other types have none.", "VALIDATION_ERROR");
  await prisma.customFieldDefinition.update({ where: { id }, data: input });
  await writeAuditLog({ ...meta, action: "employee.custom_field.changed", entityType: "CustomFieldDefinition", entityId: id, before: { label: before.label, options: before.options, visibleToEmployee: before.visibleToEmployee, active: before.active, position: before.position }, after: input });
  return { id };
}

async function inScope(employeeId: string, viewer: Viewer) {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  return prisma.employee.findFirst({ where: { AND: [{ id: employeeId }, scope] }, select: { id: true } });
}

function check(def: { type: string; options: string[]; label: string }, value: string): string {
  const v = value.trim();
  if (def.type === "NUMBER" && !/^-?\d{1,12}(\.\d{1,4})?$/.test(v)) throw new HttpError(400, `${def.label}: a number`, "VALIDATION_ERROR");
  if (def.type === "DATE" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) throw new HttpError(400, `${def.label}: a date as YYYY-MM-DD`, "VALIDATION_ERROR");
  if (def.type === "CHOICE" && !def.options.includes(v)) throw new HttpError(400, `${def.label}: one of ${def.options.join(", ")}`, "VALIDATION_ERROR");
  if (!v) throw new HttpError(400, `${def.label}: empty (send null to clear it)`, "VALIDATION_ERROR");
  return v;
}

/** One employee's values for someone who may view them (sensitive values masked). */
export async function valuesOf(employeeId: string, viewer: Viewer) {
  if (!(await inScope(employeeId, viewer))) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const [defs, rows] = await Promise.all([definitions(false), prisma.employeeCustomValue.findMany({ where: { employeeId } })]);
  const byField = new Map(rows.map((r) => [r.fieldId, r]));
  return defs.map((d) => {
    const r = byField.get(d.id);
    return { ...d, value: r ? (d.sensitive ? mask(r.valueLast4) : r.valueText) : null, hasValue: !!r };
  });
}

export async function setValues(employeeId: string, values: Record<string, string | null>, viewer: Viewer, meta: ActorMeta) {
  if (employeeId === viewer.employeeId) throw new HttpError(403, "You cannot change your own record here.", "OWN_RECORD");
  if (!(await inScope(employeeId, viewer))) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const defs = await prisma.customFieldDefinition.findMany({ where: { id: { in: Object.keys(values) }, active: true } });
  if (defs.length !== Object.keys(values).length) throw new HttpError(400, "One of the fields does not exist or is switched off.", "VALIDATION_ERROR");
  const changed: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const d of defs) {
      const raw = values[d.id];
      if (raw === null || raw === undefined) {
        const gone = await tx.employeeCustomValue.deleteMany({ where: { employeeId, fieldId: d.id } });
        if (gone.count) changed.push(d.key);
        continue;
      }
      const v = check(d, raw);
      const data = d.sensitive ? { valueText: null, valueEncrypted: encryptField(v), valueLast4: v.slice(-4) } : { valueText: v, valueEncrypted: null, valueLast4: null };
      await tx.employeeCustomValue.upsert({ where: { employeeId_fieldId: { employeeId, fieldId: d.id } }, create: { employeeId, fieldId: d.id, ...data, updatedByUserId: viewer.userId }, update: { ...data, updatedByUserId: viewer.userId } });
      changed.push(d.key);
    }
  });
  // The fields that changed, never their values (a sensitive one would otherwise sit in the audit log in the clear).
  if (changed.length) await writeAuditLog({ ...meta, action: "employee.custom_values.updated", entityType: "Employee", entityId: employeeId, after: { fields: changed } });
  return { employeeId, changed };
}

/** A director reads a sensitive value in full; audited. */
export async function reveal(employeeId: string, fieldId: string, viewer: Viewer, meta: ActorMeta) {
  if (!(await isDirector(viewer.userId))) throw new HttpError(403, "Only a director reveals a sensitive field.", "FORBIDDEN");
  const r = await prisma.employeeCustomValue.findUnique({ where: { employeeId_fieldId: { employeeId, fieldId } }, include: { field: true } });
  if (!r || !r.field.sensitive || !r.valueEncrypted) throw new HttpError(404, "Not found.", "NOT_FOUND");
  await writeAuditLog({ ...meta, action: "employee.custom_value.revealed", entityType: "Employee", entityId: employeeId, after: { field: r.field.key } });
  return { value: decryptField(r.valueEncrypted) };
}

/** The signed-in person's own values of the fields shown to employees (sensitive ones masked). */
export async function mine(employeeId: string) {
  const defs = (await definitions(false)).filter((d) => d.visibleToEmployee);
  const rows = await prisma.employeeCustomValue.findMany({ where: { employeeId, fieldId: { in: defs.map((d) => d.id) } } });
  const byField = new Map(rows.map((r) => [r.fieldId, r]));
  return defs.map((d) => ({ label: d.label, type: d.type, value: byField.has(d.id) ? (d.sensitive ? mask(byField.get(d.id)!.valueLast4) : byField.get(d.id)!.valueText) : null }));
}
