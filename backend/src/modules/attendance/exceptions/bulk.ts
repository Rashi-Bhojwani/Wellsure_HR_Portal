import { createHash, randomUUID } from "node:crypto";
import { writeAuditLogs } from "../../../lib/audit";
import { resolveAttendanceDefaults } from "../../../lib/attendanceSettings";
import { businessToday } from "../../../lib/businessDate";
import { assignmentHistories, writeAssignmentChange } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { mapUnmapped } from "../../biometric/adminService";
import type { Viewer } from "../manual/scope";
import type { Meta } from "../processService";
import { requestRecomputeRange } from "../recompute";
import { daysByKeys, matchingDays, unmappedGroups, type ExceptionDay, type ExceptionFilter } from "./exceptions";

// Bulk resolving from the Exceptions queue (Phase 3 commit 3, docs/plans/PHASE_3.md). Only where there is one obvious
// answer; everything that needs a judgement (a missing punch, a shortfall) goes to Regularization or Manual Override,
// which is where a person says what really happened.
//   - Map device IDs: "map every suggested match". A device ID equal to exactly one employee's code, who has no device
//     ID yet, is mapped to them through the same writer and audit as the Biometric Devices screen.
//   - Assign a shift to no-shift days, through the effective-dated assignment writer (from the earliest selected day).
// Both are previews first, then a confirmation of exactly the set previewed (a fingerprint), one audit row per item, and
// the actor's own items are left out: nobody settles their own attendance.

export const MAX_BULK_IDS = 200;
export const MAX_BULK_DAYS = 2000;
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const fingerprintOf = (parts: string[]): string => createHash("sha256").update([...parts].sort().join("\n")).digest("hex");

// ── Map device IDs ───────────────────────────────────────────────────────

export interface MapSelection {
  deviceUserIds?: string[];
  filter?: ExceptionFilter;
}

function requireDevices(viewer: Viewer): void {
  if (!viewer.permissions.has("attendance.devices.manage") || viewer.dataScope !== "ALL") {
    throw new HttpError(403, "Mapping device IDs is for HR, across the whole company.", "FORBIDDEN");
  }
}

async function mapPlan(viewer: Viewer, sel: MapSelection) {
  requireDevices(viewer);
  const r = await unmappedGroups(sel.filter ?? {}, { page: 1, pageSize: MAX_BULK_IDS + 1, deviceUserIds: sel.deviceUserIds });
  if (r.groups.length > MAX_BULK_IDS) throw new HttpError(400, `That is more than ${MAX_BULK_IDS} device IDs at once. Narrow it by branch or dates and map in parts.`, "TOO_MANY");
  const items: Array<{ deviceUserId: string; employeeId: string; employeeCode: string; employeeName: string | null; punches: number; firstDay: string; lastDay: string; partial: boolean }> = [];
  const skipped: Array<{ deviceUserId: string; punches: number; reason: string }> = [];
  let ownLeftOut = 0;
  for (const g of r.groups) {
    const s = g.suggestion;
    if (!s) skipped.push({ deviceUserId: g.deviceUserId, punches: g.punches, reason: "No employee has this code: choose who it belongs to on Biometric Devices." });
    else if (!s.canMap) skipped.push({ deviceUserId: g.deviceUserId, punches: g.punches, reason: s.problem ?? "Not unambiguous." });
    else if (s.employeeId === viewer.employeeId) ownLeftOut += 1;
    else items.push({ deviceUserId: g.deviceUserId, employeeId: s.employeeId, employeeCode: s.employeeCode, employeeName: s.employeeName, punches: g.punches, firstDay: g.firstDay, lastDay: g.lastDay, partial: s.partial });
  }
  return { items, skipped, ownLeftOut, fingerprint: fingerprintOf(items.map((i) => `${i.deviceUserId}>${i.employeeId}`)) };
}

export async function previewMapDeviceIds(viewer: Viewer, sel: MapSelection) {
  const p = await mapPlan(viewer, sel);
  return {
    count: p.items.length,
    punches: p.items.reduce((n, i) => n + i.punches, 0),
    ownLeftOut: p.ownLeftOut,
    fingerprint: p.fingerprint,
    items: p.items,
    skipped: p.skipped,
  };
}

