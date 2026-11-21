import { behaviourValue } from "../behaviours/service";
import { isDirector, requireDirector } from "../../lib/directorAuthority";
import { notifyDirectors } from "../../lib/notifyDirectors";
import { z } from "zod";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { inForceOn, namesOn } from "../../lib/effectiveDating";
import { activeUsersHoldingPermission, resolveAccess } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { computeAttendance } from "../attendance/compute";
import { finalisedPeriodsOverlapping } from "../attendance/lockedPeriods";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { allowancesLeft, arrivalMinute, bandLabel, evaluateMonth, hhmmOf, type ArrivalResult, type Consequence, type LateRule } from "./evaluate";
import { settingsForMonth } from "./settings";

// Lateness views and waivers (docs/plans/LATE_CHECKLIST.md §5–6). Every view is worked out from the stored attendance days with the same pure functions the
// attendance hook used, so a screen never disagrees with loss of pay. Rupee amounts appear only on a person's own view and on the directors' screens.

export const HR_DECIDER_PERMISSION = "attendance.override.manage";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const monthParam = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }).strict();
const thisMonth = () => iso(businessToday()).slice(0, 7);
export const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return iso(new Date(Date.UTC(y, m, 0)));
};

export interface Actor {
  userId: string;
  employeeId: string;
  ip?: string | null;
}

export interface ArrivalView {
  date: string;
  time: string;
  band: 1 | 2 | 3;
  bandLabel: string;
  consequence: Consequence;
  /** In words, for the person. */
  says: string;
  /** The day's loss of pay as it stands (attendance), for context. */
  dayLop: string;
  waiver: { id: string; status: string; reason: string; decisionNote: string | null } | null;
}
export interface PersonMonth {
  employeeId: string;
  employeeCode: string;
  name: string;
  arrivals: ArrivalView[];
  allowances: Array<{ band: 1 | 2 | 3; bandLabel: string; free: number; used: number; left: number }>;
}

function says(c: Consequence, amounts: boolean): string {
  switch (c.kind) {
    case "WAIVED":
      return "Waived: no consequence, and no allowance used";
    case "FREE":
      return `Late mark (allowance ${c.allowanceNo} of ${c.of} this month)`;
    case "NOT_SET":
      return "Late mark only: the owners have not decided this band yet (no consequence)";
    case "NONE":
      return "No consequence";
    case "MARK":
      return "Late mark only";
    case "CUT":
      return `Salary cut of ${c.days} day through loss of pay (if the day already loses more for short hours, only that applies)`;
    case "PENALTY":
      return amounts ? `Penalty of ₹${c.amount}, its own payslip deduction (if the day already loses more for short hours, only that applies)` : "Penalty, its own payslip deduction";
  }
}

const stripAmount = (c: Consequence): Consequence => (c.kind === "PENALTY" ? { kind: "PENALTY", amount: "" } : c);

/** Each person's late arrivals in the month under the rule in force, with their waivers. */
export async function monthOf(employeeIds: string[], month: string, opts: { amountsFor: ReadonlySet<string> }): Promise<{ rule: LateRule | null; people: PersonMonth[] }> {
  const s = await settingsForMonth(month);
  const rule = s.rule;
  if (!rule || employeeIds.length === 0) return { rule, people: [] };
  const [rows, waivers, employees, names] = await Promise.all([
    prisma.dailyAttendance.findMany({
      where: { employeeId: { in: employeeIds }, date: { gte: day(`${month}-01`), lte: day(monthEnd(month)) } },
      select: { employeeId: true, date: true, firstIn: true, lastOut: true, provisional: true, status: true, firstHalfStatus: true, source: true, shiftStart: true, lopDays: true },
      orderBy: { date: "asc" },
    }),
    prisma.lateWaiver.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: day(`${month}-01`), lte: day(monthEnd(month)) }, status: { not: "WITHDRAWN" } }, orderBy: { createdAt: "asc" } }),
    prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, employeeCode: true } }),
    namesOn(employeeIds, businessToday()),
  ]);
  const people: PersonMonth[] = [];
  for (const e of employees.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))) {
    const mine = rows.filter((r) => r.employeeId === e.id);
    const arrivals = mine
      .map((r) => ({ date: iso(r.date), minute: arrivalMinute(rule, { firstIn: r.firstIn?.getTime() ?? null, inKnown: r.lastOut !== null || r.provisional, status: r.status, firstHalfStatus: r.firstHalfStatus, source: r.source, shiftStart: r.shiftStart }) }))
      .filter((a): a is { date: string; minute: number } => a.minute !== null);
    const myWaivers = waivers.filter((w) => w.employeeId === e.id);
    const approved = new Set(myWaivers.filter((w) => w.status === "APPROVED").map((w) => iso(w.date)));
    const results = evaluateMonth(rule, arrivals, approved);
    const amounts = opts.amountsFor.has(e.id);
    people.push({
      employeeId: e.id,
      employeeCode: e.employeeCode,
      name: names.get(e.id) ?? e.employeeCode,
      arrivals: results.map((a: ArrivalResult) => {
        const w = myWaivers.filter((x) => iso(x.date) === a.date).at(-1) ?? null;
        return {
          date: a.date,
          time: hhmmOf(a.minute),
          band: a.band,
          bandLabel: bandLabel(rule, a.band),
          consequence: amounts ? a.consequence : stripAmount(a.consequence),
          says: says(a.consequence, amounts),
          dayLop: mine.find((r) => iso(r.date) === a.date)!.lopDays.toString(),
          waiver: w ? { id: w.id, status: w.status, reason: w.reason, decisionNote: w.decisionNote } : null,
        };
      }),
      allowances: allowancesLeft(rule, results)
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .map((x) => ({ ...x, bandLabel: bandLabel(rule, x.band) })),
    });
  }
  return { rule, people };
}

