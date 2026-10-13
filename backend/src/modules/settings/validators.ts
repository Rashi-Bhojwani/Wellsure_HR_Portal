import { z } from "zod";
import {
  DIRECTORY_TOGGLEABLE_FIELDS,
  MAX_DOCUMENT_UPLOAD_MB_CEILING,
  MAX_PHOTO_UPLOAD_MB_CEILING,
  SUPPORTED_DOCUMENT_MIME_TYPES,
  type DocumentMimeType,
} from "@shared/constants/peopleDocuments";

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

export const updatePeopleDocumentsSettingsSchema = z.object({
  directoryVisibleFields: z.array(z.enum(DIRECTORY_TOGGLEABLE_FIELDS)).optional(),
  photoMaxUploadMb: z.number().positive().max(MAX_PHOTO_UPLOAD_MB_CEILING).optional(),
  documentMaxUploadMb: z.number().positive().max(MAX_DOCUMENT_UPLOAD_MB_CEILING).optional(),
  documentAllowedMimeTypes: z
    .array(z.enum(SUPPORTED_DOCUMENT_MIME_TYPES as [DocumentMimeType, ...DocumentMimeType[]]))
    .min(1, "Allow at least one document type")
    .optional(),
});

// Phase 5 commit D — Helpdesk. Whole days; the employee is shown the exact
// auto-close and reopen-until dates these produce on each resolved ticket.
export const updateHelpdeskSettingsSchema = z.object({
  autoCloseDays: z.number().int().min(1).max(90).optional(),
  reopenWindowDays: z.number().int().min(1).max(90).optional(),
});

// Phase 2 P2-F — Attendance → Device health (docs/plans/PHASE_2.md "P2-F
// build design"). Sent to every sync agent in its heartbeat reply. The
// warning must come before the alarm; the service checks it against the
// stored value when only one of the two is sent.
export const updateDeviceHealthSettingsSchema = z.object({
  retentionWarningPercent: z.number().int().min(1).max(99).optional(),
  retentionAlarmPercent: z.number().int().min(2).max(100).optional(),
  logNearlyFullPercent: z.number().int().min(50).max(100).optional(),
  clockDriftWarningSeconds: z.number().int().min(10).max(3600).optional(),
});

// Phase 2 P2-H — Attendance → Device alerts (docs/plans/PHASE_2.md "P2-H build design").
export const updateDeviceAlertSettingsSchema = z.object({
  deviceSilentMinutes: z.number().int().min(5).max(480).optional(),
  agentSilentMinutes: z.number().int().min(2).max(240).optional(),
  agentWindowMarginMinutes: z.number().int().min(0).max(240).optional(),
  morningCheckTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, e.g. 10:30").optional(),
  alertEmails: z.array(z.string().trim().toLowerCase().email().max(200)).max(20).optional(),
  alertSuperAdmins: z.boolean().optional(),
  recoverySettleSeconds: z.number().int().min(0).max(900).optional(),
});

// Phase 3 commit 1 — Attendance → Regularization (docs/plans/PHASE_3.md).
export const updateRegularizationSettingsSchema = z.object({
  backdateCycles: z.number().int().min(0).max(3).optional(),
  bulkMaxRangeDays: z.number().int().min(1).max(92).optional(),
  bulkMaxEmployeeDays: z.number().int().min(1).max(5000).optional(),
});
