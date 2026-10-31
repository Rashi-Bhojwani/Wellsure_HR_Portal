import { Prisma, type RemoteAttendanceRecord } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { activeDirectors, isDirector, requireDirector } from "../../../lib/directorAuthority";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { getSetting, setSetting } from "../../../lib/settings";
import { HttpError } from "../../../middleware/errorHandler";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { computeAttendance } from "../compute";
import { appendOverrides } from "../overrides";
import { DECIDED, dayStateOf, hoursText, minutesBetween, outcomeFor, reminderDue, remoteOn, timeOnly, whoMayDecide, type Decision } from "./rules";
import { payrollPlacementsOn } from "../../../lib/effectiveDating";

// Remote attendance (docs/plans/STAGE_5A_PLAN.md). A director marks who works remotely; a remote employee checks in and out (a time stamped by the server, nothing about where
// they are); the record goes to the directors, who alone approve a full day, approve a half day, or reject it with a reason and an outcome. A director never decides their own
// record. The decision is written through the attendance engine's own override path, so the month view and payroll read it as they read any other day.

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const NOTE_MIN = 3;
const MAX_BULK = 200;
const PAGE_MAX = 100;

export const REMINDER_HOURS_KEY = "attendance.remote.reminderAfterHours";
export const SUGGESTED_OUTCOME_KEY = "attendance.remote.suggestedRejectOutcome";

export interface Actor {
  userId: string;
  ip?: string | null;
}

const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  return r.data;
};

async function employeeOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  if (!u) throw new HttpError(401, "Sign in again.", "UNAUTHENTICATED");
  return u.employeeId;
}
const ownerUserId = async (employeeId: string) => (await prisma.user.findUnique({ where: { employeeId }, select: { id: true } }))?.id ?? null;

async function event(recordId: string, type: string, actorUserId: string | null, note = "", payload: object = {}, db: Prisma.TransactionClient | typeof prisma = prisma) {
  await db.remoteAttendanceEvent.create({ data: { recordId, type, actorUserId, note, payload: payload as Prisma.InputJsonValue } });
}

// ── Who is remote ──

export const markSchema = z
  .object({
    employeeId: z.string().min(1).max(64),
    effectiveFrom: z.iso.date(),
    remote: z.boolean(),
    reason: z.string().trim().min(NOTE_MIN, "Say why").max(200),
  })
  .strict();

export async function isRemoteOn(employeeId: string, date: string): Promise<boolean> {
  const marks = await prisma.remoteWorkMark.findMany({ where: { employeeId }, select: { effectiveFrom: true, createdAt: true, remote: true } });
  return remoteOn(marks.map((m) => ({ effectiveFrom: iso(m.effectiveFrom), createdAt: m.createdAt.toISOString(), remote: m.remote })), date);
}

export async function markRemote(raw: unknown, actor: Actor): Promise<{ id: string }> {
  const input = parse(markSchema, raw);
  await requireDirector(actor.userId, "mark who works remotely");
  if (!(await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } }))) throw new HttpError(404, "That employee was not found.", "NOT_FOUND");
  const mark = await prisma.remoteWorkMark.create({ data: { employeeId: input.employeeId, effectiveFrom: day(input.effectiveFrom), remote: input.remote, reason: input.reason, markedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, action: input.remote ? "attendance.remote.marked" : "attendance.remote.unmarked", entityType: "RemoteWorkMark", entityId: mark.id, after: { employeeId: input.employeeId, effectiveFrom: input.effectiveFrom, remote: input.remote }, ipAddress: actor.ip ?? null });
  await notifyEmployee(input.employeeId, {
    type: "attendance.remote.marked",
    title: input.remote ? "You can work remotely" : "Remote work has ended for you",
    body: input.remote ? `From ${input.effectiveFrom} you check in and check out in the app on the days you work remotely.` : `From ${input.effectiveFrom} you no longer check in and out remotely.`,
    link: "/app/attendance/info",
    payload: {},
  });
  return { id: mark.id };
}

export interface RemoteRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  remoteToday: boolean;
  since: string | null;
  lastReason: string | null;
}

/** Everyone who has ever been marked, with whether they are remote today. Directors only. */
export async function listRemote(): Promise<RemoteRow[]> {
  const marks = await prisma.remoteWorkMark.findMany({ orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
  const ids = [...new Set(marks.map((m) => m.employeeId))];
  const emps = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } });
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const today = iso(businessToday());
  const names = await namesOn(ids, businessToday());
  return ids.map((id) => {
    const mine = marks.filter((m) => m.employeeId === id);
    const asMarks = mine.map((m) => ({ effectiveFrom: iso(m.effectiveFrom), createdAt: m.createdAt.toISOString(), remote: m.remote }));
    const last = mine.filter((m) => iso(m.effectiveFrom) <= today).at(-1) ?? null;
    return { employeeId: id, employeeCode: code.get(id) ?? id, name: names.get(id) ?? code.get(id) ?? id, remoteToday: remoteOn(asMarks, today), since: last ? iso(last.effectiveFrom) : null, lastReason: last?.reason ?? null };
  });
}

