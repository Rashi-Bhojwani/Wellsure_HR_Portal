import { z } from "zod";

export const runIdParamsSchema = z.object({ id: z.string().min(1).max(60) });
export const runItemParamsSchema = z.object({ id: z.string().min(1).max(60), employeeId: z.string().min(1).max(60) });
export const runListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const readinessQuerySchema = z.object({ cycleStart: z.iso.date() });
export const runCreateSchema = z.object({ cycleStart: z.iso.date() });
export const runCalculateSchema = z.object({ fingerprint: z.string().min(10).max(200) });
export const runVoidSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const varianceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  changedOnly: z.enum(["true", "false"]).default("false"),
  flaggedOnly: z.enum(["true", "false"]).default("false"),
});
