import { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { requireDirector } from "../../../lib/directorAuthority";
import { recordDirectorNotice, scheduleDelivery } from "../../../lib/directorNotices";
import { employedBetween, namesOn, notifyPayrollInputsChanged } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { assertNotOwnPay } from "../salary/guards";

// Not on payroll (docs/plans/STAGE_5B_PLAN.md, B6). A director marks a person as not on payroll from a date (to a date, or until further notice), with a required reason. It is
// append-only and effective-dated: ending it early is another row (an "include" from a date). It takes effect only when a DIFFERENT director confirms it. A run skips a person who is
// excluded and confirmed on the cycle's last day, and says so in its "skipped" list. HR sees nothing: every route here is a director's.

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const NOTE_MIN = 3;

export const addSchema = z
  .object({
    employeeId: z.string().min(1).max(64),
    kind: z.enum(["EXCLUDE", "INCLUDE"]),
    fromDate: z.iso.date(),
    toDate: z.iso.date().nullable().optional(),
    reason: z.string().trim().min(NOTE_MIN, "Say why").max(200),
  })
  .strict()
  .refine((v) => !v.toDate || v.toDate >= v.fromDate, { message: "The end date is before the start date", path: ["toDate"] });

export interface Actor {
  userId: string;
  ip?: string | null;
}

export async function add(raw: unknown, actor: Actor): Promise<{ id: string }> {
  const parsed = addSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const input = parsed.data;
  await requireDirector(actor.userId, "mark somebody as not on payroll");
  if (!(await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true } }))) throw new HttpError(404, "That employee was not found.", "NOT_FOUND");
  await assertNotOwnPay(actor.userId, [input.employeeId], "This change");
  const finalised = await prisma.payrollRun.findFirst({ where: { status: "FINALISED", cycleEnd: { gte: day(input.fromDate) }, ...(input.toDate ? { cycleStart: { lte: day(input.toDate) } } : {}) }, select: { cycleLabel: true } });
  if (finalised) throw new HttpError(409, `The run for ${finalised.cycleLabel} is already final, so a change that reaches it cannot be made. Start it after that period.`, "RUN_FINAL");
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.payrollExclusion.create({ data: { employeeId: input.employeeId, kind: input.kind, fromDate: day(input.fromDate), toDate: input.toDate ? day(input.toDate) : null, reason: input.reason, madeByUserId: actor.userId } });
    const n = await recordDirectorNotice({ kind: "ACTION", step: "RUN_APPROVAL", subjectType: "PAYROLL_EXCLUSION", subjectId: r.id, subjectLabel: input.kind === "EXCLUDE" ? "a person marked as not on payroll, waiting for your confirmation" : "a person put back on payroll, waiting for your confirmation", itemCount: 1, actorUserId: actor.userId, approvalId: null, authority: null }, tx);
    return { r, noticeId: n.noticeId };
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.exclusion.added", entityType: "PayrollExclusion", entityId: row.r.id, after: { kind: input.kind, from: input.fromDate, to: input.toDate ?? null, reasonRecorded: true }, ipAddress: actor.ip ?? null });
  await scheduleDelivery(row.noticeId);
  return { id: row.r.id };
}

export async function confirm(id: string, actor: Actor): Promise<{ id: string }> {
  await requireDirector(actor.userId, "confirm a payroll exclusion");
  const row = await prisma.payrollExclusion.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "That entry was not found.", "NOT_FOUND");
  if (row.madeByUserId === actor.userId) throw new HttpError(403, "You made this, so a different director has to confirm it.", "CHECKER_IS_MAKER");
  if (row.confirmedByUserId) throw new HttpError(409, "It has already been confirmed.", "ALREADY_CONFIRMED");
  try {
    await prisma.payrollExclusion.update({ where: { id }, data: { confirmedByUserId: actor.userId, confirmedAt: new Date() } }); // allow-clock: an instant
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError || (err instanceof Error && /PAYROLL_EXCLUSION/.test(err.message))) throw new HttpError(409, "It could not be confirmed (somebody else did, or it is not yours to confirm).", "CONFLICT");
    throw err;
  }
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.exclusion.confirmed", entityType: "PayrollExclusion", entityId: id, ipAddress: actor.ip ?? null });
  await notifyPayrollInputsChanged("A payroll exclusion was confirmed", actor.userId);
  return { id };
}

