import { addDays } from "../engine/time";

// The shift roster's rotation, as a pure function (Phase 3 commit 2, docs/plans/PHASE_3.md "Shift Roster rules").
// A rotation is a list of steps (a shift, for a number of days) that repeats from a start date until an end date.
// The result is the assignment segments to write: one per change of shift, adjacent equal shifts merged, because the
// assignment history stores a row per change, not a row per day.

export interface RotationStep {
  shiftId: string;
  days: number;
}

export interface Segment {
  /** First day on this shift. */
  from: string;
  shiftId: string;
}

export interface RotationInput {
  start: string;
  steps: RotationStep[];
  /** Repeat the steps until `until` (inclusive). Without it the steps run once and the last shift stays. */
  repeat: boolean;
  until?: string | null;
}

/** The segments a rotation writes, in date order. The last one is open-ended: the caller adds the return row if wanted. */
export function rotationSegments(input: RotationInput): Segment[] {
  const { start, steps, repeat } = input;
  if (steps.length === 0) return [];
  const until = repeat ? input.until : null;
  if (repeat && !until) throw new Error("A repeating rotation needs an end date.");
  const out: Segment[] = [];
  const push = (from: string, shiftId: string) => {
    if (out.at(-1)?.shiftId !== shiftId) out.push({ from, shiftId });
  };
  let at = start;
  let i = 0;
  // One pass of the steps, or cycles until the end date.
  for (;;) {
    const step = steps[i % steps.length]!;
    if (until && at > until) break;
    push(at, step.shiftId);
    at = addDays(at, step.days);
    i += 1;
    if (!until && i >= steps.length) break;
  }
  return out;
}

/** The first day after the rotation ends (when people go back to their previous shift). */
export const dayAfter = (date: string): string => addDays(date, 1);
