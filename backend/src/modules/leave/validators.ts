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

export const calendarQuerySchema = z.object({
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  locationId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
});

export const holidaysQuerySchema = z.object({
  locationId: z.string().min(1).optional(), // defaults to the caller's own current branch
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
