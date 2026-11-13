import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { activeDirectors, requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { notifyEmployee } from "../../notifications/notifyEmployee";

// ST-30 (docs/plans/A_PARITY_ROWS.md part 2): compliance due dates. Directors enter each one themselves (statute, what is due, the day of the month, how many days
// before to remind, where the date comes from); none is preset — the dates are statutory facts the owners give. Each month a date is shown as due, overdue or done;
// a director marks it done (audited); the hourly director sweep reminds the directors once a month inside the window.

type Actor = { userId: string; ip?: string | null };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The day a due date falls on in a month (`YYYY-MM`), clamped to the month's last day (31 in a 30-day month is the 30th). Pure; exported for the test. */
export function dueOn(month: string, dueDay: number): string {
  const y = Number(month.slice(0, 4)); // allow-number: a calendar year
  const m = Number(month.slice(5, 7)); // allow-number: a calendar month
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(dueDay, last)).padStart(2, "0")}`;
}

/** Whether today is inside the reminder window for that day: from `remindDaysBefore` days before, up to and including the day. Pure; exported for the test. */
export function inWindow(today: string, due: string, remindDaysBefore: number): boolean {
  const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const diff = Math.round((d(due) - d(today)) / 86_400_000); // allow-number: milliseconds in a day
  return diff >= 0 && diff <= remindDaysBefore;
}

export const dueDateSchema = z
  .object({
    statute: z.string().trim().min(2).max(40),
    item: z.string().trim().min(3).max(200),
    dueDay: z.number().int().min(1).max(31),
    remindDaysBefore: z.number().int().min(0).max(30),
    source: z.string().trim().min(3, "Say where the date comes from").max(300),
  })
  .strict();
export const retireSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
export const doneSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), note: z.string().trim().max(300).optional() }).strict();

export async function list(actor: Actor) {
  await requireDirector(actor.userId, "see the compliance calendar");
  const today = iso(businessToday());
  const month = today.slice(0, 7);
  const rows = await prisma.complianceDueDate.findMany({ where: { retiredAt: null }, orderBy: [{ dueDay: "asc" }, { statute: "asc" }], include: { marks: { where: { kind: "DONE" }, orderBy: { month: "desc" }, take: 12 } } });
  return {
    month,
    dates: rows.map((r) => {
      const due = dueOn(month, r.dueDay);
      const done = r.marks.find((m) => m.month === month);
      return { id: r.id, statute: r.statute, item: r.item, dueDay: r.dueDay, remindDaysBefore: r.remindDaysBefore, source: r.source, dueThisMonth: due, state: done ? "DONE" : today > due ? "OVERDUE" : inWindow(today, due, r.remindDaysBefore) ? "DUE_SOON" : "UPCOMING", doneMonths: r.marks.map((m) => m.month) };
    }),
    note: "No due date is preset: each is entered by a director with its source.",
  };
}

export async function add(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "add a compliance due date");
  const parsed = dueDateSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const row = await prisma.complianceDueDate.create({ data: { ...parsed.data, createdByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.compliance.date_added", entityType: "ComplianceDueDate", entityId: row.id, after: parsed.data });
  return { id: row.id };
}

export async function retire(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "retire a compliance due date");
  const parsed = retireSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const row = await prisma.complianceDueDate.findUnique({ where: { id } });
  if (!row || row.retiredAt) throw new HttpError(404, "Due date not found.", "NOT_FOUND");
  await prisma.complianceDueDate.update({ where: { id }, data: { retiredAt: new Date(), retiredByUserId: actor.userId, retireReason: parsed.data.reason } }); // allow-clock: an instant
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.compliance.date_retired", entityType: "ComplianceDueDate", entityId: id, after: { reason: parsed.data.reason } });
  return { id, retired: true };
}

export async function markDone(id: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "mark a compliance item done");
  const parsed = doneSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const row = await prisma.complianceDueDate.findUnique({ where: { id } });
  if (!row || row.retiredAt) throw new HttpError(404, "Due date not found.", "NOT_FOUND");
  if (parsed.data.month > iso(businessToday()).slice(0, 7)) throw new HttpError(400, "A month in the future cannot be marked done.", "VALIDATION_ERROR");
  const existing = await prisma.complianceDueMark.findUnique({ where: { dueDateId_month_kind: { dueDateId: id, month: parsed.data.month, kind: "DONE" } } });
  if (existing) throw new HttpError(409, "Already marked done for that month.", "ALREADY_DONE");
  await prisma.complianceDueMark.create({ data: { dueDateId: id, month: parsed.data.month, kind: "DONE", byUserId: actor.userId, note: parsed.data.note ?? null } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.compliance.done", entityType: "ComplianceDueDate", entityId: id, after: { month: parsed.data.month } });
  return { id, month: parsed.data.month, done: true };
}

/** The reminder: each live date inside its window this month, not done and not yet reminded, tells every active director once. Called by the hourly director sweep. */
export async function remindDueDates(): Promise<{ reminded: number }> {
  const today = iso(businessToday());
  const month = today.slice(0, 7);
  const rows = await prisma.complianceDueDate.findMany({ where: { retiredAt: null }, include: { marks: { where: { month } } } });
  let reminded = 0;
  for (const r of rows) {
    const due = dueOn(month, r.dueDay);
    if (!inWindow(today, due, r.remindDaysBefore) || r.marks.length > 0) continue; // done or already reminded this month
    try {
      await prisma.complianceDueMark.create({ data: { dueDateId: r.id, month, kind: "REMINDED" } }); // the unique key makes this once a month, even with two workers
    } catch {
      continue;
    }
    for (const d of await activeDirectors()) await notifyEmployee(d.employeeId, { type: "payroll.compliance.due", title: `${r.statute}: due ${due}`, body: r.item, link: "/admin/payroll/compliance" });
    reminded += 1;
  }
  return { reminded };
}
