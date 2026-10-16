import { Prisma } from "@prisma/client";
import type { ReportBreakdown, ReportColumn, ReportResult } from "@shared/constants/reports";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { businessToday } from "../../lib/businessDate";
import { placedAtSql } from "../../lib/effectiveDating";
import { getExcessHoursSettings } from "../../lib/excessHoursSettings";
import { namesOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { DAY_TYPES, TYPE_LABELS, unmappedGroups } from "../attendance/exceptions/exceptions";
import { placementsOn, ymd, type Placement, type Population, type ReportQuery } from "./context";

// The four attendance reports (Phase 3 commit 4, docs/plans/PHASE_3.md): late coming, excess hours, exception summary and
// the attendance muster summary. They read the computed days (daily_attendance), over the viewer's population exactly like
// the other reports (a manager sees their team), and the screen and the Excel export render the same result. Every one says
// which of its days were not simply the device's: corrected by a request (~), set by HR (#), shift set for the day by HR
// (^) or marked by hand in the muster. Every one warns when any figure was computed with rule values HR has not confirmed.

type Row = Record<string, string | number | null>;
type Body = Pick<ReportResult, "columns" | "rows" | "summary" | "breakdowns" | "notes" | "warnings">;

export const MAX_ATTENDANCE_REPORT_DAYS = 93;
const TZ = "Asia/Kolkata";
const day = (s: string) => new Date(`${s}T00:00:00Z`);

function range(q: ReportQuery): { from: string; to: string } {
  const today = businessToday();
  const to = q.to ?? ymd(today);
  const from = q.from ?? ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  if (to < from) throw new HttpError(400, "The end date is before the start date.", "INVALID_RANGE");
  if (Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000) + 1 > MAX_ATTENDANCE_REPORT_DAYS) {
    throw new HttpError(400, `An attendance report covers at most ${MAX_ATTENDANCE_REPORT_DAYS} days at a time. Narrow the dates.`, "TOO_WIDE");
  }
  return { from, to };
}

interface DayRow {
  employee_id: string;
  employee_code: string;
  date: Date;
  status: string;
  first_half_status: string | null;
  second_half_status: string | null;
  exception_flags: string[];
  shift_code: string | null;
  shift_start: string | null;
  shift_end: string | null;
  first_in: Date | null;
  last_out: Date | null;
  late_in_minutes: number | null;
  excess_minutes: number | null;
  lop_days: string;
  source: string;
  capture: string;
  override_kind: string | null;
  shift_override_ref: string | null;
  shift_id: string | null;
  policy_id: string | null;
  provisional: boolean;
}

/** The days in range for the viewer's people, with the org and employment-type filters applied as on each day. */
async function loadDays(q: ReportQuery, pop: Population, from: string, to: string, extra: Prisma.Sql = Prisma.empty): Promise<DayRow[]> {
  const conds: Prisma.Sql[] = [Prisma.sql`d.date BETWEEN ${day(from)} AND ${day(to)}`];
  if (pop.ids) conds.push(pop.ids.size ? Prisma.sql`d.employee_id IN (${Prisma.join([...pop.ids])})` : Prisma.sql`FALSE`);
  if (q.employmentType) conds.push(Prisma.sql`e.employment_type = ${q.employmentType}::"EmploymentType"`);
  if (q.departmentId || q.locationId) conds.push(placedAtSql(Prisma.sql`d.employee_id`, Prisma.sql`d.date`, { departmentId: q.departmentId, locationId: q.locationId }));
  return prisma.$queryRaw<DayRow[]>(Prisma.sql`
    SELECT d.employee_id, e.employee_code, d.date, d.status, d.first_half_status, d.second_half_status, d.exception_flags, d.shift_code, d.shift_start, d.shift_end,
           d.first_in, d.last_out, d.late_in_minutes, d.excess_minutes, d.lop_days::text AS lop_days, d.source::text AS source, d.capture::text AS capture,
           d.override_kind, d.shift_override_ref, d.shift_id, d.policy_id, d.provisional
    FROM daily_attendance d JOIN employees e ON e.id = d.employee_id
    WHERE ${Prisma.join(conds, " AND ")} ${extra}
    ORDER BY e.employee_code, d.date`);
}

const PERSON_COLUMNS: ReportColumn[] = [
  { key: "employeeCode", header: "Employee Code" },
  { key: "name", header: "Name" },
  { key: "department", header: "Department" },
  { key: "branch", header: "Branch" },
];