// ── The employee's day ──

export interface RecordView {
  id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: RemoteAttendanceRecord["status"];
  half: string | null;
  decidedAt: string | null;
  /** What the person was told when a day was rejected: the director's reason. Shown to the owner and to directors only. */
  decisionReason: string | null;
  rejectOutcome: string | null;
  reopenCount: number;
  openRequests: number;
  /** H:MM between the check-in and the check-out, when both exist. */
  hours: string | null;
  /** Whether a review has already been asked for this day (one is allowed). */
  reviewUsed: boolean;
}

const view = (r: RemoteAttendanceRecord & { requests?: Array<{ status: string; kind?: string }> }): RecordView => ({
  id: r.id,
  date: iso(r.date),
  checkIn: r.checkInAt ? timeOnly(r.checkInAt) : null,
  checkOut: r.checkOutAt ? timeOnly(r.checkOutAt) : null,
  status: r.status,
  half: r.half,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  decisionReason: r.decisionReason,
  rejectOutcome: r.rejectOutcome,
  reopenCount: r.reopenCount,
  openRequests: (r.requests ?? []).filter((q) => q.status === "OPEN").length,
  hours: hoursText(r.checkInAt, r.checkOutAt),
  reviewUsed: (r.requests ?? []).some((q) => q.kind === "REVIEW"),
});

export async function myToday(userId: string) {
  const employeeId = await employeeOf(userId);
  const today = iso(businessToday());
  const remote = await isRemoteOn(employeeId, today);
  const record = await prisma.remoteAttendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: day(today) } }, include: { requests: { select: { status: true, kind: true } } } });
  const state = dayStateOf(record ? { status: record.status, checkIn: !!record.checkInAt, checkOut: !!record.checkOutAt } : null);
  return { remote, today, serverTime: timeOnly(new Date()), state, record: record ? view(record) : null, canCheckIn: remote && !record?.checkInAt, canCheckOut: remote && !!record?.checkInAt && !record.checkOutAt }; // allow-clock: the server time the screen shows
}

async function directorsToTell(ownerEmployeeId: string): Promise<string[]> {
  return (await activeDirectors()).filter((d) => d.employeeId !== ownerEmployeeId).map((d) => d.employeeId);
}

/** Every director except the one who acted (and except the owner of the record, who is told separately) hears of a decision. No reason is in the message. */
async function tellOtherDirectors(actorUserId: string, ownerEmployeeId: string, title: string, body: string): Promise<void> {
  const me = await employeeOf(actorUserId);
  for (const d of await activeDirectors()) {
    if (d.employeeId === me || d.employeeId === ownerEmployeeId) continue;
    await notifyEmployee(d.employeeId, { type: "attendance.remote.director_told", title, body, link: "/admin/workforce/attendance/remote", payload: {} });
  }
}

export async function checkIn(userId: string): Promise<RecordView> {
  const employeeId = await employeeOf(userId);
  const today = iso(businessToday());
  if (!(await isRemoteOn(employeeId, today))) throw new HttpError(403, "You are not marked as working remotely today.", "NOT_REMOTE");
  const existing = await prisma.remoteAttendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: day(today) } } });
  if (existing?.checkInAt) throw new HttpError(409, "You have already checked in today.", "ALREADY_CHECKED_IN");
  const now = new Date(); // allow-clock: the instant the server stamps; nothing else is recorded
  // Two presses at once (a double tap, two devices) make one check-in: the loser of the race sees the same refusal as a second press.
  const already = new HttpError(409, "You have already checked in today.", "ALREADY_CHECKED_IN");
  let record: RemoteAttendanceRecord;
  try {
    if (existing) {
      const { count } = await prisma.remoteAttendanceRecord.updateMany({ where: { id: existing.id, checkInAt: null }, data: { checkInAt: now } });
      if (count !== 1) throw already;
      record = await prisma.remoteAttendanceRecord.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      record = await prisma.remoteAttendanceRecord.create({ data: { employeeId, date: day(today), checkInAt: now } });
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw already;
    throw err;
  }
  await event(record.id, "CHECK_IN", userId);
  return view(record);
}

