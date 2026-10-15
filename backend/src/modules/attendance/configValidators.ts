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

// ── Process Attendance (P2-C) ──
export const processRunSchema = z
  .object({
    fromDate: z.iso.date(),
    toDate: z.iso.date(),
    employeeIds: z.array(z.string().min(1)).max(2000).optional(),
    locationId: z.string().min(1).nullable().optional(),
    reason: z.string().trim().min(5, "Say why (e.g. HR confirmed the half-day hours)").max(500),
  });
export const processScopeQuerySchema = z.object({ from: z.iso.date() });
export const finalisationReadinessQuerySchema = z.object({ from: z.iso.date(), to: z.iso.date() });

// ── Manual entry and the muster (P2-D) ──
export const musterQuerySchema = z.object({
  cycleStart: z.iso.date().optional(),
  locationId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
});
export const musterEntriesSchema = z.object({
  entries: z
    .array(z.object({ employeeId: z.string().min(1), date: z.iso.date(), text: z.string().max(40), remark: z.string().trim().max(200).optional().nullable() }))
    .min(1)
    .max(2000),
});
export const markPresentSchema = z.object({ date: z.iso.date(), locationId: z.string().min(1) });
export const musterTemplateQuerySchema = z.object({ locationId: z.string().min(1), cycleStart: z.iso.date().optional() });

// ── Attendance Info, Who Is In, regularization (P2-E) ──
export const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM") });
export const dateParamsSchema = z.object({ date: z.iso.date() });
export const employeeDateParamsSchema = z.object({ employeeId: z.string().min(1), date: z.iso.date() });
export const whoIsInQuerySchema = z.object({ locationId: z.string().min(1).optional(), departmentId: z.string().min(1).optional() });
const reasonCode = z.enum(["FORGOT_TO_PUNCH", "DEVICE_DOWN", "ON_DUTY_ELSEWHERE", "OTHER"]);
const targetStatus = z.enum(["P", "A", "HD_FIRST", "HD_SECOND"]);
const noteText = z.string().trim().max(500);
/** A correction is a status, or one or two times (never both, never neither). */
const correctionFields = {
  inTime: time.optional().nullable(),
  outTime: time.optional().nullable(),
  status: targetStatus.optional().nullable(),
};
const oneCorrection = (v: { inTime?: string | null; outTime?: string | null; status?: string | null }) => (v.status ? 1 : 0) + (v.inTime || v.outTime ? 1 : 0) === 1;
const correctionMessage = "Give corrected times (in, out or both), or a status, not both and not neither.";
export const raiseRegularizationSchema = z
  .object({ date: z.iso.date(), reasonCode, note: noteText.optional().nullable(), ...correctionFields })
  .refine(oneCorrection, { message: correctionMessage })
  .refine((v) => v.reasonCode !== "OTHER" || (v.note ?? "").length >= 3, { message: "Say what happened.", path: ["note"] });
export const eligibilityQuerySchema = z.object({ date: z.iso.date() });
export const regularizationQueueQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  reasonCode: reasonCode.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  batchId: z.string().min(1).optional(),
});

// Bulk correction by HR (Phase 3 commit 1): a date range, a set of employees (a branch, a department, or a list),
// one correction, previewed and then confirmed against the exact set that was previewed.
const bulkSelection = z
  .object({
    employeeIds: z.array(z.string().min(1)).min(1).max(1000).optional(),
    locationId: z.string().min(1).optional(),
    departmentId: z.string().min(1).optional(),
  })
  .refine((s) => (s.employeeIds ? 1 : 0) + (s.locationId || s.departmentId ? 1 : 0) === 1, { message: "Choose employees by a list, or by branch and/or department." });
const bulkBase = z.object({
  selection: bulkSelection,
  from: z.iso.date(),
  to: z.iso.date(),
  reasonCode,
  note: noteText.min(5, "Say why (at least a few words)"),
  action: z.enum(["RAISE", "RAISE_AND_APPROVE"]),
  ...correctionFields,
});
export const bulkRegularizationPreviewSchema = bulkBase.refine(oneCorrection, { message: correctionMessage }).refine((v) => v.from <= v.to, { message: "The end date is before the start date." });
export const bulkRegularizationSchema = bulkBase
  .extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.literal(true) })
  .refine(oneCorrection, { message: correctionMessage })
  .refine((v) => v.from <= v.to, { message: "The end date is before the start date." });
export const regularizationDecisionSchema = z.object({ note: z.string().trim().max(500).optional().nullable() });

// ── Manual Override and Shift Override (Phase 3 commit 2): HR sets a day or a shift directly, after a preview ──
const overrideStatus = z.enum(["P", "A", "HD_FIRST", "HD_SECOND", "WORKED"]);
const overrideNote = z.string().trim().min(5, "Say why (at least a few words)").max(500);
const overrideBase = z.object({
  selection: bulkSelection,
  from: z.iso.date(),
  to: z.iso.date(),
  reasonCode,
  note: overrideNote,
  releaseLeave: z.boolean().default(false),
  /** With the release: the day follows the device's punches; no status or times are set. */
  followDevice: z.boolean().default(false),
  inTime: time.optional().nullable(),
  outTime: time.optional().nullable(),
  status: overrideStatus.optional().nullable(),
});
type OverrideShape = { inTime?: string | null; outTime?: string | null; status?: string | null; followDevice?: boolean; releaseLeave?: boolean };
/** Exactly one of: a status, times, or "follow the device" (which only makes sense with the leave release). */
const oneOverride = (v: OverrideShape) => (v.status ? 1 : 0) + (v.inTime || v.outTime ? 1 : 0) + (v.followDevice ? 1 : 0) === 1 && (!v.followDevice || !!v.releaseLeave);
const overrideMessage = "Set a status, or give times, or follow the device (the last only when releasing approved leave).";
const orderedDates = (v: { from: string; to: string }) => v.from <= v.to;
const datesMessage = { message: "The end date is before the start date." };
export const overridePreviewSchema = overrideBase.refine(oneOverride, { message: overrideMessage }).refine(orderedDates, datesMessage);
export const overrideConfirmSchema = overrideBase
  .extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.literal(true) })
  .refine(oneOverride, { message: overrideMessage })
  .refine(orderedDates, datesMessage);
