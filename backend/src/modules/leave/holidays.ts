import { requestRecomputeForEveryone } from "../attendance/recompute";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "./types";

// Prisma's unique-constraint violation (P2002 on date) -> a friendly 409,
// same convention org/service.ts's runUnique uses.
async function runUnique<T>(fn: () => Promise<T>, onConflict: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(409, onConflict, "CONFLICT");
    }
    throw err;
  }
}

function dateOnlyJson(row: { date: Date }) {
  return { ...row, date: row.date.toISOString().slice(0, 10) };
}

// Company-wide, not per-branch (HR-confirmed 2026-09-28 — see schema.prisma's
// comment on the Holiday model): one holiday calendar and one restricted-
// holiday list for the whole company, not one per branch. Read-only for
// commit B; commit C added the mutating admin endpoints below, gated by
// leave.policy.manage.
export async function listHolidays(year?: number) {
  const rows = await prisma.holiday.findMany({
    where: year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } } : {},
    orderBy: { date: "asc" },
  });
  return rows.map(dateOnlyJson);
}

export async function listRestrictedHolidays(year?: number) {
  const rows = await prisma.restrictedHoliday.findMany({
    where: year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } } : {},
    orderBy: { date: "asc" },
  });
  return rows.map(dateOnlyJson);
}

// ── Holidays — admin mutations (leave.policy.manage) ────────────────────

interface HolidayInput {
  date: string;
  name: string;
}

export async function createHoliday(input: HolidayInput, meta: ActorMeta) {
  const date = new Date(input.date);
  const holiday = await runUnique(() => prisma.holiday.create({ data: { date, name: input.name } }), "A holiday already exists on this date.");
  await writeAuditLog({ ...meta, action: "leave.holiday.create", entityType: "Holiday", entityId: holiday.id, after: dateOnlyJson(holiday) });
  await requestRecomputeForEveryone([holiday.date]); // Phase 2: the day becomes H for everyone
  return dateOnlyJson(holiday);
}

export async function updateHoliday(id: string, input: Partial<HolidayInput>, meta: ActorMeta) {
  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Holiday not found.", "NOT_FOUND");
  const after = await runUnique(
    () => prisma.holiday.update({ where: { id }, data: { ...(input.date ? { date: new Date(input.date) } : {}), ...(input.name ? { name: input.name } : {}) } }),
    "A holiday already exists on this date.",
  );
  await writeAuditLog({ ...meta, action: "leave.holiday.update", entityType: "Holiday", entityId: id, before: dateOnlyJson(before), after: dateOnlyJson(after) });
  await requestRecomputeForEveryone([before.date, after.date]);
  return dateOnlyJson(after);
}

export async function deleteHoliday(id: string, meta: ActorMeta) {
  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Holiday not found.", "NOT_FOUND");
  await prisma.holiday.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "leave.holiday.delete", entityType: "Holiday", entityId: id, before: dateOnlyJson(before) });
  await requestRecomputeForEveryone([before.date]);
}

// ── Restricted holidays — admin mutations (leave.policy.manage) ─────────

export async function createRestrictedHoliday(input: HolidayInput, meta: ActorMeta) {
  const date = new Date(input.date);
  const holiday = await runUnique(() => prisma.restrictedHoliday.create({ data: { date, name: input.name } }), "A restricted holiday already exists on this date.");
  await writeAuditLog({ ...meta, action: "leave.restrictedHoliday.create", entityType: "RestrictedHoliday", entityId: holiday.id, after: dateOnlyJson(holiday) });
  return dateOnlyJson(holiday);
}

export async function updateRestrictedHoliday(id: string, input: Partial<HolidayInput>, meta: ActorMeta) {
  const before = await prisma.restrictedHoliday.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Restricted holiday not found.", "NOT_FOUND");
  const after = await runUnique(
    () => prisma.restrictedHoliday.update({ where: { id }, data: { ...(input.date ? { date: new Date(input.date) } : {}), ...(input.name ? { name: input.name } : {}) } }),
    "A restricted holiday already exists on this date.",
  );
  await writeAuditLog({ ...meta, action: "leave.restrictedHoliday.update", entityType: "RestrictedHoliday", entityId: id, before: dateOnlyJson(before), after: dateOnlyJson(after) });
  return dateOnlyJson(after);
}

export async function deleteRestrictedHoliday(id: string, meta: ActorMeta) {
  const before = await prisma.restrictedHoliday.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Restricted holiday not found.", "NOT_FOUND");
  await prisma.restrictedHoliday.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "leave.restrictedHoliday.delete", entityType: "RestrictedHoliday", entityId: id, before: dateOnlyJson(before) });
}
