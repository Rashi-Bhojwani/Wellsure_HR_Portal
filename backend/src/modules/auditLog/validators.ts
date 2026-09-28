import { z } from "zod";

export const listAuditLogQuerySchema = z.object({
  actorSearch: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
