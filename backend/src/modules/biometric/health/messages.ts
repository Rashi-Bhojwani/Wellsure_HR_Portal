import type { DeviceIncidentKind } from "@prisma/client";
import { instantToLocalTime } from "@shared/attendance/attlog";

// The words of the alerts (docs/plans/PHASE_2.md "P2-H build design"). Pure, so
// what HR is told is tested. The recovery notice is the one that has to be
// actionable: "device back online" says nothing; "back online after 4 hours,
// 37 punches arrived, 3 people still have none, check whether their attendance
// needs correcting" says what to do.

const IST = "Asia/Kolkata";
export const hhmm = (d: Date): string => instantToLocalTime(d, IST).slice(11, 16);

/** "4 h 10 min", "35 min", "2 days 3 h". */
export function humanDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} day${days === 1 ? "" : "s"} ${h} h` : `${days} day${days === 1 ? "" : "s"}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface IncidentFacts {
  kind: DeviceIncidentKind;
  /** The device ("C-10 entrance") or, for an agent incident, the agent ("C-10 office PC"). */
  subject: string;
  branch: string | null;
  openedAt: Date;
  lastContactAt: Date | null;
  details: Record<string, unknown>;
}

export interface Message {
  title: string;
  body: string;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function openedMessage(f: IncidentFacts): Message {
  const where = f.branch ? ` (${f.branch})` : "";
  const since = f.lastContactAt ? ` Last heard from at ${hhmm(f.lastContactAt)}.` : "";
  switch (f.kind) {
    case "DEVICE_SILENT":
      return {
        title: `${f.subject}${where} has gone quiet`,
        body: `No contact with the biometric device for ${humanDuration(Number(f.details.silentMinutes ?? 0) * 60_000)} during working hours.${since} Punches made now are not reaching the system; check the device is on and on the network. If its log fills or wraps they could be lost.`,
      };
    case "AGENT_SILENT":
      return {
        title: `${f.subject}${where} has stopped reporting`,
        body: `The sync agent on the office PC has not reported for ${humanDuration(Number(f.details.silentMinutes ?? 0) * 60_000)}.${since} Until it is back no punches reach the system. Check the PC is on and online and the agent service is running (INSTALL.md, \`status\`).`,
      };
    case "NO_PUNCHES_TODAY":
      return {
        title: `${f.subject}${where}: no punches today`,
        body: `The device is reachable and ${plural(Number(f.details.expectedPeople ?? 0), "person is", "people are")} expected, but nobody has punched today (checked at ${f.details.checkedAt ?? "the morning check"}). ${num(f.details.branchPeopleWithoutMapping) ? `${plural(Number(f.details.branchPeopleWithoutMapping), "person")} at this branch ${Number(f.details.branchPeopleWithoutMapping) === 1 ? "has" : "have"} no device ID mapped. ` : ""}${num(f.details.unmappedPunchesYesterday) ? `${plural(Number(f.details.unmappedPunchesYesterday), "punch", "punches")} from unknown IDs arrived yesterday: see Unmapped on the Devices screen.` : ""}`.trim(),
      };
    case "CLOCK_DRIFT":
      return { title: `${f.subject}${where}: clock is wrong`, body: `The device's clock is ${String(f.details.text ?? "off")}. Punch times, lateness and which day a night shift's punch belongs to depend on it. Set it from the device's own menu; the system never changes it.` };
    case "RETENTION_RISK":
      return { title: `${f.subject}${where}: punches at risk on the device`, body: `${String(f.details.reason ?? "The device log is nearly full or has not been read for long.")} Punches not yet read can be overwritten.` };
  }
}

export function escalationMessage(f: IncidentFacts, now: Date): Message {
  const m = openedMessage(f);
  return {
    title: `Still open: ${m.title}`,
    body: `This has been open for ${humanDuration(now.getTime() - f.openedAt.getTime())} and a new working day has started. ${m.body}`,
  };
}

export interface RecoverySummary {
  /** Punches made during the gap that have since arrived (device incidents). */
  arrivedPunches: number | null;
  /** People expected at the affected branch(es) with no punch yet today, when known. */
  expectedWithoutPunch: number | null;
  /** The first punch of the day, for a "no punches today" incident. */
  firstPunchAt: string | null;
}

export function recoveredMessage(f: IncidentFacts, resolvedAt: Date, r: RecoverySummary): Message {
  const from = f.lastContactAt ?? f.openedAt;
  const gap = humanDuration(resolvedAt.getTime() - from.getTime());
  const span = `${hhmm(from)}–${hhmm(resolvedAt)}`;
  const where = f.branch ? ` (${f.branch})` : "";
  switch (f.kind) {
    case "DEVICE_SILENT":
    case "AGENT_SILENT": {
      const noun = f.kind === "AGENT_SILENT" ? "The sync agent" : "The device";
      const lines = [`${noun} is back online after ${gap} (${span}).`];
      if (r.arrivedPunches !== null) {
        lines.push(
          r.arrivedPunches > 0
            ? `${plural(r.arrivedPunches, "punch", "punches")} made during that time ${r.arrivedPunches === 1 ? "has" : "have"} now arrived, and those days were recomputed.`
            : `No punches made during that time have arrived. If people punched meanwhile they may still be on the device, or lost if its log wrapped; check the device.`,
        );
      }
      if (r.expectedWithoutPunch !== null && r.expectedWithoutPunch > 0) {
        lines.push(`${plural(r.expectedWithoutPunch, "person is", "people are")} expected at ${f.branch ?? "the branch"} with no punch yet today: check whether anyone's attendance needs correcting (Attendance → Muster, or a missing-punch request).`);
      } else if (r.arrivedPunches !== null) {
        lines.push("Everyone expected today has a punch.");
      }
      return { title: `${f.subject}${where} is back after ${gap}`, body: lines.join(" ") };
    }
    case "NO_PUNCHES_TODAY":
      return { title: `${f.subject}${where}: punches are arriving again`, body: `The first punch of the day arrived at ${r.firstPunchAt ?? hhmm(resolvedAt)}, ${gap} after the morning check raised this. Anyone who punched before then is already included.` };
    case "CLOCK_DRIFT":
      return { title: `${f.subject}${where}: clock is right again`, body: `The device's clock is back within the limit after ${gap}. Punches made while it was off carry the wrong time: check the days in that period if lateness looks odd.` };
    case "RETENTION_RISK":
      return { title: `${f.subject}${where}: punches are safe again`, body: `The device has been read and its log is no longer at risk (open for ${gap}).` };
  }
}