/** What a person (or their manager) is shown of the rule: cutoffs, bands and outcomes; a penalty's amount only with `amounts`. */
function ruleSummary(rule: LateRule | null, amounts: boolean) {
  if (!rule) return null;
  return {
    effectiveFrom: rule.effectiveFrom,
    cutoffs: rule.cutoffs,
    bands: rule.bands.map((b, i) => ({ band: i + 1, label: bandLabel(rule, (i + 1) as 1 | 2 | 3), outcome: b.outcome.kind === "PENALTY" && !amounts ? { kind: "PENALTY", amount: "" } : b.outcome, applies: b.applies })),
  };
}

export async function mine(actor: Actor, month = thisMonth()) {
  const { rule, people } = await monthOf([actor.employeeId], month, { amountsFor: new Set([actor.employeeId]) });
  return { month, active: rule !== null, rule: ruleSummary(rule, true), me: people[0] ?? null };
}

/** The manager's current direct reports (their reporting manager today). */
export async function teamOf(managerEmployeeId: string): Promise<string[]> {
  const rows = await prisma.employeeJobHistory.findMany({ where: { reportingManagerId: managerEmployeeId, ...inForceOn() }, select: { employeeId: true } });
  return [...new Set(rows.map((r) => r.employeeId))].filter((id) => id !== managerEmployeeId);
}

export async function team(actor: Actor, month = thisMonth()) {
  const ids = await teamOf(actor.employeeId);
  const { rule, people } = await monthOf(ids, month, { amountsFor: new Set() });
  const finalised = await finalisedPeriodsOverlapping(`${month}-01`, monthEnd(month));
  return { month, active: rule !== null, isManager: ids.length > 0, rule: ruleSummary(rule, false), finalised: finalised.length > 0, people };
}

// ── Waivers ──

export const waiverBody = z.object({ employeeId: z.string().min(1).max(64), date: z.iso.date(), reason: z.string().trim().min(3).max(300) }).strict();
export const rejectBody = z.object({ note: z.string().trim().min(3).max(300) }).strict();
export const listQuery = z.object({ status: z.enum(["PENDING", "HR_APPROVED", "APPROVED", "REJECTED"]).default("PENDING") }).strict(); // FIX-M8: HR_APPROVED waits for a director

async function refuseFinalisedDay(date: string): Promise<void> {
  if ((await finalisedPeriodsOverlapping(date, date)).length) throw new HttpError(409, "That day is in a finalised attendance period; a waiver cannot change it. Use the correction path for a finalised month.", "MONTH_FINALISED");
}

