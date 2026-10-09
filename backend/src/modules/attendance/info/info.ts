import type { DailyAttendance } from "@prisma/client";
import { instantToLocalTime } from "@shared/attendance/attlog";
import { formatMusterInput, musterCode } from "@shared/attendance/muster";
import { businessToday } from "../../../lib/businessDate";
import { assignmentOn, assignmentsOn, deviceMappingPeriods, namesOn, placementsOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { computeAttendance, shiftDef } from "../compute";
import { addDays, dayStartMs, shiftTimeline } from "../engine/time";
import { employeesInRange } from "../jobs";
import { entryInput, entryKey, latestEntries } from "../manual/entries";
import { viewableEmployeeIds, type Viewer } from "../manual/scope";
import { requestEligibility } from "../regularization/service";

// Attendance Info and Who Is In? (Phase 2 P2-E, docs/plans/PHASE_2.md §8 and
// "P2-E build design"). The employee's own view, the admin's view of anyone
// in attendance.view scope (the same data), and the live "who has punched
// today" board.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const hhmm = (d: Date | null) => (d ? instantToLocalTime(d, "Asia/Kolkata").slice(11, 16) : null);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Exceptions worth a banner (late/early are recorded, but HR confirmed they carry no penalty). */
export const EXCEPTION_FLAGS = ["MISSING_PUNCH", "HALF_DAY_MIN_NOT_MET", "SHORTFALL", "NO_SHIFT", "CLOCK_FLAGGED"];

/** Throws 404 unless `viewer` may see this employee's attendance (attendance.view, in data scope). */
export async function assertCanView(viewer: Viewer, employeeId: string) {
  const viewable = await viewableEmployeeIds(viewer);
  const exists = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!exists || (viewable !== null && !viewable.has(employeeId))) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
}

/** Make sure every day that has happened has a record (e.g. today before the nightly). */
async function ensureComputed(employeeId: string, from: string, to: string) {
  const last = to < iso(businessToday()) ? to : iso(businessToday());
  if (from > last) return;
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { dateOfJoining: true, lastWorkingDate: true } });
  let expected = 0;
  for (let d = from; d <= last; d = addDays(d, 1)) if (iso(e.dateOfJoining) <= d && (!e.lastWorkingDate || iso(e.lastWorkingDate) >= d)) expected += 1;
  const have = await prisma.dailyAttendance.count({ where: { employeeId, date: { gte: day(from), lte: day(last) } } });
  if (have < expected) await computeAttendance([employeeId], from, last);
}

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lastDay = new Date(Date.UTC(y, m, 0));
  return { from: iso(first), to: iso(lastDay) };
}

