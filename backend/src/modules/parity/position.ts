import { businessToday } from "../../lib/businessDate";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { changeAssignment } from "../attendance/configService";
import { findScopedEmployee, updateJob } from "../employee/service";
import type { ParityMeta, ParityViewer } from "./types";

// A-9 G2 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 9): one card per attribute — department, designation, location, grade, cost centre, attendance shift —
// with its current value, the date it took effect and every earlier value. Read from the two effective-dated histories that already exist (EmployeeJobHistory and
// AttendanceAssignment); a change is ALWAYS written through their own writers (employee/service.ts updateJob, attendance/configService.ts changeAssignment), which
// keep the record consistent, close the previous row, refuse overlaps and write their own audit row. Nothing here writes a history table itself. A change from
// this screen must carry a reason. Division does not exist in this system (no master): it is an open question for the owners, not built.
// Grade and cost centre are labels here; any payroll effect of a grade belongs to the payroll model (Session A), not to this screen.

export const POSITION_ATTRIBUTES = ["department", "designation", "location", "grade", "costCentre", "shift"] as const;
export type PositionAttribute = (typeof POSITION_ATTRIBUTES)[number];
const LABEL: Record<PositionAttribute, string> = { department: "Department", designation: "Designation", location: "Location", grade: "Grade", costCentre: "Cost centre", shift: "Attendance shift" };
type JobAttribute = Exclude<PositionAttribute, "shift">;

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

interface Entry {
  valueId: string | null;
  value: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  status: "past" | "current" | "scheduled";
}

/** Consecutive rows that keep the same value are one entry: a change of department does not show as a change of grade. */
function collapse(rows: Array<{ valueId: string | null; value: string; from: Date; to: Date | null; reason: string | null }>, today: Date): Entry[] {
  const out: Array<{ valueId: string | null; value: string; from: Date; to: Date | null; reason: string | null }> = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.valueId === r.valueId && last.to?.getTime() === r.from.getTime()) last.to = r.to;
    else out.push({ ...r });
  }
  return out
    .map((e) => ({
      valueId: e.valueId,
      value: e.value,
      effectiveFrom: iso(e.from)!,
      effectiveTo: iso(e.to),
      reason: e.reason,
      status: (e.from > today ? "scheduled" : e.to && e.to <= today ? "past" : "current") as Entry["status"],
    }))
    .reverse();
}

export async function getPosition(employeeId: string, viewer: ParityViewer) {
  await findScopedEmployee(employeeId, viewer.employeeId, viewer.dataScope);
  const today = businessToday();
  const [jobs, assignments] = await Promise.all([
    prisma.employeeJobHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" }, include: { department: true, designation: true, location: true, grade: true, costCentre: true } }),
    prisma.attendanceAssignment.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" }, include: { shift: true } }),
  ]);
  const pick: Record<JobAttribute, (j: (typeof jobs)[number]) => { id: string | null; name: string }> = {
    department: (j) => ({ id: j.departmentId, name: j.department.name }),
    designation: (j) => ({ id: j.designationId, name: j.designation.name }),
    location: (j) => ({ id: j.locationId, name: j.location.name }),
    grade: (j) => ({ id: j.gradeId, name: j.grade?.name ?? "Not set" }),
    costCentre: (j) => ({ id: j.costCentreId, name: j.costCentre?.name ?? "Not set" }),
  };
  const attributes = POSITION_ATTRIBUTES.map((key) => {
    const entries =
      key === "shift"
        ? collapse(assignments.map((a) => ({ valueId: a.shiftId, value: a.shift.name, from: a.effectiveFrom, to: a.effectiveTo, reason: a.changeReason })), today)
        : collapse(jobs.map((j) => ({ valueId: pick[key](j).id, value: pick[key](j).name, from: j.effectiveFrom, to: j.effectiveTo, reason: j.changeReason })), today);
    return { key, label: LABEL[key], current: entries.find((e) => e.status === "current") ?? null, entries };
  });
  return { employeeId, attributes, division: { built: false, note: "Divisions are not used in this system yet (an open question for the owners)." } };
}

export interface PositionChange {
  attribute: PositionAttribute;
  valueId: string | null;
  effectiveFrom: string;
  reason: string;
}

export async function changePosition(employeeId: string, input: PositionChange, viewer: ParityViewer, meta: ParityMeta) {
  await findScopedEmployee(employeeId, viewer.employeeId, viewer.dataScope);
  if (input.attribute === "shift") {
    if (!viewer.permissions.has("attendance.config.manage")) throw new HttpError(403, "Missing permission: attendance.config.manage", "FORBIDDEN");
    if (!input.valueId) throw new HttpError(400, "Choose a shift.", "VALIDATION_ERROR");
    await changeAssignment(employeeId, { shiftId: input.valueId, effectiveFrom: input.effectiveFrom, changeReason: input.reason }, { ...meta, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, actorEmployeeId: viewer.employeeId });
  } else {
    if (!viewer.permissions.has("employee.edit")) throw new HttpError(403, "Missing permission: employee.edit", "FORBIDDEN");
    if (!input.valueId && ["department", "designation", "location"].includes(input.attribute)) throw new HttpError(400, `Choose a ${LABEL[input.attribute].toLowerCase()}.`, "VALIDATION_ERROR");
    const field = `${input.attribute}Id` as const;
    await updateJob(employeeId, { [field]: input.valueId, effectiveFrom: input.effectiveFrom, changeReason: input.reason } as Parameters<typeof updateJob>[1], meta);
  }
  return getPosition(employeeId, viewer);
}
