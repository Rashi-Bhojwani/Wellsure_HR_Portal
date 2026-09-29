import { z } from "zod";

export const idParamsSchema = z.object({ id: z.string().min(1) });

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
    linkLabel: z.string().trim().max(100).optional(),
    linkUrl: z.string().trim().url().max(500).optional(),
    scopeLocationId: z.string().min(1).optional(),
    scopeDepartmentId: z.string().min(1).optional(),
    activeFrom: isoDateSchema,
    activeTo: isoDateSchema,
  })
  .refine((v) => v.activeFrom <= v.activeTo, { message: "activeFrom must not be after activeTo", path: ["activeTo"] });

export const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  linkLabel: z.string().trim().max(100).nullable().optional(),
  linkUrl: z.string().trim().url().max(500).nullable().optional(),
  scopeLocationId: z.string().min(1).nullable().optional(),
  scopeDepartmentId: z.string().min(1).nullable().optional(),
  activeFrom: isoDateSchema.optional(),
  activeTo: isoDateSchema.optional(),
  isActive: z.boolean().optional(),
});