export const overrideClearSchema = z.object({ employeeId: z.string().min(1), date: z.iso.date(), note: overrideNote });
export const overrideListQuerySchema = z.object({
  employeeId: z.string().min(1).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const shiftOverrideBase = z.object({
  selection: bulkSelection,
  from: z.iso.date(),
  to: z.iso.date(),
  shiftId: z.string().min(1),
  note: overrideNote,
});
export const shiftOverridePreviewSchema = shiftOverrideBase.refine(orderedDates, datesMessage);
export const shiftOverrideConfirmSchema = shiftOverrideBase.extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.literal(true) }).refine(orderedDates, datesMessage);
export const shiftOverrideClearSchema = z.object({ employeeId: z.string().min(1), date: z.iso.date(), note: overrideNote });
export const shiftOverrideListQuerySchema = overrideListQuerySchema;

// ── Shift Roster (Phase 3 commit 2): a shift, or a rotation of shifts, for many people from a future date ──
const rosterBase = z.object({
  selection: bulkSelection,
  start: z.iso.date(),
  steps: z.array(z.object({ shiftId: z.string().min(1), days: z.number().int().min(1).max(366) })).min(1).max(14),
  repeat: z.boolean().default(false),
  until: z.iso.date().optional().nullable(),
  then: z.enum(["RETURN", "STAY"]).default("RETURN"),
  note: overrideNote,
});
const rosterRules = (v: { steps: unknown[]; repeat: boolean; until?: string | null }) => (v.repeat ? !!v.until : v.steps.length === 1);
const rosterMessage = { message: "A repeating rotation needs an end date; without repeating, give one shift (it then stays from the start date)." };
export const rosterPreviewSchema = rosterBase.refine(rosterRules, rosterMessage);
export const rosterConfirmSchema = rosterBase.extend({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.literal(true) }).refine(rosterRules, rosterMessage);

// ── Employee Swipes (Phase 3 commit 2): the raw punch log, filtered and paged server-side ──
const flagParam = z.enum(["any", "pending", "accepted", "discarded", "none"]);
export const swipesQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  deviceId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  route: z.enum(["AGENT", "PUSH", "IMPORT"]).optional(),
  used: z.enum(["yes", "no"]).optional(),
  flagged: flagParam.optional(),
  unmapped: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

// ── Period Finalisation (Phase 3 commit 3): a whole attendance cycle at a time ──
export const finalisePeriodSchema = z.object({ from: z.iso.date(), to: z.iso.date(), note: z.string().trim().max(500).optional(), confirm: z.literal(true) }).refine((v) => v.from <= v.to, { message: "The end date is before the start date." });
export const unlockPeriodSchema = z
  .object({ from: z.iso.date(), to: z.iso.date(), reason: z.string().trim().min(5, "Say why (a few words)").max(500), confirmPayrollConsumed: z.boolean().default(false), confirm: z.literal(true) })
  .refine((v) => v.from <= v.to, { message: "The end date is before the start date." });

// ── The Exceptions queue (Phase 3 commit 3): server-paged, filtered; bulk resolve by preview then confirm ──
const exceptionFilter = {
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  locationId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
};
export const exceptionsQuerySchema = z.object({
  ...exceptionFilter,
  type: z.enum(["MISSING_PUNCH", "SHORTFALL", "HALF_DAY_MIN_NOT_MET", "NO_SHIFT", "CLOCK_FLAGGED", "UNMAPPED_ID"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const filterObject = z.object(exceptionFilter);
const mapSelection = z
  .object({ deviceUserIds: z.array(z.string().min(1)).min(1).max(200).optional(), filter: filterObject.optional() })
  .refine((v) => !!v.deviceUserIds !== !!v.filter, { message: "Choose device IDs by ticking them, or by a filter (branch, dates) — one or the other." });
export const mapDeviceIdsPreviewSchema = mapSelection;
export const mapDeviceIdsSchema = z.intersection(mapSelection, z.object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.literal(true) }));
const assignBase = z.object({
  keys: z.array(z.object({ employeeId: z.string().min(1), date: z.iso.date() })).min(1).max(2000).optional(),
  filter: filterObject.optional(),
  shiftId: z.string().min(1),
});
const assignSelection = (v: { keys?: unknown; filter?: unknown }) => !!v.keys !== !!v.filter;
const assignMessage = { message: "Choose days by ticking them, or by a filter (branch, department, dates) — one or the other." };
export const assignShiftPreviewSchema = assignBase.refine(assignSelection, assignMessage);
export const assignShiftSchema = assignBase.extend({ note: z.string().trim().max(500).default(""), fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.literal(true) }).refine(assignSelection, assignMessage);
