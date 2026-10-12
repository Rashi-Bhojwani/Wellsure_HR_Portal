import type { DeviceIncident, DeviceIncidentKind } from "@prisma/client";
import { toMinutes } from "@shared/utils/attendance";
import { getDeviceAlertSettings, type DeviceAlertSettings } from "../../../lib/deviceAlertSettings";
import { getDeviceHealthThresholds } from "../../../lib/deviceHealthSettings";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { addDays, dayStartMs } from "../../attendance/engine/time";
import { deviceHealth } from "../deviceHealth";
import { openIncident, openIncidents, resolveIncident, type Subject } from "./incidents";
import { sendEscalation, sendOpened, sendRecovered } from "./notify";
import { peopleWithoutMapping } from "./people";
import { summariseRecovery } from "./recovery";
import { nextWindowStart, windowContaining, windowsAround } from "./windows";

// The device and agent health check (docs/plans/PHASE_2.md "P2-H build design",
// spec §4.7). Runs every minute on the scheduler; every decision is a function
// of the database and `now`, so a test (or the simulator) can put the clock
// where it likes. It does three things, in order:
//   1. open and close incidents from the current facts;
//   2. tell people: a new incident once, one escalation if it is still open at
//      the start of the next working day, and a recovery notice that says what
//      was missed once a closed incident has settled;
//   3. nothing else. It never changes a device or an agent.

export interface HealthRunResult {
  opened: Array<{ kind: DeviceIncidentKind; deviceId: string | null; agentId: string | null }>;
  resolved: Array<{ kind: DeviceIncidentKind; deviceId: string | null; agentId: string | null }>;
  notified: { opened: number; escalated: number; recovered: number };
}

const MIN = 60_000;
const utcDay = (date: string) => new Date(`${date}T00:00:00Z`);

