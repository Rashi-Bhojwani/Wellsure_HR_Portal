import { z } from "zod";

export const listDirectoryQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  departmentId: z.string().trim().min(1).optional(),
  locationId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const idParamsSchema = z.object({ id: z.string().min(1) });

export const photoParamsSchema = z.object({
  employeeId: z.string().min(1),
  size: z.enum(["thumb", "full"]),
});

export const photoQuerySchema = z.object({
  t: z.string().min(1).max(2048).optional(), // FIX-M1: an access token (now carrying its session version) is longer than 200 characters; it is still refused (401), not a 400
  v: z.string().max(40).optional(), // cache-buster only; the current photo is always what's served
});
