import type { Prisma, ShiftOverride } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { ShiftDef } from "./engine/types";

// shift_overrides (Phase 3 commit 2, docs/plans/PHASE_3.md): a shift for one employee on one date, read by the
// engine ahead of the assignment's shift. Append-only: for an employee-day the row with the highest `seq` is the
// active one, and a row with no shift clears it. The week-off pattern and the policy stay the assignment's.

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const shiftOverrideKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** A shift with its sessions: what the engine needs, and what the day's shift columns are written from. */
export const shiftWithSessions = { sessions: { orderBy: { sortOrder: "asc" as const } } } as const;
export type ShiftWithSessions = Prisma.ShiftGetPayload<{ include: typeof shiftWithSessions }>;

export function shiftDefOf(s: ShiftWithSessions): ShiftDef {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    graceInMinutes: s.graceInMinutes,
    graceOutMinutes: s.graceOutMinutes,
    windowBeforeMinutes: s.windowBeforeMinutes,
    windowAfterMinutes: s.windowAfterMinutes,
    sessions: s.sessions.map((x) => ({ kind: x.kind, label: x.label, startTime: x.startTime, endTime: x.endTime })),
  };
}

/** The active override rows (latest per employee-day, cleared ones excluded) for these employees over [from, to]. */
export async function activeShiftOverrideRows(employeeIds: string[], from: string, to: string): Promise<Map<string, ShiftOverride>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await prisma.shiftOverride.findMany({
    where: { employeeId: { in: employeeIds }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    orderBy: { seq: "asc" },
  });
  const latest = new Map<string, ShiftOverride>();
  for (const r of rows) latest.set(shiftOverrideKey(r.employeeId, iso(r.date)), r); // ascending: the latest wins
  for (const [k, r] of latest) if (!r.shiftId) latest.delete(k);
  return latest;
}

export interface LoadedShiftOverride {
  id: string;
  shift: ShiftWithSessions;
}

/** What the engine's loader takes: the shift per employee-day. */
export async function loadShiftOverrides(employeeIds: string[], from: string, to: string): Promise<Map<string, LoadedShiftOverride>> {
  const rows = await activeShiftOverrideRows(employeeIds, from, to);
  if (rows.size === 0) return new Map();
  const shifts = await prisma.shift.findMany({ where: { id: { in: [...new Set([...rows.values()].map((r) => r.shiftId!))] } }, include: shiftWithSessions });
  const byId = new Map(shifts.map((s) => [s.id, s]));
  const out = new Map<string, LoadedShiftOverride>();
  for (const [k, r] of rows) {
    const shift = byId.get(r.shiftId!);
    if (shift) out.set(k, { id: r.id, shift });
  }
  return out;
}

export interface NewShiftOverride {
  employeeId: string;
  date: string;
  shiftId: string | null;
  reason: string;
  createdByUserId: string;
}

export async function appendShiftOverrides(tx: Prisma.TransactionClient, rows: NewShiftOverride[]): Promise<ShiftOverride[]> {
  const out: ShiftOverride[] = [];
  for (const r of rows) {
    out.push(await tx.shiftOverride.create({ data: { employeeId: r.employeeId, date: new Date(`${r.date}T00:00:00Z`), shiftId: r.shiftId, reason: r.reason, createdByUserId: r.createdByUserId } }));
  }
  return out;
}
