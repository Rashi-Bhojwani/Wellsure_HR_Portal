import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "./types";

// Prisma's unique-constraint violation (P2002 on [locationId, date]) -> a
// friendly 409, same convention org/service.ts's runUnique uses.
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

// Read-only for commit B (every role needs these for the Holiday Calendar
// screen); commit C adds the mutating admin endpoints (create/edit/delete,
// gated by leave.policy.manage) below, to the same two resources.
export async function listHolidays(locationId: string, year?: number) {
  const rows = await prisma.holiday.findMany({
    where: { locationId, ...(year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } } : {}) },
    orderBy: { date: "asc" },
  });
  return rows.map(dateOnlyJson);
}

export async function listRestrictedHolidays(locationId: string, year?: number) {
  const rows = await prisma.restrictedHoliday.findMany({
    where: { locationId, ...(year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } } : {}) },
    orderBy: { date: "asc" },
  });
  return rows.map(dateOnlyJson);
}

// The employee's own current branch — Holiday Calendar defaults to this
// when no locationId query param is given.
export async function getEmployeeCurrentLocationId(employeeId: string): Promise<string | null> {
  const jobHistory = await prisma.employeeJobHistory.findFirst({
    where: { employeeId, effectiveTo: null },
    select: { locationId: true },
  });
  return jobHistory?.locationId ?? null;
}

// ── Holidays — admin mutations (leave.policy.manage) ────────────────────

interface HolidayInput {
  locationId: string;
  date: string;
  name: string;
}

export async function createHoliday(input: HolidayInput, meta: ActorMeta) {
  const date = new Date(input.date);
  const holiday = await runUnique(
    () => prisma.holiday.create({ data: { locationId: input.locationId, date, name: input.name } }),
    "A holiday already exists for this branch and date.",
  );
  await writeAuditLog({ ...meta, action: "leave.holiday.create", entityType: "Holiday", entityId: holiday.id, after: dateOnlyJson(holiday) });
  return dateOnlyJson(holiday);
}

export async function updateHoliday(id: string, input: Partial<Omit<HolidayInput, "locationId">>, meta: ActorMeta) {
  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Holiday not found.", "NOT_FOUND");
  const after = await runUnique(
    () => prisma.holiday.update({ where: { id }, data: { ...(input.date ? { date: new Date(input.date) } : {}), ...(input.name ? { name: input.name } : {}) } }),
    "A holiday already exists for this branch and date.",
  );
  await writeAuditLog({ ...meta, action: "leave.holiday.update", entityType: "Holiday", entityId: id, before: dateOnlyJson(before), after: dateOnlyJson(after) });
  return dateOnlyJson(after);
}

export async function deleteHoliday(id: string, meta: ActorMeta) {
  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Holiday not found.", "NOT_FOUND");
  await prisma.holiday.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "leave.holiday.delete", entityType: "Holiday", entityId: id, before: dateOnlyJson(before) });
}

// Apply the same date+name to several branches at once (spec: "adding a
// branch is a data change, never a code change" — HR maintains one
// holiday calendar per branch, and most holidays are shared org-wide).
// Per-location result, never all-or-nothing: a branch that already has a
// holiday on this date is reported, not allowed to fail the whole batch.
interface BulkHolidayInput {
  locationIds: string[];
  date: string;
  name: string;
}

export async function bulkCreateHolidays(input: BulkHolidayInput, meta: ActorMeta) {
  const date = new Date(input.date);
  const results: { locationId: string; status: "created" | "skipped"; error?: string }[] = [];
  for (const locationId of input.locationIds) {
    try {
      const holiday = await prisma.holiday.create({ data: { locationId, date, name: input.name } });
      await writeAuditLog({ ...meta, action: "leave.holiday.create", entityType: "Holiday", entityId: holiday.id, after: dateOnlyJson(holiday) });
      results.push({ locationId, status: "created" });
    } catch (err) {
      const message = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" ? "A holiday already exists for this branch and date." : "Could not create.";
      results.push({ locationId, status: "skipped", error: message });
    }
  }
  return results;
}

// ── Restricted holidays — admin mutations (leave.policy.manage) ─────────

export async function createRestrictedHoliday(input: HolidayInput, meta: ActorMeta) {
  const date = new Date(input.date);
  const holiday = await runUnique(
    () => prisma.restrictedHoliday.create({ data: { locationId: input.locationId, date, name: input.name } }),
    "A restricted holiday already exists for this branch and date.",
  );
  await writeAuditLog({ ...meta, action: "leave.restrictedHoliday.create", entityType: "RestrictedHoliday", entityId: holiday.id, after: dateOnlyJson(holiday) });
  return dateOnlyJson(holiday);
}

export async function updateRestrictedHoliday(id: string, input: Partial<Omit<HolidayInput, "locationId">>, meta: ActorMeta) {
  const before = await prisma.restrictedHoliday.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Restricted holiday not found.", "NOT_FOUND");
  const after = await runUnique(
    () => prisma.restrictedHoliday.update({ where: { id }, data: { ...(input.date ? { date: new Date(input.date) } : {}), ...(input.name ? { name: input.name } : {}) } }),
    "A restricted holiday already exists for this branch and date.",
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

export async function bulkCreateRestrictedHolidays(input: BulkHolidayInput, meta: ActorMeta) {
  const date = new Date(input.date);
  const results: { locationId: string; status: "created" | "skipped"; error?: string }[] = [];
  for (const locationId of input.locationIds) {
    try {
      const holiday = await prisma.restrictedHoliday.create({ data: { locationId, date, name: input.name } });
      await writeAuditLog({ ...meta, action: "leave.restrictedHoliday.create", entityType: "RestrictedHoliday", entityId: holiday.id, after: dateOnlyJson(holiday) });
      results.push({ locationId, status: "created" });
    } catch (err) {
      const message = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" ? "A restricted holiday already exists for this branch and date." : "Could not create.";
      results.push({ locationId, status: "skipped", error: message });
    }
  }
  return results;
}