export async function confirmMapDeviceIds(viewer: Viewer, sel: MapSelection, input: { fingerprint: string }, meta: Meta) {
  const p = await mapPlan(viewer, sel);
  if (p.items.length === 0) throw new HttpError(409, "Nothing is left to map. Review the list again.", "SELECTION_CHANGED");
  if (p.fingerprint !== input.fingerprint) throw new HttpError(409, "The list changed since you looked at it (an ID was mapped meanwhile, or more punches arrived). Review it again before mapping.", "SELECTION_CHANGED");
  const bulkId = randomUUID();
  const mapped: string[] = [];
  const failed: Array<{ deviceUserId: string; message: string }> = [];
  let punchesResolved = 0;
  // One mapping at a time, each through the Biometric Devices path (its own transaction and audit row, tagged with this batch).
  for (const item of p.items) {
    try {
      const r = await mapUnmapped({ deviceUserId: item.deviceUserId, employeeId: item.employeeId }, { ...meta, actorEmployeeId: viewer.employeeId }, { fromExceptionsQueue: true, bulkId, bulkCount: p.items.length });
      mapped.push(item.deviceUserId);
      punchesResolved += r.resolved;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      failed.push({ deviceUserId: item.deviceUserId, message: err.message });
    }
  }
  return { bulkId, mapped: mapped.length, punchesResolved, failed };
}

// ── Assign a shift to no-shift days ──────────────────────────────────────

export interface AssignSelection {
  keys?: Array<{ employeeId: string; date: string }>;
  filter?: ExceptionFilter;
}
export interface AssignInput {
  shiftId: string;
  note: string;
}

export const ASSIGN_PROBLEM_LABEL: Record<string, string> = {
  CLOSED: "Has left: their assignment history is closed",
  BEFORE_ASSIGNMENT: "Their assignment starts after these days: correct those days with Shift Override",
  SAME_SHIFT: "Already assigned this shift: the shift itself has a problem (Attendance Settings)",
};

function requireConfig(viewer: Viewer): void {
  if (!viewer.permissions.has("attendance.config.manage")) throw new HttpError(403, "Missing permission: attendance.config.manage", "FORBIDDEN");
}

async function assignPlan(viewer: Viewer, sel: AssignSelection, shiftId: string) {
  requireConfig(viewer);
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, select: { id: true, code: true, name: true, isActive: true, sessions: { select: { kind: true } } } });
  if (!shift || !shift.isActive) throw new HttpError(400, "Choose an active shift.", "VALIDATION_ERROR");
  if (!shift.sessions.some((s) => s.kind === "WORK")) throw new HttpError(400, `Shift ${shift.code} has no working session, so it cannot give a day its hours. Define it in Attendance Settings first.`, "VALIDATION_ERROR");
  let rows: ExceptionDay[];
  if (sel.keys) rows = await daysByKeys(viewer, sel.keys, ["NO_SHIFT"]);
  else {
    const m = await matchingDays(viewer, sel.filter ?? {}, ["NO_SHIFT"], MAX_BULK_DAYS);
    if (m.overLimit) throw new HttpError(400, `That is more than ${MAX_BULK_DAYS} days at once. Narrow it by branch, department or dates and do it in parts.`, "TOO_MANY");
    rows = m.rows;
  }
  if (sel.keys && sel.keys.length > MAX_BULK_DAYS) throw new HttpError(400, `That is more than ${MAX_BULK_DAYS} days at once.`, "TOO_MANY");
  const own = rows.filter((r) => r.employeeId === viewer.employeeId);
  const others = rows.filter((r) => r.employeeId !== viewer.employeeId);
  const byEmployee = new Map<string, ExceptionDay[]>();
  for (const r of others) byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r]);
  const ids = [...byEmployee.keys()];
  const histories = await assignmentHistories(ids);
  const defaults = ids.length ? await resolveAttendanceDefaults(prisma).catch(() => null) : null;
  const items = ids.map((employeeId) => {
    const days = byEmployee.get(employeeId)!.sort((a, b) => a.date.localeCompare(b.date));
    const mine = histories.filter((h) => h.employeeId === employeeId);
    const latest = mine.at(-1) ?? null;
    const from = days[0]!.date;
    let problem: keyof typeof ASSIGN_PROBLEM_LABEL | "NO_DEFAULTS" | null = null;
    if (!latest) problem = defaults ? null : "NO_DEFAULTS";
    else if (latest.effectiveTo) problem = "CLOSED";
    else if (day(from) < latest.effectiveFrom) problem = "BEFORE_ASSIGNMENT";
    else if (latest.shiftId === shiftId) problem = "SAME_SHIFT";
    return {
      employeeId,
      employeeCode: days[0]!.employeeCode,
      employeeName: days[0]!.employeeName,
      from,
      noShiftDays: days.length,
      lockedDays: days.filter((d) => d.locked).length,
      currentShift: latest?.shift.code ?? null,
      hasAssignment: !!latest,
      problem,
      problemText: problem === "NO_DEFAULTS" ? "The company's default week-off pattern and policy are missing: set them in Attendance Settings." : problem ? ASSIGN_PROBLEM_LABEL[problem]! : null,
    };
  });
  const ok = items.filter((i) => !i.problem);
  return { shift, items, ok, ownLeftOut: own.length, defaults, fingerprint: fingerprintOf([shiftId, ...ok.map((i) => `${i.employeeId}>${i.from}`)]) };
}

