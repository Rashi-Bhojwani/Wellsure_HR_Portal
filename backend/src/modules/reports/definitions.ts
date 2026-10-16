import { Prisma } from "@prisma/client";
import type { ReportBreakdown, ReportColumn, ReportKey, ReportResult, ReportSummaryItem } from "@shared/constants/reports";
import { addCalendarDays, businessToday } from "../../lib/businessDate";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { computeTotalLeaveDays } from "../leave/dayCount";
import { resolveDayCountContext } from "../leave/dayCountContext";
import { EncashmentRateNotConfiguredError, getEncashmentRateProvider } from "../leave/encashmentRate";
import { attendanceMuster, excessHours, exceptionSummary, lateComing } from "./attendanceReports";
import { currentName, employeeWhere, matchesOrg, nameOf, placementsOn, ymd, type Placement, type Population, type ReportQuery } from "./context";

// The seven core reports (Phase 5 commit F, docs/plans/PHASE_5.md §F). Each
// returns rows + summary + breakdowns computed over the viewer's population;
// the screen and the Excel export render the same result, so they can't
// disagree. Nothing here reads attendance or payroll data (Phases 3 and 6).

export type ReportBody = Pick<ReportResult, "columns" | "rows" | "summary" | "breakdowns" | "notes" | "warnings"> & { rateProvisional?: boolean };
type Row = Record<string, string | number | null>;
type Definition = (q: ReportQuery, pop: Population) => Promise<ReportBody>;

const MAX_RANGE_DAYS = 366;

// ── shared bits ──────────────────────────────────────────────────────

const day = (s: string | undefined, fallback: Date) => (s ? new Date(`${s}T00:00:00Z`) : fallback);

export function rangeOf(q: ReportQuery, defaultFrom: Date, defaultTo: Date): { from: Date; to: Date } {
  const from = day(q.from, defaultFrom);
  const to = day(q.to, defaultTo);
  if (to.getTime() < from.getTime()) throw new HttpError(400, "The end date is before the start date.", "INVALID_RANGE");
  return { from, to };
}

const PERSON_COLUMNS: ReportColumn[] = [
  { key: "employeeCode", header: "Employee Code" },
  { key: "name", header: "Name" },
  { key: "department", header: "Department" },
  { key: "designation", header: "Designation" },
  { key: "branch", header: "Branch" },
];

const personCells = (e: { employeeCode: string; nameHistory: { fullName: string }[] }, p: Placement | undefined): Row => ({
  employeeCode: e.employeeCode,
  name: nameOf(e),
  department: p?.department ?? null,
  designation: p?.designation ?? null,
  branch: p?.location ?? null,
});

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", INTERN: "Intern", CONSULTANT: "Consultant", PROBATION: "Probation" };

function countBy(rows: Row[], key: string, title: string, label = "Count"): ReportBreakdown {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = (r[key] as string | null) ?? "—";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return {
    title,
    columns: [
      { key: "label", header: title.replace(/^By /, "").replace(/^./, (c) => c.toUpperCase()) },
      { key: "count", header: label, type: "number" },
    ],
    rows: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([labelValue, count]) => ({ label: labelValue, count })),
  };
}

function monthsBetween(from: Date, to: Date): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d.getTime() <= to.getTime(); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    out.push({ key: ymd(d).slice(0, 7), label: d.toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) });
  }
  return out;
}

function byMonth(dates: string[], from: Date, to: Date, title: string, header: string): ReportBreakdown {
  return {
    title,
    columns: [
      { key: "label", header: "Month" },
      { key: "count", header, type: "number" },
    ],
    rows: monthsBetween(from, to).map((m) => ({ label: m.label, count: dates.filter((d) => d.startsWith(m.key)).length })),
  };
}

// ── Headcount ────────────────────────────────────────────────────────