export async function requestWaiver(actor: Actor, input: z.infer<typeof waiverBody>) {
  if (input.employeeId === actor.employeeId) throw new HttpError(403, "You cannot ask for a waiver of your own late arrival; your manager can.", "OWN_ARRIVAL");
  const reports = await teamOf(actor.employeeId);
  if (!reports.includes(input.employeeId)) throw new HttpError(403, "Only the person's reporting manager can ask for a waiver.", "NOT_YOUR_TEAM");
  await refuseFinalisedDay(input.date);
  const { rule, people } = await monthOf([input.employeeId], input.date.slice(0, 7), { amountsFor: new Set() });
  if (!rule) throw new HttpError(409, "The lateness rule is not in use for that month.", "LATENESS_OFF");
  const arrival = people[0]?.arrivals.find((a) => a.date === input.date);
  if (!arrival) throw new HttpError(409, "That day is not a late arrival.", "NOT_LATE");
  const open = await prisma.lateWaiver.findFirst({ where: { employeeId: input.employeeId, date: day(input.date), status: { in: ["PENDING", "HR_APPROVED", "APPROVED"] } }, select: { id: true } });
  if (open) throw new HttpError(409, "A waiver for that day is already waiting or approved.", "ALREADY_ASKED");
  const row = await prisma.lateWaiver.create({ data: { employeeId: input.employeeId, date: day(input.date), reason: input.reason, requestedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "attendance.lateness.waiver.requested", entityType: "LateWaiver", entityId: row.id, after: { employeeId: input.employeeId, date: input.date } });
  for (const u of await activeUsersHoldingPermission(HR_DECIDER_PERMISSION)) {
    if (u.userId === actor.userId || u.employeeId === input.employeeId) continue;
    await notifyEmployee(u.employeeId, { type: "lateness.waiver.requested", title: "A lateness waiver waits for a decision", body: `A manager asked to waive a late arrival on ${input.date}.`, link: "/admin/workforce/attendance/lateness-waivers" });
  }
  return { id: row.id };
}

export async function withdrawWaiver(actor: Actor, id: string) {
  const w = await prisma.lateWaiver.findUnique({ where: { id } });
  if (!w || w.requestedByUserId !== actor.userId) throw new HttpError(404, "There is no such waiver request of yours.", "NOT_FOUND");
  if (w.status !== "PENDING") throw new HttpError(409, "Only a waiting request can be withdrawn.", "ALREADY_DECIDED");
  await prisma.lateWaiver.update({ where: { id }, data: { status: "WITHDRAWN" } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "attendance.lateness.waiver.withdrawn", entityType: "LateWaiver", entityId: id });
  return { id };
}

async function requireHrDecider(userId: string): Promise<void> {
  const access = await resolveAccess(userId);
  if (!access.permissions.has(HR_DECIDER_PERMISSION)) throw new HttpError(403, "Lateness waivers are decided by HR (Manual Override permission).", "FORBIDDEN");
}

export async function listWaivers(actor: Actor, status: "PENDING" | "HR_APPROVED" | "APPROVED" | "REJECTED") {
  await requireHrDecider(actor.userId);
  const rows = await prisma.lateWaiver.findMany({ where: { status }, orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" }, take: 200, include: { employee: { select: { employeeCode: true } } } });
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const names = await namesOn(ids, businessToday());
  const requesters = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.requestedByUserId) } }, select: { id: true, employeeId: true } });
  const reqNames = await namesOn(requesters.map((r) => r.employeeId), businessToday());
  // The arrival behind each request, without any amount: HR never sees pay figures.
  const byMonth = new Map<string, string[]>();
  for (const r of rows) byMonth.set(iso(r.date).slice(0, 7), [...(byMonth.get(iso(r.date).slice(0, 7)) ?? []), r.employeeId]);
  const arrivals = new Map<string, ArrivalView>();
  for (const [m, emps] of byMonth) for (const p of (await monthOf([...new Set(emps)], m, { amountsFor: new Set() })).people) for (const a of p.arrivals) arrivals.set(`${p.employeeId}|${a.date}`, a);
  return rows.map((r) => {
    const a = arrivals.get(`${r.employeeId}|${iso(r.date)}`);
    const requester = requesters.find((u) => u.id === r.requestedByUserId);
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      fullName: names.get(r.employeeId) ?? r.employee.employeeCode,
      date: iso(r.date),
      time: a?.time ?? null,
      bandLabel: a?.bandLabel ?? null,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decisionNote,
      requestedBy: requester ? (reqNames.get(requester.employeeId) ?? "A manager") : "A manager",
      mine: r.requestedByUserId === actor.userId || r.employeeId === actor.employeeId,
    };
  });
}

