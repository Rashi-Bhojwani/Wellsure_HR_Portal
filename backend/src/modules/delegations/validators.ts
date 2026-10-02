import { z } from "zod";

const reason = z.string().trim().max(500).optional().nullable();

export const idParamsSchema = z.object({ id: z.string().min(1) });
export const delegatorParamsSchema = z.object({ delegatorUserId: z.string().min(1) });
export const createMineSchema = z.object({ delegateUserId: z.string().min(1), startDate: z.iso.date(), endDate: z.iso.date(), reason });
export const createSchema = createMineSchema.extend({ delegatorUserId: z.string().min(1) });
export const revokeSchema = z.object({ reason });
export const listQuerySchema = z.object({ status: z.enum(["SCHEDULED", "ACTIVE", "ENDED", "REVOKED"]).optional() });