// Everyone employed on `asOf`: joined on or before it, and either still
// active or separated with a last working day on or after it. INACTIVE
// (suspended) people aren't counted — we don't know when they became so.
export async function headcountOn(asOf: Date, q: ReportQuery, pop: Population) {
  const employees = await prisma.employee.findMany({
    where: {
      ...employeeWhere(pop, q),
      dateOfJoining: { lte: asOf },
      OR: [
        { status: "ACTIVE", OR: [{ lastWorkingDate: null }, { lastWorkingDate: { gte: asOf } }] },
        { status: "SEPARATED", lastWorkingDate: { gte: asOf } },
      ],
    },
    select: { id: true, employeeCode: true, dateOfJoining: true, employmentType: true, ...currentName() },
    orderBy: { employeeCode: "asc" },
  });
  const placements = await placementsOn(
    employees.map((e) => e.id),
    asOf,
  );
  return employees.filter((e) => matchesOrg(placements.get(e.id), q)).map((e) => ({ e, p: placements.get(e.id) }));
}

const headcount: Definition = async (q, pop) => {
  const asOf = day(q.asOf, businessToday());
  const people = await headcountOn(asOf, q, pop);
  const rows = people.map(({ e, p }) => ({
    ...personCells(e, p),
    city: p?.city ?? null,
    employmentType: EMPLOYMENT_TYPE_LABEL[e.employmentType] ?? e.employmentType,
    dateOfJoining: ymd(e.dateOfJoining),
    reportingManager: p?.reportingManager ?? null,
  }));
  return {
    columns: [...PERSON_COLUMNS, { key: "city", header: "City" }, { key: "employmentType", header: "Employment Type" }, { key: "dateOfJoining", header: "Date of Joining", type: "date" }, { key: "reportingManager", header: "Reporting Manager" }],
    rows,
    summary: [{ label: `Headcount on ${ymd(asOf)}`, value: rows.length, type: "number" }],
    breakdowns: [countBy(rows, "department", "By department", "Headcount"), countBy(rows, "branch", "By branch", "Headcount"), countBy(rows, "employmentType", "By employment type", "Headcount")],
    notes: ["Counts everyone who had joined by the date and hadn't yet left (last working day on or after it). Department, branch and designation are as on that date.", "Suspended (inactive) employees aren't counted."],
    warnings: [],
  };
};

// ── Joiners ──────────────────────────────────────────────────────────

const joiners: Definition = async (q, pop) => {
  const today = businessToday();
  const { from, to } = rangeOf(q, new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), today);
  const employees = await prisma.employee.findMany({
    where: { ...employeeWhere(pop, q), dateOfJoining: { gte: from, lte: to } },
    select: { id: true, employeeCode: true, dateOfJoining: true, employmentType: true, status: true, ...currentName() },
    orderBy: [{ dateOfJoining: "asc" }, { employeeCode: "asc" }],
  });
  const rows: Row[] = [];
  for (const e of employees) {
    const p = (await placementsOn([e.id], e.dateOfJoining)).get(e.id);
    if (!matchesOrg(p, q)) continue;
    rows.push({ ...personCells(e, p), dateOfJoining: ymd(e.dateOfJoining), employmentType: EMPLOYMENT_TYPE_LABEL[e.employmentType] ?? e.employmentType, status: e.status === "ACTIVE" ? "Active" : e.status === "SEPARATED" ? "Separated" : "Inactive" });
  }
  return {
    columns: [...PERSON_COLUMNS, { key: "dateOfJoining", header: "Date of Joining", type: "date" }, { key: "employmentType", header: "Employment Type" }, { key: "status", header: "Status today" }],
    rows,
    summary: [{ label: "Joiners", value: rows.length, type: "number" }],
    breakdowns: [byMonth(rows.map((r) => r.dateOfJoining as string), from, to, "By month", "Joiners"), countBy(rows, "department", "By department", "Joiners")],
    notes: ["Department, branch and designation are as on each person's joining date."],
    warnings: [],
  };
};

// ── Leavers & attrition ──────────────────────────────────────────────