export async function runDeviceHealthChecks(now: Date = new Date()): Promise<HealthRunResult> {
  const settings = await getDeviceAlertSettings();
  const thresholds = await getDeviceHealthThresholds();
  const result: HealthRunResult = { opened: [], resolved: [], notified: { opened: 0, escalated: 0, recovered: 0 } };
  const open = await openIncidents();
  const find = (kind: DeviceIncidentKind, s: Subject) => open.find((i) => i.kind === kind && i.deviceId === (s.deviceId ?? null) && i.agentId === (s.agentId ?? null)) ?? null;

  const { today, byDate } = await windowsAround(now);
  const todayWindows = byDate.get(today)!;

  /** Open when wanted and not open; close when not wanted and open. `keepOpen` blocks closing (e.g. the window has ended but the device is still unheard from). */
  async function reconcile(kind: DeviceIncidentKind, subject: Subject, want: boolean, ctx: { lastContactAt: Date | null; details: Record<string, unknown>; locationIds: string[]; clear?: boolean; quiet?: boolean }) {
    const existing = find(kind, subject);
    if (want && !existing) {
      const escalateAfter = await nextWindowStart(ctx.locationIds, now);
      const { incident, created } = await openIncident({ kind, subject, now, lastContactAt: ctx.lastContactAt, details: ctx.details, escalateAfter });
      if (created) result.opened.push({ kind, deviceId: incident.deviceId, agentId: incident.agentId });
    } else if (existing && (ctx.quiet || (!want && (ctx.clear ?? true)))) {
      await resolveIncident(existing, now, { quiet: ctx.quiet });
      result.resolved.push({ kind, deviceId: existing.deviceId, agentId: existing.agentId });
    }
  }

  // ── agents ──
  const agents = await prisma.biometricAgent.findMany({ include: { devices: { select: { id: true, isActive: true, locationId: true } } } });
  const agentSilentOpen = new Set<string>();
  for (const agent of agents) {
    const subject = { agentId: agent.id };
    const activeDevices = agent.devices.filter((d) => d.isActive);
    const locationIds = [...new Set(activeDevices.map((d) => d.locationId))];
    if (!agent.isActive || activeDevices.length === 0) {
      await reconcile("AGENT_SILENT", subject, false, { lastContactAt: null, details: {}, locationIds, quiet: true });
      continue;
    }
    if (!agent.lastHeartbeatAt) continue; // never reported: nothing to have gone quiet
    const silentMs = now.getTime() - agent.lastHeartbeatAt.getTime();
    const want = silentMs >= settings.agentSilentMinutes * MIN;
    await reconcile("AGENT_SILENT", subject, want, { lastContactAt: agent.lastHeartbeatAt, details: { silentMinutes: Math.floor(silentMs / MIN) }, locationIds });
    if (want || find("AGENT_SILENT", subject)) agentSilentOpen.add(agent.id);
  }
  const agentOf = new Map(agents.map((a) => [a.id, a]));

  // ── devices ──
  const devices = await prisma.device.findMany();
  for (const device of devices) {
    const subject = { deviceId: device.id };
    const locationIds = [device.locationId];
    if (!device.isActive) {
      for (const kind of ["DEVICE_SILENT", "NO_PUNCHES_TODAY", "CLOCK_DRIFT", "RETENTION_RISK"] as const) await reconcile(kind, subject, false, { lastContactAt: null, details: {}, locationIds, quiet: true });
      continue;
    }
    const agent = device.agentId ? (agentOf.get(device.agentId) ?? null) : null;
    const health = deviceHealth(device, agent ? { lastHeartbeatAt: agent.lastHeartbeatAt } : null, thresholds, now);

    // Contact: the agent's last successful read of it, or the device's own poll / upload. A device nobody has ever heard from has not "gone quiet":
    // alerts are for things that stop (connection day has a person present, and the Devices screen says "not connected yet").
    const heardAt = device.route === "PUSH" ? [device.lastHeartbeatAt, device.lastReceivedAt].filter((d): d is Date => !!d) : health.lastReadAt ? [new Date(health.lastReadAt)] : [];
    const contactAt: Date | null = heardAt.length ? new Date(Math.max(...heardAt.map((d) => d.getTime()))) : null;
    const fresh = contactAt !== null && now.getTime() - contactAt.getTime() < settings.deviceSilentMinutes * MIN;
    const agentIsSilent = !!device.agentId && agentSilentOpen.has(device.agentId);

    // 1. No contact for N minutes during working hours. The root cause of an agent that has stopped is the agent, so no second incident for its devices.
    const window = windowContaining(byDate, device.locationId, now);
    const silentSince = window && contactAt ? Math.max(contactAt.getTime(), window.start) : null;
    const silentMs = silentSince === null ? 0 : now.getTime() - silentSince;
    const silentWant = !!window && contactAt !== null && silentMs >= settings.deviceSilentMinutes * MIN && !agentIsSilent;
    await reconcile("DEVICE_SILENT", subject, silentWant, {
      lastContactAt: contactAt,
      details: { silentMinutes: Math.floor(silentMs / MIN), windowStart: window ? new Date(window.start).toISOString() : null, windowEnd: window ? new Date(window.end).toISOString() : null },
      locationIds,
      // It closes when contact is back, not when the working window happens to end.
      clear: fresh,
    });

    // 2. The morning check: reachable, people expected, nobody has punched.
    const todayWindow = todayWindows.get(device.locationId);
    const contactIncidentOpen = !!find("DEVICE_SILENT", subject) || agentIsSilent;
    const punchesToday = await prisma.rawPunch.count({ where: { deviceId: device.id, businessDate: utcDay(today) } });
    let noPunchWant = false;
    let noPunchDetails: Record<string, unknown> = {};
    if (todayWindow) {
      const checkAt = Math.max(dayStartMs(today) + toMinutes(settings.morningCheckTime) * MIN, todayWindow.start + settings.deviceSilentMinutes * MIN);
      if (now.getTime() >= checkAt && fresh && !contactIncidentOpen && punchesToday === 0) {
        const lastTwoWeeks = await prisma.rawPunch.count({ where: { deviceId: device.id, businessDate: { gte: utcDay(addDays(today, -14)), lt: utcDay(today) } } });
        if (lastTwoWeeks > 0) {
          noPunchWant = true;
          noPunchDetails = {
            expectedPeople: todayWindow.employeeIds.length,
            checkedAt: new Date(now.getTime() + 330 * MIN).toISOString().slice(11, 16),
            branchPeopleWithoutMapping: (await peopleWithoutMapping(today, device.locationId)).length,
            unmappedPunchesYesterday: await prisma.rawPunch.count({ where: { deviceId: device.id, employeeId: null, businessDate: utcDay(addDays(today, -1)) } }),
          };
        }
      }
    }
    await reconcile("NO_PUNCHES_TODAY", subject, noPunchWant, { lastContactAt: null, details: noPunchDetails, locationIds, clear: punchesToday > 0 });

    // 3. Clock drift and the retention guard: the agent's report, now with a start, an end and a notice.
    const drift = health.clockDrift;
    await reconcile("CLOCK_DRIFT", subject, !!drift?.exceeded, { lastContactAt: null, details: { offsetSeconds: drift?.offsetSeconds ?? null, text: drift?.text ?? null }, locationIds });
    const risk = health.retention?.state === "RISK" || !!health.retention?.logNearlyFull;
    const reason = health.retention?.logNearlyFull ? `The device's log is ${health.retention.logFullPercent ?? "nearly"}% full.` : `The device has not been read for ${health.retention?.gapHours ?? "many"} hours against a retention window of ${health.retention?.windowHours ?? "?"} hours.`;
    await reconcile("RETENTION_RISK", subject, risk, { lastContactAt: null, details: { reason, state: health.retention?.state ?? null, logFullPercent: health.retention?.logFullPercent ?? null }, locationIds });
  }

  await tellPeople(now, settings, result);
  return result;
}

