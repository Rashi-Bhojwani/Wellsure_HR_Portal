import type { ManualAttendanceEntry, ManualEntryVia, Prisma } from "@prisma/client";
import type { ManualStatus, MusterInput } from "@shared/attendance/muster";
import { prisma } from "../../../lib/prisma";
import type { ManualEntry } from "../engine/types";

// Manual attendance entries (P2-D, docs/plans/PHASE_2.md §2.3): append-only,
// the latest per employee-day wins (by `seq`), CLEARED withdraws it. The
// engine reads them through `loadManualEntries` (compute.ts's loader).

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const entryKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** The latest entry per employee-day in [from, to], CLEARED ones included. */
export async function latestEntries(employeeIds: string[], from: string, to: string): Promise<Map<string, ManualAttendanceEntry>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await prisma.manualAttendanceEntry.findMany({
    where: { employeeId: { in: employeeIds }, date: { gte: day(from), lte: day(to) } },
    orderBy: { seq: "asc" },
  });
  const out = new Map<string, ManualAttendanceEntry>();
  for (const r of rows) out.set(entryKey(r.employeeId, iso(r.date)), r); // ascending: the last one wins
  return out;
}

export function entryInput(row: Pick<ManualAttendanceEntry, "kind" | "inTime" | "outTime" | "status">): MusterInput {
  if (row.kind === "TIMED") return { kind: "TIMED", inTime: row.inTime!, outTime: row.outTime };
  if (row.kind === "STATUS_ONLY") return { kind: "STATUS_ONLY", status: row.status as ManualStatus };
  return { kind: "CLEARED" };
}

/** What the engine reads: the latest entry per day, as an engine ManualEntry; a cleared day has none. */
export async function loadManualEntries(employeeIds: string[], from: string, to: string): Promise<Map<string, ManualEntry>> {
  const out = new Map<string, ManualEntry>();
  for (const [key, r] of await latestEntries(employeeIds, from, to)) {
    if (r.kind === "TIMED") out.set(key, { kind: "TIMED", id: r.id, inTime: r.inTime!, outTime: r.outTime });
    else if (r.kind === "STATUS_ONLY") out.set(key, { kind: "STATUS_ONLY", id: r.id, status: r.status as ManualStatus });
  }
  return out;
}

export interface NewEntry {
  employeeId: string;
  date: string;
  input: MusterInput;
  remark?: string | null;
}

/** Append entries (never edits one). */
export async function appendEntries(
  tx: Prisma.TransactionClient,
  items: NewEntry[],
  meta: { via: ManualEntryVia; enteredByUserId: string; uploadId?: string | null },
): Promise<number> {
  if (items.length === 0) return 0;
  const { count } = await tx.manualAttendanceEntry.createMany({
    data: items.map((e) => ({
      employeeId: e.employeeId,
      date: day(e.date),
      kind: e.input.kind,
      inTime: e.input.kind === "TIMED" ? e.input.inTime : null,
      outTime: e.input.kind === "TIMED" ? e.input.outTime : null,
      status: e.input.kind === "STATUS_ONLY" ? e.input.status : null,
      via: meta.via,
      uploadId: meta.uploadId ?? null,
      remark: e.remark?.trim() || null,
      enteredByUserId: meta.enteredByUserId,
    })),
  });
  return count;
}
