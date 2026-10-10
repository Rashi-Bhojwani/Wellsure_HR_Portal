// The punch-to-screen latency test's arithmetic (docs/plans/PHASE_2.md
// "P2-G, commit G2 build design", G2b; spec gate G1): what counts as a pass.
// Pure, so the rules that decide pass and fail are themselves tested.

export type RouteName = "agent" | "push" | "file";
export type ScreenName = "employeeScreen" | "whoIsIn";

export interface Sample {
  route: RouteName;
  employee: string;
  /** Milliseconds from the punch reaching the server to it showing on that screen; null: that screen was not watched in this sample. */
  employeeScreenMs: number | null;
  whoIsInMs: number | null;
  /** Agent route only: the device recording the punch to the server receiving it (bounded by the poll interval). */
  punchToServerMs: number | null;
}

export interface Summary {
  count: number;
  min: number;
  median: number;
  max: number;
}

export function summarise(values: number[]): Summary | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return { count: v.length, min: v[0]!, median: v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2), max: v[v.length - 1]! };
}

export type Summaries = Record<RouteName, Record<ScreenName, Summary | null>>;

export function summarisePerRoute(samples: Sample[]): Summaries {
  const out = {} as Summaries;
  for (const route of ["agent", "push", "file"] as const) {
    const mine = samples.filter((s) => s.route === route);
    out[route] = {
      employeeScreen: summarise(mine.flatMap((s) => (s.employeeScreenMs === null ? [] : [s.employeeScreenMs]))),
      whoIsIn: summarise(mine.flatMap((s) => (s.whoIsInMs === null ? [] : [s.whoIsInMs]))),
    };
  }
  return out;
}

/** The gate: every sample, on both screens, within this long of the punch reaching the server. */
export const GATE_MS = 5000;

/** A baseline can't make a fast route's ordinary jitter a failure: nothing under this is ever a regression. */
export const BASELINE_FLOOR_MS = 2000;
export const BASELINE_FACTOR = 2;

export type Baseline = Partial<Record<RouteName, Partial<Record<ScreenName, number>>>>;

export function baselineOf(summaries: Summaries): Baseline {
  const out: Baseline = {};
  for (const route of Object.keys(summaries) as RouteName[]) {
    out[route] = {};
    for (const screen of Object.keys(summaries[route]) as ScreenName[]) {
      const m = summaries[route][screen]?.max;
      if (m !== undefined) out[route]![screen] = m;
    }
  }
  return out;
}

/** Everything that makes this run fail, in sentences. Empty means pass. */
export function verdict(samples: Sample[], summaries: Summaries, baseline: Baseline | null, gateMs = GATE_MS): string[] {
  const problems: string[] = [];
  for (const route of ["agent", "push", "file"] as const) {
    for (const screen of ["employeeScreen", "whoIsIn"] as const) {
      const s = summaries[route][screen];
      const label = `${route} route → ${screen === "employeeScreen" ? "the employee's Attendance Info" : "HR's Who Is In?"}`;
      if (!s) problems.push(`${label}: never measured`);
      else if (s.max > gateMs) problems.push(`${label}: slowest ${s.max} ms, over the ${gateMs} ms gate`);
      const base = baseline?.[route]?.[screen];
      if (s && base !== undefined && s.max > Math.max(base * BASELINE_FACTOR, BASELINE_FLOOR_MS)) {
        problems.push(`${label}: slowest ${s.max} ms against a baseline of ${base} ms (more than ${BASELINE_FACTOR}x, and over ${BASELINE_FLOOR_MS} ms)`);
      }
    }
  }
  if (samples.length === 0) problems.push("no samples were taken");
  return problems;
}
