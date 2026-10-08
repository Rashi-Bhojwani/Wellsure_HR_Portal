import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/redis";
import { businessToday } from "../../lib/businessDate";
import { getTeamEmployeeIds, type DataScope } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";

// Admin Dashboard widgets (spec §7.1) — six aggregates over Employee/
// EmployeePersonal/EmployeeJobHistory/Separation/Location/City/Department,
// every one scoped to currently ACTIVE employees / current (effectiveTo:
// null) job history rows.
//
// Cached as one JSON blob in Redis for CACHE_TTL_SECONDS, per spec's
// "Cached in Redis." Deliberately TTL-only, no write-triggered
// invalidation: the set of writes that could change these numbers
// (employee create, separate, a cancelled separation, a job-history
// transfer, a name/DOB/gender edit) is large and easy to under-cover —
// hooking "the obvious ones" and missing the rest is exactly the kind of
// half-invalidation that's wrong in ways nobody notices. A flat 5-minute
// staleness bound is simpler and correct by construction — the explicit
// tradeoff, not an oversight.
const CACHE_KEY = "admin:dashboard:widgets";
const CACHE_TTL_SECONDS = 300;

// Data scope (E1.1 — was a live leak): the route only requires
// employee.view, which managers hold, so until E1.1 every manager saw
// company-wide headcount, age, gender and attrition. Now ALL-scope viewers
// get the company figures; anyone else gets the same widgets computed over
// the people in their scope (TEAM: themselves + their reports; SELF:
// themselves), each cached under its own key.
export interface DashboardViewer {
  employeeId: string;
  dataScope: DataScope;
}

// null = everyone. `managers` = whose former reports count as attrition.
interface Population {
  ids: string[] | null;
  managers: string[] | null;
}

async function populationFor(viewer: DashboardViewer): Promise<Population> {
  if (viewer.dataScope === "ALL") return { ids: null, managers: null };
  if (viewer.dataScope === "SELF") return { ids: [viewer.employeeId], managers: [] };
  const team = await getTeamEmployeeIds(viewer.employeeId);
  return { ids: [viewer.employeeId, ...team], managers: [viewer.employeeId, ...team] };
}

