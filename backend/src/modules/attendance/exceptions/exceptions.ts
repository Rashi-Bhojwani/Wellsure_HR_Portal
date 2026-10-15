import { Prisma } from "@prisma/client";
import { businessToday } from "../../../lib/businessDate";
import { buildEmployeeScopeWhere } from "../../../lib/dataScope";
import { deviceMappingPeriods, namesOn, placedAtSql, placementPeriods } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { addDays } from "../engine/time";
import type { Viewer } from "../manual/scope";

// The Exceptions queue (Phase 3 commit 3, docs/plans/PHASE_3.md): one list of the days that need a person to look,
// derived from the computed days (daily_attendance), so a day leaves the queue by itself the moment it is corrected
// and recomputed. The types are the engine's own flags: a missing punch, a shortfall, the half-day minimum not met, no
// shift, a punch set aside as implausible (clock-flagged). Late-in and early-out are reported, not queued: they are not
// problems to fix. Beside them, device user IDs whose punches match nobody (the unmapped IDs, grouped by ID).
// Scope: `attendance.view` in the viewer's data scope; unmapped IDs belong to nobody, so they are for ALL scope alone.

export const DAY_TYPES = ["MISSING_PUNCH", "SHORTFALL", "HALF_DAY_MIN_NOT_MET", "NO_SHIFT", "CLOCK_FLAGGED"] as const;
export type DayExceptionType = (typeof DAY_TYPES)[number];
export type ExceptionType = DayExceptionType | "UNMAPPED_ID";
export const TYPE_LABELS: Record<ExceptionType, string> = {
  MISSING_PUNCH: "Missing punch",
  SHORTFALL: "Short of the full day",
  HALF_DAY_MIN_NOT_MET: "Half-day minimum not met",
  NO_SHIFT: "No shift assigned",
  CLOCK_FLAGGED: "A punch was set aside (clock)",
  UNMAPPED_ID: "Unmapped device ID",
};

export interface ExceptionFilter {
  from?: string;
  to?: string;
  locationId?: string;
  departmentId?: string;
}
export interface ExceptionQuery extends ExceptionFilter {
  /** Absent: every day type. */
  type?: ExceptionType;
  page: number;
  pageSize: number;
}

export const MAX_RANGE_DAYS = 93;
const DEFAULT_RANGE_DAYS = 14;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export function exceptionRange(f: ExceptionFilter): { from: string; to: string } {
  const to = f.to ?? iso(businessToday());
  const from = f.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) throw new HttpError(400, "The end date is before the start date.", "VALIDATION_ERROR");
  if (Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000) + 1 > MAX_RANGE_DAYS) {
    throw new HttpError(400, `The exceptions queue covers at most ${MAX_RANGE_DAYS} days at a time. Narrow the dates.`, "TOO_WIDE");
  }
  return { from, to };
}

/** Everyone this viewer may see: null for everyone, otherwise their ids. Without `attendance.view` the queue is refused upstream. */
async function visibleIds(viewer: Viewer): Promise<string[] | null> {
  if (viewer.dataScope === "ALL") return null;
  const rows = await prisma.employee.findMany({ where: await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope), select: { id: true } });
  return rows.map((r) => r.id);
}

/** WHERE for the day rows `d` (daily_attendance) as this viewer, for these types. */
export async function dayConditions(viewer: Viewer, f: ExceptionFilter, types: readonly DayExceptionType[] = DAY_TYPES): Promise<Prisma.Sql> {
  const { from, to } = exceptionRange(f);
  const conds: Prisma.Sql[] = [Prisma.sql`d.date BETWEEN ${day(from)} AND ${day(to)}`, Prisma.sql`d.exception_flags && ARRAY[${Prisma.join(types)}]::text[]`];
  const ids = await visibleIds(viewer);
  if (ids) conds.push(ids.length ? Prisma.sql`d.employee_id IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`);
  if (f.locationId || f.departmentId) conds.push(placedAtSql(Prisma.sql`d.employee_id`, Prisma.sql`d.date`, f));
  return Prisma.join(conds, " AND ");
}

