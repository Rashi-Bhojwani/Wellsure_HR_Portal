import type { BiometricAgent, Prisma } from "@prisma/client";
import type { AgentHeartbeatResponse } from "@shared/attendance/agentProtocol";
import { getDeviceHealthThresholds } from "../../lib/deviceHealthSettings";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { emitDeviceStatus } from "../../realtime/emit";
import { ingest, type IngestResult } from "./ingestion";
import type { AgentHeartbeatBody } from "./validators";

// The sync agent's side of the API (docs/plans/PHASE_2.md §3 "Agent
// endpoints"). An agent may post only for devices assigned to it. The
// response's highest timestamp is what it advances its cursor to — and only
// after a successful response, so a failed post is simply re-sent (the
// exact-duplicate key makes that harmless).

async function deviceForAgent(agent: BiometricAgent, serialNumber: string) {
  const device = await prisma.device.findUnique({ where: { serialNumber } });
  if (!device || device.agentId !== agent.id || !device.isActive || device.route !== "AGENT") {
    throw new HttpError(403, `Device "${serialNumber}" isn't an active device assigned to this agent.`, "DEVICE_NOT_ASSIGNED");
  }
  return device;
}

export async function postPunches(agent: BiometricAgent, body: { device: string; lines: string[] }): Promise<IngestResult> {
  const device = await deviceForAgent(agent, body.device);
  return ingest({ route: "AGENT", device, text: body.lines.join("\n"), agentId: agent.id });
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The agent's heartbeat (P2-F, docs/plans/PHASE_2.md "P2-F build design").
 * Stores what it reports — on the agent, and per device assigned to it — and
 * replies with what it needs to know about each of those devices, plus the
 * device-health thresholds. A change made in the app therefore reaches the
 * agent within one cycle, with no restart.
 *
 * The last successful read is placed on the SERVER's clock from the agent's
 * "seconds since", so a wrong PC clock can't hide (or invent) a gap; and the
 * retention state shown on screen is worked out from it when it is read, so it
 * keeps climbing on its own if the agent stops reporting.
 */
export async function heartbeat(agent: BiometricAgent, body: AgentHeartbeatBody, now: Date = new Date()): Promise<AgentHeartbeatResponse> {
  const [assigned, thresholds] = await Promise.all([
    prisma.device.findMany({ where: { agentId: agent.id, isActive: true, route: "AGENT" }, orderBy: { name: "asc" } }),
    getDeviceHealthThresholds(),
  ]);
  const bySerial = new Map(assigned.map((d) => [d.serialNumber, d]));
  const deviceUpdates = body.devices.flatMap((report) => {
    const device = bySerial.get(report.device);
    if (!device) return []; // not this agent's to report on; the agent marks it NOT_ASSIGNED itself
    const serverLastReadAt = typeof report.secondsSinceLastRead === "number" ? new Date(now.getTime() - report.secondsSinceLastRead * 1000).toISOString() : null;
    return [
      prisma.device.update({
        where: { id: device.id },
        data: {
          agentReport: { ...report, serverLastReadAt } as unknown as Prisma.InputJsonValue,
          agentReportAt: now,
          ...(report.reachable ? { lastHeartbeatAt: now } : {}),
        },
      }),
    ];
  });
  await prisma.$transaction([
    prisma.biometricAgent.update({ where: { id: agent.id }, data: { version: body.version, host: body.host, lastHeartbeatAt: now, lastHeartbeat: body as unknown as Prisma.InputJsonValue } }),
    ...deviceUpdates,
  ]);
  emitDeviceStatus({ agentId: agent.id });
  return {
    ok: true,
    serverTime: now.toISOString(),
    devices: assigned.map((d) => ({
      serial: d.serialNumber,
      name: d.name,
      timezone: d.timezone,
      syncFrom: isoDay(d.syncFrom),
      retentionDays: d.retentionDays,
      retentionRecords: d.retentionRecords,
      isSimulated: d.isSimulated,
    })),
    thresholds,
  };
}
