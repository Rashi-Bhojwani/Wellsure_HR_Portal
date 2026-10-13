import type { AttendanceOverride, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { DayOverride } from "./engine/types";

// attendance_overrides (Phase 3, docs/plans/PHASE_3.md): every day-level correction, append-only. For an
// employee-day the row with the highest `seq` is the active one; a CLEARED row takes the override away. The
// engine reads them through here; raw punches are never touched.

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const overrideKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** The engine's view of one override row (null for CLEARED). */
export function toDayOverride(r: Pick<AttendanceOverride, "id" | "origin" | "kind" | "inTime" | "outTime" | "status">): DayOverride | null {
  switch (r.kind) {
    case "ADD_TIME":
      return { kind: "ADD_TIME", id: r.id, origin: r.origin, time: (r.inTime ?? r.outTime)! };
    case "TIMES":
      return { kind: "TIMES", id: r.id, origin: r.origin, inTime: r.inTime!, outTime: r.outTime! };
    case "STATUS":
      return { kind: "STATUS", id: r.id, origin: r.origin, status: r.status as "P" | "A" | "HD_FIRST" | "HD_SECOND" | "WORKED" };
    case "CLEARED":
      return null;
  }
}

/** The active override rows (latest per employee-day, CLEARED ones excluded) for these employees over [from, to]. */
export async function activeOverrideRows(employeeIds: string[], from: string, to: string): Promise<Map<string, AttendanceOverride>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await prisma.attendanceOverride.findMany({
    where: { employeeId: { in: employeeIds }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    orderBy: { seq: "asc" },
  });
  const latest = new Map<string, AttendanceOverride>();
  for (const r of rows) latest.set(overrideKey(r.employeeId, iso(r.date)), r); // ascending: the latest wins
  for (const [k, r] of latest) if (r.kind === "CLEARED") latest.delete(k);
  return latest;
}

/** What the engine takes: one DayOverride per employee-day. */
export async function loadOverrides(employeeIds: string[], from: string, to: string): Promise<Map<string, DayOverride>> {
  const out = new Map<string, DayOverride>();
  for (const [k, r] of await activeOverrideRows(employeeIds, from, to)) {
    const o = toDayOverride(r);
    if (o) out.set(k, o);
  }
  return out;
}

export type NewOverride = {
  employeeId: string;
  date: string;
  origin: "REGULARIZATION" | "MANUAL_OVERRIDE";
  kind: "ADD_TIME" | "TIMES" | "STATUS" | "CLEARED";
  inTime?: string | null;
  outTime?: string | null;
  status?: string | null;
  reasonCode?: "FORGOT_TO_PUNCH" | "DEVICE_DOWN" | "ON_DUTY_ELSEWHERE" | "OTHER" | null;
  reason?: string;
  requestId?: string | null;
  createdByUserId: string;
};

/** Append override rows (never edit): returns what was written. */
export async function appendOverrides(tx: Prisma.TransactionClient, rows: NewOverride[]): Promise<AttendanceOverride[]> {
  const written: AttendanceOverride[] = [];
  for (const r of rows) {
    written.push(
      await tx.attendanceOverride.create({
        data: {
          employeeId: r.employeeId,
          date: new Date(`${r.date}T00:00:00Z`),
          origin: r.origin,
          kind: r.kind,
          inTime: r.inTime ?? null,
          outTime: r.outTime ?? null,
          status: r.status ?? null,
          reasonCode: r.reasonCode ?? null,
          reason: r.reason ?? "",
          requestId: r.requestId ?? null,
          createdByUserId: r.createdByUserId,
        },
      }),
    );
  }
  return written;
}
