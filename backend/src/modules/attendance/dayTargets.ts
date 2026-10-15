import { businessToday } from "../../lib/businessDate";
import { placementPeriods } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { employeesInRange } from "./jobs";

// Who a bulk action covers (Phase 3): a hand-picked list, or everyone placed at a branch and/or department on each
// day. Shared by bulk regularization, Manual Override and Shift Override, so the three read a selection the same
// way. A day on which the person was not there (not yet joined, already left, at another branch) is not a target
// and is not reported either: there is nothing to do and nothing to say.

export interface Selection {
  employeeIds?: string[];
  locationId?: string;
  departmentId?: string;
}

const day = (s: string) => new Date(`${s}T00:00:00Z`);

export function spanDays(from: string, to: string): number {
  return Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000) + 1;
}

export async function resolveTargets(selection: Selection, from: string, to: string) {
  let candidateIds: string[];
  if (selection.employeeIds) {
    const found = await prisma.employee.findMany({ where: { id: { in: selection.employeeIds } }, select: { id: true } });
    if (found.length !== new Set(selection.employeeIds).size) throw new HttpError(404, "Some of those employees weren't found.", "NOT_FOUND");
    candidateIds = found.map((e) => e.id);
  } else {
    candidateIds = await employeesInRange(from, to);
  }
  const periods = selection.employeeIds ? null : await placementPeriods(candidateIds, day(from), day(to));
  const placedOn = (employeeId: string, date: string) => {
    if (!periods) return true;
    const p = (periods.get(employeeId) ?? []).find((x) => x.from <= day(date) && day(date) <= x.to);
    if (!p) return false;
    return (!selection.locationId || p.locationId === selection.locationId) && (!selection.departmentId || p.departmentId === selection.departmentId);
  };
  const employed = new Map((await prisma.employee.findMany({ where: { id: { in: candidateIds } }, select: { id: true, dateOfJoining: true, lastWorkingDate: true } })).map((e) => [e.id, e]));
  const employedOn = (employeeId: string, date: string) => {
    const e = employed.get(employeeId);
    return !!e && e.dateOfJoining <= day(date) && (!e.lastWorkingDate || e.lastWorkingDate >= day(date));
  };
  return { candidateIds, targeted: (employeeId: string, date: string) => placedOn(employeeId, date) && employedOn(employeeId, date), today: businessToday() };
}
