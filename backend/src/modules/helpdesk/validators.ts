import { z } from "zod";
import { HELPDESK_PRIORITIES, HELPDESK_STATUSES } from "@shared/constants/helpdesk";

// Raising a ticket and replying are multipart (attachments ride along), so
// every field arrives as a string: booleans via z.stringbool, never
// z.coerce.boolean (see docs/PROGRESS.md, Phase 1 commit D).

export const idParamsSchema = z.object({ id: z.string().min(1) });

export const createCategorySchema = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/, "Use capital letters, digits and underscores."),
  name: z.string().trim().min(1).max(80),
  isSensitive: z.boolean().optional(),
  directorsOnly: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  defaultAssigneeEmployeeId: z.string().min(1).nullable().optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isSensitive: z.boolean().optional(),
  directorsOnly: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  defaultAssigneeEmployeeId: z.string().min(1).nullable().optional(),
});

export const raiseTicketSchema = z.object({
  categoryId: z.string().trim().min(1),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(5000),
  priority: z.enum(HELPDESK_PRIORITIES).optional(),
});

export const addMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  isInternalNote: z.stringbool().default(false),
});

export const updateTicketSchema = z
  .object({
    status: z.enum(HELPDESK_STATUSES).optional(),
    priority: z.enum(HELPDESK_PRIORITIES).optional(),
    assigneeEmployeeId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.assigneeEmployeeId !== undefined, "Nothing to update.");

export const myTicketsQuerySchema = z.object({
  status: z.enum(HELPDESK_STATUSES).optional(),
});

export const queueQuerySchema = z.object({
  status: z.enum(HELPDESK_STATUSES).optional(),
  categoryId: z.string().min(1).optional(),
  assignee: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