interface DayRow {
  employee_id: string;
  employee_code: string;
  date: Date;
  status: string;
  exception_flags: string[];
  shift_code: string | null;
  first_in: Date | null;
  last_out: Date | null;
  shortfall_minutes: number | null;
  actual_minutes: number | null;
  is_locked: boolean;
  provisional: boolean;
}

export interface ExceptionDay {
  key: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string | null;
  date: string;
  status: string;
  types: DayExceptionType[];
  shiftCode: string | null;
  firstIn: string | null;
  lastOut: string | null;
  shortfallMinutes: number | null;
  actualMinutes: number | null;
  branch: string | null;
  department: string | null;
  locked: boolean;
  provisional: boolean;
}

export const dayKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

async function describeDays(rows: DayRow[]): Promise<ExceptionDay[]> {
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.employee_id))];
  const dates = rows.map((r) => r.date.getTime());
  const [names, periods] = await Promise.all([namesOn(ids, businessToday()), placementPeriods(ids, new Date(Math.min(...dates)), new Date(Math.max(...dates)))]);
  const locationIds = new Set<string>();
  const departmentIds = new Set<string>();
  for (const list of periods.values()) for (const p of list) {
      locationIds.add(p.locationId);
      departmentIds.add(p.departmentId);
    }
  const [locations, departments] = await Promise.all([
    prisma.location.findMany({ where: { id: { in: [...locationIds] } }, select: { id: true, name: true } }),
    prisma.department.findMany({ where: { id: { in: [...departmentIds] } }, select: { id: true, name: true } }),
  ]);
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  return rows.map((r) => {
    const placed = (periods.get(r.employee_id) ?? []).find((p) => p.from <= r.date && r.date <= p.to);
    return {
      key: dayKey(r.employee_id, iso(r.date)),
      employeeId: r.employee_id,
      employeeCode: r.employee_code,
      employeeName: names.get(r.employee_id) ?? null,
      date: iso(r.date),
      status: r.status,
      types: DAY_TYPES.filter((t) => r.exception_flags.includes(t)),
      shiftCode: r.shift_code,
      firstIn: r.first_in?.toISOString() ?? null,
      lastOut: r.last_out?.toISOString() ?? null,
      shortfallMinutes: r.shortfall_minutes,
      actualMinutes: r.actual_minutes,
      branch: placed ? (locationName.get(placed.locationId) ?? null) : null,
      department: placed ? (departmentName.get(placed.departmentId) ?? null) : null,
      locked: r.is_locked,
      provisional: r.provisional,
    };
  });
}

const DAY_SELECT = Prisma.sql`SELECT d.employee_id, e.employee_code, d.date, d.status, d.exception_flags, d.shift_code, d.first_in, d.last_out, d.shortfall_minutes, d.actual_minutes, d.is_locked, d.provisional
  FROM daily_attendance d JOIN employees e ON e.id = d.employee_id`;

export async function countsByType(viewer: Viewer, f: ExceptionFilter): Promise<Record<ExceptionType | "ALL_DAYS", number>> {
  const where = await dayConditions(viewer, f);
  const per = DAY_TYPES.map((t) => Prisma.sql`count(*) FILTER (WHERE ${t} = ANY(d.exception_flags))::int AS ${Prisma.raw(`"${t}"`)}`);
  const rows = await prisma.$queryRaw<Array<Record<string, number>>>(Prisma.sql`SELECT count(*)::int AS "ALL_DAYS", ${Prisma.join(per)} FROM daily_attendance d WHERE ${where}`);
  const r = rows[0] ?? {};
  const unmapped = viewer.dataScope === "ALL" && !f.departmentId ? (await unmappedGroups(f, { count: true })).total : 0;
  return {
    ALL_DAYS: r.ALL_DAYS ?? 0,
    MISSING_PUNCH: r.MISSING_PUNCH ?? 0,
    SHORTFALL: r.SHORTFALL ?? 0,
    HALF_DAY_MIN_NOT_MET: r.HALF_DAY_MIN_NOT_MET ?? 0,
    NO_SHIFT: r.NO_SHIFT ?? 0,
    CLOCK_FLAGGED: r.CLOCK_FLAGGED ?? 0,
    UNMAPPED_ID: unmapped,
  };
}

// ── Unmapped device IDs ──────────────────────────────────────────────────

