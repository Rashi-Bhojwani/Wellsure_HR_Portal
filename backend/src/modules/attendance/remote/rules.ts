// Remote attendance, the pure part (docs/plans/STAGE_5A_PLAN.md). Nothing here reads the database.

export type Half = "FIRST" | "SECOND";
export type RejectOutcome = "ABSENT" | "LOSS_OF_PAY";

export type Decision = { kind: "FULL" } | { kind: "HALF"; half: Half } | { kind: "REJECT"; reason: string; outcome: RejectOutcome };

/** The status the engine's own override machinery is given for a decision (the engine turns it into days and into loss of pay). */
export type OverrideStatus = "P" | "HD_FIRST" | "HD_SECOND" | "A";

export interface OutcomeFor {
  status: OverrideStatus;
  /** What the muster note and the audit say. */
  label: string;
}

/**
 * The one mapping from a director's decision to what attendance records. A full day is present; a half day is present for the half the director names (the engine marks the
 * other half absent, half a day of loss of pay); a rejection is absent (the engine's absent day is one day of loss of pay, the path payroll already reads). Absent and Loss of
 * pay are two names the director chooses between: both reach attendance as the same absent day today, and the record keeps which was chosen.
 */
export function outcomeFor(d: Decision): OutcomeFor {
  if (d.kind === "FULL") return { status: "P", label: "Remote work approved for the full day" };
  if (d.kind === "HALF") return { status: d.half === "FIRST" ? "HD_FIRST" : "HD_SECOND", label: `Remote work approved for a half day (${d.half === "FIRST" ? "first" : "second"} half)` };
  return { status: "A", label: d.outcome === "LOSS_OF_PAY" ? "Remote work rejected: loss of pay" : "Remote work rejected: absent" };
}

export type Who = { ok: true } | { ok: false; code: "NOT_A_DIRECTOR" | "OWN_RECORD"; message: string };

/** Only a director decides; never their own record (it goes to the other director). */
export function whoMayDecide(p: { actorUserId: string; ownerUserId: string | null; actorIsDirector: boolean }): Who {
  if (!p.actorIsDirector) return { ok: false, code: "NOT_A_DIRECTOR", message: "Only a director decides remote work." };
  if (p.ownerUserId !== null && p.ownerUserId === p.actorUserId) return { ok: false, code: "OWN_RECORD", message: "This is your own record, so the other director decides it." };
  return { ok: true };
}

export interface Mark {
  effectiveFrom: string;
  createdAt: string;
  remote: boolean;
}

/** Is the person remote on `day`? The latest mark effective on or before the day decides (a later-written mark beats an earlier one on the same date). No mark: not remote. */
export function remoteOn(marks: readonly Mark[], day: string): boolean {
  let best: Mark | null = null;
  for (const m of marks) {
    if (m.effectiveFrom > day) continue;
    if (!best || m.effectiveFrom > best.effectiveFrom || (m.effectiveFrom === best.effectiveFrom && m.createdAt > best.createdAt)) best = m;
  }
  return best?.remote === true;
}

export type RecordStatus = "OPEN" | "PENDING" | "APPROVED_FULL" | "APPROVED_HALF" | "REJECTED";
export const DECIDED: readonly RecordStatus[] = ["APPROVED_FULL", "APPROVED_HALF", "REJECTED"];

/** A time of day only, in the business time zone (Asia/Kolkata), as HH:MM. No date, no place. */
export function timeOnly(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

/** Minutes between two instants, rounded down. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 60_000); // allow-number: a count of minutes, not money
}

/** Whether a pending record is older than the reminder threshold (hours). A threshold that is Not set (null) never reminds. */
export function reminderDue(pendingSince: Date, now: Date, thresholdHours: number | null, alreadyRemindedAt: Date | null): boolean {
  if (thresholdHours === null || alreadyRemindedAt !== null) return false;
  return minutesBetween(pendingSince, now) >= thresholdHours * 60;
}