export async function checkOut(userId: string): Promise<RecordView> {
  const employeeId = await employeeOf(userId);
  const today = iso(businessToday());
  if (!(await isRemoteOn(employeeId, today))) throw new HttpError(403, "You are not marked as working remotely today.", "NOT_REMOTE");
  const existing = await prisma.remoteAttendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: day(today) } } });
  if (!existing?.checkInAt) throw new HttpError(409, "Check in first.", "NOT_CHECKED_IN");
  if (existing.checkOutAt) throw new HttpError(409, "You have already checked out today.", "ALREADY_CHECKED_OUT");
  const now = new Date(); // allow-clock: the instant the server stamps
  const { count } = await prisma.remoteAttendanceRecord.updateMany({ where: { id: existing.id, checkOutAt: null }, data: { checkOutAt: now, status: "PENDING" } });
  if (count !== 1) throw new HttpError(409, "You have already checked out today.", "ALREADY_CHECKED_OUT");
  const record = await prisma.remoteAttendanceRecord.findUniqueOrThrow({ where: { id: existing.id } });
  await event(record.id, "CHECK_OUT", userId);
  for (const to of await directorsToTell(employeeId)) {
    await notifyEmployee(to, { type: "attendance.remote.pending", title: "Remote attendance to decide", body: "A remote day is waiting for your decision.", link: "/admin/workforce/attendance/remote", payload: {} });
  }
  return view(record);
}

export async function myRecords(userId: string, q: { from?: string; to?: string }): Promise<RecordView[]> {
  const employeeId = await employeeOf(userId);
  const rows = await prisma.remoteAttendanceRecord.findMany({
    where: { employeeId, ...(q.from || q.to ? { date: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}) },
    orderBy: { date: "desc" },
    take: PAGE_MAX,
    include: { requests: { select: { status: true, kind: true } } },
  });
  return rows.map(view);
}

// ── Directors: the queue, deciding, reopening ──

export const listSchema = z
  .object({
    status: z.enum(["OPEN", "PENDING", "APPROVED_FULL", "APPROVED_HALF", "REJECTED"]).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    employeeId: z.string().min(1).max(64).optional(),
    departmentId: z.string().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(PAGE_MAX).default(40),
  })
  .strict();

export interface DirectorRow extends RecordView {
  employeeId: string;
  employeeCode: string;
  name: string;
  /** True when the signed-in director owns it, so the other director decides. */
  yours: boolean;
  departmentName: string | null;
  /** What the person gave when a correction was accepted for this day. */
  correctionNote: string | null;
  decidedByName: string | null;
}

/** Who is in a department today, among the people who have remote records (read through the placement reader, never the history table). */
async function employeesInDepartment(departmentId: string, only?: string): Promise<string[]> {
  const people = (await prisma.remoteAttendanceRecord.findMany({ where: only ? { employeeId: only } : {}, select: { employeeId: true }, distinct: ["employeeId"] })).map((r) => r.employeeId);
  const placed = await payrollPlacementsOn(people, businessToday());
  return people.filter((id) => placed.get(id)?.departmentId === departmentId);
}

export async function listRecords(q: z.infer<typeof listSchema>, actor: Actor): Promise<{ rows: DirectorRow[]; total: number }> {
  await requireDirector(actor.userId, "see remote attendance");
  const where: Prisma.RemoteAttendanceRecordWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.departmentId ? { employeeId: { in: await employeesInDepartment(q.departmentId, q.employeeId) } } : q.employeeId ? { employeeId: q.employeeId } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.remoteAttendanceRecord.count({ where }),
    prisma.remoteAttendanceRecord.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { requests: { select: { status: true, kind: true } }, employee: { select: { employeeCode: true } } } }),
  ]);
  const ids = [...new Set(rows.map((r) => r.employeeId))];
  const names = await namesOn(ids, businessToday());
  const mine = await employeeOf(actor.userId);
  const placed = await payrollPlacementsOn(ids, businessToday());
  const deptNames = new Map((await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  const dept = new Map(ids.map((id) => [id, deptNames.get(placed.get(id)?.departmentId ?? "") ?? ""]));
  const corrections = await prisma.remoteAttendanceEvent.findMany({ where: { recordId: { in: rows.map((r) => r.id) }, type: "CORRECTED" }, orderBy: { createdAt: "asc" }, select: { recordId: true, note: true } });
  const note = new Map(corrections.map((c) => [c.recordId, c.note]));
  const deciders = await prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => (r.decidedByUserId ? [r.decidedByUserId] : [])) } }, select: { id: true, employeeId: true } });
  const decNames = await namesOn(deciders.map((u) => u.employeeId), businessToday());
  const decBy = new Map(deciders.map((u) => [u.id, decNames.get(u.employeeId) ?? "A director"]));
  return { total, rows: rows.map((r) => ({ ...view(r), employeeId: r.employeeId, employeeCode: r.employee.employeeCode, name: names.get(r.employeeId) ?? r.employee.employeeCode, yours: r.employeeId === mine, departmentName: dept.get(r.employeeId) || null, correctionNote: note.get(r.id) ?? null, decidedByName: r.decidedByUserId ? (decBy.get(r.decidedByUserId) ?? null) : null })) };
}

