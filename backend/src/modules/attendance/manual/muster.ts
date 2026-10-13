import type { DailyAttendance, ManualAttendanceEntry } from "@prisma/client";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { MUSTER_INPUT_HELP, MUSTER_LEGEND, formatMusterInput, musterCode, parseMusterCell, sameMusterInput, type MusterInput } from "@shared/attendance/muster";
import { cycleFor, loadCycleRules, recentCycles, type Cycle } from "../../../lib/attendanceCycle";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { assignmentsOn, deviceMappingPeriods, namesOn, placementPeriods } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { buildXlsx, type XlsxColumn } from "../../../lib/xlsx";
import { HttpError } from "../../../middleware/errorHandler";
import { computeAttendance } from "../compute";
import { addDays } from "../engine/time";
import { employeesInRange } from "../jobs";
import type { Meta } from "../processService";
import { appendEntries, entryInput, entryKey, latestEntries, type NewEntry } from "./entries";
import { hasAnyBranch, inBranches, markableBranches, viewableEmployeeIds, type Branches, type Viewer } from "./scope";

// The Attendance Muster (Phase 2 P2-D, docs/plans/PHASE_2.md §5.1, §5.3 and
// "P2-D build design"): employees × the days of a cycle, directly editable
// for manual-capture employees in the viewer's branches.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const hhmm = (d: Date | null) => (d ? instantToLocalTime(d, "Asia/Kolkata").slice(11, 16) : null);
const MAX_BATCH = 2000;
const MAX_BACK_DAYS = 400;

function deviceOn(periods: Array<{ from: Date; to: Date | null }> | undefined, date: string): boolean {
  // mapping periods are half-open [from, to)
  return (periods ?? []).some((p) => iso(p.from) <= date && (!p.to || iso(p.to) > date));
}
function locationOn(segs: Array<{ locationId: string; from: Date; to: Date }> | undefined, date: string): string | null {
  return segs?.find((s) => iso(s.from) <= date && iso(s.to) >= date)?.locationId ?? null;
}
function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const minDate = (a: string, b: string) => (a < b ? a : b);

export interface MusterCell {
  date: string;
  code: string | null; // what the cell shows; null = not employed that day / not yet happened
  status: string | null;
  source: string | null;
  capture: "DEVICE" | "MANUAL" | null;
  editable: boolean;
  offDayOnly: boolean; // a holiday or week-off: only W or times may be entered
  reason: string | null; // why it's read-only, for the tooltip
  firstIn: string | null;
  lastOut: string | null;
  actualMinutes: number | null;
  lateInMinutes: number | null;
  earlyOutMinutes: number | null;
  lopDays: number;
  flags: string[];
  statusOnly: boolean;
  missingPunch: boolean;
  corrected: boolean; // corrected by hand: a regularization or a manual override (Phase 3); overrideKind says which
  overrideKind: string | null; // REGULARIZATION | MANUAL_OVERRIDE
  workedOnOffDay: boolean;
  provisional: boolean;
  locked: boolean;
  entry: { kind: string; text: string; via: string; remark: string | null; enteredAt: string } | null;
}

