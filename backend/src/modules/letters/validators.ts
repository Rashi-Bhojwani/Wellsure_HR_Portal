import { z } from "zod";
import { LETTER_EXTRA_FIELD_TYPES } from "@shared/constants/letters";

export const idParamsSchema = z.object({ id: z.string().min(1) });
export const employeeIdParamsSchema = z.object({ employeeId: z.string().min(1) });

const extraField = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  type: z.enum(LETTER_EXTRA_FIELD_TYPES),
  required: z.boolean(),
});
const body = z.string().min(1).max(200_000);
const extraValues = z.record(z.string(), z.string().max(2000)).default({});

export const createTemplateSchema = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/, "Use capital letters, digits and underscores."),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  visibleToEmployeeDefault: z.boolean().optional(),
  bodyHtml: body,
  extraFields: z.array(extraField).max(20).default([]),
});

export const newVersionSchema = z.object({
  bodyHtml: body,
  extraFields: z.array(extraField).max(20).default([]),
});

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
  visibleToEmployeeDefault: z.boolean().optional(),
});

export const previewSchema = z.object({
  templateName: z.string().trim().min(1).max(120).default("Preview"),
  bodyHtml: body,
  extraFields: z.array(extraField).max(20).default([]),
  employeeId: z.string().min(1),
  extraValues,
});

export const issueSchema = z.object({
  templateId: z.string().min(1),
  extraValues,
  visibleToEmployee: z.boolean().optional(),
});

export const reissueSchema = z.object({
  extraValues: z.record(z.string(), z.string().max(2000)).optional(),
  visibleToEmployee: z.boolean().optional(),
});

export const letterheadSchema = z.object({
  legalName: z.string().trim().max(200).optional(),
  registeredAddress: z.string().trim().max(1000).optional(),
  signatoryName: z.string().trim().max(120).optional(),
  signatoryDesignation: z.string().trim().max(120).optional(),
});

// ── A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md) — begin ──
export const starterParamsSchema = z.object({ code: z.string().regex(/^STARTER_[A-Z_]+$/) });
const signatories = z.array(z.string().min(1)).max(2, "At most two signatories.");
export const prepareSchema = z
  .object({
    clientKey: z.string().uuid(),
    templateId: z.string().min(1),
    employeeIds: z.array(z.string().min(1)).min(1).max(200).optional(),
    segmentId: z.string().min(1).optional(),
    extraValues,
    remarks: z.string().trim().max(500).nullable().optional(),
    signatoryEmployeeIds: signatories.default([]),
  })
  .refine((b) => Boolean(b.employeeIds) !== Boolean(b.segmentId), { message: "Choose people or a segment (one of the two)." });
export const updateRequestSchema = z
  .object({ extraValues: z.record(z.string(), z.string().max(2000)).optional(), remarks: z.string().trim().max(500).nullable().optional(), signatoryEmployeeIds: signatories.optional() })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change." });
export const requestListQuerySchema = z.object({
  status: z.enum(["IN_PROGRESS", "ISSUED", "VOID"]).default("IN_PROGRESS"),
  batchId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export const signSchema = z.object({ position: z.union([z.literal(1), z.literal(2)]) });
export const voidSchema = z.object({ reason: z.string().trim().min(3, "Say why (a few words)").max(300) });
export const grantSchema = z
  .object({ templateId: z.string().min(1), action: z.enum(["PREPARE", "ISSUE"]), roleCode: z.string().min(1).max(60).optional(), userId: z.string().min(1).optional() })
  .refine((b) => Boolean(b.roleCode) !== Boolean(b.userId), { message: "Grant to a role or to one person." })
  .refine((b) => b.roleCode !== "SUPER_ADMIN", { message: "Directors can already do this." });
export const serialSchema = z.object({ prefix: z.string().trim().max(20).regex(/^[A-Za-z0-9/_-]*$/, "Letters, digits, / _ - only"), nextNumber: z.number().int().min(1).max(999_999_999) });
// ── A-9 — end ──