export interface ExclusionView {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  kind: "EXCLUDE" | "INCLUDE";
  fromDate: string;
  toDate: string | null;
  reason: string;
  madeBy: string;
  confirmed: boolean;
  confirmedAt: string | null;
  createdAt: string;
}

export async function list(actor: Actor): Promise<ExclusionView[]> {
  await requireDirector(actor.userId, "see who is not on payroll");
  const rows = await prisma.payrollExclusion.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const emps = await prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, employeeCode: true } });
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const names = await namesOn([...code.keys()], businessToday());
  const makers = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.madeByUserId))] } }, select: { id: true, employeeId: true } });
  const makerNames = await namesOn(makers.map((m) => m.employeeId), businessToday());
  const makerOf = new Map(makers.map((m) => [m.id, makerNames.get(m.employeeId) ?? "A director"]));
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeCode: code.get(r.employeeId) ?? r.employeeId, name: names.get(r.employeeId) ?? code.get(r.employeeId) ?? r.employeeId, kind: r.kind, fromDate: iso(r.fromDate), toDate: r.toDate ? iso(r.toDate) : null, reason: r.reason, madeBy: makerOf.get(r.madeByUserId) ?? "A director", confirmed: r.confirmedByUserId !== null, confirmedAt: r.confirmedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }));
}

/**
 * Who is excluded on `day`: the latest confirmed row effective on that day decides (rows are ordered by start date, then by when they were made); an EXCLUDE row with no end date
 * holds until a later INCLUDE row. Pure over the rows so the rule is tested without a database.
 */
export function excludedOn(rows: ReadonlyArray<{ employeeId: string; kind: "EXCLUDE" | "INCLUDE"; fromDate: string; toDate: string | null; createdAt: string; confirmed: boolean }>, dayIso: string): Map<string, true> {
  const decided = new Map<string, { kind: string; fromDate: string; createdAt: string }>();
  for (const r of rows) {
    if (!r.confirmed || r.fromDate > dayIso || (r.toDate !== null && r.toDate < dayIso)) continue;
    const cur = decided.get(r.employeeId);
    if (!cur || r.fromDate > cur.fromDate || (r.fromDate === cur.fromDate && r.createdAt > cur.createdAt)) decided.set(r.employeeId, r);
  }
  return new Map([...decided].filter(([, r]) => r.kind === "EXCLUDE").map(([id]) => [id, true as const]));
}

/** For the run: the people among `employeeIds` who are excluded and confirmed on `dayDate` (the cycle's last day), with the reason. */
export async function skippedOn(employeeIds: string[], dayDate: Date): Promise<Map<string, string>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await prisma.payrollExclusion.findMany({ where: { employeeId: { in: employeeIds }, confirmedByUserId: { not: null }, fromDate: { lte: dayDate } }, orderBy: [{ fromDate: "asc" }, { createdAt: "asc" }] });
  const shaped = rows.map((r) => ({ employeeId: r.employeeId, kind: r.kind, fromDate: iso(r.fromDate), toDate: r.toDate ? iso(r.toDate) : null, createdAt: r.createdAt.toISOString(), confirmed: true }));
  const out = excludedOn(shaped, iso(dayDate));
  const reason = new Map<string, string>();
  for (const r of rows) if (out.has(r.employeeId) && r.kind === "EXCLUDE") reason.set(r.employeeId, r.reason);
  return reason;
}

/** The people a run for this cycle skips, named, for the run's readiness and detail. */
export async function skippedForCycle(cycleStart: Date, cycleEnd: Date): Promise<Array<{ employeeId: string; employeeCode: string; name: string; reason: string }>> {
  const people = await prisma.employee.findMany({ where: employedBetween(cycleStart, cycleEnd), select: { id: true, employeeCode: true }, orderBy: { employeeCode: "asc" } });
  const skipped = await skippedOn(people.map((p) => p.id), cycleEnd);
  const names = await namesOn([...skipped.keys()], cycleEnd);
  return people.filter((p) => skipped.has(p.id)).map((p) => ({ employeeId: p.id, employeeCode: p.employeeCode, name: names.get(p.id) ?? p.employeeCode, reason: skipped.get(p.id)! }));
}
