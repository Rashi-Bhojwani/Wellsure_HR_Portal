// The seam between ingestion and the rules engine (docs/plans/PHASE_2.md §3).
// Ingestion (P2-B), late re-mapping and, later, manual entries call
// requestRecompute with the employee-days their new data touches. The engine
// (P2-C) registers the real handler — a debounced attendance.recompute job.
// Until then the request is a no-op, and the nightly catch-up (P2-C)
// recomputes everything since the last run, so nothing ingested before the
// engine exists is ever missed.

export interface DayRef {
  employeeId: string;
  /** The punch's business date (UTC midnight). The engine decides which attendance day it counts toward (night shifts). */
  date: Date;
}

type Handler = (days: DayRef[]) => Promise<void>;
let handler: Handler = async () => undefined;

export function setRecomputeHandler(h: Handler | null): void {
  handler = h ?? (async () => undefined);
}

/** Ask for these employee-days to be recomputed (duplicates collapsed). */
export async function requestRecompute(days: DayRef[]): Promise<void> {
  const seen = new Map<string, DayRef>();
  for (const d of days) seen.set(`${d.employeeId}|${d.date.toISOString().slice(0, 10)}`, d);
  if (seen.size) await handler([...seen.values()]);
}

/** Every day from `from` to `to` (inclusive, UTC-midnight dates) for each employee — capped at today by the engine. */
export async function requestRecomputeRange(employeeIds: string[], from: Date, to: Date): Promise<void> {
  const days: DayRef[] = [];
  for (const employeeId of employeeIds) {
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) days.push({ employeeId, date: d });
  }
  await requestRecompute(days);
}

// Company-wide changes (a holiday added, moved or removed) touch everyone
// employed on those dates: one job per date range, not one per person.
type DatesHandler = (dates: Date[]) => Promise<void>;
let datesHandler: DatesHandler = async () => undefined;
export function setRecomputeDatesHandler(h: DatesHandler | null): void {
  datesHandler = h ?? (async () => undefined);
}
export async function requestRecomputeForEveryone(dates: Date[]): Promise<void> {
  if (dates.length) await datesHandler(dates);
}