export const decisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FULL"), note: z.string().trim().max(200).optional() }).strict(),
  z.object({ kind: z.literal("HALF"), half: z.enum(["FIRST", "SECOND"]), reason: z.string().trim().min(NOTE_MIN, "Say why it is a half day").max(200) }).strict(),
  z.object({ kind: z.literal("REJECT"), reason: z.string().trim().min(NOTE_MIN, "Say why it is rejected").max(200), outcome: z.enum(["ABSENT", "LOSS_OF_PAY"]) }).strict(),
]);

async function assertMayDecide(record: RemoteAttendanceRecord, actor: Actor): Promise<void> {
  const who = whoMayDecide({ actorUserId: actor.userId, ownerUserId: await ownerUserId(record.employeeId), actorIsDirector: await isDirector(actor.userId) });
  if (!who.ok) throw new HttpError(403, who.message, who.code);
}

async function assertDayNotFinal(record: RemoteAttendanceRecord): Promise<void> {
  const row = await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: record.employeeId, date: record.date } }, select: { isLocked: true } });
  if (row?.isLocked) throw new HttpError(409, "This day's attendance is finalised, so it cannot be changed here. Unlock the attendance period first.", "LOCKED");
}

/** Writes the decision through the engine's override path and recomputes the day. */
async function apply(record: RemoteAttendanceRecord, d: Decision, actor: Actor, type: string) {
  await assertMayDecide(record, actor);
  if (record.status !== "PENDING") throw new HttpError(409, "This record is not waiting for a decision.", "NOT_PENDING");
  await assertDayNotFinal(record);
  const out = outcomeFor(d);
  const status = d.kind === "FULL" ? "APPROVED_FULL" : d.kind === "HALF" ? "APPROVED_HALF" : "REJECTED";
  const reasonOf = d.kind === "FULL" ? (d.note?.trim() || null) : d.reason;
  const version = { status, half: d.kind === "HALF" ? d.half : null, outcome: d.kind === "REJECT" ? d.outcome : null, reason: reasonOf, checkIn: record.checkInAt ? timeOnly(record.checkInAt) : null, checkOut: record.checkOutAt ? timeOnly(record.checkOutAt) : null };
  const updated = await prisma.$transaction(async (tx) => {
    const [o] = await appendOverrides(tx, [{ employeeId: record.employeeId, date: iso(record.date), origin: "MANUAL_OVERRIDE", kind: "STATUS", status: out.status, reasonCode: "OTHER", reason: out.label, createdByUserId: actor.userId }]);
    const { count } = await tx.remoteAttendanceRecord.updateMany({ where: { id: record.id, status: "PENDING" }, data: { status, half: version.half, rejectOutcome: version.outcome, decisionReason: reasonOf, decidedByUserId: actor.userId, decidedAt: new Date(), overrideId: o!.id } }); // allow-clock: an instant
    if (count !== 1) throw new HttpError(409, "Somebody else decided this a moment ago.", "NOT_PENDING");
    await event(record.id, type, actor.userId, reasonOf ?? "", version, tx);
    // The audit row is the record of who decided what, when, and why. HR has no key to read the audit trail.
    await writeAuditLog({ actorUserId: actor.userId, action: "attendance.remote.decided", entityType: "RemoteAttendanceRecord", entityId: record.id, before: { status: "PENDING" }, after: { employeeId: record.employeeId, date: iso(record.date), ...version }, ipAddress: actor.ip ?? null });
    return tx.remoteAttendanceRecord.findUniqueOrThrow({ where: { id: record.id } });
  });
  await computeAttendance([record.employeeId], iso(record.date), iso(record.date));
  await notifyEmployee(record.employeeId, {
    type: "attendance.remote.decided",
    title: d.kind === "REJECT" ? "Your remote day was not approved" : "Your remote day was approved",
    body: d.kind === "REJECT" ? `${iso(record.date)}: ${d.reason}${d.outcome === "LOSS_OF_PAY" ? " (loss of pay)" : " (absent)"}` : d.kind === "HALF" ? `${iso(record.date)}: ${out.label}. ${d.reason}` : `${iso(record.date)}: ${out.label}.`,
    link: "/app/attendance/info",
    payload: {},
  });
  await tellOtherDirectors(actor.userId, record.employeeId, "A remote day was decided", `${out.label}.`);
  return updated;
}

