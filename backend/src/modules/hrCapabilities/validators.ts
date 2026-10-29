import { z } from "zod";
import { HR_CAPABILITY_IDS, HR_SWITCH_STATES } from "@shared/constants/hrCapabilities";

export const setCapabilitySchema = z
  .object({
    capability: z.enum(HR_CAPABILITY_IDS),
    subject: z.discriminatedUnion("kind", [z.object({ kind: z.literal("ROLE"), roleCode: z.enum(["HR_ADMIN", "HR_EXECUTIVE"]) }), z.object({ kind: z.literal("USER"), employeeId: z.string().min(1) })]),
    state: z.enum(HR_SWITCH_STATES),
    reason: z.string().trim().min(3).max(500),
    /** An instant; omitted means now. Not in the past, and not more than a year ahead. */
    effectiveFrom: z.iso.datetime().optional(),
  })
  .strict();
export type SetCapabilityInput = z.infer<typeof setCapabilitySchema>;

export const historyQuerySchema = z.object({
  capability: z.enum(HR_CAPABILITY_IDS).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