const leavers: Definition = async (q, pop) => {
  const today = businessToday();
  const { from, to } = rangeOf(q, new Date(Date.UTC(today.getUTCFullYear(), 0, 1)), today);
  // The employee record is the source of truth for who left and when —
  // people imported from greytHR have a last working day but no Separation
  // row in this system. The reason comes from the completed separation
  // where there is one.
  const leftEmployees = await prisma.employee.findMany({
    where: { status: "SEPARATED", lastWorkingDate: { gte: from, lte: to }, ...(q.employmentType ? { employmentType: q.employmentType } : {}) },
    select: {
      id: true,
      employeeCode: true,
      dateOfJoining: true,
      lastWorkingDate: true,
      exitReason: true,
      ...currentName(),
      jobHistory: { orderBy: { effectiveFrom: "desc" }, take: 1, select: { reportingManagerId: true } },
      separations: { where: { status: "COMPLETED" }, orderBy: { completedAt: "desc" }, take: 1, select: { reason: true } },
    },
    orderBy: [{ lastWorkingDate: "asc" }, { employeeCode: "asc" }],
  });
  const rows: Row[] = [];
  for (const e of leftEmployees) {
    const lastManager = e.jobHistory[0]?.reportingManagerId ?? "";
    if (pop.ids && !pop.ids.has(e.id) && !pop.managers!.has(lastManager)) continue;
    const lwd = e.lastWorkingDate!;
    const p = (await placementsOn([e.id], lwd)).get(e.id);
    if (!matchesOrg(p, q)) continue;
    const tenureYears = (lwd.getTime() - e.dateOfJoining.getTime()) / (365.25 * 86_400_000);
    rows.push({ ...personCells(e, p), dateOfJoining: ymd(e.dateOfJoining), lastWorkingDate: ymd(lwd), tenureYears: Math.round(tenureYears * 10) / 10, reason: e.exitReason ?? e.separations[0]?.reason ?? null });
  }
  const opening = (await headcountOn(from, q, pop)).length;
  const closing = (await headcountOn(to, q, pop)).length;
  const average = (opening + closing) / 2;
  const attrition = average > 0 ? rows.length / average : null;
  return {
    columns: [...PERSON_COLUMNS, { key: "dateOfJoining", header: "Date of Joining", type: "date" }, { key: "lastWorkingDate", header: "Last Working Day", type: "date" }, { key: "tenureYears", header: "Tenure (years)", type: "number" }, { key: "reason", header: "Reason" }],
    rows,
    summary: [
      { label: "Leavers", value: rows.length, type: "number" },
      { label: `Headcount on ${ymd(from)}`, value: opening, type: "number" },
      { label: `Headcount on ${ymd(to)}`, value: closing, type: "number" },
      { label: "Average headcount", value: average, type: "number" },
      { label: "Attrition", value: attrition, type: "percent" },
    ],
    breakdowns: [byMonth(rows.map((r) => r.lastWorkingDate as string), from, to, "By month", "Leavers"), countBy(rows, "reason", "By reason", "Leavers"), countBy(rows, "department", "By department", "Leavers")],
    notes: [
      "Attrition = leavers ÷ average of the headcount on the first and last day of the range. It isn't annualised: for a part-year range it's the attrition over that period.",
      "Leavers are separated employees whose last working day falls in the range (including people imported with a last working day). Department and branch are as on that day.",
    ],
    warnings: [],
  };
};

// ── Birthdays & anniversaries ────────────────────────────────────────

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// The day a date-of-year falls on in `year` — 29 Feb becomes 28 Feb in a
// non-leap year.
function occurrence(source: Date, year: number): Date {
  const m = source.getUTCMonth();
  const d = source.getUTCDate();
  return new Date(Date.UTC(year, m, m === 1 && d === 29 && !isLeap(year) ? 28 : d));
}