export interface UnmappedGroup {
  deviceUserId: string;
  punches: number;
  days: number;
  firstDay: string;
  lastDay: string;
  devices: string[];
  branches: string[];
  /** The employee whose code equals this ID, if exactly one does, and whether mapping it is unambiguous. */
  suggestion: null | { employeeId: string; employeeCode: string; employeeName: string | null; canMap: boolean; problem: string | null; partial: boolean };
}

function unmappedWhere(f: ExceptionFilter, anyDate: boolean): Prisma.Sql {
  const conds = [Prisma.sql`p.employee_id IS NULL`];
  if (!anyDate) {
    const { from, to } = exceptionRange(f);
    conds.push(Prisma.sql`p.business_date BETWEEN ${day(from)} AND ${day(to)}`);
  }
  if (f.locationId) conds.push(Prisma.sql`dv.location_id = ${f.locationId}`);
  return Prisma.join(conds, " AND ");
}

/** Punches that matched nobody, grouped by device user ID (newest first). With `count`, only the total. */
export async function unmappedGroups(f: ExceptionFilter, opts: { count?: boolean; page?: number; pageSize?: number; deviceUserIds?: string[] } = {}) {
  // Named IDs (a bulk action's explicit list) are taken whatever the dates on screen: the IDs are what was chosen.
  const where = unmappedWhere(f, !!opts.deviceUserIds);
  const only = opts.deviceUserIds ? Prisma.sql`AND p.device_user_id IN (${Prisma.join(opts.deviceUserIds)})` : Prisma.empty;
  const from = Prisma.sql`FROM raw_punches p JOIN devices dv ON dv.id = p.device_id WHERE ${where} ${only}`;
  const total = Number((await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT count(DISTINCT p.device_user_id) AS n ${from}`))[0]?.n ?? 0);
  if (opts.count) return { total, groups: [] as UnmappedGroup[] };
  const page = opts.page ?? 1;
  const size = opts.pageSize ?? 50;
  const rows = await prisma.$queryRaw<Array<{ device_user_id: string; punches: bigint; days: bigint; first_day: Date; last_day: Date; devices: string[]; location_ids: string[] }>>(
    Prisma.sql`SELECT p.device_user_id, count(*) AS punches, count(DISTINCT p.business_date) AS days, min(p.business_date) AS first_day, max(p.business_date) AS last_day,
        array_agg(DISTINCT dv.name) AS devices, array_agg(DISTINCT dv.location_id) AS location_ids
      ${from} GROUP BY p.device_user_id ORDER BY max(p.punched_at) DESC, p.device_user_id LIMIT ${size} OFFSET ${opts.deviceUserIds ? 0 : (page - 1) * size}`,
  );
  const ids = rows.map((r) => r.device_user_id);
  const locations = await prisma.location.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.location_ids))] } }, select: { id: true, name: true } });
  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const suggestions = await suggestionsFor(rows.map((r) => ({ deviceUserId: r.device_user_id, firstDay: r.first_day })));
  return {
    total,
    groups: rows.map(
      (r): UnmappedGroup => ({
        deviceUserId: r.device_user_id,
        punches: Number(r.punches),
        days: Number(r.days),
        firstDay: iso(r.first_day),
        lastDay: iso(r.last_day),
        devices: r.devices,
        branches: r.location_ids.map((l) => locationName.get(l) ?? "").filter(Boolean),
        suggestion: suggestions.get(r.device_user_id) ?? null,
      }),
    ),
    ids,
  };
}

/**
 * The unambiguous match for each device ID: the one employee whose code is exactly that ID. It is only offered for
 * bulk mapping when nothing about it needs a judgement: they have no device ID mapped yet (mapping a second would
 * replace the first), they hadn't left before the first punch, and it isn't the actor's own (checked by the caller).
 */
async function suggestionsFor(groups: Array<{ deviceUserId: string; firstDay: Date }>): Promise<Map<string, NonNullable<UnmappedGroup["suggestion"]>>> {
  const out = new Map<string, NonNullable<UnmappedGroup["suggestion"]>>();
  if (groups.length === 0) return out;
  const employees = await prisma.employee.findMany({
    where: { employeeCode: { in: groups.map((g) => g.deviceUserId) } },
    select: { id: true, employeeCode: true, dateOfJoining: true, lastWorkingDate: true },
  });
  const ids = employees.map((e) => e.id);
  const [names, mapped] = await Promise.all([namesOn(ids, businessToday()), deviceMappingPeriods(ids, day("1900-01-01"), day("2999-12-31"))]);
  for (const g of groups) {
    const e = employees.find((x) => x.employeeCode === g.deviceUserId);
    if (!e) continue;
    let problem: string | null = null;
    if ((mapped.get(e.id) ?? []).length > 0) problem = "They already have a device ID mapped; mapping this one would replace it. Decide that on Biometric Devices.";
    else if (e.lastWorkingDate && e.lastWorkingDate < g.firstDay) problem = `They left on ${iso(e.lastWorkingDate)}, before these punches.`;
    out.set(g.deviceUserId, {
      employeeId: e.id,
      employeeCode: e.employeeCode,
      employeeName: names.get(e.id) ?? null,
      canMap: problem === null,
      problem,
      partial: e.dateOfJoining > g.firstDay,
    });
  }
  return out;
}

// ── The list ─────────────────────────────────────────────────────────────

export async function listExceptions(viewer: Viewer, q: ExceptionQuery) {
  const { from, to } = exceptionRange(q);
  const counts = await countsByType(viewer, q);
  const base = { from, to, counts, page: q.page, pageSize: q.pageSize };
  if (q.type === "UNMAPPED_ID") {
    if (viewer.dataScope !== "ALL" || q.departmentId) return { ...base, kind: "UNMAPPED" as const, total: 0, days: [] as ExceptionDay[], unmapped: [] as UnmappedGroup[] };
    const r = await unmappedGroups(q, { page: q.page, pageSize: q.pageSize });
    return { ...base, kind: "UNMAPPED" as const, total: r.total, days: [] as ExceptionDay[], unmapped: r.groups };
  }
  const types = q.type ? [q.type] : DAY_TYPES;
  const where = await dayConditions(viewer, q, types);
  const rows = await prisma.$queryRaw<DayRow[]>(Prisma.sql`${DAY_SELECT} WHERE ${where} ORDER BY d.date DESC, e.employee_code, d.employee_id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`);
  return { ...base, kind: "DAYS" as const, total: q.type ? counts[q.type] : counts.ALL_DAYS, days: await describeDays(rows), unmapped: [] as UnmappedGroup[] };
}

/** Every employee-day matching the filter and types, as this viewer (for the bulk actions: a filter instead of a hand-picked list). */
export async function matchingDays(viewer: Viewer, f: ExceptionFilter, types: readonly DayExceptionType[], limit: number): Promise<{ rows: ExceptionDay[]; overLimit: boolean }> {
  const where = await dayConditions(viewer, f, types);
  const rows = await prisma.$queryRaw<DayRow[]>(Prisma.sql`${DAY_SELECT} WHERE ${where} ORDER BY d.date, e.employee_code, d.employee_id LIMIT ${limit + 1}`);
  return { rows: await describeDays(rows.slice(0, limit)), overLimit: rows.length > limit };
}

/** The given employee-days, but only those that are exceptions of these types and visible to this viewer. */
export async function daysByKeys(viewer: Viewer, keys: Array<{ employeeId: string; date: string }>, types: readonly DayExceptionType[]): Promise<ExceptionDay[]> {
  if (keys.length === 0) return [];
  const ids = await visibleIds(viewer);
  const visible = ids ? new Set(ids) : null;
  const allowed = keys.filter((k) => !visible || visible.has(k.employeeId));
  if (allowed.length === 0) return [];
  const pairs = allowed.map((k) => Prisma.sql`(${k.employeeId}, ${k.date}::date)`);
  const rows = await prisma.$queryRaw<DayRow[]>(
    Prisma.sql`${DAY_SELECT} WHERE (d.employee_id, d.date) IN (${Prisma.join(pairs)}) AND d.exception_flags && ARRAY[${Prisma.join(types)}]::text[] ORDER BY d.date, e.employee_code, d.employee_id`,
  );
  return describeDays(rows);
}
