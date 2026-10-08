import type { BiometricAgent, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { ingest, type IngestResult } from "./ingestion";

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

interface HeartbeatBody {
  version: string;
  host: string;
  devices: Array<{ device: string; reachable: boolean } & Record<string, unknown>>;
}

export async function heartbeat(agent: BiometricAgent, body: HeartbeatBody, now: Date = new Date()): Promise<{ ok: true; serverTime: string; devices: string[] }> {
  const assigned = await prisma.device.findMany({ where: { agentId: agent.id, isActive: true }, select: { id: true, serialNumber: true } });
  const reachable = body.devices.filter((d) => d.reachable).map((d) => d.device);
  await prisma.$transaction([
    prisma.biometricAgent.update({ where: { id: agent.id }, data: { version: body.version, host: body.host, lastHeartbeatAt: now, lastHeartbeat: body as unknown as Prisma.InputJsonValue } }),
    prisma.device.updateMany({ where: { agentId: agent.id, serialNumber: { in: reachable } }, data: { lastHeartbeatAt: now } }),
  ]);
  // The server's clock lets the agent measure each device's drift (P2-F); the
  // device list tells it what to poll, so assignment changes need no restart.
  return { ok: true, serverTime: now.toISOString(), devices: assigned.map((d) => d.serialNumber) };
}