export async function decide(recordId: string, raw: unknown, actor: Actor): Promise<RecordView> {
  const d = parse(decisionSchema, raw) as Decision;
  const record = await prisma.remoteAttendanceRecord.findUnique({ where: { id: recordId } });
  if (!record) throw new HttpError(404, "That record was not found.", "NOT_FOUND");
  return view(await apply(record, d, actor, "DECIDED"));
}

export const bulkApproveSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_BULK), note: z.string().trim().max(200).optional() }).strict();
export const bulkRejectSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_BULK), reason: z.string().trim().min(NOTE_MIN, "Say why they are rejected").max(200), outcome: z.enum(["ABSENT", "LOSS_OF_PAY"]) }).strict();

export interface BulkResult {
  done: number;
  skipped: Array<{ id: string; why: string }>;
}

async function bulk(ids: string[], d: Decision, actor: Actor): Promise<BulkResult> {
  await requireDirector(actor.userId, "decide remote attendance");
  const skipped: BulkResult["skipped"] = [];
  let done = 0;
  for (const id of [...new Set(ids)]) {
    try {
      const record = await prisma.remoteAttendanceRecord.findUnique({ where: { id } });
      if (!record) throw new HttpError(404, "Not found.", "NOT_FOUND");
      await apply(record, d, actor, "DECIDED");
      done += 1;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      skipped.push({ id, why: err.message });
    }
  }
  return { done, skipped };
}

/** Bulk approve is for a full day. A half day is decided one record at a time, because the director has to say which half. */
export async function bulkApprove(raw: unknown, actor: Actor): Promise<BulkResult> {
  const i = parse(bulkApproveSchema, raw);
  return bulk(i.ids, { kind: "FULL", ...(i.note ? { note: i.note } : {}) }, actor);
}
export async function bulkReject(raw: unknown, actor: Actor): Promise<BulkResult> {
  const i = parse(bulkRejectSchema, raw);
  return bulk(i.ids, { kind: "REJECT", reason: i.reason, outcome: i.outcome }, actor);
}

export const reopenSchema = z.object({ reason: z.string().trim().min(NOTE_MIN, "Say why").max(200) }).strict();

/** A decided record goes back to waiting; the day returns to what the engine works out (the override is cleared). */
export async function reopen(recordId: string, raw: unknown, actor: Actor): Promise<RecordView> {
  const { reason } = parse(reopenSchema, raw);
  const record = await prisma.remoteAttendanceRecord.findUnique({ where: { id: recordId } });
  if (!record) throw new HttpError(404, "That record was not found.", "NOT_FOUND");
  await assertMayDecide(record, actor);
  if (!(DECIDED as readonly string[]).includes(record.status)) throw new HttpError(409, "Only a decided record can be reopened.", "NOT_DECIDED");
  await assertDayNotFinal(record);
  const updated = await prisma.$transaction(async (tx) => {
    await appendOverrides(tx, [{ employeeId: record.employeeId, date: iso(record.date), origin: "MANUAL_OVERRIDE", kind: "CLEARED", reason: `Remote work reopened: ${reason}`, createdByUserId: actor.userId }]);
    const { count } = await tx.remoteAttendanceRecord.updateMany({ where: { id: record.id, status: record.status }, data: { status: "PENDING", half: null, rejectOutcome: null, decisionReason: null, decidedByUserId: null, decidedAt: null, overrideId: null, reopenCount: { increment: 1 } } });
    if (count !== 1) throw new HttpError(409, "Somebody else changed this a moment ago.", "CONFLICT");
    await event(record.id, "REOPENED", actor.userId, reason, { from: record.status }, tx);
    const before = { status: record.status, half: record.half, outcome: record.rejectOutcome, reason: record.decisionReason, decidedByUserId: record.decidedByUserId, decidedAt: record.decidedAt?.toISOString() ?? null };
    await event(record.id, "REOPENED_VERSION", actor.userId, reason, before, tx); // the version that was replaced, kept in the history
    await writeAuditLog({ actorUserId: actor.userId, action: "attendance.remote.reopened", entityType: "RemoteAttendanceRecord", entityId: record.id, before, after: { employeeId: record.employeeId, date: iso(record.date), status: "PENDING", reopenReason: reason }, ipAddress: actor.ip ?? null });
    return tx.remoteAttendanceRecord.findUniqueOrThrow({ where: { id: record.id } });
  });
  await computeAttendance([record.employeeId], iso(record.date), iso(record.date));
  await tellOtherDirectors(actor.userId, record.employeeId, "A remote decision was reopened", `${iso(record.date)}.`);
  await notifyEmployee(record.employeeId, { type: "attendance.remote.reopened", title: "Your remote day is being looked at again", body: `${iso(record.date)}: a director reopened it.`, link: "/app/attendance/info", payload: {} });
  return view(updated);
}

