import { deviceMappingPeriods, placementsOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { employeesInRange } from "../../attendance/jobs";

// People at branches that HAVE a biometric machine but no device user ID mapped
// on a day (docs/plans/PHASE_2.md §7.2): their punches, if they make any, land
// in the unmapped queue, and on a day they are expected they look absent. Shown
// on the Devices screen and counted in the morning check.
export interface UnmappedPerson {
  employeeId: string;
  employeeCode: string;
  locationId: string;
  branch: string;
}

export async function peopleWithoutMapping(date: string, onlyLocationId?: string): Promise<UnmappedPerson[]> {
  const day = new Date(`${date}T00:00:00Z`);
  const withDevice = await prisma.device.findMany({ where: { isActive: true, ...(onlyLocationId ? { locationId: onlyLocationId } : {}) }, select: { locationId: true, location: { select: { name: true } } } });
  if (withDevice.length === 0) return [];
  const branchName = new Map(withDevice.map((d) => [d.locationId, d.location.name]));
  const ids = await employeesInRange(date, date);
  const placements = await placementsOn(ids, day);
  const atDeviceBranch = ids.filter((id) => branchName.has(placements.get(id)?.locationId ?? ""));
  if (atDeviceBranch.length === 0) return [];
  const periods = await deviceMappingPeriods(atDeviceBranch, day, day);
  const unmapped = atDeviceBranch.filter((id) => !(periods.get(id) ?? []).some((p) => p.from <= day && (!p.to || p.to > day)));
  const codes = await prisma.employee.findMany({ where: { id: { in: unmapped } }, select: { id: true, employeeCode: true } });
  const codeOf = new Map(codes.map((c) => [c.id, c.employeeCode]));
  return unmapped
    .map((id) => ({ employeeId: id, employeeCode: codeOf.get(id) ?? "", locationId: placements.get(id)!.locationId, branch: branchName.get(placements.get(id)!.locationId)! }))
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.employeeCode.localeCompare(b.employeeCode));
}