async function people(rows: DayRow[], asOf: string) {
  const ids = [...new Set(rows.map((r) => r.employee_id))];
  const [names, placements] = await Promise.all([namesOn(ids, day(asOf)), placementsOn(ids, day(asOf))]);
  return (r: { employee_id: string; employee_code: string }): Row => {
    const p: Placement | undefined = placements.get(r.employee_id);
    return { employeeCode: r.employee_code, name: names.get(r.employee_id) ?? r.employee_code, department: p?.department ?? null, branch: p?.location ?? null };
  };
}

/** How the day was set, for a per-day list: the device unless the day says otherwise. */
function origin(r: Pick<DayRow, "override_kind" | "shift_override_ref" | "capture">): string {
  const parts: string[] = [];
  if (r.override_kind === "REGULARIZATION") parts.push("Correction approved (~)");
  else if (r.override_kind === "MANUAL_OVERRIDE") parts.push("Set by HR (#)");
  else if (r.capture === "MANUAL") parts.push("Marked by hand (muster)");
  else parts.push("Device");
  if (r.shift_override_ref) parts.push("shift set by HR (^)");
  return parts.join(", ");
}
const setByHand = (r: Pick<DayRow, "override_kind" | "shift_override_ref" | "capture">) => !!r.override_kind || !!r.shift_override_ref || r.capture === "MANUAL";

const clock = (t: Date | null) => (t ? instantToLocalTime(t, TZ).slice(11, 16) : null);
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

const MARKER_NOTE = "How the day was set: Device (the biometric device's punches), Correction approved (~), Set by HR (#), Marked by hand (muster); \"shift set by HR (^)\" where HR gave that day a different shift.";

/** A warning when any figure rests on a shift or policy whose values HR has not confirmed yet. */
async function placeholderWarnings(rows: DayRow[]): Promise<string[]> {
  const shiftIds = [...new Set(rows.flatMap((r) => (r.shift_id ? [r.shift_id] : [])))];
  const policyIds = [...new Set(rows.flatMap((r) => (r.policy_id ? [r.policy_id] : [])))];
  const [shifts, policies] = await Promise.all([
    shiftIds.length ? prisma.shift.findMany({ where: { id: { in: shiftIds } }, select: { code: true, placeholderFields: true } }) : [],
    policyIds.length ? prisma.attendancePolicy.findMany({ where: { id: { in: policyIds } }, select: { code: true, placeholderFields: true } }) : [],
  ]);
  const pending = [...shifts.map((s) => ({ what: `shift ${s.code}`, f: s.placeholderFields })), ...policies.map((p) => ({ what: `policy ${p.code}`, f: p.placeholderFields }))].filter((x) => Array.isArray(x.f) && x.f.length > 0);
  return pending.length ? [`Computed with rule values HR has not confirmed: ${pending.map((x) => x.what).join(", ")}. The figures here may change when HR confirms them in Attendance Settings.`] : [];
}

const countBy = (rows: Row[], key: string, title: string, label: string): ReportBreakdown => {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(String(r[key] ?? "—"), (counts.get(String(r[key] ?? "—")) ?? 0) + 1);
  return { title, columns: [{ key: "label", header: title.replace(/^By /, "").replace(/^./, (c) => c.toUpperCase()) }, { key: "count", header: label, type: "number" }], rows: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, count]) => ({ label: l, count })) };
};

const sumBy = (rows: Row[], key: string, value: string, title: string, label: string): ReportBreakdown => {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(String(r[key] ?? "—"), (sums.get(String(r[key] ?? "—")) ?? 0) + Number(r[value] ?? 0));
  return { title, columns: [{ key: "label", header: title.replace(/^By /, "").replace(/^./, (c) => c.toUpperCase()) }, { key: "count", header: label, type: "number" }], rows: [...sums.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, count]) => ({ label: l, count: Math.round(count * 100) / 100 })) };
};

/** The ten people with the most entries. */
function topPeople(rows: Row[], title: string, label: string): ReportBreakdown {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(`${r.name} (${r.employeeCode})`, (counts.get(`${r.name} (${r.employeeCode})`) ?? 0) + 1);
  return { title, columns: [{ key: "label", header: "Employee" }, { key: "count", header: label, type: "number" }], rows: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([l, count]) => ({ label: l, count })) };
}

// ── Late coming ──────────────────────────────────────────────────────