async function decide(actor: Actor, id: string, approve: boolean, note: string | null) {
  await requireHrDecider(actor.userId);
  const w = await prisma.lateWaiver.findUnique({ where: { id } });
  if (!w) throw new HttpError(404, "There is no such waiver request.", "NOT_FOUND");
  if (w.status !== "PENDING") throw new HttpError(409, "This request is already decided or withdrawn.", "ALREADY_DECIDED");
  if (w.requestedByUserId === actor.userId) throw new HttpError(403, "You asked for this waiver, so somebody else in HR decides it.", "CHECKER_IS_MAKER");
  if (w.employeeId === actor.employeeId) throw new HttpError(403, "This is your own late arrival, so somebody else in HR decides it.", "OWN_ARRIVAL");
  const date = iso(w.date);
  await refuseFinalisedDay(date);
  // FIX-M8 (independent audit 2026-11-20): a waiver cancels a pay cut. With "lateness waivers need a director's confirmation" on (the default), HR's approval
  // waits (HR_APPROVED) until a director who is not the HR approver, the requester or the person confirms it. A director deciding is a director's decision.
  if (approve && !(await isDirector(actor.userId)) && (await behaviourValue("lateness.waiverNeedsDirector")).value) {
    const held = await prisma.lateWaiver.updateMany({ where: { id, status: "PENDING" }, data: { status: "HR_APPROVED", hrApprovedByUserId: actor.userId, hrApprovedAt: new Date() } }); // allow-clock: an instant
    if (held.count !== 1) throw new HttpError(409, "This request was just decided by someone else.", "ALREADY_DECIDED");
    await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "attendance.lateness.waiver.hr_approved", entityType: "LateWaiver", entityId: id, before: { status: "PENDING" }, after: { status: "HR_APPROVED" } });
    await notifyDirectors({ type: "director.lateness_waiver_pending", title: "A lateness waiver waits for a director", body: `HR approved a waiver for ${date}. It takes effect when a director confirms it.`, link: "/admin/workforce/attendance/lateness-waivers" });
    return { id, status: "HR_APPROVED" as const };
  }
  const { count } = await prisma.lateWaiver.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "REJECTED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionNote: note } }); // allow-clock: an instant
  if (count !== 1) throw new HttpError(409, "This request was just decided by someone else.", "ALREADY_DECIDED");
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: approve ? "attendance.lateness.waiver.approved" : "attendance.lateness.waiver.rejected", entityType: "LateWaiver", entityId: id, before: { status: "PENDING" }, after: { status: approve ? "APPROVED" : "REJECTED", note } });
  // The rest of the month numbers again without this arrival (its consequence goes, its allowance comes back): worked out now, not at the next nightly run.
  if (approve) await computeAttendance([w.employeeId], date, monthEnd(date.slice(0, 7)));
  const requester = await prisma.user.findUnique({ where: { id: w.requestedByUserId }, select: { employeeId: true } });
  const title = approve ? `A late arrival on ${date} was waived` : `A waiver for ${date} was not approved`;
  for (const target of new Set([w.employeeId, requester?.employeeId].filter((x): x is string => !!x))) await notifyEmployee(target, { type: approve ? "lateness.waiver.approved" : "lateness.waiver.rejected", title, body: approve ? "No consequence for that arrival; any allowance it used is back." : (note ?? ""), link: "/app/attendance/lateness" });
  return { id, status: approve ? "APPROVED" : "REJECTED" };
}

export const approveWaiver = (actor: Actor, id: string) => decide(actor, id, true, null);

/** FIX-M8: a director confirms (or turns down) a waiver HR approved. Never the HR approver, the requester or the person whose arrival it is. */
export async function confirmWaiver(actor: Actor, id: string, approve: boolean, note: string | null) {
  await requireDirector(actor.userId, "confirm a lateness waiver");
  const w = await prisma.lateWaiver.findUnique({ where: { id } });
  if (!w) throw new HttpError(404, "There is no such waiver request.", "NOT_FOUND");
  if (w.status !== "HR_APPROVED") throw new HttpError(409, "This waiver is not waiting for a director.", "NOT_WAITING");
  if (w.hrApprovedByUserId === actor.userId || w.requestedByUserId === actor.userId) throw new HttpError(403, "You approved or asked for this waiver, so a different director confirms it.", "CHECKER_IS_MAKER");
  if (w.employeeId === actor.employeeId) throw new HttpError(403, "This is your own late arrival, so a different director confirms it.", "OWN_ARRIVAL");
  const date = iso(w.date);
  await refuseFinalisedDay(date);
  const { count } = await prisma.lateWaiver.updateMany({ where: { id, status: "HR_APPROVED" }, data: { status: approve ? "APPROVED" : "REJECTED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionNote: note } }); // allow-clock: an instant
  if (count !== 1) throw new HttpError(409, "This request was just decided by someone else.", "ALREADY_DECIDED");
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: approve ? "attendance.lateness.waiver.director_confirmed" : "attendance.lateness.waiver.director_rejected", entityType: "LateWaiver", entityId: id, before: { status: "HR_APPROVED" }, after: { status: approve ? "APPROVED" : "REJECTED", note } });
  if (approve) await computeAttendance([w.employeeId], date, monthEnd(date.slice(0, 7)));
  const requester = await prisma.user.findUnique({ where: { id: w.requestedByUserId }, select: { employeeId: true } });
  for (const target of new Set([w.employeeId, requester?.employeeId].filter((x): x is string => !!x))) await notifyEmployee(target, { type: approve ? "lateness.waiver.approved" : "lateness.waiver.rejected", title: approve ? `A late arrival on ${date} was waived` : `A waiver for ${date} was not approved`, body: approve ? "No consequence for that arrival; any allowance it used is back." : (note ?? ""), link: "/app/attendance/lateness" });
  return { id, status: approve ? ("APPROVED" as const) : ("REJECTED" as const) };
}
export const rejectWaiver = (actor: Actor, id: string, note: string) => decide(actor, id, false, note);
