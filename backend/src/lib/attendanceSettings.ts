import type { Prisma } from "@prisma/client";
import { HttpError } from "../middleware/errorHandler";
import { prisma } from "./prisma";
import { getSetting } from "./settings";

// System Settings → Attendance (Phase 2, docs/plans/PHASE_2.md §2.1). Read
// here; written only by the attendance config module.
export const ATTENDANCE_SETTING_KEYS = {
  defaults: "attendance.defaults",
} as const;

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