/** At most once each: claim the row (an update that only one process can win), then send. */
async function tellPeople(now: Date, settings: DeviceAlertSettings, result: HealthRunResult): Promise<void> {
  const claim = async (id: string, field: "openNotifiedAt" | "escalatedAt" | "recoveryNotifiedAt", extra: Record<string, unknown> = {}) =>
    (await prisma.deviceIncident.updateMany({ where: { id, [field]: null }, data: { [field]: now, ...extra } })).count === 1;
  const guarded = async (what: string, incident: DeviceIncident, send: () => Promise<void>) => {
    try {
      await send();
    } catch (err) {
      logger.error({ event: "device.incident.notify_failed", what, incidentId: incident.id, err }, "could not notify about a device incident");
    }
  };

  for (const i of await prisma.deviceIncident.findMany({ where: { resolvedAt: null, openNotifiedAt: null } })) {
    if (await claim(i.id, "openNotifiedAt")) {
      await guarded("opened", i, () => sendOpened(i, settings));
      result.notified.opened++;
    }
  }
  for (const i of await prisma.deviceIncident.findMany({ where: { resolvedAt: null, escalatedAt: null, openNotifiedAt: { not: null }, escalateAfter: { lte: now } } })) {
    if (await claim(i.id, "escalatedAt")) {
      await guarded("escalated", i, () => sendEscalation(i, now, settings));
      result.notified.escalated++;
    }
  }
  const settled = new Date(now.getTime() - settings.recoverySettleSeconds * 1000);
  for (const i of await prisma.deviceIncident.findMany({ where: { resolvedAt: { lte: settled }, recoveryNotifiedAt: null, openNotifiedAt: { not: null } } })) {
    if (await claim(i.id, "recoveryNotifiedAt")) {
      await guarded("recovered", i, async () => {
        const summary = await summariseRecovery(i, now);
        await prisma.deviceIncident.update({ where: { id: i.id }, data: { recoverySummary: summary as never } });
        await sendRecovered(i, summary, settings);
      });
      result.notified.recovered++;
    }
  }
  // An incident that closed before anyone was told about it (opened and cleared within one run's gap) needs no recovery notice.
  await prisma.deviceIncident.updateMany({ where: { resolvedAt: { not: null }, openNotifiedAt: null, recoveryNotifiedAt: null }, data: { recoveryNotifiedAt: now } });
}
