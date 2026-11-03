import { z } from "zod";

export const employeeParams = z.object({ employeeId: z.string().min(1).max(64) });
// Only ever the caller's own avatar: no employee id is accepted (a body naming someone else is refused as unknown input).
export const chooseSchema = z.object({ kind: z.enum(["PHOTO", "INITIALS", "CHARACTER", "FUN"]), catalogueId: z.string().trim().min(1).max(40).optional() }).strict();
export const surpriseSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(64) }).strict();
export const removeSchema = z.object({ reason: z.string().trim().min(3, "Say why the photo is being removed.").max(500) }).strict();