export async function monthView(employeeId: string, month: string) {
  const { from, to } = monthBounds(month);
  await ensureComputed(employeeId, from, to);
  const [rows, entries, requests, names, emp] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { employeeId, date: { gte: day(from), lte: day(to) } }, orderBy: { date: "asc" } }),
    latestEntries([employeeId], from, to),
    prisma.regularizationRequest.findMany({ where: { employeeId, date: { gte: day(from), lte: day(to) } }, orderBy: { createdAt: "asc" } }),
    namesOn([employeeId], day(to < iso(businessToday()) ? to : iso(businessToday()))),
    prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { id: true, employeeCode: true, dateOfJoining: true } }),
  ]);
  const requestOn = new Map(requests.map((r) => [iso(r.date), r])); // ascending: the latest wins
  const days = rows.map((r) => {
    const date = iso(r.date);
    const entry = entries.get(entryKey(employeeId, date));
    const req = requestOn.get(date);
    return {
      date,
      status: r.status,
      code: musterCode(r.status),
      shiftCode: r.shiftCode,
      source: r.source,
      capture: r.capture,
      statusOnly: r.source === "MANUAL" && entry?.kind === "STATUS_ONLY",
      corrected: r.overrideKind === "MISSING_PUNCH_CORRECTION",
      missingPunch: r.exceptionFlags.includes("MISSING_PUNCH"),
      flags: r.exceptionFlags,
      lopDays: Number(r.lopDays),
      firstIn: hhmm(r.firstIn),
      lastOut: hhmm(r.lastOut),
      totalMinutes: r.totalMinutes,
      actualMinutes: r.actualMinutes,
      lateInMinutes: r.lateInMinutes,
      provisional: r.provisional,
      locked: r.isLocked,
      workedOnOffDay: r.workedOnOffDay,
      request: req ? { id: req.id, status: req.status, missing: req.missing, time: req.time } : null,
    };
  });
  const worked = rows.filter((r) => r.totalMinutes !== null && !r.provisional);
  const exceptionDays = days.filter((d) => d.flags.some((f) => EXCEPTION_FLAGS.includes(f)));
  const kinds: Record<string, number> = {};
  for (const d of exceptionDays) for (const f of d.flags) if (EXCEPTION_FLAGS.includes(f)) kinds[f] = (kinds[f] ?? 0) + 1;
  return {
    employee: { id: emp.id, employeeCode: emp.employeeCode, name: names.get(employeeId) ?? emp.employeeCode, dateOfJoining: iso(emp.dateOfJoining) },
    month,
    today: iso(businessToday()),
    days,
    stats: {
      avgWorkMinutes: avg(worked.map((r) => r.totalMinutes!)),
      avgActualMinutes: avg(worked.filter((r) => r.actualMinutes !== null).map((r) => r.actualMinutes!)),
      lateDays: rows.filter((r) => (r.lateInMinutes ?? 0) > 0).length,
      lopDays: Math.round(rows.reduce((n, r) => n + Number(r.lopDays), 0) * 100) / 100,
      exceptionDays: exceptionDays.length,
      exceptionKinds: kinds,
    },
  };
}

/** Names of users (who entered, who decided), as their employee names. */
async function userNames(userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map<string, string>();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, employeeId: true } });
  const names = await namesOn(users.map((u) => u.employeeId), businessToday());
  return new Map(users.map((u) => [u.id, names.get(u.employeeId) ?? "someone"]));
}