export async function lateComing(q: ReportQuery, pop: Population): Promise<Body> {
  const { from, to } = range(q);
  const days = await loadDays(q, pop, from, to, Prisma.sql`AND d.late_in_minutes > 0`);
  const who = await people(days, to);
  const rows: Row[] = days.map((r) => ({
    ...who(r),
    date: ymd(r.date),
    shift: r.shift_code,
    shiftStart: r.shift_start,
    firstIn: clock(r.first_in),
    lateBy: r.late_in_minutes ?? 0,
    status: r.status,
    origin: origin(r),
  }));
  const total = rows.reduce((n, r) => n + (r.lateBy as number), 0);
  return {
    columns: [...PERSON_COLUMNS, { key: "date", header: "Date", type: "date" }, { key: "shift", header: "Shift" }, { key: "shiftStart", header: "Shift Start" }, { key: "firstIn", header: "First In" }, { key: "lateBy", header: "Late By (min)", type: "number" }, { key: "status", header: "Day Status" }, { key: "origin", header: "How The Day Was Set" }],
    rows,
    summary: [
      { label: "Late days", value: rows.length, type: "number" },
      { label: "People", value: new Set(rows.map((r) => r.employeeCode)).size, type: "number" },
      { label: "Total late (min)", value: total, type: "number" },
      { label: "Average late (min)", value: rows.length ? Math.round(total / rows.length) : 0, type: "number" },
      { label: "Days set by hand", value: days.filter(setByHand).length, type: "number" },
    ],
    breakdowns: [topPeople(rows, "Most often late", "Late days"), countBy(rows, "department", "By department", "Late days"), countBy(rows, "branch", "By branch", "Late days")],
    notes: [
      "Days on which the first punch was after the shift start (the shift's grace is the shift's own setting). Lateness is recorded, not penalised: no pay is lost for it.",
      MARKER_NOTE,
      "Department and branch are as on the last day of the range; the department and branch filters apply to where each person was on each day.",
    ],
    warnings: await placeholderWarnings(days),
  };
}

// ── Excess hours ─────────────────────────────────────────────────────

export async function excessHours(q: ReportQuery, pop: Population): Promise<Body> {
  const { from, to } = range(q);
  const { minMinutes } = await getExcessHoursSettings();
  const threshold = Math.max(1, minMinutes);
  const days = await loadDays(q, pop, from, to, Prisma.sql`AND d.excess_minutes >= ${threshold} AND d.provisional = FALSE`);
  const who = await people(days, to);
  const rows: Row[] = days.map((r) => ({
    ...who(r),
    date: ymd(r.date),
    shift: r.shift_code,
    shiftEnd: r.shift_end,
    lastOut: clock(r.last_out),
    excessMinutes: r.excess_minutes ?? 0,
    excess: hm(r.excess_minutes ?? 0),
    origin: origin(r),
  }));
  const total = rows.reduce((n, r) => n + (r.excessMinutes as number), 0);
  return {
    columns: [...PERSON_COLUMNS, { key: "date", header: "Date", type: "date" }, { key: "shift", header: "Shift" }, { key: "shiftEnd", header: "Shift End" }, { key: "lastOut", header: "Last Out" }, { key: "excessMinutes", header: "Excess (min)", type: "number" }, { key: "excess", header: "Excess (h:mm)" }, { key: "origin", header: "How The Day Was Set" }],
    rows,
    summary: [
      { label: "Excess hours", value: Math.round((total / 60) * 100) / 100, type: "number" },
      { label: "Days", value: rows.length, type: "number" },
      { label: "People", value: new Set(rows.map((r) => r.employeeCode)).size, type: "number" },
      { label: "Smallest excess listed (min)", value: threshold, type: "number" },
      { label: "Days set by hand", value: days.filter(setByHand).length, type: "number" },
    ],
    breakdowns: [sumBy(rows.map((r) => ({ ...r, hours: (r.excessMinutes as number) / 60 })), "department", "hours", "By department", "Excess hours"), topPeople(rows, "Most days with excess", "Days")],
    notes: [
      `The minutes a person's last punch was after the end of their shift, on days with at least ${threshold} of them (System Settings → Attendance → Excess hours). Days whose shift window was still open when computed are left out.`,
      MARKER_NOTE,
    ],
    warnings: [
      "Overtime is not defined yet (no rate, eligibility or approval). These are hours worked beyond the shift end, not payable overtime.",
      ...(await placeholderWarnings(days)),
    ],
  };
}

