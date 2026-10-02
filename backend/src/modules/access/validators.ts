import { z } from "zod";

export const roleCodeParamsSchema = z.object({ code: z.string().min(1).max(40) });
export const employeeParamsSchema = z.object({ employeeId: z.string().min(1) });
export const employeeRoleParamsSchema = z.object({ employeeId: z.string().min(1), code: z.string().min(1).max(40) });
export const employeeKeyParamsSchema = z.object({ employeeId: z.string().min(1), key: z.string().min(1).max(80) });

export const updateRoleSchema = z
  .object({
    permissions: z.array(z.string().min(1).max(80)).max(200).optional(),
    dataScope: z.enum(["SELF", "TEAM", "ALL"]).optional(),
  })
  .refine((v) => v.permissions !== undefined || v.dataScope !== undefined, "Nothing to update.");

// A reason is required for every per-user exception (shown on the Access
// tab and in the audit log).
const reason = z.string().trim().min(3, "Give a reason (at least a few words).").max(500);
export const setOverrideSchema = z.object({ effect: z.enum(["GRANT", "REVOKE"]), reason });
export const reasonSchema = z.object({ reason });
export const assignRoleSchema = z.object({ code: z.string().min(1).max(40) });
