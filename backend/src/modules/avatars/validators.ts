import { z } from "zod";

export const employeeParams = z.object({ employeeId: z.string().min(1).max(64) });
export const removeSchema = z.object({ reason: z.string().trim().min(3, "Say why the photo is being removed.").max(500) }).strict();
