import { z } from "zod";

const date = z.iso.date().optional(); // YYYY-MM-DD; defaults to today, never in the future

export const employeeParamsSchema = z.object({ employeeId: z.string().min(1) });
export const memberParamsSchema = z.object({ employeeId: z.string().min(1), memberId: z.string().min(1) });
export const appointSchema = z.object({ employeeId: z.string().min(1), effectiveFrom: date });
export const removeManagerSchema = z.object({ newManagerId: z.string().min(1).nullable(), effectiveFrom: date });
export const assignTeamSchema = z.object({ employeeIds: z.array(z.string().min(1)).min(1).max(200), effectiveFrom: date });
export const removeMemberSchema = z.object({ effectiveFrom: date });
