import type { Prisma } from "@prisma/client";
import { HttpError } from "../middleware/errorHandler";
import { prisma } from "./prisma";
import { getSetting } from "./settings";

// System Settings → Attendance (Phase 2, docs/plans/PHASE_2.md §2.1). Read
// here; written only by the attendance config module.
export const ATTENDANCE_SETTING_KEYS = {
  defaults: "attendance.defaults",
  /** The cut-over guard: the engine never writes a day before this business date (YYYY-MM-DD). Unset: no guard. */
  engineStartDate: "attendance.engineStartDate",
} as const;

export const isoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * greytHR runs attendance until the cut-over. From the cut-over date this engine is the record; before it, days come from greytHR (imported
 * read-only) and the engine must never compute, overwrite or delete them, whoever asks (Process Attendance, the nightly job, a recompute after
 * a correction). Null means no guard (development, and staging before the date is set).
 */
export async function getEngineStartDate(): Promise<string | null> {
  const v = await getSetting<string | null>(ATTENDANCE_SETTING_KEYS.engineStartDate, null);
  return isoDate(v) ? v : null;
}

/** The company default a new hire gets (HR 2026-10-08: GEN, Sunday off, the default policy). */
export interface AttendanceDefaults {
  shiftCode: string;
  weekOffPatternCode: string;
  policyCode: string;
}

export const FALLBACK_ATTENDANCE_DEFAULTS: AttendanceDefaults = { shiftCode: "GEN", weekOffPatternCode: "SUN", policyCode: "DEFAULT" };

export async function getAttendanceDefaults(): Promise<AttendanceDefaults> {
  return getSetting<AttendanceDefaults>(ATTENDANCE_SETTING_KEYS.defaults, FALLBACK_ATTENDANCE_DEFAULTS);
}

/** The default shift / week-off pattern / policy ids, resolved inside `tx`. */
export async function resolveAttendanceDefaults(tx: Prisma.TransactionClient): Promise<{ shiftId: string; weekOffPatternId: string; policyId: string }> {
  const d = await getAttendanceDefaults();
  const [shift, weekOffPattern, policy] = await Promise.all([
    tx.shift.findUnique({ where: { code: d.shiftCode }, select: { id: true, isActive: true } }),
    tx.weekOffPattern.findUnique({ where: { code: d.weekOffPatternCode }, select: { id: true, isActive: true } }),
    tx.attendancePolicy.findUnique({ where: { code: d.policyCode }, select: { id: true, isActive: true } }),
  ]);
  if (!shift?.isActive || !weekOffPattern?.isActive || !policy?.isActive) {
    throw new HttpError(
      409,
      "The company's default attendance shift, week-off pattern or policy is missing or inactive. Set it in Attendance Settings before adding employees.",
      "ATTENDANCE_DEFAULTS_MISSING",
    );
  }
  return { shiftId: shift.id, weekOffPatternId: weekOffPattern.id, policyId: policy.id };
}

/**
 * Punch plausibility (docs/plans/PHASE_2.md §3 "Clock safeguards"): a punch
 * more than `futureToleranceMinutes` ahead of the server clock, or older than
 * `maxPunchAgeDays`, is stored but flagged. Read from the company default
 * policy — ingestion runs before a punch is known to be anyone's.
 */
export async function punchPlausibility(): Promise<{ futureToleranceMinutes: number; maxPunchAgeDays: number }> {
  const d = await getAttendanceDefaults();
  const policy = await prisma.attendancePolicy.findUnique({ where: { code: d.policyCode }, select: { futureToleranceMinutes: true, maxPunchAgeDays: true } });
  return policy ?? { futureToleranceMinutes: 10, maxPunchAgeDays: 45 };
}
