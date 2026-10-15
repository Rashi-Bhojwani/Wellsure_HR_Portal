import { Prisma } from "@prisma/client";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { businessToday } from "../../../lib/businessDate";
import { buildEmployeeScopeWhere } from "../../../lib/dataScope";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { buildXlsx, type XlsxColumn } from "../../../lib/xlsx";
import { addDays } from "../engine/time";
import type { Viewer } from "../manual/scope";

// Employee Swipes (Phase 3 commit 2, docs/plans/PHASE_3.md): the raw punch log exactly as the device sent it — which
// device, which device user ID, the time as the device recorded it and the instant it means, the route it arrived by,
// whether it was flagged and what was decided, and whether a computed day used it. Read-only: nothing here changes a
// punch. Scope: ALL sees everything, including punches that match nobody; a manager (attendance.swipes.view granted)
// sees only their team's; nobody sees a punch they are not entitled to by being told it exists.

export interface SwipeQuery {
  from?: string;
  to?: string;
  deviceId?: string;
  locationId?: string;
  employeeId?: string;
  route?: "AGENT" | "PUSH" | "IMPORT";
  used?: "yes" | "no";
  flagged?: "any" | "pending" | "accepted" | "discarded" | "none";
  unmapped?: boolean;
  page: number;
  pageSize: number;
}

export const MAX_RANGE_DAYS = 31;
export const EXPORT_CAP = 20_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TZ = "Asia/Kolkata";

function range(q: SwipeQuery): { from: string; to: string } {
  const today = iso(businessToday());
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -6);
  if (from > to) throw new HttpError(400, "The end date is before the start date.", "VALIDATION_ERROR");
  if (Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1 > MAX_RANGE_DAYS) {
    throw new HttpError(400, `Employee Swipes covers at most ${MAX_RANGE_DAYS} days at a time. Narrow the dates.`, "TOO_WIDE");
  }
  return { from, to };
}

/** The WHERE for a query as this viewer: their scope first, then the filters. */
async function where(viewer: Viewer, q: SwipeQuery): Promise<Prisma.Sql> {
  const { from, to } = range(q);
  const conds: Prisma.Sql[] = [Prisma.sql`p.business_date BETWEEN ${new Date(`${from}T00:00:00Z`)} AND ${new Date(`${to}T00:00:00Z`)}`];
  if (viewer.dataScope !== "ALL") {
    // Not everyone: only punches of people in scope. Punches that match nobody are for ALL scope alone.
    const rows = await prisma.employee.findMany({ where: await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope), select: { id: true } });
    conds.push(rows.length ? Prisma.sql`p.employee_id IN (${Prisma.join(rows.map((r) => r.id))})` : Prisma.sql`FALSE`);
  }
  if (q.deviceId) conds.push(Prisma.sql`p.device_id = ${q.deviceId}`);
  if (q.locationId) conds.push(Prisma.sql`p.device_id IN (SELECT id FROM devices WHERE location_id = ${q.locationId})`);
  if (q.employeeId) conds.push(Prisma.sql`p.employee_id = ${q.employeeId}`);
  if (q.route) conds.push(Prisma.sql`p.route = ${q.route}::"PunchRoute"`);
  if (q.unmapped) conds.push(Prisma.sql`p.employee_id IS NULL`);
  if (q.flagged === "any") conds.push(Prisma.sql`p.flag IS NOT NULL`);
  if (q.flagged === "none") conds.push(Prisma.sql`p.flag IS NULL`);
  if (q.flagged === "pending") conds.push(Prisma.sql`p.flag IS NOT NULL AND fr.punch_id IS NULL`);
  if (q.flagged === "accepted") conds.push(Prisma.sql`fr.decision = 'ACCEPTED'`);
  if (q.flagged === "discarded") conds.push(Prisma.sql`fr.decision = 'DISCARDED'`);
  const used = Prisma.sql`EXISTS (SELECT 1 FROM daily_attendance d WHERE d.employee_id = p.employee_id AND d.date BETWEEN p.business_date - 1 AND p.business_date + 1 AND jsonb_exists(d.computed_from->'punchIds', p.id))`;
  if (q.used === "yes") conds.push(used);
  if (q.used === "no") conds.push(Prisma.sql`NOT ${used}`);
  return Prisma.join(conds, " AND ");
}

interface Row {
  id: string;
  punched_at: Date;
  local_time: string;
  business_date: Date;
  device_id: string;
  device_user_id: string;
  employee_id: string | null;
  route: string;
  batch_id: string;
  received_at: Date;
  flag: string | null;
  decision: string | null;
  reason: string | null;
  used: boolean;
}

const FROM_CLAUSE = Prisma.sql`FROM raw_punches p LEFT JOIN punch_flag_resolutions fr ON fr.punch_id = p.id`;
const SELECT = Prisma.sql`SELECT p.id, p.punched_at, p.local_time, p.business_date, p.device_id, p.device_user_id, p.employee_id, p.route::text AS route, p.batch_id, p.received_at, p.flag::text AS flag, fr.decision::text AS decision, fr.reason,
  EXISTS (SELECT 1 FROM daily_attendance d WHERE d.employee_id = p.employee_id AND d.date BETWEEN p.business_date - 1 AND p.business_date + 1 AND jsonb_exists(d.computed_from->'punchIds', p.id)) AS used`;

const FLAG_WORDS: Record<string, string> = { FUTURE: "Time ahead of the server clock", TOO_OLD: "Older than plausible" };