// ── Exception summary ────────────────────────────────────────────────

export async function exceptionSummary(q: ReportQuery, pop: Population): Promise<Body> {
  const { from, to } = range(q);
  const days = await loadDays(q, pop, from, to, Prisma.sql`AND d.exception_flags && ARRAY[${Prisma.join([...DAY_TYPES])}]::text[]`);
  const who = await people(days, to);
  const byEmployee = new Map<string, { row: Row; total: number; byHand: number; counts: Record<string, number> }>();
  const typeTotals: Record<string, number> = Object.fromEntries(DAY_TYPES.map((t) => [t, 0]));
  for (const r of days) {
    const entry = byEmployee.get(r.employee_id) ?? { row: who(r), total: 0, byHand: 0, counts: Object.fromEntries(DAY_TYPES.map((t) => [t, 0])) };
    entry.total += 1;
    if (setByHand(r)) entry.byHand += 1;
    for (const t of DAY_TYPES) {
      if (r.exception_flags.includes(t)) {
        entry.counts[t] = (entry.counts[t] ?? 0) + 1;
        typeTotals[t] = (typeTotals[t] ?? 0) + 1;
      }
    }
    byEmployee.set(r.employee_id, entry);
  }
  const rows: Row[] = [...byEmployee.values()]
    .map((e): Row => ({ ...e.row, ...Object.fromEntries(DAY_TYPES.map((t) => [t, e.counts[t] ?? 0])), total: e.total, byHand: e.byHand }))
    .sort((a, b) => Number(b.total) - Number(a.total) || String(a.employeeCode).localeCompare(String(b.employeeCode)));
  // Device IDs that match nobody belong to nobody, so only a company-wide view counts them.
  const unmapped = pop.ids === null && !q.departmentId ? (await unmappedGroups({ from, to, locationId: q.locationId }, { count: true })).total : null;
  const byType: ReportBreakdown = { title: "By reason", columns: [{ key: "label", header: "Reason" }, { key: "count", header: "Days", type: "number" }], rows: DAY_TYPES.map((t) => ({ label: TYPE_LABELS[t], count: typeTotals[t] ?? 0 })) };
  return {
    columns: [...PERSON_COLUMNS, ...DAY_TYPES.map((t): ReportColumn => ({ key: t, header: TYPE_LABELS[t], type: "number" })), { key: "total", header: "Days With An Exception", type: "number" }, { key: "byHand", header: "Of Which Set By Hand", type: "number" }],
    rows,
    summary: [
      { label: "Days with an exception", value: days.length, type: "number" },
      { label: "People", value: rows.length, type: "number" },
      ...DAY_TYPES.map((t) => ({ label: TYPE_LABELS[t], value: typeTotals[t] ?? 0, type: "number" as const })),
      ...(unmapped === null ? [] : [{ label: "Unmapped device IDs", value: unmapped, type: "number" as const }]),
    ],
    breakdowns: [byType, countBy(rows, "department", "By department", "People"), countBy(rows, "branch", "By branch", "People")],
    notes: [
      "The days the Attendance Exception queue would list in this range, counted per person: a day with two reasons counts under both and once in the total. Late arrivals and early departures are not exceptions.",
      "\"Of which set by hand\": the days among them that were marked in the muster or carry an HR override or shift override (a corrected day normally leaves the list). " + MARKER_NOTE,
      ...(unmapped === null ? ["Device IDs that match no employee are counted for a company-wide view only."] : ["Unmapped device IDs: IDs whose punches in this range matched nobody (company-wide)."]),
    ],
    warnings: await placeholderWarnings(days),
  };
}

// ── Attendance muster summary ────────────────────────────────────────

type Unit = "present" | "absent" | "leave" | "holiday" | "weekOff" | "notMarked" | "noShift";
function unitsOf(r: Pick<DayRow, "status" | "first_half_status" | "second_half_status">): Array<[Unit, number]> {
  const kind = (s: string): Unit => (s === "P" ? "present" : s === "A" ? "absent" : s === "H" ? "holiday" : s === "O" ? "weekOff" : s === "NM" ? "notMarked" : s === "NS" ? "noShift" : "leave");
  if (r.status === "HD") return [["present", 0.5], ["absent", 0.5]];
  if (r.first_half_status && r.second_half_status) return [[kind(r.first_half_status), 0.5], [kind(r.second_half_status), 0.5]];
  if (r.status.includes(":")) {
    const [a, b] = r.status.split(":") as [string, string];
    return [[kind(a), 0.5], [kind(b), 0.5]];
  }
  return [[kind(r.status), 1]];
}

