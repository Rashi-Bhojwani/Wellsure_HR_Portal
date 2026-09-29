import { z } from "zod";

export const idParamsSchema = z.object({ id: z.string().min(1) });

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
