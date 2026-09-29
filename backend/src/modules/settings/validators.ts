import { z } from "zod";

const rateLimitSchema = z.object({
  maxAttempts: z.number().int().min(1).max(1000),
  windowSeconds: z.number().int().min(1).max(86400),
});

export const updateSettingsSchema = z.object({
  lockoutMaxAttempts: z.number().int().min(1).max(20).optional(),
  lockoutMinutes: z.number().int().min(1).max(1440).optional(),
  passwordMinLength: z.number().int().min(6).max(64).optional(),
  invitationTtlHours: z.number().int().min(1).max(336).optional(),
  require2faRoles: z.array(z.enum(["SUPER_ADMIN", "HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "MANAGER", "APPROVER", "EMPLOYEE"])).optional(),
  rateLimits: z
    .object({
      login: rateLimitSchema.optional(),
      totpVerify: rateLimitSchema.optional(),
      inviteAccept: rateLimitSchema.optional(),
      forgotPassword: rateLimitSchema.optional(),
      resetPassword: rateLimitSchema.optional(),
    })
    .optional(),
});

export const updateLeaveSettingsSchema = z.object({
  encashmentDefaultDailyRate: z.number().positive().nullable().optional(),
});
