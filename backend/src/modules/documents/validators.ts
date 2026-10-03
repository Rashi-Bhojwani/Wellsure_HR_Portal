import { DOCUMENT_SENSITIVITIES } from "@shared/constants/peopleDocuments";
import { z } from "zod";

// Multipart forms send every field as a string: "" means "not set", and
// booleans arrive as "true"/"false" (z.stringbool, never z.coerce.boolean —
// see the includeSensitive bug in docs/PROGRESS.md, Phase 1 commit D).
const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const idParamsSchema = z.object({ id: z.string().min(1) });
export const employeeIdParamsSchema = z.object({ employeeId: z.string().min(1) });

export const listCategoriesQuerySchema = z.object({
  appliesTo: z.enum(["COMPANY", "EMPLOYEE"]).optional(),
  includeInactive: z.stringbool().optional(),
});

export const createCategorySchema = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/, "Use capital letters, digits and underscores."),
  name: z.string().trim().min(1).max(80),
  appliesTo: z.enum(["COMPANY", "EMPLOYEE"]),
  sensitivity: z.enum(DOCUMENT_SENSITIVITIES).optional(), // required for EMPLOYEE (checked in the service)
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
  sensitivity: z.enum(DOCUMENT_SENSITIVITIES).optional(), // raise only
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const uploadCompanyDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  categoryId: z.string().trim().min(1),
  scopeLocationId: optionalId,
  scopeDepartmentId: optionalId,
});

export const updateCompanyDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  categoryId: z.string().trim().min(1).optional(),
  scopeLocationId: z.string().min(1).nullable().optional(),
  scopeDepartmentId: z.string().min(1).nullable().optional(),
});

export const listManagedCompanyDocumentsQuerySchema = z.object({
  includeArchived: z.stringbool().optional(),
});

export const uploadEmployeeDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  categoryId: z.string().trim().min(1),
  visibleToEmployee: z.stringbool().default(false),
});

export const updateEmployeeDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().trim().min(1).optional(),
  visibleToEmployee: z.boolean().optional(),
});
