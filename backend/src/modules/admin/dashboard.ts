import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/redis";
import { businessToday } from "../../lib/businessDate";

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

export async function getDashboardWidgets() {
  const cached = await redis.get(CACHE_KEY);
  if (cached) return JSON.parse(cached) as Awaited<ReturnType<typeof computeDashboardWidgets>>;

  const widgets = await computeDashboardWidgets();
  await redis.set(CACHE_KEY, JSON.stringify(widgets), "EX", CACHE_TTL_SECONDS);
  return widgets;
}

async function computeDashboardWidgets() {
  const [yearsInService, additionsAttrition, headcountByLocation, headcountByCity, ageDistribution, genderSplit, departmentHeadcount] = await Promise.all([
    getYearsInServiceDistribution(),
    getAdditionsAttrition(),
    getHeadcountByLocation(),
    getHeadcountByCity(),
    getAgeDistribution(),
    getGenderSplit(),
    getDepartmentHeadcount(),
  ]);
  return { yearsInService, additionsAttrition, headcountByLocation, headcountByCity, ageDistribution, genderSplit, departmentHeadcount };
}

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

async function getYearsInServiceDistribution() {
  const employees = await prisma.employee.findMany({ where: { status: "ACTIVE" }, select: { dateOfJoining: true } });
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

async function getAgeDistribution() {
  const rows = await prisma.employeePersonal.findMany({
    where: { employee: { status: "ACTIVE" } },
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

async function getGenderSplit() {
  const rows = await prisma.employeePersonal.groupBy({
    by: ["gender"],
    where: { employee: { status: "ACTIVE" } },
    _count: { _all: true },
  });
  return rows.map((r) => ({ gender: r.gender, count: r._count._all }));
}

async function getHeadcountByLocation() {
  const rows = await prisma.employeeJobHistory.groupBy({
    by: ["locationId"],
    where: { effectiveTo: null, employee: { status: "ACTIVE" } },
    _count: { _all: true },
  });
  const locations = await prisma.location.findMany({ where: { id: { in: rows.map((r) => r.locationId) } }, select: { id: true, name: true } });
  const nameById = new Map(locations.map((l) => [l.id, l.name]));
  return rows.map((r) => ({ name: nameById.get(r.locationId) ?? r.locationId, count: r._count._all })).sort((a, b) => b.count - a.count);
}

async function getHeadcountByCity() {
  const rows = await prisma.employeeJobHistory.findMany({
    where: { effectiveTo: null, employee: { status: "ACTIVE" } },
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

async function getDepartmentHeadcount() {
  const rows = await prisma.employeeJobHistory.groupBy({
    by: ["departmentId"],
    where: { effectiveTo: null, employee: { status: "ACTIVE" } },
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
async function getAdditionsAttrition() {
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

  const [joiners, leavers] = await Promise.all([
    prisma.employee.findMany({ where: { dateOfJoining: { gte: rangeStart, lte: rangeEnd } }, select: { dateOfJoining: true } }),
    prisma.separation.findMany({ where: { status: "COMPLETED", completedAt: { gte: rangeStart, lte: rangeEnd } }, select: { completedAt: true } }),
  ]);

  return months.map((m) => ({
    month: m.label,
    joined: joiners.filter((j) => j.dateOfJoining >= m.start && j.dateOfJoining <= m.end).length,
    resigned: leavers.filter((l) => l.completedAt! >= m.start && l.completedAt! <= m.end).length,
  }));
}