// ── Correction and review requests ──

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time is written HH:MM, for example 09:30");
export const requestSchema = z
  .object({
    kind: z.enum(["CORRECTION", "REVIEW"]),
    note: z.string().trim().min(NOTE_MIN, "Say what is wrong").max(300),
    checkIn: hhmm.optional(),
    checkOut: hhmm.optional(),
  })
  .strict();

const istInstant = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

export async function requestChange(userId: string, recordId: string, raw: unknown): Promise<{ id: string }> {
  const input = parse(requestSchema, raw);
  const employeeId = await employeeOf(userId);
  const record = await prisma.remoteAttendanceRecord.findUnique({ where: { id: recordId } });
  if (!record || record.employeeId !== employeeId) throw new HttpError(404, "That record was not found.", "NOT_FOUND"); // not yours: it does not exist for you
  const decided = (DECIDED as readonly string[]).includes(record.status);
  if (input.kind === "CORRECTION" && decided) throw new HttpError(409, "This day has been decided. Ask for a review instead.", "DECIDED");
  if (input.kind === "REVIEW" && record.status !== "REJECTED" && record.status !== "APPROVED_HALF") throw new HttpError(409, "A review can be asked for after a rejection or a half day.", "NOT_REVIEWABLE");
  if (input.kind === "REVIEW" && (await prisma.remoteAttendanceRequest.count({ where: { recordId, kind: "REVIEW" } })) > 0) throw new HttpError(409, "You have already asked for a review of this day. One is allowed.", "REVIEW_USED");
  if (input.kind === "CORRECTION" && !input.checkIn && !input.checkOut) throw new HttpError(400, "Give the time in, the time out, or both.", "VALIDATION_ERROR");
  if (input.kind === "REVIEW" && (input.checkIn || input.checkOut)) throw new HttpError(400, "A review carries no times.", "VALIDATION_ERROR");
  if (await prisma.remoteAttendanceRequest.count({ where: { recordId, status: "OPEN" } })) throw new HttpError(409, "There is already a request waiting on this day.", "REQUEST_OPEN");
  const date = iso(record.date);
  const req = await prisma.remoteAttendanceRequest.create({ data: { recordId, kind: input.kind, note: input.note, requestedByUserId: userId, proposedCheckIn: input.checkIn ? istInstant(date, input.checkIn) : null, proposedCheckOut: input.checkOut ? istInstant(date, input.checkOut) : null } });
  await event(recordId, input.kind === "CORRECTION" ? "CORRECTION_REQUESTED" : "REVIEW_REQUESTED", userId, input.note, {});
  for (const to of await directorsToTell(employeeId)) await notifyEmployee(to, { type: "attendance.remote.request", title: "A remote-attendance request", body: "A request is waiting for you.", link: "/admin/workforce/attendance/remote", payload: {} });
  return { id: req.id };
}

export const missedSchema = z.object({ date: z.iso.date(), note: z.string().trim().min(NOTE_MIN, "Say what happened").max(300), checkIn: hhmm, checkOut: hhmm }).strict();

/** A remote day with no record at all (the person forgot to check in): they ask for the times to be recorded, with a reason. A director accepts or declines it like any correction. */
export async function requestMissedDay(userId: string, raw: unknown): Promise<{ id: string }> {
  const input = parse(missedSchema, raw);
  const employeeId = await employeeOf(userId);
  if (input.date >= iso(businessToday())) throw new HttpError(400, "A missed day is a day that has passed. Today you can still check in.", "VALIDATION_ERROR");
  if (!(await isRemoteOn(employeeId, input.date))) throw new HttpError(403, "You were not marked as working remotely on that day.", "NOT_REMOTE");
  if (istInstant(input.date, input.checkOut) < istInstant(input.date, input.checkIn)) throw new HttpError(400, "The time out is before the time in.", "VALIDATION_ERROR");
  if (await prisma.remoteAttendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: day(input.date) } }, select: { id: true } })) throw new HttpError(409, "That day already has a record. Ask for a correction on it.", "RECORD_EXISTS");
  const record = await prisma.remoteAttendanceRecord.create({ data: { employeeId, date: day(input.date) } });
  const req = await prisma.remoteAttendanceRequest.create({ data: { recordId: record.id, kind: "CORRECTION", note: input.note, requestedByUserId: userId, proposedCheckIn: istInstant(input.date, input.checkIn), proposedCheckOut: istInstant(input.date, input.checkOut) } });
  await event(record.id, "CORRECTION_REQUESTED", userId, input.note, { missedDay: true });
  for (const to of await directorsToTell(employeeId)) await notifyEmployee(to, { type: "attendance.remote.request", title: "A remote-attendance request", body: "A request is waiting for you.", link: "/admin/workforce/attendance/remote", payload: {} });
  return { id: req.id };
}

