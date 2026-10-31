import { z } from "zod";

export const idParams = z.object({ id: z.string().min(1).max(64) });
export const employeeParams = z.object({ employeeId: z.string().min(1).max(64) });
export const bookSchema = z.object({ slotId: z.string().min(1).max(64), timezone: z.string().trim().min(1).max(64) }).strict();
export const rescheduleSchema = z.object({ slotId: z.string().min(1).max(64) }).strict();
export const createSlotSchema = z.object({ startsAt: z.iso.datetime() }).strict();
export const completeSchema = z.object({ outcome: z.enum(["COMPLETED", "NOT_HELD"]) }).strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const authoriseSchema = z.object({ employeeId: z.string().min(1).max(64), reason: z.string().trim().min(3).max(500) }).strict();
export const reassignSchema = z.object({ slotId: z.string().min(1).max(64) }).strict();
