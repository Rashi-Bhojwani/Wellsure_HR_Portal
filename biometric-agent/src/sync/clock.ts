import { localTimeToInstant } from "@shared/attendance/attlog";

// Clock drift (docs/plans/PHASE_2.md §7.1): measured, reported, never
// corrected (P2-F rule 5). The device's clock is read against the PC's, and
// the PC's against the server's (from the last heartbeat round trip), so a
// wrong PC clock doesn't make a correct device look wrong.

/** Device clock minus PC clock, seconds. The device keeps local wall-clock time in its zone. */
export function deviceMinusPcSeconds(deviceLocal: string, timezone: string, pcNow: Date): number {
  return Math.round((localTimeToInstant(deviceLocal, timezone).getTime() - pcNow.getTime()) / 1000);
}

/** PC clock minus server clock, from one round trip: the server's time is taken as the midpoint. */
export function pcMinusServerSeconds(sentAtMs: number, receivedAtMs: number, serverTime: string): number {
  return Math.round(((sentAtMs + receivedAtMs) / 2 - Date.parse(serverTime)) / 1000);
}
