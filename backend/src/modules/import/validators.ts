import { z } from "zod";

export const datasetParamsSchema = z.object({
  dataset: z.enum(["org-masters", "employees", "statutory", "bank"]),
});

export const batchIdParamsSchema = z.object({ id: z.string().min(1) });

export const commitBodySchema = z.object({
  confirmText: z.string().trim().max(50).optional(),
});

export const listBatchesQuerySchema = z.object({
  dataset: z.enum(["org-masters", "employees", "statutory", "bank"]).optional(),
});
