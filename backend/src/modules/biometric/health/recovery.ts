import type { DeviceIncident } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { hhmm, type RecoverySummary } from "./messages";
import { branchWindows, businessDateAt } from "./windows";

// What a recovery notice says was missed (docs/plans/PHASE_2.md "P2-H build
// design"): not "device back online" but how long, how many punches made in the
// gap have since arrived, and who is still expected with no punch today, so HR
// knows whether anyone's attendance needs correcting. Counted from the raw
// punches, which are immutable, so the figure is a fact and not an estimate.

export async function summariseRecovery(incident: DeviceIncident, now: Date): Promise<RecoverySummary> {
  const none: RecoverySummary = { arrivedPunches: null, expectedWithoutPunch: null, firstPunchAt: null };
  const devices = incident.deviceId
    ? await prisma.device.findMany({ where: { id: incident.deviceId }, select: { id: true, locationId: true } })
    : await prisma.device.findMany({ where: { agentId: incident.agentId ?? "none", isActive: true }, select: { id: true, locationId: true } });
  if (devices.length === 0) return none;
  const deviceIds = devices.map((d) => d.id);
  const today = businessDateAt(now);
  const day = new Date(`${today}T00:00:00Z`);

  if (incident.kind === "NO_PUNCHES_TODAY") {
    const first = await prisma.rawPunch.findFirst({ where: { deviceId: { in: deviceIds }, businessDate: day }, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } });
    return { ...none, firstPunchAt: first ? hhmm(first.punchedAt) : null };
  }
  if (incident.kind !== "DEVICE_SILENT" && incident.kind !== "AGENT_SILENT") return none;

  const gapFrom = incident.lastContactAt ?? incident.openedAt;
  const gapTo = incident.resolvedAt ?? now;
  // Punches made during the gap that reached the server afterwards: the catch-up.
  const arrivedPunches = await prisma.rawPunch.count({ where: { deviceId: { in: deviceIds }, punchedAt: { gte: gapFrom, lte: gapTo }, receivedAt: { gte: gapFrom } } });

  const windows = await branchWindows(today);
  // "No punch yet today" only means something once the branch's working day has begun (an agent PC switched on at 08:00 for a 10:00 shift).
  const branches = [...new Set(devices.map((d) => d.locationId))].map((l) => windows.get(l)).filter((w): w is NonNullable<typeof w> => !!w);
  const begun = branches.filter((w) => w.start <= now.getTime());
  if (branches.length > 0 && begun.length === 0) return { ...none, arrivedPunches, workNotStarted: true };
  const expected = begun.flatMap((w) => w.employeeIds);
  if (expected.length === 0) return { ...none, arrivedPunches };
  const punched = await prisma.rawPunch.findMany({ where: { employeeId: { in: expected }, businessDate: day }, select: { employeeId: true }, distinct: ["employeeId"] });
  return { ...none, arrivedPunches, expectedWithoutPunch: expected.length - punched.length };
}
