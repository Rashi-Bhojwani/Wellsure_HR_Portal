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
