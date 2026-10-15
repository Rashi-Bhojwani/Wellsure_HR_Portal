import { z } from "zod";

export const idParamsSchema = z.object({ id: z.string().min(1) });

const dayPartSchema = z.enum(["FULL", "FIRST_HALF", "SECOND_HALF"]);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const applyLeaveSchema = z.object({
  employeeId: z.string().min(1).optional(), // defaults to the caller's own
  leaveTypeId: z.string().min(1),
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  fromDayPart: dayPartSchema.default("FULL"),
  toDayPart: dayPartSchema.default("FULL"),
  reason: z.string().trim().max(1000).optional(),
  attachmentStorageKey: z.string().max(500).optional(),
});

export const listLeaveRequestsQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  leaveTypeId: z.string().min(1).optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  // Only PENDING requests whose team has nobody who can approve them
  // (noTeamApprover.ts) — HR's "needs you" view; company-wide viewers only.
  noTeamApprover: z.stringbool().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const approveRequestSchema = z.object({
  comments: z.string().trim().max(1000).optional(),
});

export const rejectRequestSchema = z.object({
  comments: z.string().trim().min(1).max(1000),
});

export const bulkApproveSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  comments: z.string().trim().max(1000).optional(),
});

export const cancelRequestSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const balancesQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
  asOfDate: isoDateSchema.optional(),
});

export const ledgerQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
  leaveTypeId: z.string().min(1).optional(),
});

export const calendarQuerySchema = z.object({
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  locationId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
});

export const holidaysQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// ── Admin: manual grant/debit + comp-off grant (leave.grant) ────────────

export const manualGrantSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeId: z.string().min(1),
  days: z.number().refine((d) => d !== 0, "days must not be zero"),
  entryDate: isoDateSchema,
  remarks: z.string().trim().max(1000).optional(),
});

export const manualCompOffGrantSchema = z.object({
  employeeId: z.string().min(1),
  earnedDate: isoDateSchema,
  hoursWorked: z.number().positive().max(24),
  remarks: z.string().trim().max(1000).optional(),
});

export const compOffQuerySchema = z.object({
  employeeId: z.string().min(1),
});

// ── Admin: leave types & policies (leave.policy.manage) ─────────────────

export const createLeaveTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9_]+$/, "code must be upper-case letters, digits or underscore"),
  name: z.string().trim().min(1).max(100),
  isPaid: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
});

export const updateLeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isPaid: z.boolean().optional(),
  allowHalfDay: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const upsertLeavePolicySchema = z.object({
  accrualEnabled: z.boolean().optional(),
  accrualDaysPerMonth: z.number().min(0).max(31).nullable().optional(),
  eligibilityMode: z.enum(["DAYS", "CALENDAR_MONTHS"]).nullable().optional(),
  eligibilityValue: z.number().int().min(0).nullable().optional(),
  carryForwardCapDays: z.number().min(0).nullable().optional(),
  negativeBalanceAllowed: z.boolean().optional(),
  skipBalanceCheck: z.boolean().optional(),
  yearEndEncashment: z.boolean().optional(),
  compOffMinHoursWorked: z.number().min(0).max(24).nullable().optional(),
  compOffExpiryDays: z.number().int().min(0).nullable().optional(),
  wfhMonthlyLimit: z.number().int().min(0).nullable().optional(),
  wfhYearlyLimit: z.number().int().min(0).nullable().optional(),
  rhYearlyQuota: z.number().int().min(0).nullable().optional(),
});

// ── Admin: holidays / restricted holidays mutations (leave.policy.manage) ─

export const createHolidaySchema = z.object({
  date: isoDateSchema,
  name: z.string().trim().min(1).max(200),
});

export const updateHolidaySchema = z.object({
  date: isoDateSchema.optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

// ── Admin: Year End Process (leave.yearend.manage) ──────────────────────

export const yearEndListQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const previewYearEndSchema = z.object({
  leaveYear: z.number().int().min(2000).max(2100),
});

export const commitYearEndSchema = z.object({
  confirmText: z.string().trim().max(50).optional(),
});

// ── Admin: Leave Recalculator (leave.recalculate) ────────────────────────

export const recalculatePreviewSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1).max(500),
  fromDate: isoDateSchema,
});

export const recalculateCommitSchema = z.object({
  employeeIds: z.array(z.string().min(1)).min(1).max(500),
  fromDate: isoDateSchema,
  confirmText: z.string().trim().max(50).optional(),
});

// ── Admin: Workforce Overview dashboard (leave.view) ─────────────────────

export const dashboardQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