export async function attendanceMuster(q: ReportQuery, pop: Population): Promise<Body> {
  const { from, to } = range(q);
  const days = await loadDays(q, pop, from, to);
  const who = await people(days, to);
  type Acc = { row: Row; u: Record<Unit, number>; lop: number; late: number; excess: number; request: number; hr: number; hand: number; shift: number };
  const byEmployee = new Map<string, Acc>();
  for (const r of days) {
    const acc: Acc = byEmployee.get(r.employee_id) ?? { row: who(r), u: { present: 0, absent: 0, leave: 0, holiday: 0, weekOff: 0, notMarked: 0, noShift: 0 }, lop: 0, late: 0, excess: 0, request: 0, hr: 0, hand: 0, shift: 0 };
    for (const [unit, n] of unitsOf(r)) acc.u[unit] += n;
    acc.lop += Number(r.lop_days);
    if ((r.late_in_minutes ?? 0) > 0) acc.late += 1;
    if (!r.provisional) acc.excess += r.excess_minutes ?? 0;
    if (r.override_kind === "REGULARIZATION") acc.request += 1;
    else if (r.override_kind === "MANUAL_OVERRIDE") acc.hr += 1;
    else if (r.capture === "MANUAL") acc.hand += 1;
    if (r.shift_override_ref) acc.shift += 1;
    byEmployee.set(r.employee_id, acc);
  }
  const rows: Row[] = [...byEmployee.values()].map((a) => ({
    ...a.row,
    present: a.u.present,
    absent: a.u.absent,
    leave: a.u.leave,
    holiday: a.u.holiday,
    weekOff: a.u.weekOff,
    notMarked: a.u.notMarked,
    noShift: a.u.noShift,
    lop: Math.round(a.lop * 100) / 100,
    lateDays: a.late,
    excessHours: Math.round((a.excess / 60) * 100) / 100,
    request: a.request,
    hr: a.hr,
    hand: a.hand,
    shift: a.shift,
  }));
  const sum = (k: string) => Math.round(rows.reduce((n, r) => n + Number(r[k]), 0) * 100) / 100;
  const num = (key: string, header: string): ReportColumn => ({ key, header, type: "number" });
  return {
    columns: [
      ...PERSON_COLUMNS,
      num("present", "Present"),
      num("absent", "Absent"),
      num("leave", "Leave"),
      num("holiday", "Holiday"),
      num("weekOff", "Week-off"),
      num("notMarked", "Not Marked"),
      num("noShift", "No Shift"),
      num("lop", "LOP Days"),
      num("lateDays", "Late Days"),
      num("excessHours", "Excess Hours"),
      num("request", "Days Corrected By Request (~)"),
      num("hr", "Days Set By HR (#)"),
      num("hand", "Days Marked By Hand (muster)"),
      num("shift", "Days With Shift Set By HR (^)"),
    ],
    rows,
    summary: [
      { label: "People", value: rows.length, type: "number" },
      { label: "Present days", value: sum("present"), type: "number" },
      { label: "Absent days", value: sum("absent"), type: "number" },
      { label: "Leave days", value: sum("leave"), type: "number" },
      { label: "LOP days", value: sum("lop"), type: "number" },
      { label: "Not marked", value: sum("notMarked"), type: "number" },
      { label: "Days not from the device", value: sum("request") + sum("hr") + sum("hand"), type: "number" },
    ],
    breakdowns: [sumBy(rows, "department", "present", "By department", "Present days"), sumBy(rows, "branch", "lop", "By branch", "LOP days")],
    notes: [
      "One line per person for the range: days counted by what the computed day says (half-day statuses count half a day each way). For the day-by-day grid, and to mark manual-capture days, use the Attendance Muster screen.",
      "The last four columns count the days that were not simply the device's: a correction request approved (~), set by HR (#), marked by hand in the muster, and days with a shift HR set for that day (^). LOP days are the engine's, for the half-day rule and absences; approved unpaid leave is in the LOP report.",
      "Not marked (NM) days are manual-capture days nobody has filled in: paid days are never guessed.",
    ],
    warnings: await placeholderWarnings(days),
  };
}