const celebrations: Definition = async (q, pop) => {
  const today = businessToday();
  const { from, to } = rangeOf(q, today, addCalendarDays(today, 30));
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) throw new HttpError(400, "Pick a range of a year or less.", "RANGE_TOO_LONG");
  const kind = q.kind ?? "all";
  const employees = await prisma.employee.findMany({
    where: { ...employeeWhere(pop, q), status: "ACTIVE" },
    select: { id: true, employeeCode: true, dateOfJoining: true, ...currentName(), personal: { select: { dateOfBirth: true } } },
  });
  const placements = await placementsOn(
    employees.map((e) => e.id),
    today,
  );
  const rows: Row[] = [];
  for (const e of employees) {
    const p = placements.get(e.id);
    if (!matchesOrg(p, q)) continue;
    for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year++) {
      const inRange = (d: Date) => d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
      if (kind !== "anniversary" && e.personal?.dateOfBirth) {
        const d = occurrence(e.personal.dateOfBirth, year);
        // Day and month only — never the year of birth or an age.
        if (inRange(d)) rows.push({ date: ymd(d), kind: "Birthday", ...personCells(e, p), detail: d.toLocaleString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) });
      }
      if (kind !== "birthday") {
        const d = occurrence(e.dateOfJoining, year);
        const years = year - e.dateOfJoining.getUTCFullYear();
        if (years >= 1 && inRange(d)) rows.push({ date: ymd(d), kind: "Work anniversary", ...personCells(e, p), detail: `${years} year${years === 1 ? "" : "s"}` });
      }
    }
  }
  rows.sort((a, b) => (a.date as string).localeCompare(b.date as string) || (a.name as string).localeCompare(b.name as string));
  return {
    columns: [{ key: "date", header: "Date", type: "date" }, { key: "kind", header: "Occasion" }, ...PERSON_COLUMNS, { key: "detail", header: "Detail" }],
    rows,
    summary: [
      { label: "Birthdays", value: rows.filter((r) => r.kind === "Birthday").length, type: "number" },
      { label: "Work anniversaries", value: rows.filter((r) => r.kind === "Work anniversary").length, type: "number" },
    ],
    breakdowns: [],
    notes: ["Active employees only. Birthdays show the day and month, never the year or age. A 29 February date falls on 28 February in other years.", "Anniversaries count completed years of service (1 year and up)."],
    warnings: [],
  };
};

// ── Leave balance ────────────────────────────────────────────────────

async function activeEmployeesOn(asOf: Date, q: ReportQuery, pop: Population) {
  const employees = await prisma.employee.findMany({
    where: { ...employeeWhere(pop, q), status: "ACTIVE", dateOfJoining: { lte: asOf } },
    select: { id: true, employeeCode: true, ...currentName() },
    orderBy: { employeeCode: "asc" },
  });
  const placements = await placementsOn(
    employees.map((e) => e.id),
    asOf,
  );
  return employees.filter((e) => matchesOrg(placements.get(e.id), q)).map((e) => ({ e, p: placements.get(e.id) }));
}

// Same arithmetic as the Leave Balances screen (ledger.getLeaveBalancesFor-
// Employee): the sum of every ledger entry dated on or before asOf.
async function balancesOn(employeeIds: string[], leaveTypeIds: string[], asOf: Date): Promise<Map<string, Prisma.Decimal>> {
  const sums = await prisma.leaveLedger.groupBy({
    by: ["employeeId", "leaveTypeId"],
    where: { employeeId: { in: employeeIds }, leaveTypeId: { in: leaveTypeIds }, entryDate: { lte: asOf } },
    _sum: { days: true },
  });
  return new Map(sums.map((s) => [`${s.employeeId}:${s.leaveTypeId}`, s._sum.days ?? new Prisma.Decimal(0)]));
}