export async function getDashboardWidgets(viewer: DashboardViewer) {
  const key = viewer.dataScope === "ALL" ? CACHE_KEY : `${CACHE_KEY}:${viewer.dataScope}:${viewer.employeeId}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof computeDashboardWidgets>>;

  const widgets = await computeDashboardWidgets(await populationFor(viewer));
  await redis.set(key, JSON.stringify(widgets), "EX", CACHE_TTL_SECONDS);
  return widgets;
}

async function computeDashboardWidgets(pop: Population) {
  const [yearsInService, additionsAttrition, headcountByLocation, headcountByCity, ageDistribution, genderSplit, departmentHeadcount] = await Promise.all([
    getYearsInServiceDistribution(pop),
    getAdditionsAttrition(pop),
    getHeadcountByLocation(pop),
    getHeadcountByCity(pop),
    getAgeDistribution(pop),
    getGenderSplit(pop),
    getDepartmentHeadcount(pop),
  ]);
  return { scope: pop.ids === null ? ("company" as const) : ("team" as const), yearsInService, additionsAttrition, headcountByLocation, headcountByCity, ageDistribution, genderSplit, departmentHeadcount };
}

const inPop = (pop: Population) => (pop.ids === null ? {} : { id: { in: pop.ids } });
const jobInPop = (pop: Population) => (pop.ids === null ? {} : { employeeId: { in: pop.ids } });

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function bucketByRanges(value: number, buckets: { label: string; max?: number }[]): string {
  for (const b of buckets) {
    if (b.max === undefined || value < b.max) return b.label;
  }
  return buckets[buckets.length - 1]!.label;
}

const YEARS_IN_SERVICE_BUCKETS = [
  { label: "<1", max: 1 },
  { label: "1-2", max: 2 },
  { label: "2-3", max: 3 },
  { label: "3-4", max: 4 },
  { label: "4-5", max: 5 },
  { label: "5-6", max: 6 },
  { label: "6-7", max: 7 },
  { label: "7-8", max: 8 },
  { label: "8-9", max: 9 },
  { label: "9-10", max: 10 },
  { label: ">10" },
];

async function getYearsInServiceDistribution(pop: Population) {
  const employees = await prisma.employee.findMany({ where: { status: "ACTIVE", ...inPop(pop) }, select: { dateOfJoining: true } });
  const today = businessToday();
  const counts = new Map<string, number>(YEARS_IN_SERVICE_BUCKETS.map((b) => [b.label, 0]));
  for (const emp of employees) {
    const years = (today.getTime() - emp.dateOfJoining.getTime()) / MS_PER_YEAR;
    const bucket = bucketByRanges(years, YEARS_IN_SERVICE_BUCKETS);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return YEARS_IN_SERVICE_BUCKETS.map((b) => ({ bucket: b.label, count: counts.get(b.label) ?? 0 }));
}

const AGE_BUCKETS = [
  { label: "<20", max: 20 },
  { label: "20-25", max: 25 },
  { label: "25-30", max: 30 },
  { label: "30-35", max: 35 },
  { label: "35-40", max: 40 },
  { label: "40-45", max: 45 },
  { label: "45-50", max: 50 },
  { label: ">50" },
];

async function getAgeDistribution(pop: Population) {
  const rows = await prisma.employeePersonal.findMany({
    where: { employee: { status: "ACTIVE", ...inPop(pop) } },
    select: { dateOfBirth: true },
  });
  const today = businessToday();
  const counts = new Map<string, number>(AGE_BUCKETS.map((b) => [b.label, 0]));
  for (const row of rows) {
    const age = (today.getTime() - row.dateOfBirth.getTime()) / MS_PER_YEAR;
    const bucket = bucketByRanges(age, AGE_BUCKETS);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return AGE_BUCKETS.map((b) => ({ bucket: b.label, count: counts.get(b.label) ?? 0 }));
}

async function getGenderSplit(pop: Population) {
  const rows = await prisma.employeePersonal.groupBy({
    by: ["gender"],
    where: { employee: { status: "ACTIVE", ...inPop(pop) } },
    _count: { _all: true },
  });
  return rows.map((r) => ({ gender: r.gender, count: r._count._all }));
}

async function getHeadcountByLocation(pop: Population) {
  const rows = await prisma.employeeJobHistory.groupBy({
    by: ["locationId"],
    where: { ...inForceOn(), ...jobInPop(pop), employee: { status: "ACTIVE" } },
    _count: { _all: true },
  });
  const locations = await prisma.location.findMany({ where: { id: { in: rows.map((r) => r.locationId) } }, select: { id: true, name: true } });
  const nameById = new Map(locations.map((l) => [l.id, l.name]));
  return rows.map((r) => ({ name: nameById.get(r.locationId) ?? r.locationId, count: r._count._all })).sort((a, b) => b.count - a.count);
}

async function getHeadcountByCity(pop: Population) {
  const rows = await prisma.employeeJobHistory.findMany({
    where: { ...inForceOn(), ...jobInPop(pop), employee: { status: "ACTIVE" } },
    select: { location: { select: { cityMaster: { select: { id: true, name: true } } } } },
  });
  const counts = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    const city = row.location.cityMaster;
    const key = city?.id ?? "unassigned";
    const name = city?.name ?? "Unassigned";
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { name, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

async function getDepartmentHeadcount(pop: Population) {
  const rows = await prisma.employeeJobHistory.groupBy({
    by: ["departmentId"],
    where: { ...inForceOn(), ...jobInPop(pop), employee: { status: "ACTIVE" } },
    _count: { _all: true },
  });
  const departments = await prisma.department.findMany({ where: { id: { in: rows.map((r) => r.departmentId) } }, select: { id: true, name: true } });
  const nameById = new Map(departments.map((d) => [d.id, d.name]));
  return rows.map((r) => ({ name: nameById.get(r.departmentId) ?? r.departmentId, count: r._count._all })).sort((a, b) => b.count - a.count);
}

// Last 12 calendar months (this one included), joined vs resigned.
// Joined = Employee.dateOfJoining falling in the month. Resigned =
// Separation.completedAt falling in the month, COMPLETED status only —
// an INITIATED-but-not-yet-effective or a CANCELLED separation was never
// a real attrition event.
async function getAdditionsAttrition(pop: Population) {
  const today = businessToday();
  const months = Array.from({ length: 12 }, (_, i) => {
    const offset = 11 - i;
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const label = start.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
    return { start, end, label };
  });
  const rangeStart = months[0]!.start;
  const rangeEnd = months[months.length - 1]!.end;

  const [joiners, allLeavers] = await Promise.all([
    prisma.employee.findMany({ where: { dateOfJoining: { gte: rangeStart, lte: rangeEnd }, ...inPop(pop) }, select: { dateOfJoining: true } }),
    prisma.separation.findMany({
      where: { status: "COMPLETED", completedAt: { gte: rangeStart, lte: rangeEnd } },
      select: { completedAt: true, employee: { select: { jobHistory: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { reportingManagerId: true } } } } },
    }),
  ]);
  // A leaver no longer appears in anyone's current team, so for a team view
  // they count if their LAST placement reported to this manager (or to
  // someone in their team).
  const leavers = pop.managers === null ? allLeavers : allLeavers.filter((l) => pop.managers!.includes(l.employee.jobHistory[0]?.reportingManagerId ?? ""));

  return months.map((m) => ({
    month: m.label,
    joined: joiners.filter((j) => j.dateOfJoining >= m.start && j.dateOfJoining <= m.end).length,
    resigned: leavers.filter((l) => l.completedAt! >= m.start && l.completedAt! <= m.end).length,
  }));
}
