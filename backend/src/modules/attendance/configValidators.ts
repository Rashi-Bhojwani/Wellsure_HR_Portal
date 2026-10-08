import { z } from "zod";
import { TIME_REGEX } from "@shared/utils/attendance";

// Attendance Settings (Phase 2 commit P2-A, docs/plans/PHASE_2.md §2.1, §4.6).

const time = z.string().trim().regex(TIME_REGEX, "Use HH:MM (24-hour), e.g. 09:30");
const code = z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only");
const name = z.string().trim().min(1).max(100);
const minutes = (max: number) => z.number().int().min(0).max(max);
const reason = z.string().trim().max(500).optional().nullable();

export const idParamsSchema = z.object({ id: z.string().min(1) });
export const employeeParamsSchema = z.object({ employeeId: z.string().min(1) });
export const employeeRowParamsSchema = z.object({ employeeId: z.string().min(1), rowId: z.string().min(1) });
export const userParamsSchema = z.object({ userId: z.string().min(1) });

const sessionSchema = z.object({
  kind: z.enum(["WORK", "BREAK"]),
  label: z.string().trim().min(1).max(50),
  startTime: time,
  endTime: time,
});

// Fields that may still be HR placeholders. Listing one in confirmPlaceholders
// (or changing its value) marks it as confirmed.
export const SHIFT_PLACEHOLDER_FIELDS = ["graceInMinutes", "graceOutMinutes"] as const;
export const POLICY_PLACEHOLDER_FIELDS = ["fullDayMinMinutes", "halfDayMinMinutes"] as const;

const shiftFields = {
  name,
  startTime: time,
  endTime: time,
  graceInMinutes: minutes(240),
  graceOutMinutes: minutes(240),
  windowBeforeMinutes: minutes(720),
  windowAfterMinutes: minutes(720),
  sessions: z.array(sessionSchema).min(1).max(12),
};
export const createShiftSchema = z.object({ code, ...shiftFields });
export const updateShiftSchema = z
  .object({ ...shiftFields, isActive: z.boolean(), confirmPlaceholders: z.array(z.enum(SHIFT_PLACEHOLDER_FIELDS)) })
  .partial();

const weekOffRule = z.object({ weekday: z.number().int().min(0).max(6), weeks: z.array(z.number().int().min(1).max(5)).min(1).max(5).optional() });
export const createWeekOffPatternSchema = z.object({ code, name, rules: z.array(weekOffRule).max(7) });
export const updateWeekOffPatternSchema = z.object({ name, rules: z.array(weekOffRule).max(7), isActive: z.boolean() }).partial();

const policyFields = {
  name,
  fullDayMinMinutes: minutes(1440),
  halfDayMinMinutes: minutes(1440),
  // Half-day minimum not met: LOP days (spec §4.4 default 1).
  halfDayMinNotMetLopDays: z.union([z.literal(0), z.literal(0.5), z.literal(1)]),
  nearDuplicateSeconds: z.number().int().min(0).max(3600),
  inferBreakPairing: z.boolean(),
  futureToleranceMinutes: minutes(1440),
  maxPunchAgeDays: z.number().int().min(1).max(400),
};
export const createPolicySchema = z.object({ code, ...policyFields });
export const updatePolicySchema = z
  .object({ ...policyFields, isActive: z.boolean(), confirmPlaceholders: z.array(z.enum(POLICY_PLACEHOLDER_FIELDS)) })
  .partial();

export const defaultsSchema = z.object({ shiftId: z.string().min(1), weekOffPatternId: z.string().min(1), policyId: z.string().min(1) });

export const cycleChangeSchema = z.object({ effectiveFrom: z.iso.date(), startDay: z.number().int().min(1).max(28) });

const assignmentChange = {
  shiftId: z.string().min(1).optional(),
  weekOffPatternId: z.string().min(1).optional(),
  policyId: z.string().min(1).optional(),
  effectiveFrom: z.iso.date(),
  changeReason: reason,
};
const atLeastOne = (v: { shiftId?: string; weekOffPatternId?: string; policyId?: string }) => Boolean(v.shiftId ?? v.weekOffPatternId ?? v.policyId);
export const assignmentChangeSchema = z.object(assignmentChange).refine(atLeastOne, { message: "Choose a shift, week-off pattern or policy to change." });
export const bulkAssignmentSchema = z
  .object({ ...assignmentChange, employeeIds: z.array(z.string().min(1)).min(1).max(2000) })
  .refine(atLeastOne, { message: "Choose a shift, week-off pattern or policy to change." });

export const assignmentListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  locationId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  shiftId: z.string().min(1).optional(),
  capture: z.enum(["DEVICE", "MANUAL"]).optional(),
});

export const manualBranchesSchema = z.object({ locationIds: z.array(z.string().min(1)).max(200) });
