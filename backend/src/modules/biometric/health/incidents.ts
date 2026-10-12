import { Prisma, type DeviceIncident, type DeviceIncidentKind } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { emitDeviceStatus } from "../../../realtime/emit";

// Opening and closing incidents (docs/plans/PHASE_2.md "P2-H build design").
// The partial unique index in the migration means two checks (two processes, a
// slow run overlapping the next) cannot open the same incident twice: the loser
// gets a unique violation and simply finds the winner's row.

export interface Subject {
  deviceId?: string;
  agentId?: string;
}

export const subjectWhere = (s: Subject) => ({ deviceId: s.deviceId ?? null, agentId: s.agentId ?? null });

export async function openIncident(input: { kind: DeviceIncidentKind; subject: Subject; now: Date; lastContactAt: Date | null; details: Record<string, unknown>; escalateAfter: Date | null }): Promise<{ incident: DeviceIncident; created: boolean }> {
  try {
    const incident = await prisma.deviceIncident.create({
      data: { kind: input.kind, ...subjectWhere(input.subject), openedAt: input.now, lastContactAt: input.lastContactAt, details: input.details as Prisma.InputJsonValue, escalateAfter: input.escalateAfter },
    });
    emitDeviceStatus({ ...(input.subject.deviceId ? { deviceId: input.subject.deviceId } : {}), ...(input.subject.agentId ? { agentId: input.subject.agentId } : {}) });
    return { incident, created: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.deviceIncident.findFirstOrThrow({ where: { kind: input.kind, ...subjectWhere(input.subject), resolvedAt: null } });
      return { incident: existing, created: false };
    }
    throw err;
  }
}

/** Closes it (once). `quiet` records it as closed without a recovery notice (a device switched off, a subject that no longer exists). */
export async function resolveIncident(incident: DeviceIncident, now: Date, opts: { quiet?: boolean; details?: Record<string, unknown> } = {}): Promise<DeviceIncident> {
  const updated = await prisma.deviceIncident.update({
    where: { id: incident.id },
    data: {
      resolvedAt: now,
      ...(opts.quiet ? { recoveryNotifiedAt: now } : {}),
      ...(opts.details ? { details: { ...(incident.details as Record<string, unknown>), ...opts.details } as Prisma.InputJsonValue } : {}),
    },
  });
  emitDeviceStatus({ ...(incident.deviceId ? { deviceId: incident.deviceId } : {}), ...(incident.agentId ? { agentId: incident.agentId } : {}) });
  return updated;
}

export const openIncidents = () => prisma.deviceIncident.findMany({ where: { resolvedAt: null }, orderBy: { openedAt: "asc" } });