export const resolveSchema = z.object({ accept: z.boolean(), note: z.string().trim().min(NOTE_MIN, "Say why").max(200) }).strict();

export async function resolveRequest(requestId: string, raw: unknown, actor: Actor): Promise<{ status: string }> {
  const input = parse(resolveSchema, raw);
  const req = await prisma.remoteAttendanceRequest.findUnique({ where: { id: requestId }, include: { record: true } });
  if (!req) throw new HttpError(404, "That request was not found.", "NOT_FOUND");
  await assertMayDecide(req.record, actor);
  if (req.status !== "OPEN") throw new HttpError(409, "That request has already been answered.", "NOT_OPEN");
  if (input.accept && req.kind === "CORRECTION") {
    const inAt = req.proposedCheckIn ?? req.record.checkInAt;
    const outAt = req.proposedCheckOut ?? req.record.checkOutAt;
    if (inAt && outAt && outAt < inAt) throw new HttpError(409, "The time out would be before the time in.", "TIMES_WRONG");
    await prisma.remoteAttendanceRecord.update({ where: { id: req.recordId }, data: { checkInAt: inAt, checkOutAt: outAt, ...(outAt && req.record.status === "OPEN" ? { status: "PENDING" } : {}) } });
    await event(req.recordId, "CORRECTED", actor.userId, input.note, { checkIn: inAt ? timeOnly(inAt) : null, checkOut: outAt ? timeOnly(outAt) : null });
  }
  await prisma.remoteAttendanceRequest.update({ where: { id: requestId }, data: { status: input.accept ? "ACCEPTED" : "DECLINED", resolvedByUserId: actor.userId, resolvedAt: new Date(), resolutionNote: input.note } }); // allow-clock: an instant
  await writeAuditLog({ actorUserId: actor.userId, action: "attendance.remote.request_answered", entityType: "RemoteAttendanceRequest", entityId: requestId, after: { accepted: input.accept, kind: req.kind }, ipAddress: actor.ip ?? null });
  if (input.accept && req.kind === "REVIEW") await reopen(req.recordId, { reason: `Review accepted: ${input.note}` }, actor);
  await notifyEmployee(req.record.employeeId, { type: "attendance.remote.request_answered", title: input.accept ? "Your request was accepted" : "Your request was not accepted", body: input.note, link: "/app/attendance/info", payload: {} });
  return { status: input.accept ? "ACCEPTED" : "DECLINED" };
}

export async function openRequests(actor: Actor) {
  await requireDirector(actor.userId, "see remote attendance requests");
  const rows = await prisma.remoteAttendanceRequest.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "asc" }, take: PAGE_MAX, include: { record: { select: { employeeId: true, date: true, checkInAt: true, checkOutAt: true } } } });
  const names = await namesOn([...new Set(rows.map((r) => r.record.employeeId))], businessToday());
  return rows.map((r) => ({ id: r.id, recordId: r.recordId, kind: r.kind, note: r.note, name: names.get(r.record.employeeId) ?? r.record.employeeId, date: iso(r.record.date), proposedCheckIn: r.proposedCheckIn ? timeOnly(r.proposedCheckIn) : null, proposedCheckOut: r.proposedCheckOut ? timeOnly(r.proposedCheckOut) : null, createdAt: r.createdAt.toISOString() }));
}

// ── Reports ──

export const reportSchema = z.object({ from: z.iso.date(), to: z.iso.date() }).strict();