const leaveBalance: Definition = async (q, pop) => {
  const asOf = day(q.asOf, businessToday());
  const types = await prisma.leaveType.findMany({ where: { isActive: true, ...(q.leaveTypeId ? { id: q.leaveTypeId } : {}) }, orderBy: { code: "asc" } });
  if (q.leaveTypeId && types.length === 0) throw new HttpError(400, "Unknown leave type.", "INVALID_LEAVE_TYPE");
  const people = await activeEmployeesOn(asOf, q, pop);
  const sums = await balancesOn(
    people.map(({ e }) => e.id),
    types.map((t) => t.id),
    asOf,
  );
  const typeKey = (code: string) => `lt_${code}`;
  const rows = people.map(({ e, p }) => ({ ...personCells(e, p), ...Object.fromEntries(types.map((t) => [typeKey(t.code), (sums.get(`${e.id}:${t.id}`) ?? new Prisma.Decimal(0)).toNumber()])) }));
  return {
    columns: [...PERSON_COLUMNS, ...types.map((t) => ({ key: typeKey(t.code), header: `${t.name} (${t.code})`, type: "number" as const }))],
    rows,
    summary: [{ label: "Employees", value: rows.length, type: "number" }, ...types.map((t) => ({ label: `Total ${t.code} balance`, value: Math.round(rows.reduce((n, r) => n + (r[typeKey(t.code)] as number), 0) * 100) / 100, type: "number" as const }))],
    breakdowns: [],
    notes: [`Balances on ${ymd(asOf)}: the sum of every ledger entry (accruals, grants, carry-forward, leave taken, reversals) dated on or before it — the same figure as the Leave Balances screen.`, "Active employees only."],
    warnings: [],
  };
};

// ── Leave liability ──────────────────────────────────────────────────

const leaveLiability: Definition = async (q, pop) => {
  const asOf = day(q.asOf, businessToday());
  const types = await prisma.leaveType.findMany({ where: { isActive: true, policy: { yearEndEncashment: true } }, orderBy: { code: "asc" } });
  const people = await activeEmployeesOn(asOf, q, pop);
  const sums = await balancesOn(
    people.map(({ e }) => e.id),
    types.map((t) => t.id),
    asOf,
  );
  const provider = getEncashmentRateProvider();
  let rateMissing = false;
  let provisional = false;
  const rows: Row[] = [];
  for (const { e, p } of people) {
    let rate: { amount: Prisma.Decimal; isFinal: boolean } | null = null;
    try {
      rate = await provider.getDailyRate(e.id, asOf);
      if (!rate.isFinal) provisional = true;
    } catch (err) {
      if (!(err instanceof EncashmentRateNotConfiguredError)) throw err;
      rateMissing = true;
    }
    for (const t of types) {
      const balance = sums.get(`${e.id}:${t.id}`) ?? new Prisma.Decimal(0);
      if (balance.isZero()) continue; // nothing owed, nothing to list
      const days = Prisma.Decimal.max(balance, 0); // an overdrawn balance owes nothing
      rows.push({ ...personCells(e, p), leaveType: t.code, balance: balance.toNumber(), dailyRate: rate ? rate.amount.toNumber() : null, liability: rate ? days.times(rate.amount).toDecimalPlaces(2).toNumber() : null });
    }
  }
  const totalDays = rows.reduce((n, r) => n + Math.max(0, r.balance as number), 0);
  const totalLiability = rateMissing ? null : rows.reduce((n, r) => n + ((r.liability as number | null) ?? 0), 0);
  const warnings: string[] = [];
  if (rateMissing) warnings.push("No encashment daily rate is configured (System Settings → Leave), so only days are shown — no rupee amounts.");
  return {
    columns: [...PERSON_COLUMNS, { key: "leaveType", header: "Leave Type" }, { key: "balance", header: "Balance (days)", type: "number" }, { key: "dailyRate", header: "Daily Rate", type: "money" }, { key: "liability", header: "Liability", type: "money" }],
    rows,
    summary: [
      { label: "Encashable days", value: Math.round(totalDays * 100) / 100, type: "number" },
      { label: "Total liability", value: totalLiability === null ? null : Math.round(totalLiability * 100) / 100, type: "money" },
    ],
    breakdowns: [],
    notes: [`Year-end-encashable leave (${types.map((t) => t.code).join(", ") || "none"}) on ${ymd(asOf)} × the encashment daily rate Year End Process uses. A negative balance counts as zero.`, "Active employees with a non-zero balance only."],
    warnings,
    rateProvisional: provisional || rateMissing,
  };
};