export async function previewAssignShift(viewer: Viewer, sel: AssignSelection, input: Pick<AssignInput, "shiftId">) {
  const p = await assignPlan(viewer, sel, input.shiftId);
  return {
    shift: { id: p.shift.id, code: p.shift.code, name: p.shift.name },
    employees: p.ok.length,
    days: p.ok.reduce((n, i) => n + i.noShiftDays, 0),
    blockedEmployees: p.items.length - p.ok.length,
    ownLeftOut: p.ownLeftOut,
    fingerprint: p.fingerprint,
    items: p.items,
  };
}

export async function confirmAssignShift(viewer: Viewer, sel: AssignSelection, input: AssignInput & { fingerprint: string }, meta: Meta) {
  const p = await assignPlan(viewer, sel, input.shiftId);
  if (p.ok.length === 0) throw new HttpError(409, "Nothing is left to assign. Review the list again.", "SELECTION_CHANGED");
  if (p.fingerprint !== input.fingerprint) throw new HttpError(409, "The list changed since you looked at it (someone fixed some of these, or more days appeared). Review it again before assigning.", "SELECTION_CHANGED");
  const bulkId = randomUUID();
  const reason = input.note.trim() || "Assigned from the exceptions queue";
  await prisma.$transaction(
    async (tx) => {
      const audits = [];
      for (const item of p.ok) {
        try {
          const write = await writeAssignmentChange(
            tx,
            item.employeeId,
            day(item.from),
            item.hasAssignment ? { shiftId: input.shiftId } : { shiftId: input.shiftId, weekOffPatternId: p.defaults!.weekOffPatternId, policyId: p.defaults!.policyId },
            { createdByUserId: meta.actorUserId, changeReason: reason },
          );
          audits.push({
            ...meta,
            action: "attendance.assignment.changed",
            entityType: "Employee",
            entityId: item.employeeId,
            before: write.before,
            after: { ...write.after, timeline: write.plan, fromExceptionsQueue: true, bulkId, bulkCount: p.ok.length, noShiftDays: item.noShiftDays },
          });
        } catch (err) {
          if (err instanceof HttpError) throw new HttpError(err.status, `${item.employeeCode}: ${err.message} Nothing was changed.`, err.code);
          throw err;
        }
      }
      // One audit row per person, in the same transaction: a change without its record cannot exist.
      await writeAuditLogs(audits, tx);
    },
    { timeout: 60_000 },
  );
  const today = businessToday();
  for (const item of p.ok) if (day(item.from) <= today) await requestRecomputeRange([item.employeeId], day(item.from), today);
  return { bulkId, employees: p.ok.length, days: p.ok.reduce((n, i) => n + i.noShiftDays, 0), shiftCode: p.shift.code };
}
