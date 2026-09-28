import { prisma } from "../../lib/prisma";

// Read-only for commit B (every role needs these for the Holiday Calendar
// screen); commit C adds the mutating admin endpoints (create/edit/delete,
// gated by leave.policy.manage) to the same resource.
export async function listHolidays(locationId: string, year?: number) {
  return prisma.holiday.findMany({
    where: { locationId, ...(year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } } : {}) },
    orderBy: { date: "asc" },
  });
}

export async function listRestrictedHolidays(locationId: string, year?: number) {
  return prisma.restrictedHoliday.findMany({
    where: { locationId, ...(year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } } : {}) },
    orderBy: { date: "asc" },
  });
}

// The employee's own current branch — Holiday Calendar defaults to this
// when no locationId query param is given.
export async function getEmployeeCurrentLocationId(employeeId: string): Promise<string | null> {
  const jobHistory = await prisma.employeeJobHistory.findFirst({
    where: { employeeId, effectiveTo: null },
    select: { locationId: true },
  });
  return jobHistory?.locationId ?? null;
}