// ── LOP ──────────────────────────────────────────────────────────────

const fmtDay = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const lop: Definition = async (q, pop) => {
  const today = businessToday();
  const { from, to } = rangeOf(q, new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), today);
  const requests = await prisma.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      leaveType: { isPaid: false },
      fromDate: { lte: to },
      toDate: { gte: from },
      employee: employeeWhere(pop, q),
    },
    select: { employeeId: true, fromDate: true, toDate: true, fromDayPart: true, toDayPart: true, employee: { select: { employeeCode: true, ...currentName() } } },
    orderBy: { fromDate: "asc" },
  });
  const placements = await placementsOn([...new Set(requests.map((r) => r.employeeId))], to);
  const byEmployee = new Map<string, { row: Row; days: Prisma.Decimal; spans: string[]; requests: number }>();
  for (const r of requests) {
    const p = placements.get(r.employeeId);
    if (!matchesOrg(p, q)) continue;
    // Only the part of the request inside the range, counted the way leave
    // is counted (holidays and week-offs excluded, half-days honoured).
    const oFrom = r.fromDate.getTime() < from.getTime() ? from : r.fromDate;
    const oTo = r.toDate.getTime() > to.getTime() ? to : r.toDate;
    const startPart = oFrom.getTime() === r.fromDate.getTime() ? r.fromDayPart : "FULL";
    const endPart = oTo.getTime() === r.toDate.getTime() ? r.toDayPart : "FULL";
    const single = oFrom.getTime() === oTo.getTime();
    // A one-day overlap on the request's last day takes that day's half.
    const singlePart = oFrom.getTime() === r.fromDate.getTime() ? r.fromDayPart : endPart;
    const ctx = await resolveDayCountContext(r.employeeId, oFrom, oTo);
    const days = computeTotalLeaveDays(oFrom, oTo, single ? singlePart : startPart, single ? singlePart : endPart, ctx.holidayDates, ctx.weekOffDays);
    if (days.lessThanOrEqualTo(0)) continue;
    const entry = byEmployee.get(r.employeeId) ?? { row: personCells(r.employee, p), days: new Prisma.Decimal(0), spans: [], requests: 0 };
    entry.days = entry.days.plus(days);
    entry.requests += 1;
    entry.spans.push(single ? fmtDay(oFrom) : `${fmtDay(oFrom)}–${fmtDay(oTo)}`);
    byEmployee.set(r.employeeId, entry);
  }
  const rows = [...byEmployee.values()]
    .map((x): Row & { lopDays: number } => ({ ...x.row, lopDays: x.days.toNumber(), requests: x.requests, dates: x.spans.join(", ") }))
    .sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode)));
  return {
    columns: [...PERSON_COLUMNS, { key: "lopDays", header: "LOP Days", type: "number" }, { key: "requests", header: "Requests", type: "number" }, { key: "dates", header: "Dates" }],
    rows,
    summary: [
      { label: "LOP days", value: rows.reduce((n, r) => n + r.lopDays, 0), type: "number" },
      { label: "Employees", value: rows.length, type: "number" },
    ],
    breakdowns: [countBy(rows, "department", "By department", "Employees")],
    notes: ["Approved unpaid leave only, counted day by day inside the range (holidays and week-offs excluded, half-days as half).", "Attendance-based LOP (e.g. the half-day minimum not met, spec §4.4) isn't included yet — it arrives with attendance in Phase 3."],
    warnings: [],
  };
};

export const REPORT_DEFINITIONS: Record<ReportKey, Definition> = {
  headcount,
  joiners,
  leavers,
  celebrations,
  "leave-balance": leaveBalance,
  "leave-liability": leaveLiability,
  lop,
  "late-coming": lateComing,
  "excess-hours": excessHours,
  "exception-summary": exceptionSummary,
  "attendance-muster": attendanceMuster,
};

export type { ReportSummaryItem };