export interface MusterTotals {
  paidDays: number;
  present: number;
  absent: number;
  halfDays: number;
  lop: number;
  leave: number;
  holidays: number;
  off: number;
  notMarked: number;
  missingPunch: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const OTHER = new Set(["P", "A", "H", "O", "NM", "NS", "HD"]);

/** Paid days = Σ (1 − LOP) over computed days, NM halves and NS days counting 0 until resolved. */
export function totalsFor(cells: MusterCell[]): MusterTotals {
  const t: MusterTotals = { paidDays: 0, present: 0, absent: 0, halfDays: 0, lop: 0, leave: 0, holidays: 0, off: 0, notMarked: 0, missingPunch: 0 };
  for (const c of cells) {
    if (!c.status) continue;
    const halves = c.status === "HD" ? ["P", "A"] : c.status.includes(":") ? c.status.split(":") : [c.status, c.status];
    const nmHalves = halves.filter((h) => h === "NM").length;
    if (c.status === "NS") {
      // unknown until a shift is assigned and the day reprocessed
    } else {
      t.paidDays += 1 - c.lopDays - nmHalves * 0.5;
    }
    t.lop += c.lopDays;
    for (const h of halves) {
      if (h === "P") t.present += 0.5;
      else if (h === "A") t.absent += 0.5;
      else if (h === "NM") t.notMarked += 0.5;
      else if (!OTHER.has(h)) t.leave += 0.5;
    }
    if (halves.includes("P") && halves.includes("A")) t.halfDays += 1;
    if (c.status === "H") t.holidays += 1;
    if (c.status === "O") t.off += 1;
    if (c.missingPunch) t.missingPunch += 1;
  }
  for (const k of Object.keys(t) as Array<keyof MusterTotals>) t[k] = round(t[k]);
  return t;
}

async function cycleFromStart(cycleStart: string | undefined): Promise<Cycle> {
  if (!cycleStart) return cycleFor(businessToday());
  const cycle = await cycleFor(day(cycleStart));
  if (iso(cycle.start) !== cycleStart) throw new HttpError(400, "That isn't the start of an attendance cycle.", "VALIDATION_ERROR");
  return cycle;
}

export async function musterCycles() {
  const today = businessToday();
  const view = (c: Cycle) => ({ start: iso(c.start), end: iso(c.end), label: c.label });
  return { current: view(await cycleFor(today)), cycles: recentCycles(await loadCycleRules(), today, 13).map(view) };
}

export interface MusterQuery {
  cycleStart?: string;
  locationId?: string;
  departmentId?: string;
  employeeId?: string;
}

interface Scoped {
  self: string; // the viewer's own employee id: nobody marks their own attendance
  cycle: Cycle;
  days: string[];
  lastDay: string; // the last day that has happened (or the cycle's end)
  today: string;
  branches: Branches;
  ids: string[];
  employees: Map<string, { id: string; employeeCode: string; dateOfJoining: Date; lastWorkingDate: Date | null }>;
  placements: Map<string, Array<{ locationId: string; departmentId: string; from: Date; to: Date }>>;
  mappings: Map<string, Array<{ from: Date; to: Date | null }>>;
  canMark: boolean;
}

/** Everyone this viewer may see in the cycle (before the filters), with what's needed to decide each cell. */
async function scope(viewer: Viewer, cycle: Cycle): Promise<Scoped> {
  const today = iso(businessToday());
  const start = iso(cycle.start);
  const end = iso(cycle.end);
  const [branches, viewable] = await Promise.all([markableBranches(viewer), viewableEmployeeIds(viewer)]);
  if (!hasAnyBranch(branches) && viewable !== null && viewable.size === 0) throw new HttpError(403, "You don't have access to the attendance muster.", "FORBIDDEN");
  const all = await employeesInRange(start, end);
  const [placements, mappings, rows] = await Promise.all([
    placementPeriods(all, cycle.start, cycle.end),
    deviceMappingPeriods(all, cycle.start, cycle.end),
    prisma.employee.findMany({ where: { id: { in: all } }, select: { id: true, employeeCode: true, dateOfJoining: true, lastWorkingDate: true }, orderBy: { employeeCode: "asc" } }),
  ]);
  const days = daysOf(start, end);
  const ids = rows
    .filter((e) => {
      if (viewable === null || viewable.has(e.id)) return true;
      // a marker sees the manual-capture people of their branches
      return days.some((d) => inBranches(branches, locationOn(placements.get(e.id), d)) && !deviceOn(mappings.get(e.id), d));
    })
    .map((e) => e.id);
  return {
    self: viewer.employeeId,
    cycle,
    days,
    lastDay: minDate(end, today),
    today,
    branches,
    ids,
    employees: new Map(rows.map((e) => [e.id, e])),
    placements,
    mappings,
    canMark: hasAnyBranch(branches),
  };
}

function employedOn(e: { dateOfJoining: Date; lastWorkingDate: Date | null }, date: string) {
  return iso(e.dateOfJoining) <= date && (!e.lastWorkingDate || iso(e.lastWorkingDate) >= date);
}

/** Why a day can't take a manual entry from this viewer, or null if it can (offDayOnly: W or times only). */
function editRule(s: Scoped, employeeId: string, date: string, row: DailyAttendance | undefined): { reason: string | null; offDayOnly: boolean } {
  const e = s.employees.get(employeeId)!;
  if (date > s.today) return { reason: "This day hasn't happened yet.", offDayOnly: false };
  if (!employedOn(e, date)) return { reason: "Not employed on this day.", offDayOnly: false };
  if (!inBranches(s.branches, locationOn(s.placements.get(employeeId), date))) return { reason: s.canMark ? "Not one of the branches you mark." : "View only.", offDayOnly: false };
  if (employeeId === s.self) return { reason: "Your own attendance is marked by someone else (HR or your branch's marker).", offDayOnly: false };
  if (deviceOn(s.mappings.get(employeeId), date)) return { reason: "A biometric-device day: corrections are a Manual Override (Phase 3).", offDayOnly: false };
  if (row?.isLocked) return { reason: "This period is finalised.", offDayOnly: false };
  if (row?.source === "LEAVE") return { reason: `On approved leave (${row.leaveTypeCode ?? row.status}).`, offDayOnly: false };
  return { reason: null, offDayOnly: row?.status === "H" || row?.status === "O" };
}

function cellFor(s: Scoped, employeeId: string, date: string, row: DailyAttendance | undefined, entry: ManualAttendanceEntry | undefined): MusterCell {
  const rule = editRule(s, employeeId, date, row);
  const e = s.employees.get(employeeId)!;
  const shown = row && employedOn(e, date) && date <= s.today;
  const currentEntry = entry && entry.kind !== "CLEARED" ? entry : undefined;
  const statusOnly = !!row && row.source === "MANUAL" && currentEntry?.kind === "STATUS_ONLY";
  return {
    date,
    code: shown ? musterCode(row.status) : null,
    status: shown ? row.status : null,
    source: shown ? row.source : null,
    capture: shown ? row.capture : null,
    editable: rule.reason === null,
    offDayOnly: rule.offDayOnly,
    reason: rule.reason,
    firstIn: shown ? hhmm(row.firstIn) : null,
    lastOut: shown ? hhmm(row.lastOut) : null,
    actualMinutes: shown ? row.actualMinutes : null,
    lateInMinutes: shown ? row.lateInMinutes : null,
    earlyOutMinutes: shown ? row.earlyOutMinutes : null,
    lopDays: shown ? Number(row.lopDays) : 0,
    flags: shown ? row.exceptionFlags : [],
    statusOnly: !!shown && statusOnly,
    missingPunch: !!shown && row.exceptionFlags.includes("MISSING_PUNCH"),
    corrected: !!shown && row.overrideKind !== null,
    overrideKind: shown ? row.overrideKind : null,
    workedOnOffDay: !!shown && row.workedOnOffDay,
    provisional: !!shown && row.provisional,
    locked: !!row?.isLocked,
    entry: currentEntry ? { kind: currentEntry.kind, text: formatMusterInput(entryInput(currentEntry)), via: currentEntry.via, remark: currentEntry.remark, enteredAt: currentEntry.enteredAt.toISOString() } : null,
  };
}

/** Compute any day that has happened but has no record yet (e.g. today before the nightly), so every cell is real. */
async function fillGaps(s: Scoped, ids: string[]) {
  if (ids.length === 0 || s.days[0]! > s.lastDay) return;
  const have = await prisma.dailyAttendance.groupBy({ by: ["employeeId"], where: { employeeId: { in: ids }, date: { gte: day(s.days[0]!), lte: day(s.lastDay) } }, _count: true });
  const count = new Map(have.map((h) => [h.employeeId, h._count]));
  const missing = ids.filter((id) => {
    const e = s.employees.get(id)!;
    const expected = s.days.filter((d) => d <= s.lastDay && employedOn(e, d)).length;
    return (count.get(id) ?? 0) < expected;
  });
  if (missing.length) await computeAttendance(missing, s.days[0]!, s.lastDay);
}

export async function getMuster(viewer: Viewer, q: MusterQuery) {
  const cycle = await cycleFromStart(q.cycleStart);
  const s = await scope(viewer, cycle);
  const ref = s.lastDay < s.days[0]! ? s.days[0]! : s.lastDay; // the day names and branches are shown as of
  const refLocation = (id: string) => locationOn(s.placements.get(id), ref) ?? s.placements.get(id)?.at(-1)?.locationId ?? null;

  const [locations, departments] = await Promise.all([
    prisma.location.findMany({ where: { id: { in: [...new Set(s.ids.flatMap((id) => (s.placements.get(id) ?? []).map((p) => p.locationId)))] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { id: { in: [...new Set(s.ids.flatMap((id) => (s.placements.get(id) ?? []).map((p) => p.departmentId)))] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const names = await namesOn(s.ids, day(ref));
  const everyone = s.ids.map((id) => ({ id, employeeCode: s.employees.get(id)!.employeeCode, name: names.get(id) ?? s.employees.get(id)!.employeeCode }));

  const ids = s.ids.filter(
    (id) =>
      (!q.employeeId || id === q.employeeId) &&
      (!q.locationId || (s.placements.get(id) ?? []).some((p) => p.locationId === q.locationId)) &&
      (!q.departmentId || (s.placements.get(id) ?? []).some((p) => p.departmentId === q.departmentId)),
  );
  await fillGaps(s, ids);
  const [rows, entries] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { employeeId: { in: ids }, date: { gte: cycle.start, lte: cycle.end } } }),
    latestEntries(ids, s.days[0]!, s.days.at(-1)!),
  ]);
  const rowBy = new Map(rows.map((r) => [entryKey(r.employeeId, iso(r.date)), r]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  const musterRows = ids.map((id) => {
    const cells = s.days.map((d) => cellFor(s, id, d, rowBy.get(entryKey(id, d)), entries.get(entryKey(id, d))));
    const e = s.employees.get(id)!;
    const loc = refLocation(id);
    return { employeeId: id, employeeCode: e.employeeCode, name: names.get(id) ?? e.employeeCode, branch: loc ? (locationName.get(loc) ?? null) : null, cells, totals: totalsFor(cells) };
  });
  return {
    cycle: { start: iso(cycle.start), end: iso(cycle.end), label: cycle.label },
    today: s.today,
    days: s.days.map((d) => ({ date: d, weekday: day(d).getUTCDay(), notMarked: musterRows.filter((r) => r.cells.find((c) => c.date === d)?.status?.includes("NM")).length })),
    canMark: s.canMark,
    filters: { locations, departments, employees: everyone },
    rows: musterRows,
    legend: MUSTER_LEGEND,
    inputHelp: MUSTER_INPUT_HELP,
  };
}

// ── Saving ────────────────────────────────────────────────────────────────

export interface CellEdit {
  employeeId: string;
  date: string;
  text: string;
  remark?: string | null;
}

type CellError = { employeeId: string; date: string; error: string };

/** Load the scope needed to judge edits on these employee-days, after bringing each day up to date. */
async function scopeForDays(viewer: Viewer, refs: Array<{ employeeId: string; date: string }>) {
  const today = iso(businessToday());
  const dates = refs.map((r) => r.date).sort();
  const from = dates[0]!;
  const to = dates.at(-1)!;
  const ids = [...new Set(refs.map((r) => r.employeeId))];
  const [branches, placements, mappings, employees] = await Promise.all([
    markableBranches(viewer),
    placementPeriods(ids, day(from), day(to)),
    deviceMappingPeriods(ids, day(from), day(to)),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true, dateOfJoining: true, lastWorkingDate: true } }),
  ]);
  // Never confirm that someone outside the viewer's branches exists (404 for the whole batch).
  for (const r of refs) {
    if (!employees.some((e) => e.id === r.employeeId) || !inBranches(branches, locationOn(placements.get(r.employeeId), r.date))) {
      throw new HttpError(404, "Employee not found.", "NOT_FOUND");
    }
  }
  const s: Scoped = {
    self: viewer.employeeId,
    cycle: { start: day(from), end: day(to), startDay: 1, label: "" },
    days: daysOf(from, to),
    lastDay: minDate(to, today),
    today,
    branches,
    ids,
    employees: new Map(employees.map((e) => [e.id, e])),
    placements,
    mappings,
    canMark: hasAnyBranch(branches),
  };
  if (from <= s.lastDay) await computeAttendance(ids, from, s.lastDay);
  const rows = await prisma.dailyAttendance.findMany({ where: { employeeId: { in: ids }, date: { gte: day(from), lte: day(to) } } });
  return { s, rowBy: new Map(rows.map((r) => [entryKey(r.employeeId, iso(r.date)), r])) };
}

/** Why this input doesn't fit the day (an off day takes only W or times; a half-leave day no half-day status), or null. */
export function inputProblem(input: MusterInput, day: { status: string | null; firstHalfStatus?: string | null; secondHalfStatus?: string | null } | undefined, offDayOnly: boolean): string | null {
  if (input.kind === "CLEARED") return null;
  if (offDayOnly && input.kind === "STATUS_ONLY" && input.status !== "WORKED") return `This is a ${day?.status === "H" ? "holiday" : "week-off"}: type W (worked) or the times worked, or - to clear.`;
  if (!offDayOnly && input.kind === "STATUS_ONLY" && input.status === "WORKED") return "W is for work on a holiday or week-off. Type P, or the times.";
  const halves = day?.firstHalfStatus !== undefined ? [day.firstHalfStatus, day.secondHalfStatus] : (day?.status ?? "").split(":");
  const halfLeave = halves.some((h) => h && !["P", "A", "NM", "NS", "HD", "H", "O"].includes(h));
  if (halfLeave && input.kind === "STATUS_ONLY" && (input.status === "HD_FIRST" || input.status === "HD_SECOND")) return "Half of this day is leave. Type P or A (or the times) for the other half.";
  return null;
}

/** One Save from the muster: every cell valid or nothing written. */
export async function saveEntries(viewer: Viewer, edits: CellEdit[], meta: Meta) {
  return applyEdits(viewer, edits, { via: "SCREEN" }, meta);
}

/**
 * Validate every edit (parse, branch, day rules), then append the ones that
 * change something and recompute those days. Any invalid cell: nothing is
 * written (400 MUSTER_INVALID, each cell's reason in details.cells).
 */
export async function applyEdits(viewer: Viewer, edits: CellEdit[], how: { via: "SCREEN" | "MUSTER_UPLOAD"; uploadId?: string }, meta: Meta) {
  if (edits.length === 0) throw new HttpError(400, "Nothing to save.", "VALIDATION_ERROR");
  if (edits.length > MAX_BATCH) throw new HttpError(400, `Save at most ${MAX_BATCH} cells at a time.`, "VALIDATION_ERROR");
  const keys = new Set<string>();
  for (const e of edits) {
    const k = entryKey(e.employeeId, e.date);
    if (keys.has(k)) throw new HttpError(400, "The same day appears twice in this save.", "VALIDATION_ERROR");
    keys.add(k);
  }
  const today = iso(businessToday());
  const earliest = addDays(today, -MAX_BACK_DAYS);
  const errors: CellError[] = [];
  const parsed = edits.map((e) => {
    const p = parseMusterCell(e.text);
    if (!p.ok) errors.push({ employeeId: e.employeeId, date: e.date, error: p.error });
    else if (!p.value) errors.push({ employeeId: e.employeeId, date: e.date, error: "Nothing entered. Type - to clear a day." });
    if (e.date > today) errors.push({ employeeId: e.employeeId, date: e.date, error: "This day hasn't happened yet." });
    else if (e.date < earliest) errors.push({ employeeId: e.employeeId, date: e.date, error: "That's too far back to mark here." });
    return { ...e, input: p.ok ? p.value : null };
  });
  const { s, rowBy } = await scopeForDays(viewer, edits);
  const current = await latestEntries(s.ids, s.days[0]!, s.days.at(-1)!);

  const toWrite: NewEntry[] = [];
  let unchanged = 0;
  for (const e of parsed) {
    if (!e.input || e.date > today || e.date < earliest) continue;
    const row = rowBy.get(entryKey(e.employeeId, e.date));
    const rule = editRule(s, e.employeeId, e.date, row);
    const problem = rule.reason ?? inputProblem(e.input, row, rule.offDayOnly);
    if (problem) {
      errors.push({ employeeId: e.employeeId, date: e.date, error: problem });
      continue;
    }
    const before = current.get(entryKey(e.employeeId, e.date));
    const beforeInput = before && before.kind !== "CLEARED" ? entryInput(before) : null;
    const next = e.input.kind === "CLEARED" ? null : e.input;
    if (sameMusterInput(beforeInput, next) && (how.via === "MUSTER_UPLOAD" || (e.remark?.trim() || null) === (before?.remark ?? null))) {
      unchanged += 1;
      continue;
    }
    toWrite.push({ employeeId: e.employeeId, date: e.date, input: e.input, remark: e.remark });
  }
  if (errors.length) {
    throw new HttpError(400, `${errors.length === 1 ? "1 cell" : `${errors.length} cells`} couldn't be saved, so nothing was saved. Fix the marked cells and save again.`, "MUSTER_INVALID", { cells: errors });
  }
  await prisma.$transaction((tx) => appendEntries(tx, toWrite, { via: how.via, enteredByUserId: viewer.userId, uploadId: how.uploadId ?? null }));
  await recomputeTouched(toWrite);
  if (toWrite.length) {
    await writeAuditLog({
      ...meta,
      action: "attendance.manual.entered",
      entityType: how.uploadId ? "ManualMusterUpload" : "ManualAttendanceEntry",
      entityId: how.uploadId ?? `${toWrite.length} entries`,
      after: { via: how.via, count: toWrite.length, entries: toWrite.slice(0, 200).map((e) => ({ employeeId: e.employeeId, date: e.date, entry: formatMusterInput(e.input) || "cleared", remark: e.remark ?? null })) },
    });
  }
  return { saved: toWrite.length, unchanged };
}

export async function recomputeTouched(items: Array<{ employeeId: string; date: string }>) {
  const byEmployee = new Map<string, string[]>();
  for (const i of items) byEmployee.set(i.employeeId, [...(byEmployee.get(i.employeeId) ?? []), i.date]);
  for (const [employeeId, dates] of byEmployee) {
    dates.sort();
    await computeAttendance([employeeId], dates[0]!, dates.at(-1)!);
  }
}

// ── Mark all present (plan §5.3) ─────────────────────────────────────────

export async function markAllPresent(viewer: Viewer, input: { date: string; locationId: string }, meta: Meta) {
  const today = iso(businessToday());
  if (input.date > today) throw new HttpError(400, "This day hasn't happened yet.", "VALIDATION_ERROR");
  if (input.date < addDays(today, -MAX_BACK_DAYS)) throw new HttpError(400, "That's too far back to mark here.", "VALIDATION_ERROR");
  const branches = await markableBranches(viewer);
  if (!inBranches(branches, input.locationId)) throw new HttpError(404, "Branch not found.", "NOT_FOUND");
  const all = await employeesInRange(input.date, input.date);
  const [placements, mappings] = await Promise.all([placementPeriods(all, day(input.date), day(input.date)), deviceMappingPeriods(all, day(input.date), day(input.date))]);
  // Nobody marks their own attendance (plan §5.1, the same rule as a single cell): the viewer is left out.
  const ids = all.filter((id) => id !== viewer.employeeId && locationOn(placements.get(id), input.date) === input.locationId && !deviceOn(mappings.get(id), input.date));
  if (ids.length === 0) return { marked: 0, skipped: 0 };
  await computeAttendance(ids, input.date, input.date);
  const [rows, assignments] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { employeeId: { in: ids }, date: day(input.date) } }),
    assignmentsOn(ids, day(input.date)),
  ]);
  const toWrite: NewEntry[] = [];
  for (const r of rows) {
    const shift = assignments.get(r.employeeId)?.shift;
    if (r.status !== "NM" || r.isLocked || !shift) continue; // only untouched working days; never overwrites
    toWrite.push({ employeeId: r.employeeId, date: input.date, input: { kind: "TIMED", inTime: shift.startTime, outTime: shift.endTime }, remark: "Marked all present" });
  }
  await prisma.$transaction((tx) => appendEntries(tx, toWrite, { via: "BULK", enteredByUserId: viewer.userId }));
  await recomputeTouched(toWrite);
  if (toWrite.length) {
    await writeAuditLog({ ...meta, action: "attendance.manual.markedAllPresent", entityType: "Location", entityId: input.locationId, after: { date: input.date, marked: toWrite.length, employeeIds: toWrite.map((e) => e.employeeId) } });
  }
  return { marked: toWrite.length, skipped: ids.length - toWrite.length };
}

