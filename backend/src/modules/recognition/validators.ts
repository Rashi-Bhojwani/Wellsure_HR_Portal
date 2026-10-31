import { z } from "zod";

export const idParams = z.object({ id: z.string().min(1).max(64) });
export const employeeParams = z.object({ employeeId: z.string().min(1).max(64) });
export const recipientsQuery = z.object({ q: z.string().trim().max(100).default("") }).strict();
export const directoryQuery = z.object({ ids: z.string().max(5000).default("") }).strict();
const idempotencyKey = z.string().trim().min(8).max(64);
export const giveSchema = z.object({ recipientEmployeeId: z.string().min(1).max(64), badgeCode: z.string().trim().regex(/^[A-Z0-9_]{1,40}$/), message: z.string().trim().max(280).optional(), idempotencyKey }).strict();
export const sendSchema = z.object({ recipientEmployeeId: z.string().min(1).max(64), body: z.string().trim().min(1).max(2000), idempotencyKey }).strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