export async function dayDetail(employeeId: string, date: string, opts: { self: boolean }) {
  await ensureComputed(employeeId, date, date);
  const row: DailyAttendance | null = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId, date: day(date) } } });
  if (!row) return { date, employed: false as const };
  const assignment = await assignmentOn(employeeId, day(date));
  const def = assignment ? shiftDef(assignment) : null;
  const tl = def ? shiftTimeline(def) : null;
  const base = dayStartMs(date);
  const windowFrom = new Date(base + (tl ? tl.windowStart : 0) * 1000);
  const windowTo = new Date(base + (tl ? tl.windowEnd : 86_400) * 1000);
  const computed = (row.computedFrom ?? {}) as { punchIds?: string[]; manualEntryId?: string | null; correctionId?: string | null; collapsedPunches?: number };
  const used = computed.punchIds ?? [];

  const [punches, entries, requests, mapped] = await Promise.all([
    prisma.rawPunch.findMany({
      where: { employeeId, punchedAt: { gte: windowFrom, lt: windowTo } },
      orderBy: { punchedAt: "asc" },
      select: { id: true, punchedAt: true, route: true, flag: true, flagResolution: { select: { decision: true } }, device: { select: { name: true } } },
    }),
    latestEntries([employeeId], date, date),
    prisma.regularizationRequest.findMany({ where: { employeeId, date: day(date) }, orderBy: { createdAt: "desc" } }),
    deviceMappingPeriods([employeeId], day(date), day(date)),
  ]);
  const entry = entries.get(entryKey(employeeId, date));
  const names = await userNames([entry?.enteredByUserId, ...requests.map((r) => r.decidedByUserId)]);
  return {
    date,
    employed: true as const,
    status: row.status,
    code: musterCode(row.status),
    firstHalfStatus: row.firstHalfStatus,
    secondHalfStatus: row.secondHalfStatus,
    source: row.source,
    capture: row.capture,
    deviceUser: (mapped.get(employeeId)?.length ?? 0) > 0,
    lopDays: Number(row.lopDays),
    flags: row.exceptionFlags,
    provisional: row.provisional,
    locked: row.isLocked,
    holidayName: row.holidayName,
    leaveTypeCode: row.leaveTypeCode,
    workedOnOffDay: row.workedOnOffDay,
    processedAt: row.processedAt.toISOString(),
    shift: def ? { code: def.code, name: def.name, startTime: def.startTime, endTime: def.endTime, sessions: def.sessions } : null,
    policy: assignment ? { code: assignment.policy.code, name: assignment.policy.name } : null,
    times: {
      firstIn: hhmm(row.firstIn),
      lastOut: hhmm(row.lastOut),
      lateInMinutes: row.lateInMinutes,
      earlyOutMinutes: row.earlyOutMinutes,
      totalMinutes: row.totalMinutes,
      breakMinutes: row.breakMinutes,
      actualMinutes: row.actualMinutes,
      inShiftMinutes: row.inShiftMinutes,
      shortfallMinutes: row.shortfallMinutes,
      excessMinutes: row.excessMinutes,
    },
    manualEntry:
      entry && entry.kind !== "CLEARED" && row.source === "MANUAL"
        ? { kind: entry.kind, text: formatMusterInput(entryInput(entry)), via: entry.via, remark: entry.remark, enteredBy: names.get(entry.enteredByUserId) ?? null, enteredAt: entry.enteredAt.toISOString() }
        : null,
    punches: punches.map((p) => ({
      id: p.id,
      time: instantToLocalTime(p.punchedAt, "Asia/Kolkata").slice(11, 19),
      date: instantToLocalTime(p.punchedAt, "Asia/Kolkata").slice(0, 10),
      device: p.device.name,
      route: p.route,
      // How the engine used it: first / last / in between / the only one; or why not.
      role:
        used[0] === p.id && used.length > 1
          ? "FIRST_IN"
          : used.at(-1) === p.id && used.length > 1
            ? "LAST_OUT"
            : used.includes(p.id)
              ? used.length === 1
                ? "ONLY"
                : "BETWEEN"
              : p.flag && !p.flagResolution
                ? "FLAGGED"
                : p.flagResolution?.decision === "DISCARDED"
                  ? "DISCARDED"
                  : (computed.collapsedPunches ?? 0) > 0
                    ? "DUPLICATE"
                    : "NOT_USED",
    })),
    correction:
      row.overrideKind === "MISSING_PUNCH_CORRECTION"
        ? (() => {
            const r = requests.find((x) => x.id === row.overrideRef);
            return r ? { id: r.id, missing: r.missing, time: r.time, decidedBy: names.get(r.decidedByUserId ?? "") ?? null, decidedAt: r.decidedAt?.toISOString() ?? null } : null;
          })()
        : null,
    requests: requests.map((r) => ({
      id: r.id,
      status: r.status,
      missing: r.missing,
      time: r.time,
      reason: r.reason,
      decisionNote: r.decisionNote,
      decidedBy: names.get(r.decidedByUserId ?? "") ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    // Only on the employee's own view: can they raise a forgot-to-punch request for this day?
    canRequest: opts.self ? await requestEligibility(employeeId, date) : null,
  };
}

// ── Who Is In? ────────────────────────────────────────────────────────────

function lateFromFirstPunch(r: DailyAttendance, graceMinutes: number): number | null {
  if (!r.firstIn || !r.shiftStart) return null;
  const [h, m] = r.shiftStart.split(":").map(Number) as [number, number];
  const due = dayStartMs(iso(r.date)) + (h * 60 + m + graceMinutes) * 60_000;
  const late = Math.ceil((r.firstIn.getTime() - due) / 60_000);
  return late > 0 ? late : 0;
}

export async function whoIsIn(viewer: Viewer, q: { locationId?: string; departmentId?: string }) {
  const today = iso(businessToday());
  const viewable = await viewableEmployeeIds(viewer);
  let ids = await employeesInRange(today, today);
  if (viewable !== null) ids = ids.filter((id) => viewable.has(id));
  const placements = await placementsOn(ids, businessToday());
  const locations = new Map<string, string>();
  const departments = new Map<string, string>();
  for (const p of placements.values()) {
    locations.set(p.locationId, p.location);
    departments.set(p.departmentId, p.department);
  }
  ids = ids.filter((id) => (!q.locationId || placements.get(id)?.locationId === q.locationId) && (!q.departmentId || placements.get(id)?.departmentId === q.departmentId));
  const have = new Set((await prisma.dailyAttendance.findMany({ where: { employeeId: { in: ids }, date: day(today) }, select: { employeeId: true } })).map((r) => r.employeeId));
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length) await computeAttendance(missing, today, today);
  const [rows, entries, names, codes] = await Promise.all([
    prisma.dailyAttendance.findMany({ where: { employeeId: { in: ids }, date: day(today) } }),
    latestEntries(ids, today, today),
    namesOn(ids, businessToday()),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } }),
  ]);
  const codeOf = new Map(codes.map((c) => [c.id, c.employeeCode]));
  // Lateness from the first punch against the shift start + grace: a lone punch
  // whose window has closed carries no figure on the day, but it's still "arrived at".
  const graceOf = new Map([...(await assignmentsOn(ids, businessToday()))].map(([id, a]) => [id, a.shift.graceInMinutes]));
  const person = (r: DailyAttendance) => ({
    employeeId: r.employeeId,
    employeeCode: codeOf.get(r.employeeId) ?? "",
    name: names.get(r.employeeId) ?? codeOf.get(r.employeeId) ?? "",
    branch: placements.get(r.employeeId)?.location ?? null,
    department: placements.get(r.employeeId)?.department ?? null,
  });
  const arrived = [];
  const notArrived = [];
  const away = [];
  const manual = [];
  for (const r of rows) {
    const p = person(r);
    if (r.source === "LEAVE" || r.status === "H" || r.status === "O") {
      away.push({ ...p, why: r.status === "H" ? `Holiday${r.holidayName ? `: ${r.holidayName}` : ""}` : r.status === "O" ? "Week-off" : `On leave (${r.leaveTypeCode ?? r.status})`, workedToday: r.workedOnOffDay });
    } else if (r.capture === "MANUAL") {
      const e = entries.get(entryKey(r.employeeId, today));
      const state = r.status.includes("NM") ? "NOT_MARKED" : e?.kind === "STATUS_ONLY" ? "STATUS_ONLY" : "TIMED";
      manual.push({ ...p, state, time: hhmm(r.firstIn), status: r.status });
    } else if (r.firstIn) {
      arrived.push({ ...p, time: hhmm(r.firstIn), lateInMinutes: r.lateInMinutes ?? lateFromFirstPunch(r, graceOf.get(r.employeeId) ?? 0), halfDayLeave: r.leaveTypeCode });
    } else {
      notArrived.push({ ...p, shiftStart: r.shiftStart });
    }
  }
  const byTime = (a: { time: string | null }, b: { time: string | null }) => (a.time ?? "").localeCompare(b.time ?? "");
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    date: today,
    asOf: new Date().toISOString(),
    filters: { locations: [...locations].map(([id, name]) => ({ id, name })).sort(byName), departments: [...departments].map(([id, name]) => ({ id, name })).sort(byName) },
    counts: { total: rows.length, arrived: arrived.length, notArrived: notArrived.length, away: away.length, manual: manual.length, late: arrived.filter((a) => (a.lateInMinutes ?? 0) > 0).length },
    arrived: arrived.sort(byTime),
    notArrived: notArrived.sort(byName),
    away: away.sort(byName),
    manual: manual.sort(byName),
  };
}