// ── Export ────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function exportMuster(viewer: Viewer, q: MusterQuery) {
  const m = await getMuster(viewer, q);
  const dayCols: XlsxColumn[] = m.days.map((d) => ({ key: d.date, header: `${Number(d.date.slice(8))} ${WEEKDAYS[d.weekday]}`, width: 7 }));
  const totalCols: XlsxColumn[] = [
    { key: "paidDays", header: "Paid days", type: "number", width: 10 },
    { key: "present", header: "P", type: "number", width: 6 },
    { key: "absent", header: "A", type: "number", width: 6 },
    { key: "halfDays", header: "HD", type: "number", width: 6 },
    { key: "lop", header: "LOP", type: "number", width: 6 },
    { key: "leave", header: "Leave", type: "number", width: 7 },
    { key: "holidays", header: "H", type: "number", width: 6 },
    { key: "off", header: "OFF", type: "number", width: 6 },
    { key: "notMarked", header: "NM", type: "number", width: 6 },
    { key: "missingPunch", header: "Missing punch", type: "number", width: 9 },
  ];
  const rows = m.rows.map((r) => ({
    code: r.employeeCode,
    name: r.name,
    branch: r.branch ?? "",
    ...Object.fromEntries(r.cells.map((c) => [c.date, c.code ? `${c.code}${c.statusOnly ? "*" : ""}${c.missingPunch ? "!" : ""}${c.corrected ? "~" : ""}` : ""])),
    ...r.totals,
  }));
  const buffer = await buildXlsx([
    {
      name: `Muster ${m.cycle.label}`,
      columns: [{ key: "code", header: "Code", width: 8 }, { key: "name", header: "Name", width: 24 }, { key: "branch", header: "Branch", width: 18 }, ...dayCols, ...totalCols],
      rows,
      footer: [
        `Attendance muster, ${m.cycle.label} (${m.cycle.start} to ${m.cycle.end}). Exported ${m.today}.`,
        ...m.legend.map((l) => `${l.code}: ${l.label}`),
        "* status only, no times   ! one time only (missing punch)   ~ corrected: a forgot-to-punch request was approved",
        "Paid days = days in the cycle so far less LOP; NM and NS days count 0 until resolved.",
      ],
    },
  ]);
  return { buffer, fileName: `attendance-muster-${m.cycle.start}.xlsx` };
}