/** Remote days per person per month, the pending count, every rejected day with its reason and outcome, and every half day. Directors only. */
export async function report(q: z.infer<typeof reportSchema>, actor: Actor) {
  await requireDirector(actor.userId, "see the remote attendance report");
  const rows = await prisma.remoteAttendanceRecord.findMany({ where: { date: { gte: day(q.from), lte: day(q.to) } }, orderBy: { date: "asc" }, select: { employeeId: true, date: true, status: true, half: true, rejectOutcome: true, decisionReason: true, checkInAt: true, checkOutAt: true } });
  const names = await namesOn([...new Set(rows.map((r) => r.employeeId))], businessToday());
  const nameOf = (id: string) => names.get(id) ?? id;
  const people = new Map<string, { name: string; days: number; full: number; half: number; absent: number; lossOfPay: number; pending: number; minutes: number }>();
  const monthly = new Map<string, { name: string; month: string; days: number; full: number; half: number; rejected: number; pending: number }>();
  const rejected: Array<{ name: string; date: string; outcome: string; reason: string }> = [];
  const halfDays: Array<{ name: string; date: string; half: string; reason: string }> = [];
  for (const r of rows) {
    const p = people.get(r.employeeId) ?? { name: nameOf(r.employeeId), days: 0, full: 0, half: 0, absent: 0, lossOfPay: 0, pending: 0, minutes: 0 };
    const month = iso(r.date).slice(0, 7);
    const m = monthly.get(`${r.employeeId}|${month}`) ?? { name: nameOf(r.employeeId), month, days: 0, full: 0, half: 0, rejected: 0, pending: 0 };
    p.days += 1;
    m.days += 1;
    if (r.status === "APPROVED_FULL") {
      p.full += 1;
      m.full += 1;
    } else if (r.status === "APPROVED_HALF") {
      p.half += 1;
      m.half += 1;
      halfDays.push({ name: nameOf(r.employeeId), date: iso(r.date), half: r.half ?? "", reason: r.decisionReason ?? "" });
    } else if (r.status === "REJECTED") {
      if (r.rejectOutcome === "LOSS_OF_PAY") p.lossOfPay += 1;
      else p.absent += 1;
      m.rejected += 1;
      rejected.push({ name: nameOf(r.employeeId), date: iso(r.date), outcome: r.rejectOutcome ?? "", reason: r.decisionReason ?? "" });
    } else {
      p.pending += 1;
      m.pending += 1;
    }
    if (r.checkInAt && r.checkOutAt) p.minutes += minutesBetween(r.checkInAt, r.checkOutAt);
    people.set(r.employeeId, p);
    monthly.set(`${r.employeeId}|${month}`, m);
  }
  const list = [...people.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  const total = list.reduce((t, p) => ({ days: t.days + p.days, full: t.full + p.full, half: t.half + p.half, absent: t.absent + p.absent, lossOfPay: t.lossOfPay + p.lossOfPay, pending: t.pending + p.pending }), { days: 0, full: 0, half: 0, absent: 0, lossOfPay: 0, pending: 0 });
  const pendingNow = await prisma.remoteAttendanceRecord.count({ where: { status: "PENDING" } });
  return {
    from: q.from,
    to: q.to,
    total,
    pendingNow,
    people: list.map((p) => ({ ...p, hours: `${Math.floor(p.minutes / 60)}:${String(p.minutes % 60).padStart(2, "0")}` })),
    perMonth: [...monthly.values()].sort((a, b) => (a.month + a.name < b.month + b.name ? -1 : 1)),
    rejected,
    halfDays,
  };
}

// ── Settings (Not set until a director sets them) and reminders ──

export const settingsSchema = z.object({ reminderAfterHours: z.number().int().min(1).max(200).nullable(), suggestedRejectOutcome: z.enum(["ABSENT", "LOSS_OF_PAY"]).nullable() }).strict();

export async function getSettings(actor: Actor) {
  await requireDirector(actor.userId, "see these settings");
  return { reminderAfterHours: await getSetting<number | null>(REMINDER_HOURS_KEY, null), suggestedRejectOutcome: await getSetting<"ABSENT" | "LOSS_OF_PAY" | null>(SUGGESTED_OUTCOME_KEY, null) };
}

export async function putSettings(raw: unknown, actor: Actor) {
  const input = parse(settingsSchema, raw);
  await requireDirector(actor.userId, "change these settings");
  await setSetting(REMINDER_HOURS_KEY, input.reminderAfterHours, actor.userId);
  await setSetting(SUGGESTED_OUTCOME_KEY, input.suggestedRejectOutcome, actor.userId);
  await writeAuditLog({ actorUserId: actor.userId, action: "attendance.remote.settings_changed", entityType: "SystemSetting", entityId: REMINDER_HOURS_KEY, after: input, ipAddress: actor.ip ?? null });
  return getSettings(actor);
}

/** Tells the directors about records that have waited longer than the threshold. With the threshold Not set, nothing is sent. Each record is reminded once. */
export async function sendDueReminders(now: Date = new Date()): Promise<number> { // allow-clock: a default instant
  const hours = await getSetting<number | null>(REMINDER_HOURS_KEY, null);
  if (hours === null) return 0;
  const pending = await prisma.remoteAttendanceRecord.findMany({ where: { status: "PENDING", reminderSentAt: null }, select: { id: true, employeeId: true, checkOutAt: true, createdAt: true, reminderSentAt: true } });
  let sent = 0;
  for (const r of pending) {
    if (!reminderDue(r.checkOutAt ?? r.createdAt, now, hours, r.reminderSentAt)) continue;
    for (const to of await directorsToTell(r.employeeId)) await notifyEmployee(to, { type: "attendance.remote.reminder", title: "Remote attendance is waiting", body: "A remote day has been waiting for your decision.", link: "/admin/workforce/attendance/remote", payload: {} });
    await prisma.remoteAttendanceRecord.update({ where: { id: r.id }, data: { reminderSentAt: now } });
    sent += 1;
  }
  return sent;
}