async function decorate(rows: Row[]) {
  const employeeIds = [...new Set(rows.map((r) => r.employee_id).filter((x): x is string => !!x))];
  const deviceIds = [...new Set(rows.map((r) => r.device_id))];
  const [names, employees, devices] = await Promise.all([
    namesOn(employeeIds, businessToday()),
    prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, employeeCode: true } }),
    prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, serialNumber: true, location: { select: { name: true } } } }),
  ]);
  const code = new Map(employees.map((e) => [e.id, e.employeeCode]));
  const device = new Map(devices.map((d) => [d.id, d]));
  return rows.map((r) => ({
    id: r.id,
    punchedAt: r.punched_at.toISOString(),
    /** The time exactly as the device recorded it. */
    deviceTime: r.local_time,
    /** The instant it means, in business time. */
    time: instantToLocalTime(r.punched_at, TZ).slice(0, 19),
    businessDate: iso(r.business_date),
    device: device.get(r.device_id)?.name ?? "(unknown device)",
    deviceSerial: device.get(r.device_id)?.serialNumber ?? null,
    branch: device.get(r.device_id)?.location.name ?? null,
    deviceUserId: r.device_user_id,
    employeeId: r.employee_id,
    employeeCode: r.employee_id ? (code.get(r.employee_id) ?? null) : null,
    employeeName: r.employee_id ? (names.get(r.employee_id) ?? null) : null,
    route: r.route,
    batchId: r.batch_id,
    receivedAt: r.received_at.toISOString(),
    flag: r.flag,
    flagLabel: r.flag ? (FLAG_WORDS[r.flag] ?? r.flag) : null,
    decision: r.decision,
    decisionReason: r.reason,
    /** Whether a computed day used this punch (it can be unused: a duplicate, discarded, flagged, outside every window). */
    used: r.used,
  }));
}

export async function listSwipes(viewer: Viewer, q: SwipeQuery) {
  const w = await where(viewer, q);
  const [total, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) AS n ${FROM_CLAUSE} WHERE ${w}`),
    prisma.$queryRaw<Row[]>(Prisma.sql`${SELECT} ${FROM_CLAUSE} WHERE ${w} ORDER BY p.punched_at DESC, p.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`),
  ]);
  const { from, to } = range(q);
  return { from, to, total: Number(total[0]?.n ?? 0), page: q.page, pageSize: q.pageSize, entries: await decorate(rows) };
}

/** The filter lists: devices (id, name, branch). Device names are not sensitive; punches are what scope protects. */
export async function swipeOptions() {
  const devices = await prisma.device.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, location: { select: { id: true, name: true } } } });
  return { devices: devices.map((d) => ({ id: d.id, name: d.name, locationId: d.location.id, branch: d.location.name })), routes: ["AGENT", "PUSH", "IMPORT"] as const };
}

export async function exportSwipes(viewer: Viewer, q: SwipeQuery) {
  const w = await where(viewer, q);
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`${SELECT} ${FROM_CLAUSE} WHERE ${w} ORDER BY p.punched_at DESC, p.id LIMIT ${EXPORT_CAP + 1}`);
  const capped = rows.length > EXPORT_CAP;
  const entries = await decorate(capped ? rows.slice(0, EXPORT_CAP) : rows);
  const { from, to } = range(q);
  const columns: XlsxColumn[] = [
    { key: "time", header: "Time (business)", width: 20 },
    { key: "deviceTime", header: "Time as the device recorded it", width: 22 },
    { key: "device", header: "Device", width: 20 },
    { key: "branch", header: "Branch", width: 16 },
    { key: "deviceUserId", header: "Device user ID", width: 14 },
    { key: "employeeCode", header: "Employee code", width: 14 },
    { key: "employeeName", header: "Employee", width: 22 },
    { key: "route", header: "Arrived by", width: 10 },
    { key: "receivedAt", header: "Received at (UTC)", width: 24 },
    { key: "flag", header: "Flag", width: 24 },
    { key: "decision", header: "Decision on the flag", width: 14 },
    { key: "used", header: "Used in a computed day", width: 12 },
  ];
  const filters = [
    `${from} to ${to}`,
    q.deviceId ? `device ${q.deviceId}` : null,
    q.locationId ? `branch ${q.locationId}` : null,
    q.employeeId ? `employee ${q.employeeId}` : null,
    q.route ? `route ${q.route}` : null,
    q.used ? `used: ${q.used}` : null,
    q.flagged ? `flagged: ${q.flagged}` : null,
    q.unmapped ? "unmapped only" : null,
  ].filter(Boolean);
  const buffer = await buildXlsx([
    {
      name: "Employee Swipes",
      columns,
      rows: entries.map((e) => ({ ...e, flag: e.flagLabel ?? "", decision: e.decision ?? "", used: e.employeeId ? (e.used ? "Yes" : "No") : "n/a (no employee)" })),
      footer: [
        `Raw punches exactly as received, ${entries.length} row${entries.length === 1 ? "" : "s"}. Filters: ${filters.join("; ")}.`,
        viewer.dataScope === "ALL" ? "Company-wide, including punches that match no employee." : "Your team only.",
        ...(capped ? [`Capped at ${EXPORT_CAP.toLocaleString("en-IN")} rows: narrow the dates or filters to see the rest.`] : []),
        "A punch can be unused: a near-duplicate, a discarded or still-flagged one, or one outside every shift's window.",
      ],
    },
  ]);
  return { buffer, fileName: `employee-swipes-${from}-to-${to}.xlsx`, capped };
}
